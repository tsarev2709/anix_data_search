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
    expect(selected.some((item) => item.channel === "news")).toBe(true);
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
  it("does not inherit tender or service intent from the search query", () => {
    const signal = scoreDemandResult({
      title: "Централизованные хранилища скиллов",
      url: "https://habr.com/ru/articles/123/",
      content: "Команды используют AI-агентов и хранят инструкции в репозитории. Статья объясняет архитектуру системы.",
      provider: "feed",
      query: '"тендер" "создать маскота бренда"',
      publishedAt: new Date().toISOString(),
    }, { ...query, category: "mascot", intent: "tender" });
    expect(signal.signalType).toBe("market_intelligence");
    expect(signal.leadGatePassed).toBe(false);
    expect(signal.score).toBeLessThan(25);
  });

  it("derives category and intent from the publication itself", () => {
    const signal = scoreDemandResult({
      title: "Ищем подрядчика на видео по промышленной безопасности",
      url: "https://vc.ru/marketing/123",
      content: "Нужно создать серию обучающих роликов по охране труда. Есть бюджет, ТЗ и срок до ноября.",
      provider: "feed",
      query: '"тендер" "создать маскота бренда"',
      publishedAt: new Date().toISOString(),
      author: "Руководитель ОТ",
    }, { ...query, category: "mascot", intent: "tender" });
    expect(signal.signalType).toBe("direct_demand");
    expect(signal.leadGatePassed).toBe(true);
    expect(signal.category).toBe("safety");
    expect(signal.intent).toBe("vendor_search");
    expect(signal.evidenceQuote.toLowerCase()).toContain("подрядчика");
  });

  it("separates a company trigger from a direct request", () => {
    const signal = scoreDemandResult({
      title: "Фармкомпания выводит на рынок новый препарат",
      url: "https://example.ru/news/launch",
      content: "Компания готовит запуск препарата и коммуникационную кампанию для врачей.",
      provider: "google_news",
      publishedAt: new Date().toISOString(),
      author: "Компания",
    }, { ...query, category: "pharma", intent: "market_signal", channel: "news" });
    expect(signal.signalType).toBe("account_trigger");
    expect(signal.leadGatePassed).toBe(false);
    expect(signal.category).toBe("pharma");
    expect(signal.score).toBeGreaterThanOrEqual(50);
    expect(signal.nextAction).toContain("ЛПР");
  });

});
