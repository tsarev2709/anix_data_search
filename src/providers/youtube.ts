import type { HttpOptions } from "../http.js";
import { requestJson } from "../http.js";
import type { SearchResult } from "../types.js";
import { truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult } from "./search-provider.js";

interface YouTubePayload {
  items?: Array<{ id?: { videoId?: string; channelId?: string }; snippet?: { title?: string; description?: string; publishedAt?: string; channelTitle?: string } }>;
}

export class YouTubeDemandProvider {
  readonly name = "youtube";
  readonly source = "youtube" as const;
  constructor(private readonly apiKey: string, private readonly http: HttpOptions) {}

  async searchDemand(queries: string[]): Promise<ProviderSearchResult> {
    const sent = queries.slice(0, 8);
    const results: SearchResult[] = [];
    const warnings: string[] = [];
    let successful = 0;
    for (const query of sent) {
      try {
        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("key", this.apiKey);
        url.searchParams.set("part", "snippet");
        url.searchParams.set("q", query.replace(/site:[^ )]+|["()]/g, " "));
        url.searchParams.set("type", "video");
        url.searchParams.set("order", "date");
        url.searchParams.set("maxResults", "10");
        url.searchParams.set("publishedAfter", new Date(Date.now() - 14 * 86_400_000).toISOString());
        url.searchParams.set("relevanceLanguage", "ru");
        const payload = await requestJson<YouTubePayload>(url, { method: "GET" }, this.http);
        successful += 1;
        results.push(...(payload.items ?? []).flatMap((item) => item.id?.videoId ? [{
          title: item.snippet?.title ?? item.id.videoId,
          url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
          content: truncate(item.snippet?.description ?? "", 3_000),
          provider: this.source,
          query,
          publishedAt: item.snippet?.publishedAt ?? null,
          author: item.snippet?.channelTitle ?? null,
        } satisfies SearchResult] : []));
      } catch (error) {
        warnings.push(`YouTube: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return { provider: this.name, source: this.source, status: successful > 0 ? "used" : "failed", queries: sent, results: uniqueBy(results, (item) => item.url), warnings };
  }
}
