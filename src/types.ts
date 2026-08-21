export type EvidenceSource =
  | "website"
  | "sitemap"
  | "rss"
  | "pdf"
  | "searxng"
  | "google_news"
  | "gdelt"
  | "common_crawl"
  | "github"
  | "hacker_news"
  | "stack_exchange"
  | "youtube"
  | "feed"
  | "social"
  | "gemini"
  | "search"
  | "hunter"
  | "llm";

export interface Evidence {
  source: EvidenceSource;
  url: string;
  title: string;
  snippet: string;
  query?: string;
  publishedAt?: string | null;
  discoveredAt?: string;
}

export type Deliverability = "deliverable" | "risky" | "unknown" | "undeliverable";

export interface EmailAddress {
  value: string;
  generic: boolean;
  deliverability: Deliverability;
  confidence?: number;
  status?: "found" | "general" | "inferred";
  evidenceUrl?: string;
  patternSource?: string;
  domainHasMx?: boolean | null;
}

export type SocialPlatform = "telegram" | "vk" | "youtube" | "threads" | "instagram" | "tenchat" | "linkedin" | "rutube" | "github" | "other";
export type SocialProfileKind = "company" | "person" | "channel" | "group" | "bot" | "event" | "unknown";

export interface SocialProfile {
  platform: SocialPlatform;
  kind: SocialProfileKind;
  url: string;
  username: string | null;
  displayName: string | null;
  personName: string | null;
  companyName: string | null;
  role: string | null;
  source: EvidenceSource;
  evidenceUrl: string;
  confidence: number;
  lastSeen: string;
}

export interface ContactCandidate {
  fullName: string | null;
  position: string | null;
  emails: EmailAddress[];
  phones: string[];
  socialUrls: string[];
  socialProfiles?: SocialProfile[];
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
  source: "amo" | "manual";
}

export interface CompanyResearchResult {
  company: CompanyContext;
  discoveredWebsite: string | null;
  candidates: ContactCandidate[];
  selectedCandidates: ContactCandidate[];
  research: ResearchTrace;
  warnings: string[];
  actions: SyncAction[];
  durationMs: number;
}

export type ProviderRunStatus = "used" | "disabled" | "skipped" | "failed";

export interface ResearchTrace {
  searchQueries: string[];
  searchResults: SearchResult[];
  crawledPages: Array<{
    url: string;
    title: string;
    emails: string[];
    phones: string[];
    socialUrls: string[];
  }>;
  evidence: Evidence[];
  socialProfiles?: SocialProfile[];
  peopleFound?: number;
  providerFailures?: Array<{ provider: string; message: string }>;
  crawlDiagnostics?: {
    robotsUrl: string | null;
    sitemapUrls: string[];
    sitemapEntries: number;
    feedUrls: string[];
    pdfUrls: string[];
    jsFallbacks: number;
    wordpress: boolean;
  };
  socialEnrichment?: {
    attempted: number;
    succeeded: number;
    failed: number;
    pages: Array<{
      platform: SocialPlatform;
      url: string;
      title: string;
      emails: string[];
      phones: string[];
      socialUrls: string[];
    }>;
  };
  providers: {
    [provider: string]: ProviderRunStatus;
  };
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
    searchQueries: number;
    pagesCrawled: number;
    searchResults: number;
    socialProfilesFound: number;
    peopleFound: number;
    positionsFound: number;
    emailsFound: number;
    personalEmailsFound: number;
    inferredEmailsFound: number;
    phonesFound: number;
    telegramFound: number;
    highConfidenceContacts: number;
    mediumConfidenceContacts: number;
    lowConfidenceContacts: number;
    providerFailures: number;
    socialByPlatform: Record<string, number>;
  };
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  provider?: EvidenceSource;
  query?: string;
  publishedAt?: string | null;
  author?: string | null;
}

export interface CrawledPage {
  url: string;
  title: string;
  text: string;
  emails: string[];
  phones: string[];
  socialUrls: string[];
  source?: "website" | "rss" | "pdf" | "wordpress" | "social";
  publishedAt?: string | null;
}

export type DemandIntent = "vendor_search" | "brief" | "tender" | "recommendation" | "problem" | "market_signal";
export type DemandSignalStatus = "new" | "qualified" | "dismissed";

export interface DemandQuery {
  id: string;
  query: string;
  category: string;
  intent: DemandIntent;
  priority: number;
  locale: "ru" | "en";
  channel: "web" | "social" | "forum" | "news";
}

export interface DemandSignal {
  fingerprint: string;
  source: EvidenceSource;
  category: string;
  intent: DemandIntent;
  query: string;
  title: string;
  url: string;
  snippet: string;
  author: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  score: number;
  scoreReasons: string[];
  emails: string[];
  phones: string[];
  socialUrls: string[];
  status: DemandSignalStatus;
}

export interface DemandMonitorReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  queries: DemandQuery[];
  signals: DemandSignal[];
  providers: Record<string, ProviderRunStatus>;
  failures: Array<{ provider: string; message: string }>;
  resultsCount: number;
}
