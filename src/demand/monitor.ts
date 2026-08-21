import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { Config } from "../config.js";
import { normalizeSocialUrl } from "../extraction.js";
import type { DemandMonitorReport, DemandQuery, DemandSignal, ProviderRunStatus, SearchResult } from "../types.js";
import { isGenericEmail, normalizeEmail, normalizePhone, truncate, unique, uniqueBy } from "../utils.js";
import { FeedDemandProvider } from "../providers/feed-demand.js";
import { GdeltProvider } from "../providers/gdelt.js";
import { GoogleNewsProvider } from "../providers/google-news.js";
import { HackerNewsDemandProvider } from "../providers/hacker-news.js";
import { SearxngProvider } from "../providers/searxng.js";
import { StackExchangeDemandProvider } from "../providers/stack-exchange.js";
import { YouTubeDemandProvider } from "../providers/youtube.js";
import { selectDailyDemandQueries } from "./catalog.js";

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_PATTERN = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const INTENT_TERMS = ["ищем", "ищу", "нужен", "нужна", "нужно", "посоветуйте", "порекомендуйте", "подрядчик", "исполнитель", "студия", "продакшн", "тендер", "бриф", "смет", "стоимост", "looking for", "need a", "vendor", "contractor", "recommend"];
const FIT_TERMS = ["видео", "ролик", "анимац", "нейроанимац", "explainer", "video", "motion", "маскот", "персонаж", "онбординг", "обучен", "охрана труда", "безопасност", "фарма", "препарат", "врач", "конференц", "выставк", "корпоративн", "e-learning", "industrial"];
const STRONG_TERMS = ["тендер", "запрос предложений", "бюджет", "смет", "техническое задание", "тз", "дедлайн", "срок", "бриф", "rfp"];
const NEGATIVE_TERMS = ["ищу работу", "вакансия", "резюме", "курс", "обучение профессии", "как сделать самому", "шаблон бесплатно", "скачать бесплатно", "торрент", "job opening", "hiring animator", "tutorial"];

function plainText(value: string): string {
  return cheerio.load(value).text().replace(/\s+/g, " ").trim();
}

function queryTokens(query: string): string[] {
  return query.toLowerCase().replace(/site:[^ )]+/g, " ").split(/[^a-zа-яё0-9-]+/i).filter((token) => token.length >= 4 && !["ищем", "ищу", "нужен", "нужна", "нужно", "looking", "with", "site"].includes(token));
}

function classifyResult(result: SearchResult, queries: DemandQuery[]): DemandQuery {
  const exact = queries.find((item) => item.query === result.query);
  if (exact) return exact;
  const haystack = `${result.title} ${result.content}`.toLowerCase();
  return queries
    .map((item) => ({ item, matches: queryTokens(item.query).filter((token) => haystack.includes(token)).length }))
    .sort((left, right) => right.matches - left.matches || right.item.priority - left.item.priority)[0]?.item
    ?? { id: "unclassified", query: result.query ?? "feed", category: "other", intent: "market_signal", priority: 50, locale: "ru", channel: "web" };
}

function ageDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? Math.max(0, (Date.now() - time) / 86_400_000) : null;
}

export function scoreDemandResult(result: SearchResult, query: DemandQuery): DemandSignal {
  const title = plainText(result.title);
  const snippet = truncate(plainText(result.content), 4_000);
  const haystack = `${title} ${snippet}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0;
  const intentMatches = INTENT_TERMS.filter((term) => haystack.includes(term));
  const fitMatches = FIT_TERMS.filter((term) => haystack.includes(term));
  const strongMatches = STRONG_TERMS.filter((term) => haystack.includes(term));
  const negativeMatches = NEGATIVE_TERMS.filter((term) => haystack.includes(term));
  if (intentMatches.length > 0) { score += Math.min(35, 18 + intentMatches.length * 5); reasons.push(`+ намерение: ${intentMatches.slice(0, 3).join(", ")}`); }
  if (fitMatches.length > 0) { score += Math.min(30, 12 + fitMatches.length * 4); reasons.push(`+ услуги Anix: ${fitMatches.slice(0, 4).join(", ")}`); }
  if (strongMatches.length > 0) { score += Math.min(25, 15 + strongMatches.length * 5); reasons.push(`+ коммерческая конкретика: ${strongMatches.slice(0, 3).join(", ")}`); }
  const days = ageDays(result.publishedAt);
  if (days !== null && days <= 3) { score += 16; reasons.push("+ опубликовано за 3 дня"); }
  else if (days !== null && days <= 14) { score += 10; reasons.push("+ опубликовано за 14 дней"); }
  else if (days !== null && days <= 45) { score += 4; reasons.push("+ опубликовано за 45 дней"); }
  if (result.author) { score += 5; reasons.push("+ указан автор или канал"); }
  if (query.intent === "tender" || query.intent === "vendor_search") { score += 8; reasons.push(`+ целевой тип: ${query.intent}`); }
  if (negativeMatches.length > 0) { score -= Math.min(50, 25 + negativeMatches.length * 10); reasons.push(`− нерелевантно: ${negativeMatches.slice(0, 3).join(", ")}`); }

  const emails = unique((haystack.match(EMAIL_PATTERN) ?? []).map(normalizeEmail)).filter((value) => !isGenericEmail(value) || /info@|contact@|sales@/.test(value));
  const phones = unique((`${title} ${snippet}`.match(PHONE_PATTERN) ?? []).map(normalizePhone)).filter((value) => value.replace(/\D/g, "").length >= 10);
  const socialUrls = unique([result.url, ...(snippet.match(URL_PATTERN) ?? [])].flatMap((value) => normalizeSocialUrl(value)?.url ? [normalizeSocialUrl(value)!.url] : []));
  if (emails.length + phones.length + socialUrls.length > 0) { score += 12; reasons.push("+ есть прямой публичный канал"); }
  score = Math.max(0, Math.min(100, score));
  const fingerprint = createHash("sha256").update(result.url.toLowerCase()).digest("hex");
  return {
    fingerprint,
    source: result.provider ?? "search",
    category: query.category,
    intent: query.intent,
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
  };
}

export async function monitorDemand(config: Config, runId: string): Promise<DemandMonitorReport> {
  const startedAt = new Date().toISOString();
  const queries = selectDailyDemandQueries(new Date(), config.demand.queryBudget);
  const webQueries = queries.filter((item) => item.locale === "ru").map((item) => item.query);
  const newsQueries = queries.filter((item) => item.channel !== "social" && item.locale === "ru").map((item) => item.query);
  const englishQueries = queries.filter((item) => item.locale === "en").map((item) => item.query);
  const providers = [
    new SearxngProvider(config.http, config.providers.searxngInstances).searchDemand(webQueries),
    new GoogleNewsProvider(config.http).searchDemand(newsQueries),
    new GdeltProvider(config.http).searchDemand(newsQueries),
    new HackerNewsDemandProvider(config.http).searchDemand(englishQueries),
    new StackExchangeDemandProvider(config.http).searchDemand(englishQueries),
    new FeedDemandProvider(config.http, config.demand.feeds).searchDemand(),
    ...(config.providers.youtubeApiKey ? [new YouTubeDemandProvider(config.providers.youtubeApiKey, config.http).searchDemand(webQueries)] : []),
  ];
  const outcomes = await Promise.all(providers);
  const providerStatuses: Record<string, ProviderRunStatus> = Object.fromEntries(outcomes.map((outcome) => [outcome.provider, outcome.status]));
  if (!config.providers.youtubeApiKey) providerStatuses.youtube = "disabled";
  const failures = outcomes.flatMap((outcome) => {
    if (outcome.warnings.length > 0) return outcome.warnings.map((message) => ({ provider: outcome.provider, message }));
    return outcome.status === "failed" ? [{ provider: outcome.provider, message: "provider failed" }] : [];
  });
  const rawResults = outcomes.flatMap((outcome) => outcome.results);
  const scored = rawResults.map((result) => scoreDemandResult(result, classifyResult(result, queries)));
  const signals = uniqueBy(scored.sort((left, right) => right.score - left.score), (signal) => signal.fingerprint)
    .filter((signal) => signal.score >= 25)
    .slice(0, config.demand.maxSignals);
  return { runId, startedAt, finishedAt: new Date().toISOString(), queries, signals, providers: providerStatuses, failures, resultsCount: rawResults.length };
}
