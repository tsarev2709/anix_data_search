export interface ProcurementDocument {
  title: string;
  url: string;
  kind: "specification" | "protocol" | "contract" | "other";
  sourceUrl: string;
}

export interface CompanyPublicRecord {
  kind: "procurement" | "arbitration";
  title: string;
  url: string;
  source: string;
  authority: "primary" | "secondary";
  verification: "confirmed" | "candidate";
  identity: "inn" | "name" | "unmatched" | "conflict";
  number: string | null;
  contractNumbers: string[];
  procurementReferences: Array<{ number: string; quote: string }>;
  role: "customer" | "supplier" | "winner" | "claimant" | "defendant" | "unknown";
  parties: Array<{ role: string; description: string }>;
  status: "active" | "completed" | "failed" | "cancelled" | "unknown";
  subject: string | null;
  amount: string | null;
  deadline: string | null;
  outcome: string | null;
  evidence: string;
  fetchedAt: string | null;
  documents: ProcurementDocument[];
  documentsAccess: "links_found" | "restricted" | "not_found" | "not_checked";
  relatedProcurementUrls: string[];
  relationEvidence: string | null;
  relevance: "anix" | "other";
}

export interface ProcurementResearch {
  checkedAt: string;
  inn: string | null;
  innSource?: string | null;
  status: "disabled" | "unavailable" | "partial" | "searched";
  queries: string[];
  plannedQueries: string[];
  providers: Record<string, string>;
  records: CompanyPublicRecord[];
  warnings: string[];
  summary: {
    confirmedProcurements: number;
    candidates: number;
    customer: number;
    supplier: number;
    winner: number;
    active: number;
    completed: number;
    failed: number;
    cancelled: number;
    confirmedCases: number;
    linkedCases: number;
    specificationLinks: number;
    relevantToAnix: number;
    nextActions: string[];
  };
}
