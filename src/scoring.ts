import type { ContactCandidate, CrawledPage, EmailAddress, Evidence } from "./types.js";
import { isGenericEmail, normalizeEmail, normalizePhone, truncate, unique, uniqueBy } from "./utils.js";

const DELIVERABILITY_RANK: Record<EmailAddress["deliverability"], number> = {
  undeliverable: 0,
  unknown: 1,
  risky: 2,
  deliverable: 3,
};

function bestEmail(left: EmailAddress, right: EmailAddress): EmailAddress {
  const preferred = DELIVERABILITY_RANK[right.deliverability] > DELIVERABILITY_RANK[left.deliverability] ? right : left;
  const confidence = Math.max(left.confidence ?? 0, right.confidence ?? 0);
  return { ...preferred, ...(confidence > 0 ? { confidence } : {}) };
}

function mergeEmails(values: EmailAddress[]): EmailAddress[] {
  const byEmail = new Map<string, EmailAddress>();
  for (const value of values) {
    const email = normalizeEmail(value.value);
    if (!email) continue;
    const normalized = { ...value, value: email, generic: value.generic || isGenericEmail(email) };
    const current = byEmail.get(email);
    byEmail.set(email, current ? bestEmail(current, normalized) : normalized);
  }
  return [...byEmail.values()];
}

function candidateKeys(candidate: ContactCandidate): string[] {
  const emailKeys = candidate.emails.map((email) => `email:${normalizeEmail(email.value)}`);
  const socialKeys = candidate.socialUrls.map((url) => `social:${url.toLowerCase()}`);
  const personKey = candidate.fullName
    ? [`person:${candidate.fullName.toLowerCase()}|${candidate.position?.toLowerCase() ?? ""}`]
    : [];
  return [...emailKeys, ...socialKeys, ...personKey];
}

function combine(left: ContactCandidate, right: ContactCandidate): ContactCandidate {
  const leftNamed = Boolean(left.fullName);
  const rightNamed = Boolean(right.fullName);
  return {
    fullName: (rightNamed && !leftNamed ? right.fullName : left.fullName) ?? right.fullName,
    position: left.position ?? right.position,
    emails: mergeEmails([...left.emails, ...right.emails]),
    phones: unique([...left.phones, ...right.phones].map(normalizePhone).filter(Boolean)),
    socialUrls: unique([...left.socialUrls, ...right.socialUrls]),
    evidence: uniqueBy([...left.evidence, ...right.evidence], (item) => `${item.source}:${item.url}`),
    score: 0,
    scoreReasons: [],
  };
}

export function mergeCandidates(candidates: ContactCandidate[]): ContactCandidate[] {
  const groups: ContactCandidate[] = [];
  for (const candidate of candidates) {
    const keys = candidateKeys(candidate);
    const index = groups.findIndex((group) => candidateKeys(group).some((key) => keys.includes(key)));
    if (index < 0) {
      groups.push({ ...candidate, emails: mergeEmails(candidate.emails) });
    } else {
      const current = groups[index];
      if (current) groups[index] = combine(current, candidate);
    }
  }
  return groups;
}

export function candidatesFromPages(pages: CrawledPage[], evidence: Evidence[]): ContactCandidate[] {
  const evidenceByUrl = new Map(evidence.map((item) => [item.url, item]));
  const candidates: ContactCandidate[] = [];

  for (const page of pages) {
    const pageEvidence = evidenceByUrl.get(page.url);
    if (!pageEvidence) continue;
    for (const email of page.emails) {
      candidates.push({
        fullName: null,
        position: null,
        emails: [{ value: email, generic: isGenericEmail(email), deliverability: "unknown" }],
        phones: page.phones.slice(0, 3),
        socialUrls: page.socialUrls.slice(0, 5),
        evidence: [pageEvidence],
        score: 0,
        scoreReasons: [],
      });
    }
    if (page.emails.length === 0 && (page.phones.length > 0 || page.socialUrls.length > 0)) {
      candidates.push({
        fullName: null,
        position: null,
        emails: [],
        phones: page.phones.slice(0, 3),
        socialUrls: page.socialUrls.slice(0, 5),
        evidence: [pageEvidence],
        score: 0,
        scoreReasons: [],
      });
    }
  }

  return candidates;
}

export function candidatesFromEvidence(evidence: Evidence[]): ContactCandidate[] {
  const candidates: ContactCandidate[] = [];
  for (const item of evidence) {
    const emails = unique((item.snippet.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map(normalizeEmail));
    for (const email of emails) {
      candidates.push({
        fullName: null,
        position: null,
        emails: [{ value: email, generic: isGenericEmail(email), deliverability: "unknown" }],
        phones: [],
        socialUrls: [],
        evidence: [item],
        score: 0,
        scoreReasons: [],
      });
    }
  }
  return candidates;
}

export function scoreCandidate(candidate: ContactCandidate, targetRoles: string[]): ContactCandidate {
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(`${points > 0 ? "+" : ""}${points} ${reason}`);
  };

  if (candidate.fullName) add(15, "указано имя");
  const normalizedPosition = candidate.position?.toLowerCase() ?? "";
  if (candidate.position) add(5, "указана должность");
  if (targetRoles.some((role) => normalizedPosition.includes(role.toLowerCase()))) add(25, "целевая роль");

  const deliverable = candidate.emails.some((email) => email.deliverability === "deliverable");
  const direct = candidate.emails.some((email) => !email.generic);
  const generic = candidate.emails.some((email) => email.generic);
  const undeliverableOnly = candidate.emails.length > 0 && candidate.emails.every((email) => email.deliverability === "undeliverable");
  if (direct) add(20, "персональный email");
  else if (generic) add(5, "общий email");
  if (deliverable) add(20, "email подтверждён");
  const confidence = Math.max(0, ...candidate.emails.map((email) => email.confidence ?? 0));
  if (confidence >= 70) add(10, `уверенность провайдера ${confidence}%`);
  if (candidate.phones.length > 0) add(8, "есть телефон");
  if (candidate.socialUrls.length > 0) add(5, "есть соцсеть/мессенджер");
  if (candidate.evidence.some((item) => item.source === "website")) add(8, "официальный сайт");
  if (candidate.evidence.some((item) => item.source === "hunter")) add(8, "Hunter с источником");
  if (candidate.evidence.some((item) => item.source === "search" || item.source === "llm")) add(5, "веб-источник");
  if (new Set(candidate.evidence.map((item) => item.url)).size >= 2) add(5, "несколько источников");
  if (undeliverableOnly) add(-100, "email недоставляемый");

  return { ...candidate, score: Math.max(0, Math.min(100, score)), scoreReasons: reasons };
}

export function selectCandidates(
  candidates: ContactCandidate[],
  targetRoles: string[],
  minScore: number,
  maxContacts: number,
  includeGeneric: boolean,
): { scored: ContactCandidate[]; selected: ContactCandidate[] } {
  const scored = mergeCandidates(candidates)
    .map((candidate) => scoreCandidate(candidate, targetRoles))
    .filter((candidate) => candidate.emails.length > 0 || candidate.phones.length > 0 || candidate.socialUrls.length > 0)
    .sort((a, b) => b.score - a.score);
  const selected = scored.filter((candidate) => candidate.score >= minScore);

  if (includeGeneric && !selected.some((candidate) => candidate.emails.some((email) => email.generic))) {
    const genericFallback = scored.find(
      (candidate) =>
        candidate.emails.some((email) => email.generic && email.deliverability !== "undeliverable") &&
        candidate.evidence.some((item) => item.source === "website"),
    );
    if (genericFallback) selected.push({ ...genericFallback, scoreReasons: [...genericFallback.scoreReasons, "fallback: официальный общий адрес"] });
  }

  return { scored, selected: uniqueBy(selected, (candidate) => candidateKeys(candidate)[0] ?? truncate(JSON.stringify(candidate), 300)).slice(0, maxContacts) };
}
