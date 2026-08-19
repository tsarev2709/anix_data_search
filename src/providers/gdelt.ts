import type { HttpOptions } from "../http.js";
import { requestJson } from "../http.js";
import type { SearchResult } from "../types.js";
import { normalizeUrl, truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult, SearchProvider } from "./search-provider.js";

interface GdeltResponse {
  articles?: Array<{ url?: string; title?: string; seendate?: string; domain?: string; language?: string }>;
}

export function gdeltDate(value?: string): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z` : value;
}

export class GdeltProvider implements SearchProvider {
  readonly name = "gdelt";
  readonly source = "gdelt" as const;
  constructor(private readonly http: HttpOptions) {}

  async searchCompany(companyName: string): Promise<ProviderSearchResult> {
    const queries = [`"${companyName}"`, `"${companyName}" (director OR CEO OR interview)`, `"${companyName}" (appointed OR conference)`];
    const results: SearchResult[] = [];
    const warnings: string[] = [];
    let successful = 0;
    const outcomes = await Promise.all(queries.map(async (query) => {
      try {
        const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
        url.searchParams.set("query", query);
        url.searchParams.set("mode", "artlist");
        url.searchParams.set("maxrecords", "10");
        url.searchParams.set("format", "json");
        url.searchParams.set("sort", "datedesc");
        const payload = await requestJson<GdeltResponse>(url, { method: "GET" }, this.http);
        results.push(...(payload.articles ?? []).map((article) => ({
          title: article.title?.trim() || article.domain || article.url || "GDELT",
          url: normalizeUrl(article.url ?? "") ?? "",
          content: truncate([article.domain, article.language].filter(Boolean).join(" · "), 500),
          provider: this.source,
          query,
          publishedAt: gdeltDate(article.seendate),
        })).filter((item) => Boolean(item.url)));
        return true;
      } catch (error) {
        warnings.push(`GDELT: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }));
    successful = outcomes.filter(Boolean).length;
    return { provider: this.name, source: this.source, status: successful > 0 ? "used" : "failed", queries, results: uniqueBy(results, (item) => item.url), warnings };
  }
}
