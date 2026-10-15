import type { ProviderSearchResult } from "./search-provider.js";

/** Retry failed and unattempted queries, not valid empty responses. */
export async function searchDemandWeb(
  queries: string[],
  primary: { searchDemand(queries: string[]): Promise<ProviderSearchResult> },
  fallback: { searchDemand(queries: string[], budget: number): Promise<ProviderSearchResult> } | undefined,
  budget: number,
): Promise<ProviderSearchResult[]> {
  const initial = await primary.searchDemand(queries);
  const successful = new Set(initial.successfulQueries ?? []);
  const missing = queries.filter((query) => !successful.has(query));
  if (!fallback || budget <= 0 || !missing.length) return [initial];
  return [initial, await fallback.searchDemand(missing, budget)];
}
