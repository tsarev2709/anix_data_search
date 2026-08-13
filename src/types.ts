export type EvidenceSource = "website" | "search" | "hunter" | "llm";

export interface Evidence {
  source: EvidenceSource;
  url: string;
  title: string;
  snippet: string;
}

export type Deliverability = "deliverable" | "risky" | "unknown" | "undeliverable";

export interface EmailAddress {
  value: string;
  generic: boolean;
  deliverability: Deliverability;
  confidence?: number;
}

export interface ContactCandidate {
  fullName: string | null;
  position: string | null;
  emails: EmailAddress[];
  phones: string[];
  socialUrls: string[];
  evidence: Evidence[];
  score: number;
  scoreReasons: string[];
}

export interface CompanyContext {
  sourceLeadId: number;
  sourceLeadName: string;
  pipelineId: number;
  statusId: number;
  responsibleUserId: number | null;
  companyId: number | null;
  companyName: string;
  website: string | null;
  linkedContactIds: number[];
}

export interface CompanyResearchResult {
  company: CompanyContext;
  discoveredWebsite: string | null;
  candidates: ContactCandidate[];
  selectedCandidates: ContactCandidate[];
  warnings: string[];
  actions: SyncAction[];
  durationMs: number;
}

export interface SyncAction {
  type:
    | "create_contact"
    | "reuse_contact"
    | "link_contact"
    | "create_lead"
    | "create_note"
    | "create_task"
    | "move_source_lead"
    | "skip";
  status: "planned" | "completed" | "skipped" | "failed";
  detail: string;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  mode: "dry-run" | "apply";
  writeMode: "enrich" | "new_lead";
  companies: CompanyResearchResult[];
  totals: {
    companies: number;
    candidates: number;
    selected: number;
    actionsCompleted: number;
    failures: number;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  emails: string[];
  phones: string[];
  socialUrls: string[];
}
