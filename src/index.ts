import "dotenv/config";
import { randomUUID } from "node:crypto";
import { AmoCRMClient } from "./amocrm.js";
import { loadConfig } from "./config.js";
import { researchCompany, type PipelineDependencies } from "./pipeline.js";
import { HunterProvider } from "./providers/hunter.js";
import { LlmExtractor } from "./providers/llm.js";
import { CommonCrawlProvider } from "./providers/common-crawl.js";
import { GdeltProvider } from "./providers/gdelt.js";
import { GeminiGroundedProvider } from "./providers/gemini.js";
import { GitHubDiscoveryProvider } from "./providers/github.js";
import { GoogleNewsProvider } from "./providers/google-news.js";
import { MultiSearchProvider } from "./providers/multi-search.js";
import { SearxngProvider } from "./providers/searxng.js";
import { TavilySearch } from "./providers/search.js";
import { WebsiteCrawler } from "./providers/website.js";
import { writeReport } from "./report.js";
import { SupabaseRepository } from "./supabase.js";
import { syncCandidates } from "./sync.js";
import type { CompanyResearchResult, RunReport } from "./types.js";

async function syncApproved(
  amo: AmoCRMClient,
  config: ReturnType<typeof loadConfig>,
  repository: SupabaseRepository,
  runId: string,
): Promise<void> {
  const approved = await repository.loadApproved(config.run.maxCompanies * config.run.maxContactsPerCompany);
  console.log(`[${runId}] approved contacts=${approved.length}`);
  const groups = new Map<number, typeof approved>();
  for (const item of approved) groups.set(item.company.sourceLeadId, [...(groups.get(item.company.sourceLeadId) ?? []), item]);
  let failures = 0;
  for (const items of groups.values()) {
    const first = items[0];
    if (!first) continue;
    const actions = await syncCandidates(amo, config, first.company, items.map((item) => item.candidate), runId);
    if (actions.some((action) => action.status === "failed")) failures += 1;
    else await repository.markSynced(items.map((item) => item.id));
  }
  if (failures > 0) throw new Error(`Не удалось синхронизировать ${failures} групп контактов`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const runId = process.env.GITHUB_RUN_ID || randomUUID();
  const startedAt = new Date().toISOString();
  const amo = new AmoCRMClient(config.amo, config.http);
  const repository = config.storage ? new SupabaseRepository(config.storage) : null;
  if (config.run.operation === "sync-approved") {
    if (!repository) throw new Error("Для sync-approved нужны SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY");
    await syncApproved(amo, config, repository, runId);
    return;
  }
  const dependencies: PipelineDependencies = {
    amo,
    crawler: new WebsiteCrawler(config.http, config.run.maxPagesPerSite),
    commonCrawl: new CommonCrawlProvider(config.http),
    search: new MultiSearchProvider([
      new SearxngProvider(config.http, config.providers.searxngInstances),
      new GoogleNewsProvider(config.http),
      new GdeltProvider(config.http),
      new GitHubDiscoveryProvider(config.http, config.providers.githubToken),
      ...(config.providers.geminiApiKey ? [new GeminiGroundedProvider(config.providers.geminiApiKey, config.providers.geminiModel, config.http)] : []),
      ...(config.providers.tavilyApiKey ? [new TavilySearch(config.providers.tavilyApiKey, config.http)] : []),
    ]),
    ...(config.providers.hunterApiKey
      ? { hunter: new HunterProvider(config.providers.hunterApiKey, config.providers.hunterVerifyEmails, config.http) }
      : {}),
    ...(config.providers.openaiApiKey ? { llm: new LlmExtractor(config.providers.openaiApiKey, config.providers.openaiModel) } : {}),
  };

  console.log(`[${runId}] mode=${config.run.mode} writeMode=${config.amo.writeMode} maxCompanies=${config.run.maxCompanies}`);
  const companies = await amo.listSourceCompanies(config.run.maxCompanies);
  console.log(`[${runId}] source companies=${companies.length}`);
  const results: CompanyResearchResult[] = [];

  for (const [index, company] of companies.entries()) {
    console.log(`[${runId}] ${index + 1}/${companies.length}: ${company.companyName}`);
    try {
      const result = await researchCompany(company, config, dependencies, runId);
      results.push(result);
      console.log(JSON.stringify({
        event: "company_research_completed",
        runId,
        company: company.companyName,
        sourceLeadId: company.sourceLeadId,
        queries: result.research.searchQueries.length,
        searchResults: result.research.searchResults.length,
        pages: result.research.crawledPages.length,
        candidates: result.candidates.length,
        selected: result.selectedCandidates.length,
        providers: result.research.providers,
        providerFailures: result.research.providerFailures?.map((failure) => failure.provider) ?? [],
        warnings: result.warnings.length,
        durationMs: result.durationMs,
      }));
    } catch (error) {
      console.error(JSON.stringify({ event: "company_research_failed", runId, company: company.companyName, sourceLeadId: company.sourceLeadId, error: error instanceof Error ? error.message : String(error) }));
      results.push({
        company,
        discoveredWebsite: company.website,
        candidates: [],
        selectedCandidates: [],
        research: {
          searchQueries: [],
          searchResults: [],
          crawledPages: [],
          evidence: [],
          peopleFound: 0,
          providerFailures: [{ provider: "pipeline", message: error instanceof Error ? error.message : String(error) }],
          providers: {
            searxng: "skipped",
            google_news: "skipped",
            gdelt: "skipped",
            github: "skipped",
            website: "failed",
            common_crawl: "skipped",
            gemini: config.providers.geminiApiKey ? "skipped" : "disabled",
            tavily: config.providers.tavilyApiKey ? "skipped" : "disabled",
            hunter: config.providers.hunterApiKey ? "skipped" : "disabled",
            openai: config.providers.openaiApiKey ? "skipped" : "disabled",
          },
        },
        warnings: [`Критическая ошибка компании: ${error instanceof Error ? error.message : String(error)}`],
        actions: [{ type: "skip", status: "failed", detail: "Обработка компании прервана" }],
        durationMs: 0,
      });
    }
  }

  const finishedAt = new Date().toISOString();
  const allCandidates = results.flatMap((result) => result.candidates);
  const allSocials = results.flatMap((result) => result.research.socialProfiles ?? []);
  const allEmails = allCandidates.flatMap((candidate) => candidate.emails);
  const socialByPlatform = allSocials.reduce<Record<string, number>>((counts, profile) => {
    counts[profile.platform] = (counts[profile.platform] ?? 0) + 1;
    return counts;
  }, {});
  const report: RunReport = {
    runId,
    startedAt,
    finishedAt,
    mode: config.run.mode,
    writeMode: config.amo.writeMode,
    companies: results,
    totals: {
      companies: results.length,
      candidates: results.reduce((sum, result) => sum + result.candidates.length, 0),
      selected: results.reduce((sum, result) => sum + result.selectedCandidates.length, 0),
      actionsCompleted: results.flatMap((result) => result.actions).filter((action) => action.status === "completed").length,
      failures: results.flatMap((result) => result.actions).filter((action) => action.status === "failed").length,
      searchQueries: results.reduce((sum, result) => sum + result.research.searchQueries.length, 0),
      pagesCrawled: results.reduce((sum, result) => sum + result.research.crawledPages.length, 0),
      searchResults: results.reduce((sum, result) => sum + result.research.searchResults.length, 0),
      socialProfilesFound: allSocials.length,
      peopleFound: new Set(results.flatMap((result) => result.candidates.map((candidate) => candidate.fullName ? `${result.company.sourceLeadId}:${candidate.fullName.toLowerCase()}` : null)).filter(Boolean)).size,
      positionsFound: new Set(results.flatMap((result) => result.candidates.map((candidate) => candidate.position ? `${result.company.sourceLeadId}:${candidate.fullName ?? ""}:${candidate.position.toLowerCase()}` : null)).filter(Boolean)).size,
      emailsFound: new Set(allEmails.filter((email) => email.status !== "inferred").map((email) => email.value)).size,
      personalEmailsFound: new Set(allEmails.filter((email) => !email.generic && email.status !== "inferred").map((email) => email.value)).size,
      inferredEmailsFound: new Set(allEmails.filter((email) => email.status === "inferred").map((email) => email.value)).size,
      phonesFound: new Set(allCandidates.flatMap((candidate) => candidate.phones)).size,
      telegramFound: socialByPlatform.telegram ?? 0,
      highConfidenceContacts: allCandidates.filter((candidate) => candidate.score >= 75).length,
      mediumConfidenceContacts: allCandidates.filter((candidate) => candidate.score >= 45 && candidate.score < 75).length,
      lowConfidenceContacts: allCandidates.filter((candidate) => candidate.score < 45).length,
      providerFailures: results.reduce((sum, result) => sum + (result.research.providerFailures?.length ?? 0), 0),
      socialByPlatform,
    },
  };
  await writeReport(report);
  if (repository) await repository.saveReport(report);
  console.log(`[${runId}] finished: selected=${report.totals.selected} failures=${report.totals.failures}`);
  if (report.totals.failures > 0) process.exitCode = 1;
}

await main();
