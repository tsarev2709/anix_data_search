import * as cheerio from "cheerio";
import type { HttpOptions } from "../http.js";
import { fetchWithRetry } from "../http.js";
import type { SearchResult } from "../types.js";
import { truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult } from "./search-provider.js";

const FORUM_HOSTS = ["vc.ru", "habr.com", "reddit.com", "pikabu.ru", "otvet.mail.ru"];
const SUBJECT = /видео|ролик|анимац|продакшн|студи|подрядчик|маскот|визуализац|обучен|онбординг|инструктаж|контент|video|animation|production|explainer/i;
const COMMENT_SELECTOR = '[itemtype*="schema.org/Comment"], [data-comment-id], [data-testid="comment"], shreddit-comment, .comment[id], .comment[data-id], [id^="comment-"]';
const BODY_SELECTOR = '[itemprop="text"], .comment__message, .comment__text, .comment__content, .comment-text, [slot="comment"], [data-test-id="comment-content"], [data-testid="comment-body"]';

function forumUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !FORUM_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}

function safeBrowserRequest(raw: string): boolean {
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !/^(?:localhost|.*\.(?:localhost|local|internal))$/.test(host)
      && !/^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)
      && host !== "[::1]";
  } catch { return false; }
}

function permalink(raw: unknown, pageUrl: string): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw, pageUrl);
    const page = new URL(pageUrl);
    if (url.protocol !== "https:" || url.hostname !== page.hostname || url.username || url.password) return null;
    if (url.toString() === page.toString() || (!url.hash && url.pathname === page.pathname && url.search === page.search)) return null;
    return url.toString();
  } catch { return null; }
}

type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function authorName(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const name = string(object(value)?.name).trim();
  return name || null;
}
function types(value: unknown): string[] {
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string").map((item) => item.split("/").pop() ?? item);
}

/** Extract only the post or comment body; never merge the parent article with its replies. */
export function parseDiscussionHtml(html: string, pageUrl: string, query = "discussion", limit = 25): SearchResult[] {
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  const add = (url: string | null, body: string, author: string | null, date: string | null) => {
    const content = body.replace(/\s+/g, " ").trim();
    if (!url || content.length < 30 || content.length > 20_000) return;
    results.push({
      title: author ? `Сообщение · ${author}` : "Сообщение в обсуждении",
      url,
      content: truncate(content, 4_000),
      author,
      publishedAt: date && Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
      provider: "discussion",
      query,
    });
  };

  for (const script of $('script[type="application/ld+json"]').toArray()) {
    let root: unknown;
    try { root = JSON.parse($(script).html() ?? ""); } catch { continue; }
    const visit = (value: unknown, depth: number) => {
      if (depth > 8 || results.length >= limit * 3) return;
      if (Array.isArray(value)) { for (const item of value.slice(0, 100)) visit(item, depth + 1); return; }
      const node = object(value);
      if (!node) return;
      const nodeTypes = types(node["@type"]);
      if (nodeTypes.some((type) => ["Comment", "DiscussionForumPosting", "Question"].includes(type))) {
        const url = permalink(node.url ?? node["@id"] ?? (nodeTypes.includes("Question") ? pageUrl : null), pageUrl);
        const postUrl = nodeTypes.includes("Question") || (nodeTypes.includes("DiscussionForumPosting") && depth <= 2 && !url) ? pageUrl : url;
        add(postUrl, string(node.text ?? node.articleBody ?? node.description), authorName(node.author), string(node.datePublished ?? node.dateCreated) || null);
      }
      for (const key of ["@graph", "mainEntity", "comment", "suggestedAnswer", "acceptedAnswer", "hasPart"]) visit(node[key], depth + 1);
    };
    visit(root, 0);
  }

  for (const element of $(COMMENT_SELECTOR).toArray().slice(0, limit * 4)) {
    const node = $(element);
    const bodyNode = node.find(BODY_SELECTOR).first();
    const contentNode = (bodyNode.length ? bodyNode : node).clone();
    contentNode.find(`${COMMENT_SELECTOR}, script, style, button, time, header, footer`).remove();
    const body = contentNode.text();
    const link = node.find('a[rel="bookmark"], a[href*="#comment"], a[href*="?comment"], a[href*="/comment/"]').first().attr("href");
    const id = node.attr("id");
    const url = permalink(link ?? (id ? `#${encodeURIComponent(id)}` : null), pageUrl);
    const author = node.find('[itemprop="author"], .comment__author, .comment-author, [data-testid="comment-author"], a[href*="/users/"]').first().text().replace(/\s+/g, " ").trim() || null;
    const date = node.find('time[datetime], [itemprop="datePublished"][content]').first().attr("datetime")
      ?? node.find('[itemprop="datePublished"]').first().attr("content") ?? null;
    add(url, body, author, date);
  }
  return uniqueBy(results, (item) => item.url).slice(0, limit);
}

export function selectDiscussionPages(candidates: SearchResult[], limit: number): SearchResult[] {
  const now = Date.now();
  return uniqueBy(candidates.flatMap((item) => {
    const url = forumUrl(item.url);
    if (!url || (item.publishedAt && Number.isFinite(Date.parse(item.publishedAt)) && now - Date.parse(item.publishedAt) > 45 * 86_400_000)) return [];
    return [{ ...item, url }];
  }), (item) => item.url).sort((left, right) => {
    const rank = (item: SearchResult) => (item.query?.includes("site:") ? 5 : 0) + (SUBJECT.test(`${item.title} ${item.content}`) ? 3 : 0) + (item.provider === "feed" ? 1 : 0);
    return rank(right) - rank(left);
  }).slice(0, limit);
}

export class DiscussionDemandProvider {
  readonly name = "discussion";
  readonly source = "discussion" as const;
  constructor(private readonly http: HttpOptions, private readonly maxPages: number) {}

  async searchDemand(candidates: SearchResult[]): Promise<ProviderSearchResult> {
    const pages = selectDiscussionPages(candidates, this.maxPages);
    if (!pages.length) return { provider: this.name, source: this.source, status: "skipped", queries: [], results: [], warnings: [] };
    const warnings: string[] = [];
    const results: SearchResult[] = [];
    let successful = 0;
    const dynamic: SearchResult[] = [];
    // Three pages at a time, with one attempt per page. Public forums may rate limit us.
    for (let index = 0; index < pages.length; index += 3) {
      await Promise.all(pages.slice(index, index + 3).map(async (item) => {
        try {
          const response = await fetchWithRetry(item.url, { method: "GET", redirect: "manual", headers: { accept: "text/html" } }, { ...this.http, timeoutMs: Math.min(this.http.timeoutMs, 8_000), retries: 0 });
          if (!response.ok || !/text\/html/i.test(response.headers.get("content-type") ?? "")) throw new Error(`HTTP ${response.status} or non-HTML response`);
          const html = await response.text();
          if (html.length > 2_000_000) throw new Error("page exceeds 2 MB");
          successful += 1;
          const found = parseDiscussionHtml(html, item.url, item.query, 25);
          results.push(...found);
          if (!found.length && ["vc.ru", "habr.com", "reddit.com", "pikabu.ru"].some((host) => new URL(item.url).hostname.endsWith(host))) dynamic.push(item);
        } catch (error) { warnings.push(`${item.url}: ${error instanceof Error ? error.message : String(error)}`); }
      }));
    }

    if (dynamic.length) {
      try {
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({ headless: true });
        try {
          for (const item of dynamic.slice(0, 3)) {
            const page = await browser.newPage({ userAgent: this.http.userAgent });
            try {
              await page.route(/.*/, (route) => !safeBrowserRequest(route.request().url()) || ["image", "font", "media"].includes(route.request().resourceType()) ? route.abort() : route.continue());
              await page.goto(item.url, { waitUntil: "domcontentloaded", timeout: 12_000 });
              await page.waitForTimeout(1_000);
              if (forumUrl(page.url()) && new URL(page.url()).hostname === new URL(item.url).hostname) {
                results.push(...parseDiscussionHtml(await page.content(), page.url(), item.query, 25));
              }
            } catch (error) { warnings.push(`JS ${item.url}: ${error instanceof Error ? error.message : String(error)}`); }
            finally { await page.close(); }
          }
        } finally { await browser.close(); }
      } catch (error) { warnings.push(`JS renderer: ${error instanceof Error ? error.message : String(error)}`); }
    }

    return {
      provider: this.name,
      source: this.source,
      status: successful > 0 ? "used" : "failed",
      queries: pages.map((item) => item.url),
      results: uniqueBy(results, (item) => item.url),
      warnings: warnings.slice(0, 12),
    };
  }
}
