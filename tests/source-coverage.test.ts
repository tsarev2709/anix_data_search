import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDemandQueryCatalog, selectDailyDemandQueries } from "../src/demand/catalog.js";
import { demandCoverage } from "../src/demand/coverage.js";
import { companyQueryMatrix, personQueryMatrix } from "../src/providers/query-matrix.js";
import { SEARCH_SITES } from "../src/providers/source-catalog.js";
import { searchDemandWeb } from "../src/providers/demand-web-search.js";
import { SearxngProvider } from "../src/providers/searxng.js";
import { chooseLikelyOfficialWebsite, TavilySearch } from "../src/providers/search.js";
import type { ProviderSearchResult } from "../src/providers/search-provider.js";
import { renderDemandMarkdown } from "../src/report.js";

const http = { timeoutMs: 1000, retries: 0, userAgent: "test" };
const day = (offset: number) => new Date(Date.UTC(2026, 9, 15 + offset));
const outcome = (queries: string[], successfulQueries: string[]): ProviderSearchResult => ({
  provider: "searxng", source: "searxng", status: successfulQueries.length ? "used" : "failed", queries, successfulQueries, results: [], warnings: [],
});

afterEach(() => vi.unstubAllGlobals());

describe("source coverage planning", () => {
  it("reaches every catalog site with the minimum daily budget over one rotation", () => {
    const seen = new Set<string>();
    for (let offset = 0; offset < SEARCH_SITES.length; offset += 1) {
      const queries = selectDailyDemandQueries(day(offset), 5);
      expect(queries).toHaveLength(5);
      expect(new Set(queries.map((item) => item.id)).size).toBe(5);
      queries.forEach((query) => { if (query.site) seen.add(query.site); });
    }
    expect([...seen].sort()).toEqual(SEARCH_SITES.map((site) => site.domain).sort());
  });

  it("reserves eighteen distinct site targets without losing general or news searches", () => {
    const queries = selectDailyDemandQueries(day(0), 36);
    expect(new Set(queries.flatMap((item) => item.site ? [item.site] : [])).size).toBe(18);
    expect(queries.filter((item) => item.channel === "news")).toHaveLength(6);
    expect(queries.filter((item) => item.locale === "en")).toHaveLength(4);
    const twoDays = [0, 1].flatMap((offset) => selectDailyDemandQueries(day(offset), 36).flatMap((item) => item.site ? [item.site] : []));
    expect(new Set(twoDays).size).toBe(SEARCH_SITES.length);
    expect(selectDailyDemandQueries(day(0), 0)).toEqual([]);
    expect(buildDemandQueryCatalog().every((item) => !item.site || item.query.includes(`site:${item.site}`))).toBe(true);
  });

  it("rotates contact targets and keeps role searches at the front", () => {
    const seen = new Set<string>();
    for (let offset = 0; offset < SEARCH_SITES.length; offset += 1) {
      const queries = companyQueryMatrix("Компания", ["директор"], day(offset)).slice(0, 18);
      expect(queries[1]).toContain('"директор"');
      queries.forEach((query) => [...query.matchAll(/site:([a-z0-9.-]+)/g)].forEach((match) => seen.add(match[1]!)));
    }
    for (const site of SEARCH_SITES) expect(seen.has(site.domain)).toBe(true);
    expect(personQueryMatrix("Иван Петров", "Компания", day(0)).every((query) => query.includes('"Иван Петров" "Компания"'))).toBe(true);
  });

  it("does not choose a third-party industry listing as the official company website", () => {
    expect(chooseLikelyOfficialWebsite("Аникс", [
      { title: "Аникс", url: "https://companies.rbc.ru/id/123/", content: "" },
      { title: "Аникс", url: "https://anix.example/", content: "" },
    ])).toBe("https://anix.example/");
  });
});

describe("provider recovery and truthful coverage", () => {
  it("retries failed and unattempted queries while keeping a successful empty response", async () => {
    const fallback = { searchDemand: vi.fn(async (queries: string[], budget: number) => ({ ...outcome(queries.slice(0, budget), queries.slice(0, budget)), provider: "tavily" })) };
    const initial = outcome(["empty", "failed"], ["empty"]);
    const outcomes = await searchDemandWeb(["empty", "failed", "unattempted"], { searchDemand: async () => initial }, fallback, 1);
    expect(fallback.searchDemand).toHaveBeenCalledWith(["failed", "unattempted"], 1);
    expect(outcomes).toHaveLength(2);
    await searchDemandWeb(["failed"], { searchDemand: async () => initial }, fallback, 0);
    expect(fallback.searchDemand).toHaveBeenCalledTimes(1);
  });

  it("does not report unattempted SearXNG queries after a circuit break", async () => {
    const fetch = vi.fn(async (input: string | URL) => String(input).includes("searx.space")
      ? new Response(JSON.stringify({ instances: {} })) : new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    const result = await new SearxngProvider(http, ["https://search.example"]).searchDemand(["one", "two", "three", "four", "five"]);
    expect(result.status).toBe("failed");
    expect(result.queries).toEqual(["one", "two", "three"]);
    expect(result.successfulQueries).toEqual([]);
  });

  it("keeps partial Tavily results, publication dates and the credit cap", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ results: [{ title: "Brief", url: "https://vc.ru/1", content: "request", published_date: "2026-10-15" }] })))
      .mockResolvedValueOnce(new Response("offline", { status: 500 }));
    vi.stubGlobal("fetch", fetch);
    const result = await new TavilySearch("test-key", http).searchDemand(["one", "two", "three"], 2);
    expect(result.status).toBe("used");
    expect(result.results[0]).toMatchObject({ query: "one", publishedAt: "2026-10-15" });
    expect(result.successfulQueries).toEqual(["one"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ search_depth: "basic", time_range: "month", include_published_date: true });
  });

  it("stops Tavily requests when credits are exhausted", async () => {
    const fetch = vi.fn(async () => new Response("usage limit", { status: 432 }));
    vi.stubGlobal("fetch", fetch);
    const result = await new TavilySearch("test-key", http).searchDemand(["one", "two", "three"], 3);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.queries).toEqual(["one"]);
    expect(result.status).toBe("failed");
  });

  it("distinguishes planned sites, attempted searches, successful responses and result domains", () => {
    const queries = selectDailyDemandQueries(day(0), 36);
    const target = queries.find((item) => item.site)!;
    const coverage = demandCoverage(queries, [{ ...outcome([target.query], []), results: [{ title: "Result", url: "https://www.vc.ru/123", content: "" }] }]);
    expect(coverage.plannedSites).toHaveLength(18);
    expect(coverage.attemptedSites).toEqual([target.site]);
    expect(coverage.successfulSites).toEqual([]);
    expect(coverage.resultDomains).toEqual(["vc.ru"]);
    const markdown = renderDemandMarkdown({ runId: "test", startedAt: day(0).toISOString(), finishedAt: day(0).toISOString(), queries, signals: [], providers: {}, failures: [], resultsCount: 1, discardedCount: 1, coverage });
    expect(markdown).toContain("Площадок в плане: 18");
    expect(markdown).toContain("с корректным ответом поиска: 0");
  });
});
