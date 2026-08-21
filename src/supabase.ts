import type { CompanyContext, ContactCandidate, DemandMonitorReport, RunReport } from "./types.js";

export interface ApprovedCandidate {
  id: number;
  company: CompanyContext;
  candidate: ContactCandidate;
}

interface StorageConfig {
  url: string;
  serviceRoleKey: string;
}

interface StoredCandidate {
  id: number;
  company_context: CompanyContext;
  candidate_payload: ContactCandidate;
}

export class SupabaseRepository {
  constructor(private readonly config: StorageConfig) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${this.config.url}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: this.config.serviceRoleKey,
        authorization: `Bearer ${this.config.serviceRoleKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Supabase ${response.status}: ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async saveReport(report: RunReport): Promise<void> {
    await this.request("contact_search_runs?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: report.runId,
        started_at: report.startedAt,
        finished_at: report.finishedAt,
        mode: report.mode,
        write_mode: report.writeMode,
        status: report.totals.failures > 0 ? "failed" : "completed",
        companies_count: report.totals.companies,
        candidates_count: report.totals.candidates,
        selected_count: report.totals.selected,
        failures_count: report.totals.failures,
        metrics: report.totals,
      }),
    });

    await this.request(`contact_search_companies?run_id=eq.${encodeURIComponent(report.runId)}`, { method: "DELETE" });
    if (report.companies.length === 0) return;

    const companies = await this.request<Array<{ id: number; source_lead_id: number }>>("contact_search_companies", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(
        report.companies.map((result) => ({
          run_id: report.runId,
          source_lead_id: result.company.sourceLeadId,
          source_lead_name: result.company.sourceLeadName,
          source_company_id: result.company.companyId,
          company_name: result.company.companyName,
          source_website: result.company.website,
          website: result.discoveredWebsite,
          company_context: result.company,
          research_trace: result.research,
          candidates: result.candidates,
          selected_candidates: result.selectedCandidates,
          actions: result.actions,
          warnings: result.warnings,
          duration_ms: result.durationMs,
        })),
      ),
    });
    const companyIds = new Map(companies.map((company) => [company.source_lead_id, company.id]));
    const candidates = report.companies.flatMap((result) =>
      result.selectedCandidates.map((candidate) => ({
        run_id: report.runId,
        company_id: companyIds.get(result.company.sourceLeadId),
        source_lead_id: result.company.sourceLeadId,
        company_name: result.company.companyName,
        full_name: candidate.fullName,
        position: candidate.position,
        emails: candidate.emails,
        phones: candidate.phones,
        social_urls: candidate.socialUrls,
        evidence: candidate.evidence,
        score: candidate.score,
        score_reasons: candidate.scoreReasons,
        decision: report.mode === "apply" ? "approved" : "pending",
        synced_at: report.mode === "apply" ? report.finishedAt : null,
        company_context: result.company,
        candidate_payload: candidate,
      })),
    );
    if (candidates.length > 0) {
      await this.request("contact_search_candidates", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(candidates),
      });
    }
  }

  async loadApproved(limit: number): Promise<ApprovedCandidate[]> {
    const query = new URLSearchParams({
      decision: "eq.approved",
      synced_at: "is.null",
      select: "id,company_context,candidate_payload",
      order: "created_at.asc",
      limit: String(limit),
    });
    const rows = await this.request<StoredCandidate[]>(`contact_search_candidates?${query}`);
    return rows.map((row) => ({ id: row.id, company: row.company_context, candidate: row.candidate_payload }));
  }

  async saveDemandReport(report: DemandMonitorReport): Promise<void> {
    await this.request("demand_monitor_runs?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({
        id: report.runId,
        started_at: report.startedAt,
        finished_at: report.finishedAt,
        status: report.failures.length > 0 && report.signals.length === 0 ? "failed" : "completed",
        queries_count: report.queries.length,
        results_count: report.resultsCount,
        signals_count: report.signals.length,
        failures_count: report.failures.length,
        providers: report.providers,
        failures: report.failures,
        query_catalog: report.queries,
      }),
    });
    if (report.signals.length === 0) return;
    await this.request("demand_signals?on_conflict=fingerprint", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(report.signals.map((signal) => ({
        fingerprint: signal.fingerprint,
        last_run_id: report.runId,
        source: signal.source,
        category: signal.category,
        intent: signal.intent,
        query: signal.query,
        title: signal.title,
        url: signal.url,
        snippet: signal.snippet,
        author: signal.author,
        published_at: signal.publishedAt,
        last_seen_at: signal.discoveredAt,
        score: signal.score,
        score_reasons: signal.scoreReasons,
        emails: signal.emails,
        phones: signal.phones,
        social_urls: signal.socialUrls,
      }))),
    });
  }

  async markSynced(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.request(`contact_search_candidates?id=in.(${ids.join(",")})`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ synced_at: new Date().toISOString() }),
    });
  }
}
