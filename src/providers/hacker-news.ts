import type { HttpOptions } from "../http.js";
import { requestJson } from "../http.js";
import type { SearchResult } from "../types.js";
import { normalizeUrl, truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult } from "./search-provider.js";

interface HackerNewsPayload {
  hits?: Array<{ objectID?: string; title?: string | null; story_title?: string | null; url?: string | null; story_url?: string | null; comment_text?: string | null; author?: string | null; created_at?: string | null }>;
}

export class HackerNewsDemandProvider {
  readonly name = "hacker_news";
  readonly source = "hacker_news" as const;
  constructor(private readonly http: HttpOptions) {}

  async searchDemand(queries: string[]): Promise<ProviderSearchResult> {
    const sent = queries.slice(0, 8);
    if (sent.length === 0) {
      return { provider: this.name, source: this.source, status: "skipped", queries: [], results: [], warnings: [] };
    }
    const results: SearchResult[] = [];
    const warnings: string[] = [];
    let successful = 0;
    for (const query of sent) {
      try {
        const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
        url.searchParams.set("query", query.replace(/["()]/g, " "));
        url.searchParams.set("hitsPerPage", "10");
        const payload = await requestJson<HackerNewsPayload>(url, { method: "GET" }, this.http);
        successful += 1;
        results.push(...(payload.hits ?? []).flatMap((hit) => {
          const itemUrl = normalizeUrl(hit.url ?? hit.story_url ?? "") ?? (hit.objectID ? `https://news.ycombinator.com/item?id=${hit.objectID}` : null);
          if (!itemUrl) return [];
          return [{
            title: hit.title ?? hit.story_title ?? `Hacker News · ${hit.author ?? "публикация"}`,
            url: itemUrl,
            content: truncate(hit.comment_text ?? "", 3_000),
            provider: this.source,
            query,
            publishedAt: hit.created_at ?? null,
            author: hit.author ?? null,
          } satisfies SearchResult];
        }));
      } catch (error) {
        warnings.push(`Hacker News: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { provider: this.name, source: this.source, status: successful > 0 ? "used" : "failed", queries: sent, results: uniqueBy(results, (item) => item.url), warnings };
  }
}
