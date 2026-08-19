import { resolveMx } from "node:dns/promises";
import type { ContactCandidate } from "./types.js";

export async function annotateMx(candidates: ContactCandidate[]): Promise<ContactCandidate[]> {
  const domains = [...new Set(candidates.flatMap((candidate) => candidate.emails.map((email) => email.value.split("@")[1]).filter((value): value is string => Boolean(value))))].slice(0, 50);
  const mx = new Map<string, boolean | null>();
  for (let index = 0; index < domains.length; index += 10) {
    await Promise.all(domains.slice(index, index + 10).map(async (domain) => {
      try { mx.set(domain, (await resolveMx(domain)).length > 0); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        mx.set(domain, code === "ENOTFOUND" || code === "ENODATA" ? false : null);
      }
    }));
  }
  return candidates.map((candidate) => ({
    ...candidate,
    emails: candidate.emails.map((email) => ({ ...email, domainHasMx: mx.get(email.value.split("@")[1] ?? "") ?? null })),
  }));
}
