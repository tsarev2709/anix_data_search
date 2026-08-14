import { HttpError, requestJson, type HttpOptions } from "../http.js";
import type { ContactCandidate, Deliverability, Evidence, EmailAddress } from "../types.js";
import { isGenericEmail, normalizeEmail, truncate } from "../utils.js";

interface HunterDomainResponse {
  data?: {
    domain?: string;
    organization?: string;
    emails?: Array<{
      value?: string;
      type?: string;
      confidence?: number;
      first_name?: string | null;
      last_name?: string | null;
      position?: string | null;
      verification?: { status?: string };
      sources?: Array<{ uri?: string; extracted_on?: string; last_seen_on?: string }>;
    }>;
  };
}

interface HunterVerifierResponse {
  data?: { status?: string; score?: number };
}

function mapStatus(status: string | undefined): Deliverability {
  if (status === "valid") return "deliverable";
  if (status === "accept_all") return "risky";
  if (status === "invalid" || status === "blocked") return "undeliverable";
  if (status === "webmail" || status === "disposable") return "risky";
  return "unknown";
}

export class HunterProvider {
  constructor(
    private readonly apiKey: string,
    private readonly verifyEmails: boolean,
    private readonly http: HttpOptions,
  ) {}

  async findByDomain(domain: string): Promise<ContactCandidate[]> {
    const url = new URL("https://api.hunter.io/v2/domain-search");
    url.searchParams.set("domain", domain);
    url.searchParams.set("limit", "20");
    url.searchParams.set("api_key", this.apiKey);
    const response = await requestJson<HunterDomainResponse>(url, { method: "GET" }, this.http);

    const candidates: ContactCandidate[] = [];
    for (const item of response.data?.emails ?? []) {
      const email = normalizeEmail(item.value ?? "");
      if (!email) continue;
      let verification: { deliverability: Deliverability; confidence?: number } | null = null;
      if (this.verifyEmails) {
        try {
          verification = await this.verify(email);
        } catch (error) {
          // Hunter explicitly marks claimed emails as data that must not be processed.
          if (error instanceof HttpError && error.status === 451) continue;
        }
      }
      const emailAddress: EmailAddress = {
        value: email,
        generic: item.type === "generic" || isGenericEmail(email),
        deliverability: verification?.deliverability ?? mapStatus(item.verification?.status),
        ...(typeof verification?.confidence === "number"
          ? { confidence: verification.confidence }
          : typeof item.confidence === "number"
            ? { confidence: item.confidence }
            : {}),
      };
      const sources = (item.sources ?? []).filter((source) => source.uri);
      const evidence: Evidence[] = sources.slice(0, 5).map((source) => ({
        source: "hunter",
        url: source.uri ?? `https://${domain}`,
        title: "Hunter domain source",
        snippet: truncate(`Email ${email}; найден ${source.extracted_on ?? "дата не указана"}; последний раз замечен ${source.last_seen_on ?? "дата не указана"}`, 500),
      }));
      if (evidence.length === 0) {
        evidence.push({ source: "hunter", url: `https://${domain}`, title: "Hunter domain search", snippet: `Email ${email}` });
      }
      candidates.push({
        fullName: [item.first_name, item.last_name].filter(Boolean).join(" ") || null,
        position: item.position?.trim() || null,
        emails: [emailAddress],
        phones: [],
        socialUrls: [],
        evidence,
        score: 0,
        scoreReasons: [],
      });
    }
    return candidates;
  }

  private async verify(email: string): Promise<{ deliverability: Deliverability; confidence?: number }> {
    const url = new URL("https://api.hunter.io/v2/email-verifier");
    url.searchParams.set("email", email);
    url.searchParams.set("api_key", this.apiKey);
    const response = await requestJson<HunterVerifierResponse>(url, { method: "GET" }, this.http);
    return {
      deliverability: mapStatus(response.data?.status),
      ...(typeof response.data?.score === "number" ? { confidence: response.data.score } : {}),
    };
  }
}
