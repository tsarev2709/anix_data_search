import type { Config } from "../config.js";
import type { DemandMonitorReport, DemandQuery, ProviderRunStatus, SearchResult } from "../types.js";
import { uniqueBy } from "../utils.js";
import { FeedDemandProvider } from "../providers/feed-demand.js";
import { GdeltProvider } from "../providers/gdelt.js";
import { GoogleNewsProvider } from "../providers/google-news.js";
import { HackerNewsDemandProvider } from "../providers/hacker-news.js";
import { SearxngProvider } from "../providers/searxng.js";
import { StackExchangeDemandProvider } from "../providers/stack-exchange.js";
import { YouTubeDemandProvider } from "../providers/youtube.js";
import { selectDailyDemandQueries } from "./catalog.js";
import { scoreDemandResult } from "./qualification.js";

export { scoreDemandResult } from "./qualification.js";

function queryTokens(query: string): string[] {
  return query.toLowerCase().replace(/site:[^ )]+/g, " ").split(/[^a-zа-яё0-9-]+/i)
    .filter((token) => token.length >= 4 && !["ищем", "ищу", "нужен", "нужна", "нужно", "looking", "with", "site"].includes(token));
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

export async function monitorDemand(config: Config, runId: string): Promise<DemandMonitorReport> {
  const startedAt = new Date().toISOString();
  const queries = selectDailyDemandQueries(new Date(), config.demand.queryBudget);
  const webQueries = queries.filter((item) => item.locale === "ru").map((item) => item.query);
  const newsQueries = queries.filter((item) => item.channel === "news" && item.locale === "ru").map((item) => item.query);
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
  const scored = uniqueBy(
    rawResults
      .map((result) => scoreDemandResult(result, classifyResult(result, queries)))
      .sort((left, right) => right.score - left.score),
    (signal) => signal.fingerprint,
  );

  const maxSignals = Math.min(30, config.demand.maxSignals);
  const directLimit = Math.min(20, Math.max(1, Math.ceil(maxSignals * 2 / 3)));
  const triggerLimit = Math.max(0, maxSignals - directLimit);
  const direct = scored
    .filter((signal) => signal.signalType === "direct_demand" && signal.leadGatePassed && signal.score >= 60)
    .slice(0, directLimit);
  const triggers = scored
    .filter((signal) => signal.signalType === "account_trigger" && signal.score >= 50)
    .slice(0, triggerLimit);
  const signals = [...direct, ...triggers].sort((left, right) => right.score - left.score);

  return {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    queries,
    signals,
    providers: providerStatuses,
    failures,
    resultsCount: rawResults.length,
    discardedCount: Math.max(0, scored.length - signals.length),
  };
}
