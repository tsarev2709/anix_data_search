import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { syncCandidates } from "../src/sync.js";
import type { AmoCRMClient } from "../src/amocrm.js";
import type { CompanyContext, ContactCandidate } from "../src/types.js";

const company: CompanyContext = {
  sourceLeadId: 101,
  sourceLeadName: "Example deal",
  pipelineId: 10,
  statusId: 20,
  responsibleUserId: 7,
  companyId: 303,
  companyName: "Example",
  website: "https://example.com",
  linkedContactIds: [],
};

const candidate: ContactCandidate = {
  fullName: "Иван Петров",
  position: "Директор по маркетингу",
  emails: [{ value: "ivan@example.com", generic: false, deliverability: "deliverable", confidence: 91 }],
  phones: [],
  socialUrls: [],
  evidence: [{ source: "website", url: "https://example.com/team", title: "Team", snippet: "Иван" }],
  score: 98,
  scoreReasons: ["+25 целевая роль"],
};

describe("dry-run synchronization", () => {
  it("reads for deduplication but performs zero AmoCRM mutations", async () => {
    const mutating = {
      createContact: vi.fn(),
      linkContactToLead: vi.fn(),
      createLead: vi.fn(),
      addNote: vi.fn(),
      createFollowUpTask: vi.fn(),
      moveLead: vi.fn(),
    };
    const amo = {
      findContact: vi.fn().mockResolvedValue(null),
      ...mutating,
    } as unknown as AmoCRMClient;
    const config = loadConfig({
      AMO_BASE_URL: "https://example.amocrm.ru",
      AMO_ACCESS_TOKEN: "token",
      AMO_PIPELINE_ID: "10",
      AMO_SOURCE_STATUS_ID: "20",
      AMO_SUCCESS_STATUS_ID: "30",
      CONTACT_SEARCH_MODE: "dry-run",
    });

    const actions = await syncCandidates(amo, config, company, [candidate], "test-run");

    expect(amo.findContact).toHaveBeenCalledOnce();
    for (const operation of Object.values(mutating)) expect(operation).not.toHaveBeenCalled();
    expect(actions.filter((action) => action.status === "planned").map((action) => action.type)).toEqual([
      "create_contact",
      "link_contact",
      "create_note",
      "create_task",
      "move_source_lead",
    ]);
  });
});
