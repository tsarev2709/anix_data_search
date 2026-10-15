import type { DemandMonitorReport, DemandQuery } from "../types.js";
import type { ProviderSearchResult } from "../providers/search-provider.js";
import { domainFromUrl } from "../utils.js";

export function demandCoverage(queries: DemandQuery[], outcomes: ProviderSearchResult[]): NonNullable<DemandMonitorReport["coverage"]> {
  const sites = (items: string[]) => [...new Set(items.flatMap((query) =>
    [...query.matchAll(/\bsite:([a-z0-9.-]+)/gi)].map((match) => match[1]!.toLowerCase())))].sort();
  return {
    plannedSites: sites(queries.map((item) => item.query)),
    attemptedSites: sites(outcomes.flatMap((item) => item.queries)),
    successfulSites: sites(outcomes.flatMap((item) => item.successfulQueries ?? [])),
    resultDomains: [...new Set(outcomes.flatMap((item) => item.results).flatMap((item) => {
      const domain = domainFromUrl(item.url);
      return domain ? [domain] : [];
    }))].sort(),
    providers: Object.fromEntries(outcomes.map((item) => [item.provider, {
      attempted: item.queries.length,
      successful: item.successfulQueries?.length ?? null,
    }])),
  };
}
