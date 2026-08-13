import type { HttpOptions } from "../http.js";
import { requestJson } from "../http.js";
import type { Evidence, SearchResult } from "../types.js";
import { normalizeUrl, truncate, uniqueBy } from "../utils.js";

interface TavilyResponse {
  results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
}

const NON_OFFICIAL_HOSTS = [
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

export class TavilySearch {
  constructor(
    private readonly apiKey: string,
    private readonly http: HttpOptions,
  ) {}

  async searchCompany(companyName: string, targetRoles: string[]): Promise<SearchResult[]> {
    const roleQuery = targetRoles.slice(0, 8).join(" OR ");
    const queries = [
      `\"${companyName}\" официальный сайт контакты руководство`,
      `\"${companyName}\" (${roleQuery}) email Telegram`,
    ];
    const batches = await Promise.all(queries.map((query) => this.search(query)));
    return uniqueBy(batches.flat(), (result) => result.url);
  }

  private async search(query: string): Promise<SearchResult[]> {
    const response = await requestJson<TavilyResponse>(
      "https://api.tavily.com/search",
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ query, topic: "general", search_depth: "basic", max_results: 6, include_answer: false, include_raw_content: false }),
      },
      this.http,
    );
    return (response.results ?? [])
      .map((result) => ({
        title: result.title?.trim() || result.url || "Результат поиска",
        url: normalizeUrl(result.url ?? "") ?? "",
        content: truncate(result.content ?? "", 3_000),
        ...(typeof result.score === "number" ? { score: result.score } : {}),
      }))
      .filter((result) => Boolean(result.url));
  }
}

export function searchEvidence(results: SearchResult[]): Evidence[] {
  return results.map((result) => ({ source: "search", url: result.url, title: result.title, snippet: result.content }));
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
