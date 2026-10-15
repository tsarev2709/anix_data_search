import type { DemandIntent, DemandQuery } from "../types.js";
import { uniqueBy } from "../utils.js";
import { diverseSearchSites, rotate, utcDay } from "../providers/source-catalog.js";

const RUSSIAN_INTENTS: Array<{ phrase: string; intent: DemandIntent; priority: number }> = [
  { phrase: "ищем подрядчика", intent: "vendor_search", priority: 100 },
  { phrase: "ищу студию", intent: "vendor_search", priority: 100 },
  { phrase: "нужен продакшн", intent: "vendor_search", priority: 98 },
  { phrase: "посоветуйте подрядчика", intent: "recommendation", priority: 96 },
  { phrase: "порекомендуйте студию", intent: "recommendation", priority: 96 },
  { phrase: "кто может сделать", intent: "vendor_search", priority: 92 },
  { phrase: "нужно сделать", intent: "brief", priority: 88 },
  { phrase: "ищем исполнителя", intent: "vendor_search", priority: 94 },
  { phrase: "запрос предложений", intent: "tender", priority: 100 },
  { phrase: "тендер", intent: "tender", priority: 100 },
  { phrase: "собираем сметы", intent: "brief", priority: 90 },
  { phrase: "нужна оценка стоимости", intent: "brief", priority: 86 },
];

const SERVICES: Array<{ category: string; phrases: string[] }> = [
  { category: "business_video", phrases: ["видеоролик для компании", "корпоративное видео", "видеоконтент для бизнеса"] },
  { category: "animation", phrases: ["анимационный ролик", "2D анимация для бизнеса", "3D ролик для компании", "нейроанимация"] },
  { category: "explainer", phrases: ["объясняющий ролик", "explainer video", "визуализация сложного продукта"] },
  { category: "pharma", phrases: ["фармацевтический ролик", "анимация механизма действия препарата", "ролик для врачей", "ролик для пациентов"] },
  { category: "safety", phrases: ["ролик по охране труда", "анимация по промышленной безопасности", "видеоинструктаж по безопасности", "разбор производственного инцидента видео"] },
  { category: "learning", phrases: ["анимация для электронного курса", "обучающий ролик для сотрудников", "микрообучение видео", "контент для корпоративного университета"] },
  { category: "onboarding", phrases: ["видео для онбординга сотрудников", "welcome ролик для сотрудников", "адаптационный курс видео"] },
  { category: "internal_comms", phrases: ["ролик для внутренних коммуникаций", "корпоративная культура видео", "видео обращение руководителя"] },
  { category: "hr_brand", phrases: ["ролик для бренда работодателя", "HR видео", "видео о профессиях компании"] },
  { category: "marketing", phrases: ["рекламный анимационный ролик", "видео для запуска продукта", "брендовый видеоконтент"] },
  { category: "events", phrases: ["ролик для конференции", "заставка для мероприятия", "визуальный контент для стенда", "видео для выставки"] },
  { category: "mascot", phrases: ["создать маскота бренда", "анимировать корпоративного персонажа", "персонаж для рекламной кампании"] },
  { category: "industrial", phrases: ["визуализация технологического процесса", "анимация работы оборудования", "техническая 3D анимация"] },
  { category: "sales", phrases: ["продающий видеоролик B2B", "видео для отдела продаж", "ролик для презентации продукта"] },
  { category: "public_sector", phrases: ["социальный видеоролик", "просветительская анимация", "ролик для госкомпании"] },
];

const ENGLISH_QUERIES: Array<[string, string, DemandIntent]> = [
  ["business_video", '"looking for" "video production studio"', "vendor_search"],
  ["animation", '"looking for" "animation studio"', "vendor_search"],
  ["explainer", '"need an explainer video"', "brief"],
  ["pharma", '"pharma animation studio" recommendation', "recommendation"],
  ["safety", '"safety training animation" vendor', "vendor_search"],
  ["learning", '"animation for e-learning" contractor', "vendor_search"],
  ["onboarding", '"employee onboarding video" agency', "vendor_search"],
  ["events", '"event screen content" production studio', "vendor_search"],
  ["mascot", '"brand mascot animation" studio', "vendor_search"],
  ["industrial", '"industrial process animation" vendor', "vendor_search"],
];

const NEWS_TRIGGERS: DemandQuery[] = [
  { id: "news-pharma-launch", query: "компания запускает новый препарат OR медицинское изделие", category: "pharma", intent: "market_signal", priority: 78, locale: "ru", channel: "news" },
  { id: "news-pharma-tender", query: "фармацевтическая компания тендер видео OR анимация OR контент", category: "pharma", intent: "tender", priority: 86, locale: "ru", channel: "news" },
  { id: "news-safety-training", query: "предприятие обновляет обучение охрана труда OR промышленная безопасность", category: "safety", intent: "market_signal", priority: 78, locale: "ru", channel: "news" },
  { id: "news-corporate-learning", query: "компания запускает корпоративное обучение OR онбординг сотрудников", category: "learning", intent: "market_signal", priority: 74, locale: "ru", channel: "news" },
  { id: "news-event-launch", query: "компания готовит конференцию OR выставку OR форум видеоконтент", category: "events", intent: "market_signal", priority: 72, locale: "ru", channel: "news" },
  { id: "news-brand-launch", query: "компания запускает новый бренд OR ребрендинг коммуникационная кампания", category: "marketing", intent: "market_signal", priority: 72, locale: "ru", channel: "news" },
];

function queryId(parts: string[]): string {
  return parts.join("-").toLowerCase().replace(/[^a-zа-яё0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 120);
}

export function buildDemandQueryCatalog(): DemandQuery[] {
  const queries: DemandQuery[] = [];
  for (const service of SERVICES) {
    for (const phrase of service.phrases) {
      for (const intent of RUSSIAN_INTENTS) {
        queries.push({
          id: queryId([service.category, intent.phrase, phrase]),
          query: `"${intent.phrase}" "${phrase}"`,
          category: service.category,
          intent: intent.intent,
          priority: intent.priority,
          locale: "ru",
          channel: "web",
        });
      }
      for (const site of diverseSearchSites()) {
        queries.push({
          id: queryId([service.category, site.domain, phrase]),
          query: `"${phrase}" site:${site.domain}`,
          category: service.category,
          intent: site.group === "procurement" ? "tender" : "market_signal",
          priority: site.group === "procurement" ? 94 : 82,
          locale: "ru",
          channel: site.group === "social" ? "social" : site.group === "forum" ? "forum" : "web",
          site: site.domain,
        });
      }
    }
  }
  for (const [category, query, intent] of ENGLISH_QUERIES) {
    queries.push({ id: queryId([category, query]), query, category, intent, priority: 72, locale: "en", channel: "forum" });
  }
  queries.push(...NEWS_TRIGGERS);
  return uniqueBy(queries, (item) => item.query.toLowerCase());
}

function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function selectDailyDemandQueries(date: Date, budget: number): DemandQuery[] {
  const limit = Math.max(0, Math.floor(budget));
  if (!Number.isFinite(limit) || !limit) return [];
  const catalog = buildDemandQueryCatalog();
  const day = date.toISOString().slice(0, 10);
  const dayNumber = utcDay(date);
  const ranked = (items: DemandQuery[], salt: string) => items.sort((left, right) =>
    hash(`${day}:${salt}:${left.id}`) - hash(`${day}:${salt}:${right.id}`));
  const weights = [8, 18, 6, 4];
  const quotas = weights.map((weight) => Math.floor(limit * weight / 36));
  const remainders = weights.map((weight, index) => ({ index, remainder: limit * weight / 36 - quotas[index]! }))
    .sort((left, right) => right.remainder - left.remainder);
  for (let index = 0, remaining = limit - quotas.reduce((sum, quota) => sum + quota, 0); index < remaining; index += 1) {
    quotas[remainders[index]!.index]! += 1;
  }
  // One query per site in each pass; rotating sites advances even with tiny budgets.
  const sites = rotate(diverseSearchSites(), dayNumber * quotas[1]!);
  const siteLanes = sites.map((site) => ranked(catalog.filter((item) => item.site === site.domain), site.domain));
  const siteQueries: DemandQuery[] = [];
  for (let index = 0; siteLanes.some((lane) => index < lane.length); index += 1) {
    for (const lane of siteLanes) if (lane[index]) siteQueries.push(lane[index]!);
  }
  const lanes = [
    ranked(catalog.filter((item) => !item.site && item.channel === "web" && item.priority >= 98), "core").slice(0, quotas[0]),
    siteQueries.slice(0, quotas[1]),
    ranked(catalog.filter((item) => item.channel === "news"), "news").slice(0, quotas[2]),
    ranked(catalog.filter((item) => item.locale === "en"), "english").slice(0, quotas[3]),
  ];
  const selected: DemandQuery[] = [];
  const selectedIds = new Set<string>();
  const add = (item: DemandQuery | undefined) => {
    if (item && selected.length < limit && !selectedIds.has(item.id)) {
      selected.push(item);
      selectedIds.add(item.id);
    }
  };
  // Interleave to give fallback providers a mix of general and site-specific queries.
  while (lanes.some((lane) => lane.length) && selected.length < limit) {
    for (const lane of [lanes[0]!, lanes[1]!, lanes[1]!, lanes[2]!, lanes[3]!]) add(lane.shift());
  }
  for (const item of ranked(catalog.filter((item) => !selectedIds.has(item.id)), "remaining")) add(item);
  return selected;
}
