import type { HttpOptions } from "../http.js";
import { fetchWithRetry } from "../http.js";
import type { SearchResult } from "../types.js";
import { delay, normalizeUrl, truncate, uniqueBy } from "../utils.js";
import { companyQueryMatrix, personQueryMatrix } from "./query-matrix.js";
import type { ProviderSearchResult, SearchProvider } from "./search-provider.js";

interface SearxResponse {
  results?: Array<{ title?: string; url?: string; content?: string; score?: number; publishedDate?: string }>;
}

const DEFAULT_INSTANCES = ["https://searx.be", "https://search.bus-hit.me", "https://priv.au"];

interface SearxSpaceInstance {
  analytics?: boolean;
  network_type?: string;
  http?: { status_code?: number };
  timing?: { search?: { success_percentage?: number; all?: { median?: number } } };
  uptime?: { uptimeDay?: number };
}

export function selectHealthyInstances(payload: { instances?: Record<string, SearxSpaceInstance> }, limit = 8): string[] {
  return Object.entries(payload.instances ?? {})
    .filter(([, item]) => item.analytics === false && item.network_type === "normal" && item.http?.status_code === 200 && (item.timing?.search?.success_percentage ?? 0) >= 90 && (item.uptime?.uptimeDay ?? 0) >= 95)
    .sort(([, left], [, right]) => (left.timing?.search?.all?.median ?? 99) - (right.timing?.search?.all?.median ?? 99))
    .map(([url]) => url)
    .slice(0, limit);
}

export class SearxngProvider implements SearchProvider {
  readonly name = "searxng";
  readonly source = "searxng" as const;
  private cursor = 0;
  private readonly unhealthyUntil = new Map<string, number>();
  private readonly nextRequestAt = new Map<string, number>();
  private readonly instances: string[];
  private instancesDiscovered = false;

  constructor(private readonly http: HttpOptions, instances = DEFAULT_INSTANCES) {
    this.instances = [...instances];
  }

  private async discoverInstances(): Promise<void> {
    if (this.instancesDiscovered) return;
    this.instancesDiscovered = true;
    try {
      const response = await fetchWithRetry("https://searx.space/data/instances.json", { method: "GET", headers: { accept: "application/json" } }, { ...this.http, timeoutMs: Math.min(this.http.timeoutMs, 4_500), retries: 0 });
      if (!response.ok) return;
      const discovered = selectHealthyInstances(JSON.parse(await response.text()) as { instances?: Record<string, SearxSpaceInstance> });
      for (const instance of discovered) if (!this.instances.includes(instance)) this.instances.push(instance);
    } catch { /* built-in/configured rotation remains available */ }
  }

  private async searchOne(query: string): Promise<{ results: SearchResult[]; warnings: string[]; succeeded: boolean }> {
    const warnings: string[] = [];
    const requestOptions = { ...this.http, timeoutMs: Math.min(this.http.timeoutMs, 4_500), retries: 0 };
    const start = this.cursor;
    this.cursor = this.instances.length > 0 ? (this.cursor + 1) % this.instances.length : 0;

    for (let attempt = 0; attempt < this.instances.length; attempt += 1) {
      const instance = this.instances[(start + attempt) % this.instances.length];
      if (!instance) continue;
      if ((this.unhealthyUntil.get(instance) ?? 0) > Date.now()) continue;
      try {
        const waitMs = Math.max(0, (this.nextRequestAt.get(instance) ?? 0) - Date.now());
        this.nextRequestAt.set(instance, Date.now() + waitMs + 400);
        if (waitMs > 0) await delay(waitMs);
        const url = new URL("/search", instance);
        url.searchParams.set("q", query);
        url.searchParams.set("format", "json");
        url.searchParams.set("language", "ru-RU");
        url.searchParams.set("safesearch", "0");
        const response = await fetchWithRetry(url, { method: "GET", headers: { accept: "application/json" } }, requestOptions);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = JSON.parse(await response.text()) as SearxResponse;
        this.unhealthyUntil.delete(instance);
        return {
          succeeded: true,
          warnings,
          results: (payload.results ?? []).slice(0, 8).map((item) => ({
            title: item.title?.trim() || item.url || "SearXNG",
            url: normalizeUrl(item.url ?? "") ?? "",
            content: truncate(item.content ?? "", 2_000),
            ...(typeof item.score === "number" ? { score: item.score } : {}),
            provider: this.source,
            query,
            publishedAt: item.publishedDate ?? null,
          })).filter((item) => Boolean(item.url)),
        };
      } catch (error) {
        this.unhealthyUntil.set(instance, Date.now() + 120_000);
        warnings.push(`SearXNG ${instance}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    warnings.push(`SearXNG: запрос не выполнен: ${query}`);
    return { results: [], warnings, succeeded: false };
  }

  private async searchQueries(queries: string[], budget: number): Promise<ProviderSearchResult> {
    await this.discoverInstances();
    const warnings: string[] = [];
    const results: SearchResult[] = [];
    let successfulQueries = 0;
    const sent = queries.slice(0, budget);

    // Small batches keep the run reasonably fast without flooding community instances.
    for (let index = 0; index < sent.length; index += 3) {
      const batch = await Promise.all(sent.slice(index, index + 3).map((query) => this.searchOne(query)));
      for (const outcome of batch) {
        results.push(...outcome.results);
        warnings.push(...outcome.warnings);
        if (outcome.succeeded) successfulQueries += 1;
      }
    }

    return {
      provider: this.name,
      source: this.source,
      status: successfulQueries > 0 ? "used" : "failed",
      queries: sent,
      results: uniqueBy(results, (item) => item.url),
      warnings,
    };
  }

  searchCompany(companyName: string, targetRoles: string[]) {
    return this.searchQueries(companyQueryMatrix(companyName, targetRoles), 10);
  }

  searchPerson(personName: string, companyName: string) {
    return this.searchQueries(personQueryMatrix(personName, companyName), 8);
  }
}
