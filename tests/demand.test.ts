import { describe, expect, it } from "vitest";
import { buildDemandQueryCatalog, selectDailyDemandQueries } from "../src/demand/catalog.js";
import { scoreDemandResult } from "../src/demand/monitor.js";
import type { DemandQuery } from "../src/types.js";

const query: DemandQuery = {
  id: "safety-vendor",
  query: '"ищем подрядчика" "ролик по охране труда"',
  category: "safety",
  intent: "vendor_search",
  priority: 100,
  locale: "ru",
  channel: "web",
};

describe("demand query catalog", () => {
  it("covers broad and narrow Anix services plus social and forum sources", () => {
    const catalog = buildDemandQueryCatalog();
    expect(catalog.length).toBeGreaterThan(500);
    expect(catalog.some((item) => item.query.includes("механизма действия препарата"))).toBe(true);
    expect(catalog.some((item) => item.query.includes("охране труда"))).toBe(true);
    expect(catalog.some((item) => item.channel === "social" && item.query.includes("site:t.me"))).toBe(true);
    expect(catalog.some((item) => item.channel === "forum" && item.query.includes("site:vc.ru"))).toBe(true);
  });

  it("builds a diverse deterministic daily budget", () => {
    const selected = selectDailyDemandQueries(new Date("2026-08-21T00:00:00Z"), 36);
    expect(selected).toHaveLength(36);
    expect(selected.some((item) => item.channel === "social")).toBe(true);
    expect(selected.some((item) => item.channel === "forum")).toBe(true);
    expect(selected.some((item) => item.locale === "en")).toBe(true);
    expect(selectDailyDemandQueries(new Date("2026-08-21T12:00:00Z"), 36)).toEqual(selected);
  });
});

describe("demand scoring", () => {
  it("ranks a fresh explicit commercial brief with a public channel highly", () => {
    const signal = scoreDemandResult({
      title: "Ищем подрядчика на ролик по охране труда",
      url: "https://t.me/example/42",
      content: "Нужно сделать анимационный видеоинструктаж. Есть бюджет и ТЗ. Пишите producer@example.ru",
      provider: "searxng",
      query: query.query,
      publishedAt: new Date().toISOString(),
      author: "Закупки компании",
    }, query);
    expect(signal.score).toBeGreaterThanOrEqual(75);
    expect(signal.emails).toContain("producer@example.ru");
    expect(signal.socialUrls).toContain("https://t.me/example/42");
  });

  it("downranks job seeking and free tutorials", () => {
    const signal = scoreDemandResult({ title: "Ищу работу", url: "https://example.com/job", content: "Ищу работу аниматором, нужен бесплатный курс и tutorial", provider: "feed" }, query);
    expect(signal.score).toBeLessThan(25);
  });
});
