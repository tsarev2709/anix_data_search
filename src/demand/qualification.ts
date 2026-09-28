import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { normalizeSocialUrl } from "../extraction.js";
import type {
  DemandContactability,
  DemandIntent,
  DemandQuery,
  DemandSignal,
  DemandSignalType,
  SearchResult,
} from "../types.js";
import { isGenericEmail, normalizeEmail, normalizePhone, truncate, unique } from "../utils.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;

const DIRECT_INTENT_RULES: Array<{ intent: DemandIntent; label: string; pattern: RegExp }> = [
  { intent: "tender", label: "тендер или закупка", pattern: /(?:тендер[а-яёa-z0-9_]*|запрос\s+(?:коммерческих\s+)?предложений|конкурс\s+на\s+(?:оказание|выполнение|создание)|закупк[а-яёa-z0-9_]+\s+(?:услуг|работ)|\brfp\b|request for proposals?)/i },
  { intent: "recommendation", label: "запрос рекомендации", pattern: /(?:посоветуйте|порекомендуйте|кого\s+(?:можете\s+)?порекомендовать|кто\s+(?:может|сможет)\s+(?:сделать|снять|создать)|looking for recommendations?)/i },
  { intent: "vendor_search", label: "поиск подрядчика", pattern: /(?:(?:ищем|ищу|нужен|нужна|нужно|требуется|разыскиваем|looking for|seeking|need).{0,100}(?:подрядчик|исполнитель|студи[а-яёa-z0-9_]*|продакшн|агентств[а-яёa-z0-9_]*|команд[а-яёa-z0-9_]*|vendor|contractor|production company|animation studio))/i },
  { intent: "brief", label: "конкретная задача", pattern: /(?:(?:нужно|надо|хотим|планируем|требуется|необходимо).{0,100}(?:сделать|создать|снять|разработать|произвести|подготовить|анимировать).{0,120}(?:видео|ролик|анимац[а-яёa-z0-9_]*|видеокурс|персонаж|маскот|визуализац[а-яёa-z0-9_]*))|(?:need\b.{0,80}\b(?:create|produce|make)\b.{0,80}\b(?:video|animation|explainer|training content))/i },
];

const ACCOUNT_TRIGGER_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "запуск продукта или препарата", pattern: /(?:(?:фармкомпани[а-яёa-z0-9_]*|компани[а-яёa-z0-9_]*|бренд[а-яёa-z0-9_]*|производител[а-яёa-z0-9_]*|холдинг[а-яёa-z0-9_]*|банк[а-яёa-z0-9_]*|завод[а-яёa-z0-9_]*).{0,140}(?:запускает|выводит\s+на\s+рынок|представил[а-яёa-z0-9_]*|готовит\s+запуск)|(?:регистрац[а-яёa-z0-9_]*|вывод[а-яёa-z0-9_]*).{0,80}(?:препарат[а-яёa-z0-9_]*|медицинск[а-яёa-z0-9_]*\s+издели[а-яёa-z0-9_]*))/i },
  { label: "изменение обучения или онбординга", pattern: /(?:(?:компани[а-яёa-z0-9_]*|предприяти[а-яёa-z0-9_]*|холдинг[а-яёa-z0-9_]*|университет[а-яёa-z0-9_]*).{0,140}(?:внедряет|обновляет|перезапускает|масштабирует).{0,100}(?:обучен[а-яёa-z0-9_]*|онбординг|адаптац[а-яёa-z0-9_]*|инструктаж[а-яёa-z0-9_]*))/i },
  { label: "подготовка мероприятия", pattern: /(?:(?:компани[а-яёa-z0-9_]*|бренд[а-яёa-z0-9_]*|организатор[а-яёa-z0-9_]*).{0,140}(?:проводит|организует|готовит|участвует).{0,100}(?:конференц[а-яёa-z0-9_]*|выставк[а-яёa-z0-9_]*|форум[а-яёa-z0-9_]*|стенд[а-яёa-z0-9_]*))/i },
  { label: "обновление безопасности", pattern: /(?:(?:предприяти[а-яёa-z0-9_]*|компани[а-яёa-z0-9_]*|завод[а-яёa-z0-9_]*|холдинг[а-яёa-z0-9_]*).{0,140}(?:обновляет|внедряет|пересматривает|запускает).{0,100}(?:охран[а-яёa-z0-9_]*\s+труда|промышленн[а-яёa-z0-9_]*\s+безопасност[а-яёa-z0-9_]*|инструктаж[а-яёa-z0-9_]*))/i },
  { label: "ребрендинг или новая коммуникация", pattern: /(?:(?:компани[а-яёa-z0-9_]*|бренд[а-яёa-z0-9_]*|холдинг[а-яёa-z0-9_]*).{0,140}(?:проводит|запускает|готовит|представил[а-яёa-z0-9_]*).{0,80}(?:ребрендинг|нов[а-яёa-z0-9_]*\s+бренд|коммуникационн[а-яёa-z0-9_]*\s+кампани[а-яёa-z0-9_]*))/i },
];

const NEGATIVE_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "вакансия или поиск работы", pattern: /(?:ищу\s+работу|резюме|ваканси[а-яёa-z0-9_]*|job opening|job search|hiring\s+(?:a\s+)?(?:video editor|animator|motion designer))/i },
  { label: "обучение профессии или туториал", pattern: /(?:как\s+сделать\s+самому|шаблон\s+бесплатно|скачать\s+бесплатно|торрент|tutorial|how\s+to\s+(?:make|create)|курс[а-яёa-z0-9_]*.{0,50}(?:видеомонтаж|анимац|motion design))/i },
  { label: "самореклама исполнителя", pattern: /(?:(?:оказываю|предлагаем|делаем)\s+услуг[а-яёa-z0-9_]*.{0,80}(?:видеомонтаж|анимац|ролик)|(?:студия|продакшн).{0,60}(?:предлагает|оказывает)\s+услуг)/i },
];

const STRONG_TERMS = ["бюджет", "смет", "техническое задание", "тз", "дедлайн", "срок", "бриф", "оплата", "коммерческое предложение", "rfp"];

const FIT_CATEGORIES: Array<{ category: string; matches: Array<{ label: string; pattern: RegExp; weight?: number }> }> = [
  { category: "pharma", matches: [
    { label: "фарма", pattern: /(?:фармац[а-яёa-z0-9_]*|препарат[а-яёa-z0-9_]*|лекарств[а-яёa-z0-9_]*|медицинск[а-яёa-z0-9_]*\s+издели[а-яёa-z0-9_]*)/i, weight: 2 },
    { label: "механизм действия", pattern: /(?:механизм[а-яёa-z0-9_]*\s+действи[а-яёa-z0-9_]*|для\s+врач[а-яёa-z0-9_]*|для\s+пациент[а-яёa-z0-9_]*)/i, weight: 3 },
  ] },
  { category: "safety", matches: [
    { label: "охрана труда", pattern: /охран[а-яёa-z0-9_]*\s+труда/i, weight: 3 },
    { label: "промышленная безопасность", pattern: /(?:промышленн[а-яёa-z0-9_]*\s+безопасност[а-яёa-z0-9_]*|производственн[а-яёa-z0-9_]*\s+инцидент[а-яёa-z0-9_]*|инструктаж[а-яёa-z0-9_]*\s+по\s+безопасност[а-яёa-z0-9_]*)/i, weight: 3 },
  ] },
  { category: "learning", matches: [
    { label: "корпоративное обучение", pattern: /(?:корпоративн[а-яёa-z0-9_]*\s+(?:обучен[а-яёa-z0-9_]*|университет[а-яёa-z0-9_]*)|обучающ[а-яёa-z0-9_]*\s+ролик[а-яёa-z0-9_]*|e-learning|микрообучен[а-яёa-z0-9_]*)/i, weight: 3 },
    { label: "онбординг", pattern: /(?:онбординг|адаптац[а-яёa-z0-9_]*\s+сотрудник[а-яёa-z0-9_]*|welcome\s+ролик)/i, weight: 3 },
  ] },
  { category: "events", matches: [
    { label: "мероприятие", pattern: /(?:ролик[а-яёa-z0-9_]*\s+для\s+(?:конференц[а-яёa-z0-9_]*|выставк[а-яёa-z0-9_]*|форум[а-яёa-z0-9_]*)|контент[а-яёa-z0-9_]*\s+для\s+стенд[а-яёa-z0-9_]*|заставк[а-яёa-z0-9_]*\s+для\s+мероприят[а-яёa-z0-9_]*)/i, weight: 3 },
  ] },
  { category: "industrial", matches: [
    { label: "техническая визуализация", pattern: /(?:визуализац[а-яёa-z0-9_]*\s+(?:технологическ[а-яёa-z0-9_]*\s+процесс[а-яёa-z0-9_]*|работ[а-яёa-z0-9_]*\s+оборудован[а-яёa-z0-9_]*)|техническ[а-яёa-z0-9_]*\s+3d\s+анимац[а-яёa-z0-9_]*)/i, weight: 3 },
  ] },
  { category: "internal_comms", matches: [
    { label: "внутренние коммуникации", pattern: /(?:внутренн[а-яёa-z0-9_]*\s+коммуникац[а-яёa-z0-9_]*|корпоративн[а-яёa-z0-9_]*\s+культур[а-яёa-z0-9_]*|обращени[а-яёa-z0-9_]*\s+руководител[а-яёa-z0-9_]*)/i, weight: 3 },
  ] },
  { category: "hr_brand", matches: [
    { label: "HR-бренд", pattern: /(?:бренд[а-яёa-z0-9_]*\s+работодател[а-яёa-z0-9_]*|hr[ -]?видео|видео\s+о\s+професси[а-яёa-z0-9_]*)/i, weight: 3 },
  ] },
  { category: "mascot", matches: [
    { label: "маскот или персонаж", pattern: /(?:маскот[а-яёa-z0-9_]*|корпоративн[а-яёa-z0-9_]*\s+персонаж[а-яёa-z0-9_]*|персонаж[а-яёa-z0-9_]*\s+для\s+(?:бренд[а-яёa-z0-9_]*|реклам[а-яёa-z0-9_]*))/i, weight: 3 },
  ] },
  { category: "explainer", matches: [
    { label: "объясняющий ролик", pattern: /(?:объясняющ[а-яёa-z0-9_]*\s+ролик[а-яёa-z0-9_]*|explainer|визуализац[а-яёa-z0-9_]*\s+сложн[а-яёa-z0-9_]*\s+(?:продукт[а-яёa-z0-9_]*|технолог[а-яёa-z0-9_]*))/i, weight: 3 },
  ] },
  { category: "animation", matches: [
    { label: "анимация", pattern: /(?:анимационн[а-яёa-z0-9_]*\s+ролик[а-яёa-z0-9_]*|2d\s+анимац[а-яёa-z0-9_]*|3d\s+(?:ролик[а-яёa-z0-9_]*|анимац[а-яёa-z0-9_]*)|нейроанимац[а-яёa-z0-9_]*|motion\s+design)/i, weight: 2 },
  ] },
  { category: "business_video", matches: [
    { label: "видео для бизнеса", pattern: /(?:видеоролик[а-яёa-z0-9_]*\s+для\s+(?:компани[а-яёa-z0-9_]*|бизнес[а-яёa-z0-9_]*)|корпоративн[а-яёa-z0-9_]*\s+видео|видеоконтент[а-яёa-z0-9_]*\s+для\s+бизнес[а-яёa-z0-9_]*|video\s+production)/i, weight: 2 },
    { label: "ролик", pattern: /(?:видео|ролик|animation|motion)/i },
  ] },
];

const REPLY_HOSTS = new Set([
  "t.me", "telegram.me", "vk.com", "vk.ru", "tenchat.ru", "threads.net",
  "reddit.com", "www.reddit.com", "news.ycombinator.com", "stackoverflow.com",
]);

function plainText(value: string): string {
  return cheerio.load(value).text().replace(/\s+/g, " ").trim();
}

function ageDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86_400_000) : null;
}

function replyHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return REPLY_HOSTS.has(host) || [...REPLY_HOSTS].some((item) => host.endsWith(`.${item}`));
  } catch {
    return false;
  }
}

function evidenceQuote(title: string, snippet: string, terms: string[]): string {
  const candidates = [title, ...snippet.split(/(?<=[.!?])\s+|\n+/)].map((item) => item.trim()).filter(Boolean);
  const scored = candidates.map((text, index) => ({
    text,
    index,
    score: terms.reduce((sum, term) => sum + (text.toLowerCase().includes(term.toLowerCase()) ? 1 : 0), 0),
  })).sort((left, right) => right.score - left.score || left.index - right.index);
  const best = scored[0];
  if (!best || best.index === 0) return truncate(best?.text ?? title, 500);
  return truncate(`${title} — ${best.text}`, 500);
}

function actualFit(haystack: string): { category: string; labels: string[] } {
  const categories = FIT_CATEGORIES.map((entry) => {
    const matched = entry.matches.filter((item) => item.pattern.test(haystack));
    return {
      category: entry.category,
      labels: matched.map((item) => item.label),
      weight: matched.reduce((sum, item) => sum + (item.weight ?? 1), 0),
    };
  }).filter((entry) => entry.weight > 0).sort((left, right) => right.weight - left.weight);
  return categories[0] ?? { category: "other", labels: [] };
}

function inferredIntent(haystack: string): { intent: DemandIntent; labels: string[] } | null {
  const matches = DIRECT_INTENT_RULES.filter((rule) => rule.pattern.test(haystack));
  if (matches.length === 0) return null;
  return { intent: matches[0]!.intent, labels: matches.map((item) => item.label) };
}

function contactabilityFor(result: SearchResult, emails: string[], phones: string[], socialUrls: string[]): DemandContactability {
  if (emails.length > 0 || phones.length > 0) return "direct";
  if (socialUrls.length > 0 || replyHost(result.url)) return "source_reply";
  if (result.author) return "company_research";
  return "none";
}

export function scoreDemandResult(result: SearchResult, query: DemandQuery): DemandSignal {
  const title = plainText(result.title);
  const snippet = truncate(plainText(result.content), 4_000);
  const original = `${title} ${snippet}`;
  const haystack = original.toLowerCase();
  const fit = actualFit(haystack);
  const directIntent = inferredIntent(haystack);
  const triggers = ACCOUNT_TRIGGER_RULES.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.label);
  const negatives = NEGATIVE_RULES.filter((rule) => rule.pattern.test(haystack)).map((rule) => rule.label);
  const strong = STRONG_TERMS.filter((term) => haystack.includes(term));
  const days = ageDays(result.publishedAt);
  const freshEnough = days === null || days <= 45;

  const emails = unique((original.match(EMAIL_PATTERN) ?? []).map(normalizeEmail))
    .filter((value) => !isGenericEmail(value) || /^(?:info|contact|sales)@/.test(value));
  const phones = unique((original.match(PHONE_PATTERN) ?? []).map(normalizePhone))
    .filter((value) => value.replace(/\D/g, "").length >= 10);
  const socialUrls = unique([result.url, ...(snippet.match(URL_PATTERN) ?? [])]
    .flatMap((value) => normalizeSocialUrl(value)?.url ? [normalizeSocialUrl(value)!.url] : []));
  const contactability = contactabilityFor(result, emails, phones, socialUrls);

  const directCandidate = Boolean(directIntent && fit.labels.length > 0 && negatives.length === 0);
  const triggerCandidate = !directCandidate && triggers.length > 0 && fit.labels.length > 0 && negatives.length === 0;
  const signalType: DemandSignalType = directCandidate
    ? "direct_demand"
    : triggerCandidate ? "account_trigger" : "market_intelligence";
  const leadGatePassed = signalType === "direct_demand" && freshEnough;

  let score = 0;
  const reasons: string[] = [];
  if (signalType === "direct_demand") {
    score += 42;
    reasons.push(`+42 подтверждённый спрос: ${directIntent!.labels.join(", ")}`);
  } else if (signalType === "account_trigger") {
    score += 24;
    reasons.push(`+24 коммерческий триггер: ${triggers.join(", ")}`);
  } else {
    reasons.push("не прошёл коммерческий lead-gate");
  }
  if (fit.labels.length > 0) {
    score += Math.min(28, 16 + fit.labels.length * 4);
    reasons.push(`+${Math.min(28, 16 + fit.labels.length * 4)} услуга Anix подтверждена текстом: ${fit.labels.join(", ")}`);
  }
  if (strong.length > 0 && signalType !== "market_intelligence") {
    score += Math.min(14, 8 + strong.length * 2);
    reasons.push(`+ коммерческая конкретика: ${strong.slice(0, 3).join(", ")}`);
  }
  if (days !== null && days <= 3) { score += 12; reasons.push("+12 опубликовано за 3 дня"); }
  else if (days !== null && days <= 14) { score += 8; reasons.push("+8 опубликовано за 14 дней"); }
  else if (days !== null && days <= 45) { score += 3; reasons.push("+3 опубликовано за 45 дней"); }
  else if (days !== null && days > 45) { score -= 25; reasons.push("−25 сигнал старше 45 дней"); }
  if (contactability === "direct") { score += 14; reasons.push("+14 указан email или телефон"); }
  else if (contactability === "source_reply") { score += 10; reasons.push("+10 можно ответить в источнике"); }
  else if (contactability === "company_research") { score += 4; reasons.push("+4 известен автор или организация"); }
  if (result.author) { score += 3; reasons.push("+3 указан автор или канал"); }
  if (negatives.length > 0) {
    score -= 60;
    reasons.push(`−60 исключено: ${negatives.join(", ")}`);
  }

  score = Math.max(0, Math.min(100, score));
  const quoteTerms = [
    ...(directIntent?.labels ?? []),
    ...fit.labels,
    ...triggers,
    ...strong,
  ];
  const quote = evidenceQuote(title, snippet, quoteTerms);
  const nextAction = signalType === "direct_demand"
    ? contactability === "direct" || contactability === "source_reply"
      ? "Ответить автору сегодня, сославшись на конкретную задачу"
      : "Определить компанию и ЛПР, затем отправить персональное обращение"
    : signalType === "account_trigger"
      ? "Проверить компанию, найти профильного ЛПР и использовать событие как повод для касания"
      : "Не передавать в продажи; использовать только как рыночный контекст";

  const fingerprint = createHash("sha256").update(result.url.toLowerCase()).digest("hex");
  return {
    fingerprint,
    source: result.provider ?? "search",
    category: fit.category === "other" ? query.category : fit.category,
    intent: signalType === "account_trigger" ? "market_signal" : directIntent?.intent ?? "market_signal",
    query: result.query ?? query.query,
    title,
    url: result.url,
    snippet,
    author: result.author ?? null,
    publishedAt: result.publishedAt ?? null,
    discoveredAt: new Date().toISOString(),
    score,
    scoreReasons: reasons,
    emails,
    phones,
    socialUrls,
    status: "new",
    signalType,
    leadGatePassed,
    evidenceQuote: quote,
    contactability,
    nextAction,
  };
}
