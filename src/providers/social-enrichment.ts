import * as cheerio from "cheerio";
import { fetchWithRetry, type HttpOptions } from "../http.js";
import { normalizeSocialUrl } from "../extraction.js";
import type { CrawledPage, SocialPlatform, SocialProfile } from "../types.js";
import { normalizeEmail, normalizePhone, truncate, unique, uniqueBy } from "../utils.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

export interface EnrichedSocialPage {
  platform: SocialPlatform;
  profileUrl: string;
  page: CrawledPage;
}

export interface SocialEnrichmentOutcome {
  pages: EnrichedSocialPage[];
  warnings: string[];
  attempted: number;
}

function publicPageUrl(profile: SocialProfile): string | null {
  try {
    const url = new URL(profile.url);
    if (profile.platform !== "telegram") return url.toString();
    const segments = url.pathname.split("/").filter(Boolean);
    const username = segments[0] === "s" ? segments[1] : segments[0];
    if (!username || username.startsWith("+") || username === "joinchat") return null;
    return `https://t.me/s/${username}`;
  } catch {
    return null;
  }
}

function pageFromHtml(html: string, responseUrl: string): CrawledPage {
  const $ = cheerio.load(html);
  const title = $("meta[property='og:title']").attr("content") || $("title").first().text() || $("h1").first().text() || responseUrl;
  const description = [
    $("meta[property='og:description']").attr("content"),
    $("meta[name='description']").attr("content"),
  ].filter(Boolean).join(" ");
  const hrefs = $("a[href]").map((_, element) => $(element).attr("href") ?? "").get();
  $("script, style, noscript, svg, iframe, template").remove();
  const text = truncate(`${description} ${$("body").text()}`.replace(/\s+/g, " ").trim(), 50_000);
  const emails = unique([
    ...hrefs.filter((value) => value.toLowerCase().startsWith("mailto:")).map(normalizeEmail),
    ...(text.match(EMAIL_PATTERN) ?? []).map(normalizeEmail),
  ]).filter((value) => value.includes("@"));
  const phones = unique([
    ...hrefs.filter((value) => value.toLowerCase().startsWith("tel:")).map((value) => normalizePhone(value.slice(4))),
    ...(text.match(PHONE_PATTERN) ?? []).map(normalizePhone),
  ]).filter((value) => value.replace(/\D/g, "").length >= 10);
  const embeddedUrls = [...hrefs, ...(text.match(URL_PATTERN) ?? [])];
  const socialUrls = unique(embeddedUrls.flatMap((value) => {
    try {
      const absolute = new URL(value, responseUrl).toString();
      return normalizeSocialUrl(absolute)?.url ? [normalizeSocialUrl(absolute)!.url] : [];
    } catch {
      return [];
    }
  }));
  return { url: responseUrl, title: truncate(title.trim(), 180), text, emails, phones, socialUrls, source: "social", publishedAt: null };
}

export class SocialProfileEnricher {
  constructor(private readonly http: HttpOptions, private readonly maxProfiles = 12) {}

  async enrich(profiles: SocialProfile[]): Promise<SocialEnrichmentOutcome> {
    const selected = uniqueBy(profiles, (profile) => `${profile.platform}:${profile.url.toLowerCase()}`).slice(0, this.maxProfiles);
    const pages: EnrichedSocialPage[] = [];
    const warnings: string[] = [];

    for (let index = 0; index < selected.length; index += 3) {
      const batch = await Promise.all(selected.slice(index, index + 3).map(async (profile) => {
        const url = publicPageUrl(profile);
        if (!url) return null;
        try {
          const response = await fetchWithRetry(url, { method: "GET", headers: { accept: "text/html,application/xhtml+xml" } }, { ...this.http, retries: 0, timeoutMs: Math.min(this.http.timeoutMs, 10_000) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const contentType = response.headers.get("content-type") ?? "";
          if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error(`неподдерживаемый content-type ${contentType}`);
          return { platform: profile.platform, profileUrl: profile.url, page: pageFromHtml(await response.text(), response.url || url) } satisfies EnrichedSocialPage;
        } catch (error) {
          warnings.push(`${profile.platform} ${profile.url}: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      }));
      pages.push(...batch.filter((item): item is EnrichedSocialPage => Boolean(item)));
    }

    return { pages, warnings, attempted: selected.length };
  }
}
