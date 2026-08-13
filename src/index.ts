import "dotenv/config";
import { randomUUID } from "node:crypto";
import { AmoCRMClient } from "./amocrm.js";
import { loadConfig } from "./config.js";
import { researchCompany, type PipelineDependencies } from "./pipeline.js";
import { HunterProvider } from "./providers/hunter.js";
import { LlmExtractor } from "./providers/llm.js";
import { TavilySearch } from "./providers/search.js";
import { WebsiteCrawler } from "./providers/website.js";
import { writeReport } from "./report.js";
import type { CompanyResearchResult, RunReport } from "./types.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const runId = process.env.GITHUB_RUN_ID || randomUUID();
  const startedAt = new Date().toISOString();
  const amo = new AmoCRMClient(config.amo, config.http);
  const dependencies: PipelineDependencies = {
    amo,
    crawler: new WebsiteCrawler(config.http, config.run.maxPagesPerSite),
    ...(config.providers.tavilyApiKey ? { search: new TavilySearch(config.providers.tavilyApiKey, config.http) } : {}),
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
      results.push(await researchCompany(company, config, dependencies, runId));
    } catch (error) {
      results.push({
        company,
        discoveredWebsite: company.website,
        candidates: [],
        selectedCandidates: [],
        warnings: [`Критическая ошибка компании: ${error instanceof Error ? error.message : String(error)}`],
        actions: [{ type: "skip", status: "failed", detail: "Обработка компании прервана" }],
        durationMs: 0,
      });
    }
  }

  const finishedAt = new Date().toISOString();
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
    },
  };
  await writeReport(report);
  console.log(`[${runId}] finished: selected=${report.totals.selected} failures=${report.totals.failures}`);
  if (report.totals.failures > 0) process.exitCode = 1;
}

await main();
