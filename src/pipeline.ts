import type { Config } from "./config.js";
import type { CompanyContext, CompanyResearchResult, ContactCandidate, Evidence, ProviderRunStatus, SearchResult } from "./types.js";
import { AmoCRMClient } from "./amocrm.js";
import { annotateMx } from "./dns.js";
import { extractPeopleFromEvidence, extractSocialProfiles, inferEmailCandidates } from "./extraction.js";
import { candidatesFromEvidence, candidatesFromPages, mergeCandidates, selectCandidates } from "./scoring.js";
import { domainFromUrl, uniqueBy } from "./utils.js";
import { CommonCrawlProvider } from "./providers/common-crawl.js";
import { HunterProvider } from "./providers/hunter.js";
import { LlmExtractor } from "./providers/llm.js";
import { MultiSearchProvider } from "./providers/multi-search.js";
import { chooseLikelyOfficialWebsite, searchEvidence } from "./providers/search.js";
import { pageEvidence, WebsiteCrawler } from "./providers/website.js";
import { SocialProfileEnricher } from "./providers/social-enrichment.js";
import { syncCandidates } from "./sync.js";

export interface PipelineDependencies {
  amo: AmoCRMClient;
  crawler: WebsiteCrawler;
  search: MultiSearchProvider;
  commonCrawl: CommonCrawlProvider;
  socialEnricher: SocialProfileEnricher;
  hunter?: HunterProvider;
  llm?: LlmExtractor;
}

function warning(prefix: string, error: unknown): string {
  return `${prefix}: ${error instanceof Error ? error.message : String(error)}`;
}

function socialCandidates(evidence: Evidence[], companyName: string): ContactCandidate[] {
  return extractSocialProfiles(evidence, companyName).map((profile) => ({
    fullName: profile.personName,
    position: profile.role,
    emails: [],
    phones: [],
    socialUrls: [profile.url],
    socialProfiles: [profile],
    evidence: evidence.filter((item) => item.url === profile.evidenceUrl).slice(0, 1),
    score: 0,
    scoreReasons: [],
  }));
}

function providerDefaults(dependencies: PipelineDependencies): Record<string, ProviderRunStatus> {
  return {
    searxng: "skipped",
    google_news: "skipped",
    gdelt: "skipped",
    github: "skipped",
    website: "skipped",
    common_crawl: "skipped",
    social_enrichment: "skipped",
    tavily: "disabled",
    hunter: dependencies.hunter ? "skipped" : "disabled",
    openai: dependencies.llm ? "skipped" : "disabled",
    gemini: "disabled",
  };
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
  const providers = providerDefaults(dependencies);
  const providerFailures: Array<{ provider: string; message: string }> = [];
  let results: SearchResult[] = [];
  let searchQueries: string[] = [];
  let crawledPages: Array<{ url: string; title: string; emails: string[]; phones: string[]; socialUrls: string[] }> = [];
  let crawlDiagnostics;
  let socialEnrichment;

  try {
    const discovery = await dependencies.search.searchCompany(company.companyName, config.run.targetRoles);
    results.push(...discovery.results);
    searchQueries.push(...discovery.queries);
    evidence.push(...searchEvidence(discovery.results));
    warnings.push(...discovery.warnings);
    providerFailures.push(...discovery.failures);
    Object.assign(providers, discovery.providers);
  } catch (error) {
    warnings.push(warning("Free web discovery", error));
    providerFailures.push({ provider: "multi_search", message: error instanceof Error ? error.message : String(error) });
  }

  const discoveredWebsite = company.website ?? chooseLikelyOfficialWebsite(company.companyName, results);
  const domain = domainFromUrl(discoveredWebsite);
  let archivedUrls: string[] = [];
  if (domain) {
    const archived = await dependencies.commonCrawl.discover(domain);
    archivedUrls = archived.urls;
    providers.common_crawl = archived.warning ? "failed" : "used";
    if (archived.warning) {
      warnings.push(archived.warning);
      providerFailures.push({ provider: "common_crawl", message: archived.warning });
    }
    const liveDiscoveryUrls = results
      .map((result) => result.url)
      .filter((url) => domainFromUrl(url) === domain && /contact|team|management|people|staff|about|press|news|blog|author|speaker|expert|career|vacanc|event|conference|webinar|document|file|upload|\.pdf/i.test(url));
    archivedUrls = uniqueBy([...archivedUrls, ...liveDiscoveryUrls], (url) => url);
  }

  if (discoveredWebsite) {
    try {
      const crawled = await dependencies.crawler.crawl(discoveredWebsite, archivedUrls);
      providers.website = "used";
      crawlDiagnostics = crawled.diagnostics;
      warnings.push(...crawled.warnings);
      crawledPages = crawled.pages.map((page) => ({ url: page.url, title: page.title, emails: page.emails, phones: page.phones, socialUrls: page.socialUrls }));
      const websiteEvidence = pageEvidence(crawled.pages);
      evidence.push(...websiteEvidence);
      candidates.push(...candidatesFromPages(crawled.pages, websiteEvidence));
    } catch (error) {
      providers.website = "failed";
      warnings.push(warning("Сайт", error));
      providerFailures.push({ provider: "website", message: error instanceof Error ? error.message : String(error) });
    }
  } else {
    warnings.push("Официальный сайт не найден после CRM и бесплатного web discovery");
  }

  candidates.push(...candidatesFromEvidence(evidence));
  candidates.push(...extractPeopleFromEvidence(evidence, config.run.targetRoles));
  candidates.push(...socialCandidates(evidence, company.companyName));

  const profilesToEnrich = extractSocialProfiles(evidence, company.companyName);
  if (profilesToEnrich.length > 0) {
    const enriched = await dependencies.socialEnricher.enrich(profilesToEnrich);
    const socialPages = enriched.pages.map((item) => item.page);
    const socialEvidence = pageEvidence(socialPages);
    providers.social_enrichment = enriched.pages.length > 0 ? "used" : enriched.warnings.length > 0 ? "failed" : "skipped";
    warnings.push(...enriched.warnings);
    if (enriched.warnings.length > 0 && enriched.pages.length === 0) {
      providerFailures.push({ provider: "social_enrichment", message: enriched.warnings.join("; ") });
    }
    evidence.push(...socialEvidence);
    candidates.push(...candidatesFromPages(socialPages, socialEvidence));
    candidates.push(...candidatesFromEvidence(socialEvidence));
    candidates.push(...extractPeopleFromEvidence(socialEvidence, config.run.targetRoles));
    candidates.push(...socialCandidates(socialEvidence, company.companyName));
    socialEnrichment = {
      attempted: enriched.attempted,
      succeeded: enriched.pages.length,
      failed: Math.max(0, enriched.attempted - enriched.pages.length),
      pages: enriched.pages.map((item) => ({
        platform: item.platform,
        url: item.profileUrl,
        title: item.page.title,
        emails: item.page.emails,
        phones: item.page.phones,
        socialUrls: item.page.socialUrls,
      })),
    };
  } else {
    socialEnrichment = { attempted: 0, succeeded: 0, failed: 0, pages: [] };
  }

  const personNames = uniqueBy(candidates.filter((candidate) => candidate.fullName), (candidate) => candidate.fullName!.toLowerCase()).slice(0, 3);
  for (const person of personNames) {
    try {
      const personDiscovery = await dependencies.search.searchPerson(person.fullName!, company.companyName);
      results.push(...personDiscovery.results);
      searchQueries.push(...personDiscovery.queries);
      const personEvidence = searchEvidence(personDiscovery.results);
      evidence.push(...personEvidence);
      warnings.push(...personDiscovery.warnings);
      providerFailures.push(...personDiscovery.failures);
      for (const [provider, status] of Object.entries(personDiscovery.providers)) {
        if (providers[provider] !== "used") providers[provider] = status;
      }
      candidates.push(...candidatesFromEvidence(personEvidence));
      candidates.push(...extractPeopleFromEvidence(personEvidence, config.run.targetRoles));
      candidates.push(...socialCandidates(personEvidence, company.companyName));
    } catch (error) {
      warnings.push(warning(`Второй этап ${person.fullName}`, error));
    }
  }

  if (domain && dependencies.hunter) {
    try {
      providers.hunter = "used";
      const hunterCandidates = await dependencies.hunter.findByDomain(domain);
      candidates.push(...hunterCandidates);
      evidence.push(...hunterCandidates.flatMap((candidate) => candidate.evidence));
    } catch (error) {
      providers.hunter = "failed";
      warnings.push(warning("Hunter", error));
      providerFailures.push({ provider: "hunter", message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (dependencies.llm && evidence.length > 0) {
    try {
      providers.openai = "used";
      candidates.push(...(await dependencies.llm.extract(company.companyName, evidence, config.run.targetRoles)));
    } catch (error) {
      providers.openai = "failed";
      warnings.push(warning("OpenAI extraction", error));
      providerFailures.push({ provider: "openai", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const mergedBeforeInference = mergeCandidates(candidates);
  const knownEmails = mergedBeforeInference.flatMap((candidate) => candidate.emails);
  const withInference = mergedBeforeInference.map((candidate) => ({ ...candidate, emails: [...candidate.emails, ...inferEmailCandidates(candidate, knownEmails)] }));
  const mxAnnotated = await annotateMx(withInference);
  const { scored, selected } = selectCandidates(
    mxAnnotated,
    config.run.targetRoles,
    config.run.minContactScore,
    config.run.maxContactsPerCompany,
    config.run.includeGenericEmails,
  );
  const actions = company.source === "manual"
    ? [{ type: "skip" as const, status: "planned" as const, detail: "Ручной поиск: запись в AmoCRM отключена" }]
    : await syncCandidates(dependencies.amo, config, company, selected, runId);
  const socialProfiles = extractSocialProfiles(evidence, company.companyName);

  return {
    company,
    discoveredWebsite,
    candidates: scored,
    selectedCandidates: selected,
    research: {
      searchQueries: [...new Set(searchQueries)],
      searchResults: uniqueBy(results, (result) => result.url),
      crawledPages,
      evidence: uniqueBy(evidence, (item) => `${item.source}:${item.url}:${item.title}`),
      socialProfiles,
      peopleFound: new Set(scored.map((candidate) => candidate.fullName).filter(Boolean)).size,
      providerFailures,
      ...(crawlDiagnostics ? { crawlDiagnostics } : {}),
      socialEnrichment,
      providers,
    },
    warnings: uniqueBy(warnings.map((message) => ({ message })), (item) => item.message).map((item) => item.message),
    actions,
    durationMs: Date.now() - startedAt,
  };
}
