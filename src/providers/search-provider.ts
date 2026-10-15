import type { EvidenceSource, SearchResult } from "../types.js";

export interface ProviderSearchResult {
  provider: string;
  source: EvidenceSource;
  status: "used" | "skipped" | "failed";
  queries: string[];
  /** Queries with a valid response, including zero-result responses. */
  successfulQueries?: string[];
  results: SearchResult[];
  warnings: string[];
}

export interface SearchProvider {
  readonly name: string;
  readonly source: EvidenceSource;
  searchCompany(companyName: string, targetRoles: string[]): Promise<ProviderSearchResult>;
  searchPerson?(personName: string, companyName: string): Promise<ProviderSearchResult>;
  searchPublicQueries?(queries: string[], budget: number): Promise<ProviderSearchResult>;
}

export function providerFailure(provider: SearchProvider, error: unknown, queries: string[] = []): ProviderSearchResult {
  return {
    provider: provider.name,
    source: provider.source,
    status: "failed",
    queries,
    results: [],
    warnings: [`${provider.name}: ${error instanceof Error ? error.message : String(error)}`],
  };
}
