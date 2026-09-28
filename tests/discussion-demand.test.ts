import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscussionDemandProvider, parseDiscussionHtml, selectDiscussionPages } from "../src/providers/discussion-demand.js";
import { scoreDemandResult } from "../src/demand/qualification.js";
import type { DemandQuery, SearchResult } from "../src/types.js";

const url = "https://vc.ru/marketing/123";
const query: DemandQuery = { id: "forum", query: '"ролик по охране труда" site:vc.ru', category: "safety", intent: "problem", priority: 76, locale: "ru", channel: "forum" };
const html = `
  <article><h1>Как мы выбирали студию анимации</h1><p>Нужен продакшн, но это исторический обзор.</p></article>
  <script type="application/ld+json">{
    "@context":"https://schema.org", "@type":"DiscussionForumPosting", "url":"https://vc.ru/marketing/123",
    "articleBody":"История создания ролика для сайта компании.",
    "comment":[
      {"@type":"Comment","url":"https://vc.ru/marketing/123#comment-42","text":"Ищем подрядчика: нужен ролик по охране труда, бюджет согласован. Пишите в личку.","author":{"name":"Ирина"},"datePublished":"2026-09-27T11:00:00Z"},
      {"@type":"Comment","text":"Обычный ответ без ссылки на комментарий и без задачи.","author":{"name":"Пётр"}}
    ]
  }</script>
  <div class="comment" id="comment-42"><span class="comment__author">Ирина</span><div class="comment__text">Ищем подрядчика: нужен ролик по охране труда, бюджет согласован. Пишите в личку.</div><time datetime="2026-09-27T11:00:00Z"></time></div>
  <div class="comment" id="comment-43"><span class="comment__author">Спамер</span><div class="comment__text">Предлагаем услугу видеомонтажа и анимации всем желающим прямо сегодня.</div></div>`;

afterEach(() => vi.unstubAllGlobals());

describe("discussion parsing", () => {
  it("separates comments from the article, preserves a reply link and deduplicates JSON-LD with DOM", () => {
    const results = parseDiscussionHtml(html, url, query.query);
    expect(results).toHaveLength(3);
    const request = results.find((item) => item.url.endsWith("#comment-42"));
    expect(request?.author).toBe("Ирина");
    expect(request?.publishedAt).toBe("2026-09-27T11:00:00.000Z");
    expect(request?.content).not.toContain("исторический обзор");
    const signal = scoreDemandResult(request!, query);
    expect(signal.signalType).toBe("direct_demand");
    expect(signal.contactability).toBe("source_reply");
    expect(scoreDemandResult(results.find((item) => item.url.endsWith("#comment-43"))!, query).leadGatePassed).toBe(false);
    const undated = scoreDemandResult({ ...request!, publishedAt: null }, query);
    expect(undated.leadGatePassed).toBe(false);
  });

  it("keeps only bounded HTTPS forum pages and drops old posts", () => {
    const candidates: SearchResult[] = [
      { title: "Video", url, content: "Ищем подрядчика", provider: "searxng", query: query.query },
      { title: "Private", url: "https://localhost/discussion", content: "", provider: "searxng" },
      { title: "Insecure", url: "http://vc.ru/marketing/456", content: "", provider: "searxng" },
      { title: "Old", url: "https://habr.com/ru/articles/123/", content: "", provider: "feed", publishedAt: "2020-01-01" },
      { title: "Duplicate", url, content: "", provider: "feed" },
    ];
    expect(selectDiscussionPages(candidates, 12).map((item) => item.url)).toEqual([url]);
  });

  it("fetches public pages and returns individual comments to the daily monitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })));
    const provider = new DiscussionDemandProvider({ timeoutMs: 1_000, retries: 0, userAgent: "test" }, 2);
    const outcome = await provider.searchDemand([{ title: "Форум", url, content: "видео", provider: "searxng", query: query.query }]);
    expect(outcome.status).toBe("used");
    expect(outcome.results.some((item) => item.url.endsWith("#comment-42"))).toBe(true);
    expect(outcome.results.every((item) => item.provider === "discussion")).toBe(true);
  });
});
