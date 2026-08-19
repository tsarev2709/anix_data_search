import type { ProviderRunStatus, SearchResult } from "../types.js";
import { uniqueBy } from "../utils.js";
import type { ProviderSearchResult, SearchProvider } from "./search-provider.js";
import { providerFailure } from "./search-provider.js";

export interface MultiSearchOutcome {
  results: SearchResult[];
  queries: string[];
  providers: Record<string, ProviderRunStatus>;
  warnings: string[];
  failures: Array<{ provider: string; message: string }>;
}

function combine(outcomes: ProviderSearchResult[]): MultiSearchOutcome {
  const providers: Record<string, ProviderRunStatus> = {};
  for (const outcome of outcomes) providers[outcome.provider] = outcome.status;
  return {
    results: uniqueBy(outcomes.flatMap((outcome) => outcome.results), (result) => result.url),
    queries: [...new Set(outcomes.flatMap((outcome) => outcome.queries))],
    providers,
    warnings: outcomes.flatMap((outcome) => outcome.warnings),
    failures: outcomes
      .filter((outcome) => outcome.status === "failed")
      .map((outcome) => ({ provider: outcome.provider, message: outcome.warnings.join("; ") || "provider failed" })),
  };
}

export class MultiSearchProvider {
  constructor(private readonly providers: SearchProvider[]) {}

  async searchCompany(companyName: string, targetRoles: string[]): Promise<MultiSearchOutcome> {
    const outcomes = await Promise.all(
      this.providers.map(async (provider) => {
        try {
          return await provider.searchCompany(companyName, targetRoles);
        } catch (error) {
          return providerFailure(provider, error);
        }
      }),
    );
    return combine(outcomes);
  }

  async searchPerson(personName: string, companyName: string): Promise<MultiSearchOutcome> {
    const capable = this.providers.filter((provider) => provider.searchPerson);
    const outcomes = await Promise.all(
      capable.map(async (provider) => {
        try {
          return await provider.searchPerson!(personName, companyName);
        } catch (error) {
          return providerFailure(provider, error);
        }
      }),
    );
    return combine(outcomes);
  }
}
