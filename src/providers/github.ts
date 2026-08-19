import type { HttpOptions } from "../http.js";
import { requestJson } from "../http.js";
import type { SearchResult } from "../types.js";
import { truncate, uniqueBy } from "../utils.js";
import type { ProviderSearchResult, SearchProvider } from "./search-provider.js";

interface GitHubSearch { items?: Array<{ login: string; html_url: string; type: string }> }
interface GitHubProfile { login: string; name?: string | null; company?: string | null; blog?: string | null; email?: string | null; bio?: string | null; html_url: string }

export class GitHubDiscoveryProvider implements SearchProvider {
  readonly name = "github";
  readonly source = "github" as const;
  constructor(private readonly http: HttpOptions, private readonly token?: string) {}

  async searchCompany(companyName: string): Promise<ProviderSearchResult> {
    const query = `"${companyName}" in:fullname type:org`;
    const headers: HeadersInit = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    try {
      const found = await requestJson<GitHubSearch>(`https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=3`, { method: "GET", headers }, this.http);
      const profiles = await Promise.all((found.items ?? []).slice(0, 2).map((item) => requestJson<GitHubProfile>(`https://api.github.com/users/${encodeURIComponent(item.login)}`, { method: "GET", headers }, this.http)));
      const results = profiles.map((profile) => ({
        title: [profile.name, profile.company].filter(Boolean).join(" · ") || profile.login,
        url: profile.html_url,
        content: truncate([profile.bio, profile.email, profile.blog, profile.company].filter(Boolean).join(" · "), 2_000),
        provider: this.source,
        query,
        publishedAt: null,
      }));
      return { provider: this.name, source: this.source, status: "used", queries: [query], results: uniqueBy(results, (item) => item.url), warnings: [] };
    } catch (error) {
      return { provider: this.name, source: this.source, status: "failed", queries: [query], results: [], warnings: [`GitHub: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }

  async searchPerson(personName: string, companyName: string): Promise<ProviderSearchResult> {
    const query = `"${personName}" "${companyName}" in:fullname,company,bio type:user`;
    const headers: HeadersInit = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    try {
      const found = await requestJson<GitHubSearch>(`https://api.github.com/search/users?q=${encodeURIComponent(query)}&per_page=3`, { method: "GET", headers }, this.http);
      const profiles = await Promise.all((found.items ?? []).slice(0, 3).map((item) => requestJson<GitHubProfile>(`https://api.github.com/users/${encodeURIComponent(item.login)}`, { method: "GET", headers }, this.http)));
      const results = profiles.map((profile) => ({
        title: [profile.name, profile.company].filter(Boolean).join(" · ") || profile.login,
        url: profile.html_url,
        content: truncate([profile.bio, profile.email, profile.blog, profile.company].filter(Boolean).join(" · "), 2_000),
        provider: this.source,
        query,
        publishedAt: null,
      }));
      return { provider: this.name, source: this.source, status: "used", queries: [query], results: uniqueBy(results, (item) => item.url), warnings: [] };
    } catch (error) {
      return { provider: this.name, source: this.source, status: "failed", queries: [query], results: [], warnings: [`GitHub person search: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }
}
