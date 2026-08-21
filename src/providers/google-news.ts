import * as cheerio from "cheerio";
import type { HttpOptions } from "../http.js";
import { fetchWithRetry } from "../http.js";
import type { SearchResult } from "../types.js";
import { truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult, SearchProvider } from "./search-provider.js";

function newsQueries(companyName: string): string[] {
  const company = `"${companyName}"`;
  return [
    `${company}`,
    `${company} директор`,
    `${company} руководитель`,
    `${company} назначен OR назначена`,
    `${company} возглавил OR возглавила`,
    `${company} интервью`,
    `${company} конференция OR вебинар`,
  ];
}

export class GoogleNewsProvider implements SearchProvider {
  readonly name = "google_news";
  readonly source = "google_news" as const;
  constructor(private readonly http: HttpOptions) {}

  private async searchQueries(queries: string[]): Promise<ProviderSearchResult> {
    const results: SearchResult[] = [];
    const warnings: string[] = [];
    let successful = 0;
    const outcomes = await Promise.all(queries.map(async (query) => {
      try {
        const url = new URL("https://news.google.com/rss/search");
        url.searchParams.set("q", query);
        url.searchParams.set("hl", "ru");
        url.searchParams.set("gl", "RU");
        url.searchParams.set("ceid", "RU:ru");
        const response = await fetchWithRetry(url, { method: "GET", headers: { accept: "application/rss+xml,application/xml,text/xml" } }, this.http);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const $ = cheerio.load(await response.text(), { xmlMode: true });
        $("item").slice(0, 8).each((_, item) => {
          const node = $(item);
          const articleUrl = node.find("link").first().text().trim();
          if (!articleUrl) return;
          const publication = node.find("source").first().text().trim();
          results.push({
            title: node.find("title").first().text().trim() || articleUrl,
            url: articleUrl,
            content: truncate([publication, node.find("description").first().text()].filter(Boolean).join(" · "), 2_000),
            provider: this.source,
            query,
            publishedAt: node.find("pubDate").first().text().trim() || null,
          });
        });
        return true;
      } catch (error) {
        warnings.push(`Google News RSS: ${error instanceof Error ? error.message : String(error)}`);
        return false;
      }
    }));
    successful = outcomes.filter(Boolean).length;
    return { provider: this.name, source: this.source, status: successful > 0 ? "used" : "failed", queries, results: uniqueBy(results, (item) => item.url), warnings };
  }

  searchCompany(companyName: string): Promise<ProviderSearchResult> {
    return this.searchQueries(newsQueries(companyName));
  }

  searchDemand(queries: string[]): Promise<ProviderSearchResult> {
    return this.searchQueries(queries.slice(0, 10));
  }
}
