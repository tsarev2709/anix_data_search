import * as cheerio from "cheerio";
import type { CrawledPage, Evidence } from "../types.js";
import { fetchWithRetry, type HttpOptions } from "../http.js";
import { normalizeEmail, normalizePhone, normalizeUrl, truncate, unique } from "../utils.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const USEFUL_PATH = /contact|team|about|company|people|staff|management|руковод|команд|контакт|о[-_]?компан|press|пресс/i;
const BLOCKED_PATH = /login|signin|cart|checkout|privacy|policy|cookie|terms|vacanc|career|job|личн|ваканс/i;
const SOCIAL_HOSTS = ["t.me", "telegram.me", "vk.com", "linkedin.com", "threads.net", "tenchat.ru", "youtube.com", "rutube.ru"];

function extractSocialUrls(hrefs: string[], baseUrl: string): string[] {
  return unique(
    hrefs
      .map((href) => {
        try {
          return new URL(href, baseUrl).toString();
        } catch {
          return "";
        }
      })
      .filter((href) => {
        try {
          const host = new URL(href).hostname.replace(/^www\./, "");
          return SOCIAL_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
        } catch {
          return false;
        }
      }),
  );
}

function parseHtml(html: string, url: string): { page: CrawledPage; links: string[] } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, template").remove();
  const title = truncate($("title").first().text() || $("h1").first().text() || url, 180);
  const hrefs = $("a[href]")
    .map((_, element) => $(element).attr("href") ?? "")
    .get();
  const mailtoEmails = hrefs
    .filter((href) => href.toLowerCase().startsWith("mailto:"))
    .map((href) => normalizeEmail(href));
  const telPhones = hrefs
    .filter((href) => href.toLowerCase().startsWith("tel:"))
    .map((href) => normalizePhone(href.slice(4)));
  const text = truncate($("body").text(), 30_000);
  const emails = unique([...mailtoEmails, ...(text.match(EMAIL_PATTERN) ?? []).map(normalizeEmail)]).filter(
    (email) => email.includes("@") && !/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email),
  );
  const phones = unique([...telPhones, ...(text.match(PHONE_PATTERN) ?? []).map(normalizePhone)]).filter(
    (phone) => phone.replace(/\D/g, "").length >= 10,
  );

  return {
    page: {
      url,
      title,
      text,
      emails,
      phones,
      socialUrls: extractSocialUrls(hrefs, url),
    },
    links: hrefs,
  };
}

export class WebsiteCrawler {
  constructor(
    private readonly http: HttpOptions,
    private readonly maxPages: number,
  ) {}

  async crawl(rawWebsite: string): Promise<{ pages: CrawledPage[]; warnings: string[] }> {
    const website = normalizeUrl(rawWebsite);
    if (!website) return { pages: [], warnings: [`Некорректный URL: ${rawWebsite}`] };

    const rootHost = new URL(website).hostname.replace(/^www\./, "");
    const queue = [website];
    const visited = new Set<string>();
    const pages: CrawledPage[] = [];
    const warnings: string[] = [];

    while (queue.length > 0 && pages.length < this.maxPages) {
      const current = queue.shift();
      if (!current || visited.has(current)) continue;
      visited.add(current);

      try {
        const response = await fetchWithRetry(current, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" } }, this.http);
        if (!response.ok) {
          warnings.push(`${current}: HTTP ${response.status}`);
          continue;
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) continue;
        const html = await response.text();
        const { page, links } = parseHtml(html, response.url || current);
        pages.push(page);

        const usefulLinks = links
          .map((href) => {
            try {
              const url = new URL(href, response.url || current);
              url.hash = "";
              return url;
            } catch {
              return null;
            }
          })
          .filter((url): url is URL => Boolean(url))
          .filter(
            (url) =>
              url.hostname.replace(/^www\./, "") === rootHost &&
              USEFUL_PATH.test(`${url.pathname}${url.search}`) &&
              !BLOCKED_PATH.test(url.pathname),
          )
          .map((url) => url.toString());
        queue.push(...usefulLinks.filter((url) => !visited.has(url) && !queue.includes(url)));
      } catch (error) {
        warnings.push(`${current}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return { pages, warnings };
  }
}

export function pageEvidence(pages: CrawledPage[]): Evidence[] {
  return pages.map((page) => ({
    source: "website",
    url: page.url,
    title: page.title,
    snippet: truncate(page.text, 1_500),
  }));
}
