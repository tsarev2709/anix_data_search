import type { ContactCandidate, CrawledPage, EmailAddress, Evidence } from "./types.js";
import { emailFromEvidence } from "./extraction.js";
import { isGenericEmail, normalizeEmail, normalizePhone, truncate, unique, uniqueBy } from "./utils.js";

const DELIVERABILITY_RANK: Record<EmailAddress["deliverability"], number> = {
  undeliverable: 0,
  unknown: 1,
  risky: 2,
  deliverable: 3,
};

function bestEmail(left: EmailAddress, right: EmailAddress): EmailAddress {
  const statusRank = (email: EmailAddress) => email.status === "inferred" ? 0 : email.status === "general" || email.generic ? 1 : 2;
  const leftRank = statusRank(left) * 10 + DELIVERABILITY_RANK[left.deliverability];
  const rightRank = statusRank(right) * 10 + DELIVERABILITY_RANK[right.deliverability];
  const preferred = rightRank > leftRank ? right : left;
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
    socialProfiles: uniqueBy([...(left.socialProfiles ?? []), ...(right.socialProfiles ?? [])], (profile) => `${profile.platform}:${profile.url}`),
    evidence: uniqueBy([...left.evidence, ...right.evidence], (item) => `${item.source}:${item.url}`),
    score: 0,
    scoreReasons: [],
  };
}

export function mergeCandidates(candidates: ContactCandidate[]): ContactCandidate[] {
  const groups: ContactCandidate[] = [];
  for (const candidate of candidates) {
    let merged = { ...candidate, emails: mergeEmails(candidate.emails) };
    let index = 0;
    while (index < groups.length) {
      const keys = candidateKeys(merged);
      const group = groups[index];
      if (group && candidateKeys(group).some((key) => keys.includes(key))) {
        merged = combine(group, merged);
        groups.splice(index, 1);
      } else {
        index += 1;
      }
    }
    groups.push(merged);
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
        emails: [emailFromEvidence(email, pageEvidence)],
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
        emails: [emailFromEvidence(email, item)],
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

  const officialEvidence = candidate.evidence.some((item) => item.source === "website" || item.source === "pdf" || item.source === "rss");
  if (candidate.fullName) add(10, "указано ФИО");
  const normalizedPosition = candidate.position?.toLowerCase() ?? "";
  if (candidate.position) add(5, "указана должность");
  if (candidate.fullName && candidate.position && officialEvidence) add(20, "ФИО и должность подтверждены официальным источником");
  if (targetRoles.some((role) => normalizedPosition.includes(role.toLowerCase()))) add(20, "целевая роль");

  const deliverable = candidate.emails.some((email) => email.deliverability === "deliverable");
  const directFound = candidate.emails.some((email) => !email.generic && email.status !== "inferred");
  const inferred = candidate.emails.some((email) => email.status === "inferred");
  const generic = candidate.emails.some((email) => email.generic);
  const undeliverableOnly = candidate.emails.length > 0 && candidate.emails.every((email) => email.deliverability === "undeliverable");
  if (directFound && officialEvidence) add(40, "персональный email найден в официальном источнике");
  else if (directFound) add(25, "персональный email буквально найден");
  else if (generic) add(10, "общий корпоративный email");
  if (inferred) add(-30, "email построен по шаблону, а не найден");
  if (deliverable) add(20, "email подтверждён");
  const confidence = Math.max(0, ...candidate.emails.map((email) => email.confidence ?? 0));
  if (confidence >= 70) add(10, `уверенность провайдера ${confidence}%`);
  if (candidate.phones.length > 0) add(8, "есть телефон");
  const socialPlatforms = new Set((candidate.socialProfiles ?? []).map((profile) => profile.platform));
  if (socialPlatforms.has("telegram") && officialEvidence) add(35, "личный или связанный Telegram указан официальным источником");
  else if (socialPlatforms.has("telegram")) add(20, "найден публичный Telegram");
  if ((["tenchat", "linkedin", "github"] as const).some((platform) => socialPlatforms.has(platform))) add(20, "профессиональный профиль");
  if ((["vk", "threads", "instagram"] as const).some((platform) => socialPlatforms.has(platform))) add(12, "публичный социальный профиль");
  else if (candidate.socialUrls.length > 0) add(5, "есть соцсеть/мессенджер");
  if (officialEvidence) add(8, "официальный источник");
  if (candidate.evidence.some((item) => item.source === "hunter")) add(8, "Hunter с источником");
  if (candidate.evidence.some((item) => ["search", "searxng", "google_news", "gdelt", "github", "gemini", "llm"].includes(item.source))) add(5, "независимый веб-источник");
  if (new Set(candidate.evidence.map((item) => item.url)).size >= 2) add(5, "несколько источников");
  if (undeliverableOnly) add(-100, "email недоставляемый");
  if (candidate.emails.some((email) => email.domainHasMx === false)) add(-30, "домен не публикует MX");
  const newest = candidate.evidence.map((item) => item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (newest) {
    const ageDays = (Date.now() - newest) / 86_400_000;
    if (ageDays <= 730) add(10, "свежее подтверждение за последние 2 года");
    else if (ageDays > 1_460) add(-20, "источник старше 4 лет без свежего подтверждения");
  }

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
    .sort((a, b) => b.score - a.score);
  const selected = scored.filter((candidate) => {
    const personalSocial = candidate.socialUrls.length > 0 && (Boolean(candidate.fullName) || (candidate.socialProfiles ?? []).some((profile) => profile.kind === "person"));
    const usableEmail = candidate.emails.some((email) => email.status !== "inferred" && email.deliverability !== "undeliverable");
    return candidate.score >= minScore && (usableEmail || candidate.phones.length > 0 || personalSocial);
  });

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
