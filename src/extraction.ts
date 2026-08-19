import type { ContactCandidate, EmailAddress, Evidence, EvidenceSource, SocialPlatform, SocialProfile, SocialProfileKind } from "./types.js";
import { isGenericEmail, normalizeEmail, normalizeUrl, unique, uniqueBy } from "./utils.js";

const SOCIAL_REGISTRY: Array<{ platform: SocialPlatform; hosts: string[] }> = [
  { platform: "telegram", hosts: ["t.me", "telegram.me"] },
  { platform: "vk", hosts: ["vk.com"] },
  { platform: "youtube", hosts: ["youtube.com", "youtu.be"] },
  { platform: "threads", hosts: ["threads.net"] },
  { platform: "instagram", hosts: ["instagram.com"] },
  { platform: "tenchat", hosts: ["tenchat.ru"] },
  { platform: "linkedin", hosts: ["linkedin.com"] },
  { platform: "rutube", hosts: ["rutube.ru"] },
  { platform: "github", hosts: ["github.com"] },
];

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PERSON_PATTERN = /(?:[А-ЯЁ][а-яё-]{1,30}\s+[А-ЯЁ][а-яё-]{1,30}(?:\s+[А-ЯЁ][а-яё-]{1,30})?|[А-ЯЁ][а-яё-]{1,30}\s+[А-ЯЁ]\.(?:\s?[А-ЯЁ]\.)?|[А-ЯЁ]\.(?:\s?[А-ЯЁ]\.)?\s+[А-ЯЁ][а-яё-]{1,30})/g;
const DEFAULT_ROLES = [
  "генеральный директор", "ceo", "коммерческий директор", "директор по маркетингу", "маркетинг-директор", "cmo",
  "директор по персоналу", "hrd", "hr director", "директор по обучению", "руководитель корпоративного университета",
  "руководитель l&d", "директор по коммуникациям", "pr директор", "руководитель охраны труда", "hse",
  "директор по производственной безопасности", "руководитель digital", "директор по инновациям", "бренд-директор",
  "креативный директор", "собственник", "основатель", "co-founder", "управляющий партнёр",
];

function platformForUrl(value: string): SocialPlatform | null {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "").toLowerCase();
    return SOCIAL_REGISTRY.find((entry) => entry.hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`)))?.platform ?? null;
  } catch {
    return null;
  }
}

function usernameFromUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const segment = url.pathname.split("/").filter(Boolean).at(-1) ?? null;
    return segment ? segment.replace(/^@/, "") : null;
  } catch {
    return null;
  }
}

function socialKind(platform: SocialPlatform, url: string, official: boolean): SocialProfileKind {
  const lower = url.toLowerCase();
  if (platform === "telegram") {
    if (/\/(?:joinchat\/|\+)/.test(lower)) return "group";
    if (/\/s\//.test(lower)) return "channel";
    if (/(?:_bot|bot)\/?$/.test(lower)) return "bot";
    return official ? "company" : "unknown";
  }
  if (platform === "youtube" || platform === "rutube") return "channel";
  return official ? "company" : "unknown";
}

export function normalizeSocialUrl(value: string): { platform: SocialPlatform; url: string; username: string | null } | null {
  const url = normalizeUrl(value)?.replace(/[.,;:!?]+$/, "") ?? null;
  if (!url) return null;
  const platform = platformForUrl(url);
  return platform ? { platform, url, username: usernameFromUrl(url) } : null;
}

export function extractSocialProfiles(evidence: Evidence[], companyName: string): SocialProfile[] {
  const now = new Date().toISOString();
  const profiles = evidence.flatMap((item) => {
    const urls = unique([item.url, ...(item.snippet.match(URL_PATTERN) ?? [])]);
    return urls.flatMap((url) => {
      const normalized = normalizeSocialUrl(url);
      if (!normalized) return [];
      const official = item.source === "website" || item.source === "sitemap" || item.source === "rss";
      return [{
        ...normalized,
        kind: socialKind(normalized.platform, normalized.url, official),
        displayName: item.title || null,
        personName: null,
        companyName,
        role: null,
        source: item.source,
        evidenceUrl: item.url,
        confidence: official ? 95 : normalized.platform === "tenchat" ? 80 : 65,
        lastSeen: item.discoveredAt ?? now,
      } satisfies SocialProfile];
    });
  });
  return uniqueBy(profiles, (profile) => `${profile.platform}:${profile.url.toLowerCase()}`);
}

function roleTerms(targetRoles: string[]): string[] {
  return unique([...targetRoles, ...DEFAULT_ROLES]).filter(Boolean).sort((left, right) => right.length - left.length);
}

export function extractPeopleFromEvidence(evidence: Evidence[], targetRoles: string[]): ContactCandidate[] {
  const roles = roleTerms(targetRoles);
  const candidates: ContactCandidate[] = [];
  for (const item of evidence) {
    const text = `${item.title}. ${item.snippet}`.replace(/\s+/g, " ");
    const lower = text.toLowerCase();
    for (const role of roles) {
      let from = 0;
      while (from < lower.length) {
        const index = lower.indexOf(role.toLowerCase(), from);
        if (index < 0) break;
        const windowStart = Math.max(0, index - 140);
        const windowEnd = Math.min(text.length, index + role.length + 140);
        const window = text.slice(windowStart, windowEnd);
        const names = window.match(PERSON_PATTERN) ?? [];
        for (const fullName of names.slice(0, 3)) {
          const emails = (window.match(EMAIL_PATTERN) ?? []).map((value) => emailFromEvidence(value, item));
          const socialProfiles = extractSocialProfiles([{ ...item, snippet: window }], "").map((profile) => ({ ...profile, kind: "person" as const, personName: fullName, role }));
          candidates.push({
            fullName,
            position: role,
            emails,
            phones: [],
            socialUrls: socialProfiles.map((profile) => profile.url),
            socialProfiles,
            evidence: [item],
            score: 0,
            scoreReasons: [],
          });
        }
        from = index + role.length;
      }
    }
  }
  return uniqueBy(candidates, (candidate) => `${candidate.fullName?.toLowerCase()}|${candidate.position?.toLowerCase()}`);
}

export function emailFromEvidence(value: string, evidence: Evidence): EmailAddress {
  const email = normalizeEmail(value);
  const generic = isGenericEmail(email);
  return {
    value: email,
    generic,
    deliverability: "unknown",
    status: generic ? "general" : "found",
    confidence: evidence.source === "website" || evidence.source === "pdf" || evidence.source === "rss" ? 95 : 75,
    evidenceUrl: evidence.url,
  };
}

export function inferEmailCandidates(person: ContactCandidate, knownEmails: EmailAddress[]): EmailAddress[] {
  if (!person.fullName || person.emails.length > 0) return [];
  const example = knownEmails.find((email) => !email.generic && email.value.includes("@"));
  if (!example) return [];
  const [local, domain] = example.value.split("@");
  const parts = person.fullName.toLowerCase().split(/\s+/).filter(Boolean);
  if (!local || !domain || parts.length < 2) return [];
  const [firstRaw, lastRaw] = parts;
  const transliterate = (value: string) => value.split("").map((char) => ({
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
    н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "sch",
    ы: "y", э: "e", ю: "yu", я: "ya", ь: "", ъ: "",
  } as Record<string, string>)[char] ?? char).join("").replace(/[^a-z0-9]/g, "");
  const first = transliterate(firstRaw ?? "");
  const last = transliterate(lastRaw ?? "");
  if (!first || !last) return [];
  let inferredLocal: string | null = null;
  if (/^[a-z]+\.[a-z]+$/i.test(local)) inferredLocal = `${first}.${last}`;
  else if (/^[a-z]\.[a-z]+$/i.test(local)) inferredLocal = `${first[0]}.${last}`;
  else if (/^[a-z][a-z]+$/i.test(local) && local.length > 5) inferredLocal = `${first[0]}${last}`;
  if (!inferredLocal) return [];
  return [{
    value: `${inferredLocal}@${domain}`,
    generic: false,
    deliverability: "unknown",
    status: "inferred",
    confidence: 35,
    patternSource: example.evidenceUrl ?? example.value,
  }];
}

export function evidenceSourceLabel(source: EvidenceSource): string {
  return source.replace(/_/g, " ");
}
