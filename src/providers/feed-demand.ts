import type { HttpOptions } from "../http.js";
import { fetchWithRetry } from "../http.js";
import type { SearchResult } from "../types.js";
import { truncate, unique, uniqueBy } from "../utils.js";
import { parseRssXml } from "./website.js";
import type { ProviderSearchResult } from "./search-provider.js";

const DEFAULT_FEEDS = [
  "https://habr.com/ru/rss/articles/",
  "https://vc.ru/rss/all",
  "https://www.reddit.com/r/marketing/new/.rss",
  "https://www.reddit.com/r/VideoEditing/new/.rss",
];

export class FeedDemandProvider {
  readonly name = "feeds";
  readonly source = "feed" as const;
  private readonly feeds: string[];
  constructor(private readonly http: HttpOptions, configured: string[] = []) {
    this.feeds = unique([...configured, ...DEFAULT_FEEDS]);
  }

  async searchDemand(): Promise<ProviderSearchResult> {
    const results: SearchResult[] = [];
    const warnings: string[] = [];
    let successful = 0;
    const outcomes = await Promise.all(this.feeds.map(async (feedUrl) => {
      try {
        const response = await fetchWithRetry(feedUrl, { method: "GET", headers: { accept: "application/rss+xml,application/atom+xml,application/xml,text/xml" } }, { ...this.http, retries: 0 });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        for (const page of parseRssXml(await response.text(), feedUrl)) {
          results.push({ title: page.title, url: page.url, content: truncate(page.text, 3_000), provider: this.source, query: `feed:${feedUrl}`, publishedAt: page.publishedAt ?? null, author: null });
        }
        return true;
      } catch (error) {
        warnings.push(`RSS ${feedUrl}: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }));
    successful = outcomes.filter(Boolean).length;
    return { provider: this.name, source: this.source, status: successful > 0 ? "used" : "failed", queries: this.feeds.map((item) => `feed:${item}`), results: uniqueBy(results, (item) => item.url), warnings };
  }
}
