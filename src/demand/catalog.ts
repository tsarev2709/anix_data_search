import type { DemandIntent, DemandQuery } from "../types.js";
import { uniqueBy } from "../utils.js";

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

const SOCIAL_SITES = ["t.me", "vk.com", "tenchat.ru", "threads.net"];
const FORUM_SITES = ["vc.ru", "habr.com", "pikabu.ru", "otvet.mail.ru", "reddit.com"];

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
      queries.push({
        id: queryId([service.category, "social", phrase]),
        query: `"${phrase}" (${SOCIAL_SITES.map((site) => `site:${site}`).join(" OR ")})`,
        category: service.category,
        intent: "market_signal",
        priority: 82,
        locale: "ru",
        channel: "social",
      });
      queries.push({
        id: queryId([service.category, "forum", phrase]),
        query: `"${phrase}" (${FORUM_SITES.map((site) => `site:${site}`).join(" OR ")})`,
        category: service.category,
        intent: "problem",
        priority: 76,
        locale: "ru",
        channel: "forum",
      });
    }
  }
  for (const [category, query, intent] of ENGLISH_QUERIES) {
    queries.push({ id: queryId([category, query]), query, category, intent, priority: 72, locale: "en", channel: "forum" });
  }
  return uniqueBy(queries, (item) => item.query.toLowerCase());
}

function hash(value: string): number {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

export function selectDailyDemandQueries(date: Date, budget: number): DemandQuery[] {
  const catalog = buildDemandQueryCatalog();
  const day = date.toISOString().slice(0, 10);
  const selected: DemandQuery[] = [];
  const selectedIds = new Set<string>();
  const add = (items: DemandQuery[], limit: number, salt: string) => {
    for (const item of items.sort((left, right) => hash(`${day}:${salt}:${left.id}`) - hash(`${day}:${salt}:${right.id}`)).slice(0, limit)) {
      if (selected.length >= budget || selectedIds.has(item.id)) continue;
      selected.push(item);
      selectedIds.add(item.id);
    }
  };
  add(catalog.filter((item) => item.priority >= 98 && item.channel === "web"), Math.min(8, budget), "core");
  add(catalog.filter((item) => item.channel === "social"), Math.min(8, Math.max(0, budget - selected.length)), "social");
  add(catalog.filter((item) => item.channel === "forum" && item.locale === "ru"), Math.min(6, Math.max(0, budget - selected.length)), "forum-ru");
  add(catalog.filter((item) => item.locale === "en"), Math.min(4, Math.max(0, budget - selected.length)), "english");
  add(catalog.filter((item) => !selectedIds.has(item.id)).sort((left, right) => right.priority - left.priority), budget - selected.length, "remaining");
  return selected;
}
