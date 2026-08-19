import type { HttpOptions } from "../http.js";
import { fetchWithRetry, requestJson } from "../http.js";
import { normalizeUrl, unique } from "../utils.js";

interface CrawlCollection { id: string; "cdx-api": string }
interface CdxRow { url?: string; status?: string; mime?: string; timestamp?: string }

const USEFUL_ARCHIVE_PATH = /contact|team|management|people|staff|about|press|news|blog|author|speaker|expert|career|vacanc|event|conference|webinar|document|file|upload|\.pdf(?:$|\?)/i;

export function parseCommonCrawlRows(body: string): CdxRow[] {
  const trimmed = body.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as CdxRow[] | Array<Array<string>>;
    if (Array.isArray(parsed) && Array.isArray(parsed[0])) {
      const [header, ...rows] = parsed as Array<Array<string>>;
      return rows.map((row) => Object.fromEntries((header ?? []).map((key, index) => [key, row[index]])) as CdxRow);
    }
    return Array.isArray(parsed) ? parsed as CdxRow[] : [parsed as CdxRow];
  } catch {
    return trimmed.split(/\r?\n/).map((line) => JSON.parse(line) as CdxRow);
  }
}

export class CommonCrawlProvider {
  readonly name = "common_crawl";
  constructor(private readonly http: HttpOptions) {}

  async discover(domain: string, limit = 80): Promise<{ urls: string[]; warning?: string }> {
    try {
      const collections = await requestJson<CrawlCollection[]>("https://index.commoncrawl.org/collinfo.json", { method: "GET" }, this.http);
      const endpoint = collections[0]?.["cdx-api"];
      if (!endpoint) throw new Error("актуальный индекс Common Crawl не найден");
      const url = new URL(endpoint);
      url.searchParams.set("url", `${domain}/*`);
      url.searchParams.set("output", "json");
      url.searchParams.set("filter", "status:200");
      url.searchParams.set("collapse", "urlkey");
      url.searchParams.set("fl", "url,status,mime,timestamp");
      url.searchParams.set("pageSize", String(Math.max(1, Math.min(500, limit * 4))));
      const response = await fetchWithRetry(url, { method: "GET", headers: { accept: "application/json" } }, { ...this.http, retries: 0 });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = parseCommonCrawlRows(await response.text());
      const urls = unique(rows.map((row) => normalizeUrl(row.url ?? "")).filter((item): item is string => Boolean(item)))
        .filter((item) => USEFUL_ARCHIVE_PATH.test(new URL(item).pathname))
        .slice(0, limit);
      return { urls };
    } catch (error) {
      return { urls: [], warning: `Common Crawl: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
}
