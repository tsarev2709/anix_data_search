import type { HttpOptions } from "../http.js";
import { requestJson } from "../http.js";
import type { SearchResult } from "../types.js";
import { truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult } from "./search-provider.js";

interface StackPayload {
  items?: Array<{ title?: string; link?: string; body?: string; creation_date?: number; owner?: { display_name?: string } }>;
  backoff?: number;
}

export class StackExchangeDemandProvider {
  readonly name = "stack_exchange";
  readonly source = "stack_exchange" as const;
  constructor(private readonly http: HttpOptions) {}

  async searchDemand(queries: string[]): Promise<ProviderSearchResult> {
    const sent = queries.slice(0, 5);
    if (sent.length === 0) {
      return { provider: this.name, source: this.source, status: "skipped", queries: [], results: [], warnings: [] };
    }
    const results: SearchResult[] = [];
    const warnings: string[] = [];
    let successful = 0;
    for (const query of sent) {
      try {
        const url = new URL("https://api.stackexchange.com/2.3/search/advanced");
        url.searchParams.set("site", "stackoverflow");
        url.searchParams.set("q", query.replace(/["()]/g, " "));
        url.searchParams.set("sort", "creation");
        url.searchParams.set("order", "desc");
        url.searchParams.set("pagesize", "10");
        url.searchParams.set("filter", "withbody");
        url.searchParams.set("fromdate", String(Math.floor(Date.now() / 1000) - 14 * 86_400));
        const payload = await requestJson<StackPayload>(url, { method: "GET" }, this.http);
        successful += 1;
        results.push(...(payload.items ?? []).flatMap((item) => item.link ? [{
          title: item.title ?? item.link,
          url: item.link,
          content: truncate(item.body ?? "", 3_000),
          provider: this.source,
          query,
          publishedAt: item.creation_date ? new Date(item.creation_date * 1000).toISOString() : null,
          author: item.owner?.display_name ?? null,
        } satisfies SearchResult] : []));
      } catch (error) {
        warnings.push(`Stack Exchange: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { provider: this.name, source: this.source, status: successful > 0 ? "used" : "failed", queries: sent, results: uniqueBy(results, (item) => item.url), warnings };
  }
}
