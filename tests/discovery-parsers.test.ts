import { describe, expect, it } from "vitest";
import { parseCommonCrawlRows } from "../src/providers/common-crawl.js";
import { gdeltDate } from "../src/providers/gdelt.js";
import { pageEvidence, parseRssXml, parseSitemapXml } from "../src/providers/website.js";

describe("site discovery parsers", () => {
  it("parses sitemap and nested sitemap index", () => {
    const index = parseSitemapXml(`<?xml version="1.0"?><sitemapindex><sitemap><loc>https://a.ru/posts.xml</loc></sitemap></sitemapindex>`);
    expect(index.nested).toEqual(["https://a.ru/posts.xml"]);
    const map = parseSitemapXml(`<urlset><url><loc>https://a.ru/team</loc></url><url><loc>https://a.ru/file.pdf</loc></url></urlset>`);
    expect(map.urls).toHaveLength(2);
  });

  it("parses RSS contacts and freshness", () => {
    const pages = parseRssXml(`<rss><channel><item><title>Назначение</title><link>https://a.ru/news/1</link><pubDate>Mon, 17 Aug 2026 10:00:00 GMT</pubDate><description>Иван Петров, директор. ivan@a.ru</description></item></channel></rss>`, "https://a.ru/rss.xml");
    expect(pages[0]).toMatchObject({ url: "https://a.ru/news/1", source: "rss", emails: ["ivan@a.ru"] });
    expect(pages[0]?.publishedAt).toContain("2026");
  });

  it("parses Common Crawl JSON-lines and table output", () => {
    expect(parseCommonCrawlRows('{"url":"https://a.ru/team","status":"200"}\n')).toEqual([{ url: "https://a.ru/team", status: "200" }]);
    expect(parseCommonCrawlRows('[["url","status"],["https://a.ru/file.pdf","200"]]')[0]).toEqual({ url: "https://a.ru/file.pdf", status: "200" });
  });

  it("normalizes GDELT timestamps for freshness scoring", () => {
    expect(gdeltDate("20260817T102030Z")).toBe("2026-08-17T10:20:30Z");
  });

  it("preserves direct channels in page evidence", () => {
    const evidence = pageEvidence([{ url: "https://a.ru/team", title: "Team", text: "Иван Петров", emails: ["ivan@a.ru"], phones: [], socialUrls: ["https://t.me/ivan"], source: "website" }]);
    expect(evidence[0]?.snippet).toContain("ivan@a.ru");
    expect(evidence[0]?.snippet).toContain("https://t.me/ivan");
  });
});
