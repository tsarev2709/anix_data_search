import type { Config } from "./config.js";
import type { CompanyContext, CompanyResearchResult, ContactCandidate, Evidence, SearchResult } from "./types.js";
import { AmoCRMClient } from "./amocrm.js";
import { candidatesFromEvidence, candidatesFromPages, selectCandidates } from "./scoring.js";
import { domainFromUrl } from "./utils.js";
import { HunterProvider } from "./providers/hunter.js";
import { LlmExtractor } from "./providers/llm.js";
import { chooseLikelyOfficialWebsite, searchEvidence, TavilySearch } from "./providers/search.js";
import { pageEvidence, WebsiteCrawler } from "./providers/website.js";
import { syncCandidates } from "./sync.js";

export interface PipelineDependencies {
  amo: AmoCRMClient;
  crawler: WebsiteCrawler;
  search?: TavilySearch;
  hunter?: HunterProvider;
  llm?: LlmExtractor;
}

function warning(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}

export async function researchCompany(
  company: CompanyContext,
  config: Config,
  dependencies: PipelineDependencies,
  runId: string,
): Promise<CompanyResearchResult> {
  const startedAt = Date.now();
  const warnings: string[] = [];
  const candidates: ContactCandidate[] = [];
  const evidence: Evidence[] = [];

  let results: SearchResult[] = [];
  if (dependencies.search) {
    try {
      results = await dependencies.search.searchCompany(company.companyName, config.run.targetRoles);
      evidence.push(...searchEvidence(results));
    } catch (error) {
      warnings.push(warning("Tavily", error));
    }
  } else {
    warnings.push("Tavily выключен: поиск ограничен сайтом из AmoCRM");
  }

  const discoveredWebsite = company.website ?? chooseLikelyOfficialWebsite(company.companyName, results);
  if (discoveredWebsite) {
    const crawled = await dependencies.crawler.crawl(discoveredWebsite);
    warnings.push(...crawled.warnings);
    const websiteEvidence = pageEvidence(crawled.pages);
    evidence.push(...websiteEvidence);
    candidates.push(...candidatesFromPages(crawled.pages, websiteEvidence));
  } else {
    warnings.push("Официальный сайт не найден");
  }

  candidates.push(...candidatesFromEvidence(evidence.filter((item) => item.source === "search")));

  const domain = domainFromUrl(discoveredWebsite);
  if (domain && dependencies.hunter) {
    try {
      const hunterCandidates = await dependencies.hunter.findByDomain(domain);
      candidates.push(...hunterCandidates);
      evidence.push(...hunterCandidates.flatMap((candidate) => candidate.evidence));
    } catch (error) {
      warnings.push(warning("Hunter", error));
    }
  } else if (!dependencies.hunter) {
    warnings.push("Hunter выключен: адреса не проверяются внешним верификатором");
  }

  if (dependencies.llm && evidence.length > 0) {
    try {
      candidates.push(...(await dependencies.llm.extract(company.companyName, evidence, config.run.targetRoles)));
    } catch (error) {
      warnings.push(warning("OpenAI extraction", error));
    }
  } else if (!dependencies.llm) {
    warnings.push("LLM-извлечение выключено: имена и должности берутся только из структурированных провайдеров");
  }

  const { scored, selected } = selectCandidates(
    candidates,
    config.run.targetRoles,
    config.run.minContactScore,
    config.run.maxContactsPerCompany,
    config.run.includeGenericEmails,
  );
  const actions = await syncCandidates(dependencies.amo, config, company, selected, runId);

  return {
    company,
    discoveredWebsite,
    candidates: scored,
    selectedCandidates: selected,
    warnings,
    actions,
    durationMs: Date.now() - startedAt,
  };
}
