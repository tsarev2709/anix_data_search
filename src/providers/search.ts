import type { HttpOptions } from "../http.js";
import { HttpError, requestJson } from "../http.js";
import type { Evidence, SearchResult } from "../types.js";
import { normalizeUrl, truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult, SearchProvider } from "./search-provider.js";
import { SEARCH_SITES } from "./source-catalog.js";

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string; score?: number; published_date?: string }>;
}

const NON_OFFICIAL_HOSTS = [
  ...SEARCH_SITES.map((site) => site.domain),
  "2gis.ru",
  "avito.ru",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "list-org.com",
  "ok.ru",
  "t.me",
  "tenchat.ru",
  "threads.net",
  "vk.com",
  "wikipedia.org",
  "youtube.com",
  "zachestnyibiznes.ru",
];

export class TavilySearch implements SearchProvider {
  readonly name = "tavily";
  readonly source = "search" as const;
  constructor(
    private readonly apiKey: string,
    private readonly http: HttpOptions,
  ) {}

  async searchCompany(companyName: string, targetRoles: string[]): Promise<ProviderSearchResult> {
    return this.searchQueries(companySearchQueries(companyName, targetRoles));
  }

  searchPerson(personName: string, companyName: string): Promise<ProviderSearchResult> {
    return this.searchQueries([`"${personName}" "${companyName}" контакты`, `"${personName}" "${companyName}" Telegram OR TenChat OR LinkedIn`]);
  }

  searchDemand(queries: string[], budget: number): Promise<ProviderSearchResult> {
    return this.searchQueries([...new Set(queries)].slice(0, budget), true);
  }

  searchPublicQueries(queries: string[], budget: number): Promise<ProviderSearchResult> {
    // Company procurement history must not be restricted to the last month.
    return this.searchQueries([...new Set(queries)].slice(0, budget));
  }

  private async searchQueries(planned: string[], fresh = false): Promise<ProviderSearchResult> {
    const results: SearchResult[] = [];
    const warnings: string[] = [];
    const queries: string[] = [];
    const successfulQueries: string[] = [];
    // Sequential calls stop immediately on exhausted credits or invalid credentials.
    for (const query of planned) {
      queries.push(query);
      try {
        results.push(...await this.search(query, fresh));
        successfulQueries.push(query);
      } catch (error) {
        warnings.push(`Tavily: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof HttpError && [401, 403, 429, 432, 433].includes(error.status)) break;
      }
    }
    return { provider: this.name, source: this.source, status: successfulQueries.length ? "used" : queries.length ? "failed" : "skipped", queries, successfulQueries, results: uniqueBy(results, (result) => result.url), warnings };
  }

  private async search(query: string, fresh = false): Promise<SearchResult[]> {
    const response = await requestJson<TavilyResponse>(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ query, topic: "general", search_depth: "basic", max_results: 6, include_answer: false, include_raw_content: false, ...(fresh ? { time_range: "month", include_published_date: true } : {}) }),
      },
      { ...this.http, retries: 0 },
    );
    if (!Array.isArray(response.results)) throw new Error("invalid Tavily response: results array missing");
    return (response.results ?? [])
      .map((result) => ({
        title: result.title?.trim() || result.url || "Результат поиска",
        url: normalizeUrl(result.url ?? "") ?? "",
        content: truncate(result.content ?? "", 3_000),
        ...(typeof result.score === "number" ? { score: result.score } : {}), provider: this.source,
        query,
        publishedAt: result.published_date ?? null,
      }))
      .filter((result) => Boolean(result.url));
  }
}

export function companySearchQueries(companyName: string, targetRoles: string[]): string[] {
  const roleQuery = targetRoles.slice(0, 8).join(" OR ");
  return [
    `\"${companyName}\" официальный сайт контакты руководство`,
    `\"${companyName}\" (${roleQuery}) email Telegram`,
  ];
}

export function searchEvidence(results: SearchResult[]): Evidence[] {
  return results.map((result) => ({
    source: result.provider ?? "search",
    url: result.url,
    title: result.title,
    snippet: result.content,
    ...(result.query ? { query: result.query } : {}),
    ...(result.publishedAt !== undefined ? { publishedAt: result.publishedAt } : {}),
    discoveredAt: new Date().toISOString(),
  }));
}

export function chooseLikelyOfficialWebsite(companyName: string, results: SearchResult[]): string | null {
  const tokens = companyName
    .toLowerCase()
    .replace(/[«»"']/g, " ")
    .replace(/\b(ооо|ао|пао|зао|оао|llc|inc|ltd)\b/gi, " ")
    .split(/[^a-zа-яё0-9]+/i)
    .filter((token) => token.length >= 3);

  const ranked = results
    .filter((result) => {
      const host = new URL(result.url).hostname.replace(/^www\./, "").toLowerCase();
      return !NON_OFFICIAL_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
    })
    .map((result) => {
      const haystack = `${new URL(result.url).hostname} ${result.title}`.toLowerCase();
      const tokenMatches = tokens.filter((token) => haystack.includes(token)).length;
      return { result, score: tokenMatches * 10 + (result.score ?? 0) };
    })
    .filter((item) => item.score >= 10)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.result.url ?? null;
}
