import * as cheerio from "cheerio";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { CrawledPage, Evidence } from "../types.js";
import { fetchWithRetry, type HttpOptions } from "../http.js";
import { delay, normalizeEmail, normalizePhone, normalizeUrl, truncate, unique, uniqueBy } from "../utils.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const USEFUL_PATH = /contact|team|about|company|people|staff|management|руковод|команд|контакт|о[-_]?компан|press|media|news|blog|author|speaker|expert|partner|procurement|tender|vacanc|career|job|event|conference|webinar|document|file|upload|\.pdf/i;
const HIGH_VALUE_PATH = /contact|team|people|staff|management|руковод|команд|speaker|expert|author|\.pdf/i;
const BLOCKED_PATH = /login|signin|cart|checkout|privacy|policy|cookie|terms|личн/i;
const SOCIAL_HOSTS = ["t.me", "telegram.me", "vk.com", "linkedin.com", "threads.net", "instagram.com", "tenchat.ru", "youtube.com", "youtu.be", "rutube.ru", "github.com"];
const COMMON_PATHS = ["/contacts", "/contact", "/team", "/management", "/about", "/press", "/news", "/blog", "/career", "/vacancies"];
const FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/atom.xml"];

export interface CrawlDiagnostics {
  robotsUrl: string | null;
  sitemapUrls: string[];
  sitemapEntries: number;
  feedUrls: string[];
  pdfUrls: string[];
  jsFallbacks: number;
  wordpress: boolean;
}

function extractSocialUrls(hrefs: string[], baseUrl: string): string[] {
  return unique(hrefs.map((href) => {
    try { return new URL(href, baseUrl).toString(); } catch { return ""; }
  }).filter((href) => {
    try {
      const host = new URL(href).hostname.replace(/^www\./, "");
      return SOCIAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    } catch { return false; }
  }));
}

function extractPage(text: string, hrefs: string[], url: string, title: string, source: CrawledPage["source"] = "website", publishedAt: string | null = null): CrawledPage {
  const mailtoEmails = hrefs.filter((href) => href.toLowerCase().startsWith("mailto:")).map((href) => normalizeEmail(href));
  const telPhones = hrefs.filter((href) => href.toLowerCase().startsWith("tel:")).map((href) => normalizePhone(href.slice(4)));
  const emails = unique([...mailtoEmails, ...(text.match(EMAIL_PATTERN) ?? []).map(normalizeEmail)]).filter((email) => email.includes("@") && !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email));
  const phones = unique([...telPhones, ...(text.match(PHONE_PATTERN) ?? []).map(normalizePhone)]).filter((phone) => phone.replace(/\D/g, "").length >= 10);
  return { url, title: truncate(title || url, 180), text: truncate(text, 40_000), emails, phones, socialUrls: extractSocialUrls(hrefs, url), source, publishedAt };
}

function parseHtml(html: string, url: string): { page: CrawledPage; links: string[]; feeds: string[]; likelySpa: boolean } {
  const $ = cheerio.load(html);
  const scriptCount = $("script[src]").length;
  const structuredData = $("script[type='application/ld+json']").map((_, element) => $(element).text()).get().join(" ");
  const metadata = $("meta[content]").map((_, element) => $(element).attr("content") ?? "").get().join(" ");
  const anchorContext = $("a[href]").map((_, element) => `${$(element).text().trim()} ${$(element).attr("href") ?? ""}`).get().join(" ");
  $("script, style, noscript, svg, iframe, template").remove();
  const title = $("title").first().text() || $("h1").first().text() || url;
  const hrefs = $("a[href]").map((_, element) => $(element).attr("href") ?? "").get();
  const feeds = $("link[rel='alternate']").map((_, element) => {
    const type = ($(element).attr("type") ?? "").toLowerCase();
    if (!/rss|atom|xml/.test(type)) return "";
    try { return new URL($(element).attr("href") ?? "", url).toString(); } catch { return ""; }
  }).get().filter(Boolean);
  const text = `${$("body").text()} ${anchorContext} ${metadata} ${structuredData}`;
  const embeddedUrls = `${metadata} ${structuredData}`.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return { page: extractPage(text, [...hrefs, ...embeddedUrls], url, title), links: hrefs, feeds, likelySpa: text.replace(/\s+/g, " ").trim().length < 250 && scriptCount >= 2 };
}

export function parseSitemapXml(xml: string): { urls: string[]; nested: string[] } {
  const $ = cheerio.load(xml, { xmlMode: true });
  const nested = $("sitemap > loc").map((_, element) => $(element).text().trim()).get().filter(Boolean);
  const urls = $("url > loc").map((_, element) => $(element).text().trim()).get().filter(Boolean);
  return { urls, nested };
}

export function parseRssXml(xml: string, feedUrl: string): CrawledPage[] {
  const $ = cheerio.load(xml, { xmlMode: true });
  return $("item, entry").toArray().slice(0, 30).flatMap((element) => {
    const node = $(element);
    const rawUrl = node.find("link").first().attr("href") || node.find("link").first().text().trim();
    const url = normalizeUrl(rawUrl || feedUrl);
    if (!url) return [];
    const title = node.find("title").first().text().trim() || url;
    const content = [node.find("description").first().text(), node.find("summary").first().text(), node.find("content\\:encoded").first().text(), node.find("content").first().text()].join(" ");
    const hrefs = content.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
    const publishedAt = node.find("pubDate, published, updated").first().text().trim() || null;
    return [extractPage(content, hrefs, url, title, "rss", publishedAt)];
  });
}

function parseRobots(text: string, baseUrl: string): { sitemaps: string[]; disallowed: string[] } {
  const sitemaps: string[] = [];
  const disallowed: string[] = [];
  let applies = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rest.join(":").trim();
    if (key === "user-agent") applies = value === "*";
    if (key === "disallow" && applies && value) disallowed.push(value);
    if (key === "sitemap" && value) {
      try { sitemaps.push(new URL(value, baseUrl).toString()); } catch { /* invalid sitemap */ }
    }
  }
  return { sitemaps: unique(sitemaps), disallowed };
}

async function pdfText(buffer: ArrayBuffer): Promise<string> {
  const document = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const chunks: string[] = [];
  for (let index = 1; index <= Math.min(document.numPages, 80); index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    chunks.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return truncate(chunks.join(" "), 80_000);
}

function usefulScore(value: string): number {
  const pathname = new URL(value).pathname;
  return (pathname === "/" ? 110 : 0) + (HIGH_VALUE_PATH.test(pathname) ? 100 : 0) + (USEFUL_PATH.test(pathname) ? 25 : 0) - pathname.split("/").length;
}

export class WebsiteCrawler {
  constructor(private readonly http: HttpOptions, private readonly maxPages: number) {}

  private async fetchText(url: string, accept: string): Promise<{ response: Response; text: string }> {
    const response = await fetchWithRetry(url, { method: "GET", headers: { accept } }, this.http);
    return { response, text: await response.text() };
  }

  private async renderSpa(url: string): Promise<string | null> {
    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      try {
        const page = await browser.newPage({ userAgent: this.http.userAgent });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: Math.min(20_000, this.http.timeoutMs * 2) });
        await page.waitForTimeout(1_000);
        return await page.content();
      } finally { await browser.close(); }
    } catch { return null; }
  }

  async crawl(rawWebsite: string, archivedUrls: string[] = []): Promise<{ pages: CrawledPage[]; warnings: string[]; diagnostics: CrawlDiagnostics }> {
    const website = normalizeUrl(rawWebsite);
    const diagnostics: CrawlDiagnostics = { robotsUrl: null, sitemapUrls: [], sitemapEntries: 0, feedUrls: [], pdfUrls: [], jsFallbacks: 0, wordpress: false };
    if (!website) return { pages: [], warnings: [`Некорректный URL: ${rawWebsite}`], diagnostics };

    const root = new URL(website);
    const rootHost = root.hostname.replace(/^www\./, "");
    const origin = root.origin;
    const queue = unique([website, ...COMMON_PATHS.map((path) => new URL(path, origin).toString()), ...archivedUrls]);
    const visited = new Set<string>();
    const pages: CrawledPage[] = [];
    const warnings: string[] = [];
    let disallowed: string[] = [];

    try {
      const robotsUrl = new URL("/robots.txt", origin).toString();
      const { response, text } = await this.fetchText(robotsUrl, "text/plain");
      if (response.ok) {
        diagnostics.robotsUrl = robotsUrl;
        const parsed = parseRobots(text, origin);
        disallowed = parsed.disallowed;
        diagnostics.sitemapUrls.push(...parsed.sitemaps);
      }
    } catch (error) { warnings.push(`robots.txt: ${error instanceof Error ? error.message : String(error)}`); }

    if (diagnostics.sitemapUrls.length === 0) diagnostics.sitemapUrls.push(new URL("/sitemap.xml", origin).toString());
    const visitedSitemaps = new Set<string>();
    for (let sitemapIndex = 0; sitemapIndex < diagnostics.sitemapUrls.length && sitemapIndex < 10; sitemapIndex += 1) {
      const sitemapUrl = diagnostics.sitemapUrls[sitemapIndex];
      if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
      visitedSitemaps.add(sitemapUrl);
      try {
        const { response, text } = await this.fetchText(sitemapUrl, "application/xml,text/xml");
        if (!response.ok) continue;
        const parsed = parseSitemapXml(text);
        diagnostics.sitemapEntries += parsed.urls.length;
        diagnostics.sitemapUrls.push(...parsed.nested.slice(0, 10));
        queue.push(...parsed.urls.filter((url) => USEFUL_PATH.test(url)).sort((left, right) => usefulScore(right) - usefulScore(left)).slice(0, 150));
      } catch (error) { warnings.push(`sitemap ${sitemapUrl}: ${error instanceof Error ? error.message : String(error)}`); }
    }

    const attemptedFeeds = new Set<string>();
    const readFeeds = async (feedUrls: string[]) => {
      for (const feedUrl of feedUrls) {
        if (attemptedFeeds.has(feedUrl) || pages.filter((page) => page.source === "rss").length >= 60) continue;
        attemptedFeeds.add(feedUrl);
        try {
          const { response, text } = await this.fetchText(feedUrl, "application/rss+xml,application/atom+xml,application/xml,text/xml");
          if (!response.ok || !/xml|rss|atom/i.test(response.headers.get("content-type") ?? text.slice(0, 100))) continue;
          const remaining = 60 - pages.filter((page) => page.source === "rss").length;
          pages.push(...parseRssXml(text, feedUrl).slice(0, remaining));
        } catch { /* optional feed */ }
      }
    };
    for (const feedPath of FEED_PATHS) diagnostics.feedUrls.push(new URL(feedPath, origin).toString());
    await readFeeds(diagnostics.feedUrls.slice(0, 7));

    const wpEndpoints = [
      "/wp-json/wp/v2/posts?per_page=20&_fields=link,title,content,date",
      "/wp-json/wp/v2/pages?per_page=20&_fields=link,title,content,date",
      "/wp-json/wp/v2/users?per_page=20&_fields=link,name,description,url",
      "/wp-json/wp/v2/media?per_page=20&_fields=link,title,caption,description,date,source_url",
    ];
    for (const path of wpEndpoints) {
      try {
        const response = await fetchWithRetry(new URL(path, origin), { method: "GET", headers: { accept: "application/json" } }, { ...this.http, retries: 0 });
        if (!response.ok) continue;
        const items = await response.json() as Array<{ link?: string; name?: string; description?: string | { rendered?: string }; url?: string; source_url?: string; title?: { rendered?: string }; content?: { rendered?: string }; caption?: { rendered?: string }; date?: string }>;
        diagnostics.wordpress = true;
        for (const item of items) {
          const itemUrl = normalizeUrl(item.link ?? item.url ?? item.source_url ?? "");
          if (!itemUrl) continue;
          if (/\.pdf(?:$|\?)/i.test(item.source_url ?? "")) queue.push(item.source_url!);
          const description = typeof item.description === "string" ? item.description : item.description?.rendered;
          const content = [item.content?.rendered, item.caption?.rendered, description].filter(Boolean).join(" ");
          const parsed = parseHtml(content, itemUrl);
          pages.push({ ...parsed.page, title: item.title?.rendered ?? item.name ?? parsed.page.title, source: "wordpress", publishedAt: item.date ?? null });
        }
      } catch { /* endpoint unavailable */ }
    }

    queue.sort((left, right) => usefulScore(right) - usefulScore(left));
    while (queue.length > 0 && pages.filter((page) => page.source === "website" || page.source === "pdf").length < this.maxPages) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);
      let url: URL;
      try { url = new URL(current); } catch { continue; }
      if (url.hostname.replace(/^www\./, "") !== rootHost) continue;
      if (disallowed.some((path) => path !== "/" && url.pathname.startsWith(path))) continue;
      if (BLOCKED_PATH.test(url.pathname)) continue;

      try {
        await delay(120);
        const response = await fetchWithRetry(url, { method: "GET", headers: { accept: "text/html,application/xhtml+xml,application/pdf" } }, this.http);
        if (!response.ok) { warnings.push(`${url}: HTTP ${response.status}`); continue; }
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/pdf") || /\.pdf$/i.test(url.pathname)) {
          const contentLength = Number(response.headers.get("content-length") ?? 0);
          if (contentLength > 15_000_000) { warnings.push(`${url}: PDF больше лимита 15 MB`); continue; }
          diagnostics.pdfUrls.push(response.url || url.toString());
          const text = await pdfText(await response.arrayBuffer());
          pages.push(extractPage(text, text.match(/https?:\/\/[^\s<>"']+/gi) ?? [], response.url || url.toString(), url.pathname.split("/").at(-1) || "PDF", "pdf"));
          continue;
        }
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) continue;
        let html = await response.text();
        let parsed = parseHtml(html, response.url || url.toString());
        diagnostics.feedUrls.push(...parsed.feeds);
        if (parsed.likelySpa && diagnostics.jsFallbacks < 2) {
          const rendered = await this.renderSpa(response.url || url.toString());
          if (rendered) { html = rendered; parsed = parseHtml(html, response.url || url.toString()); diagnostics.jsFallbacks += 1; }
        }
        pages.push(parsed.page);
        const usefulLinks = parsed.links.map((href) => {
          try { const next = new URL(href, response.url || url); next.hash = ""; return next; } catch { return null; }
        }).filter((next): next is URL => Boolean(next))
          .filter((next) => next.hostname.replace(/^www\./, "") === rootHost && USEFUL_PATH.test(`${next.pathname}${next.search}`) && !BLOCKED_PATH.test(next.pathname))
          .map((next) => next.toString());
        queue.push(...usefulLinks.filter((next) => !visited.has(next) && !queue.includes(next)));
        queue.sort((left, right) => usefulScore(right) - usefulScore(left));
      } catch (error) { warnings.push(`${url}: ${error instanceof Error ? error.message : String(error)}`); }
    }

    await readFeeds(unique(diagnostics.feedUrls).slice(0, 12));

    return { pages: uniqueBy(pages, (page) => `${page.source}:${page.url}`), warnings, diagnostics: { ...diagnostics, sitemapUrls: unique(diagnostics.sitemapUrls), feedUrls: unique(diagnostics.feedUrls), pdfUrls: unique(diagnostics.pdfUrls) } };
  }
}

export function pageEvidence(pages: CrawledPage[]): Evidence[] {
  const now = new Date().toISOString();
  return pages.map((page) => ({
    source: page.source === "wordpress" ? "website" : page.source ?? "website",
    url: page.url,
    title: page.title,
    snippet: truncate([...page.emails, ...page.phones, ...page.socialUrls, page.text].filter(Boolean).join("\n"), 4_000),
    publishedAt: page.publishedAt ?? null,
    discoveredAt: now,
  }));
}
