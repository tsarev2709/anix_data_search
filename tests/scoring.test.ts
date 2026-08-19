import { describe, expect, it } from "vitest";
import { mergeCandidates, selectCandidates } from "../src/scoring.js";
import type { ContactCandidate } from "../src/types.js";

function candidate(overrides: Partial<ContactCandidate> = {}): ContactCandidate {
  return {
    fullName: null,
    position: null,
    emails: [],
    phones: [],
    socialUrls: [],
    evidence: [],
    score: 0,
    scoreReasons: [],
    ...overrides,
  };
}

describe("candidate consolidation and scoring", () => {
  it("merges provider data by exact normalized email", () => {
    const merged = mergeCandidates([
      candidate({
        emails: [{ value: "Person@Example.com", generic: false, deliverability: "unknown" }],
        evidence: [{ source: "website", url: "https://example.com/team", title: "Team", snippet: "Person@example.com" }],
      }),
      candidate({
        fullName: "Иван Петров",
        position: "Директор по маркетингу",
        emails: [{ value: "person@example.com", generic: false, deliverability: "deliverable", confidence: 92 }],
        evidence: [{ source: "hunter", url: "https://example.com/ivan", title: "Hunter", snippet: "person@example.com" }],
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.fullName).toBe("Иван Петров");
    expect(merged[0]?.emails[0]).toMatchObject({ value: "person@example.com", deliverability: "deliverable", confidence: 92 });
    expect(merged[0]?.evidence).toHaveLength(2);
  });

  it("prioritizes a named, verified decision-maker", () => {
    const { scored, selected } = selectCandidates(
      [
        candidate({
          fullName: "Анна Смирнова",
          position: "Директор по маркетингу",
          emails: [{ value: "anna@example.com", generic: false, deliverability: "deliverable", confidence: 90 }],
          evidence: [
            { source: "website", url: "https://example.com/team", title: "Team", snippet: "Анна" },
            { source: "hunter", url: "https://example.com/about", title: "Hunter", snippet: "anna@example.com" },
          ],
        }),
        candidate({
          emails: [{ value: "info@example.com", generic: true, deliverability: "unknown" }],
          evidence: [{ source: "website", url: "https://example.com/contacts", title: "Contacts", snippet: "info@example.com" }],
        }),
      ],
      ["директор по маркетингу"],
      35,
      5,
      true,
    );

    expect(scored[0]?.fullName).toBe("Анна Смирнова");
    expect(scored[0]?.score).toBeGreaterThanOrEqual(90);
    expect(selected.map((item) => item.emails[0]?.value)).toEqual(["anna@example.com", "info@example.com"]);
    expect(selected[1]?.scoreReasons).toContain("fallback: официальный общий адрес");
  });

  it("rejects an undeliverable-only candidate", () => {
    const { selected } = selectCandidates(
      [
        candidate({
          fullName: "Bad Address",
          position: "CEO",
          emails: [{ value: "bad@example.com", generic: false, deliverability: "undeliverable" }],
          evidence: [{ source: "hunter", url: "https://example.com", title: "Hunter", snippet: "bad@example.com" }],
        }),
      ],
      ["ceo"],
      1,
      5,
      true,
    );
    expect(selected).toHaveLength(0);
  });

  it("merges transitive identity and evidence links", () => {
    const merged = mergeCandidates([
      candidate({ fullName: "Иван Петров", position: "CEO", socialUrls: ["https://t.me/ivan"], evidence: [{ source: "website", url: "https://example.com/team", title: "Team", snippet: "Иван Петров" }] }),
      candidate({ socialUrls: ["https://t.me/ivan"], emails: [{ value: "ivan@example.com", generic: false, deliverability: "unknown", status: "found" }], evidence: [{ source: "searxng", url: "https://search.example/ivan", title: "Profile", snippet: "ivan@example.com" }] }),
      candidate({ fullName: "Иван Петров", position: "CEO", phones: ["+79990000000"], evidence: [{ source: "rss", url: "https://example.com/feed/ivan", title: "Appointment", snippet: "Иван Петров" }] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.evidence).toHaveLength(3);
    expect(merged[0]?.emails[0]?.value).toBe("ivan@example.com");
    expect(merged[0]?.phones).toEqual(["+79990000000"]);
  });

  it("never selects an inferred-only email as a direct channel", () => {
    const { selected } = selectCandidates([
      candidate({ fullName: "Иван Петров", position: "CEO", emails: [{ value: "ivan@example.com", generic: false, deliverability: "unknown", status: "inferred" }], evidence: [{ source: "website", url: "https://example.com/team", title: "Team", snippet: "Иван Петров" }] }),
    ], ["ceo"], 1, 5, false);
    expect(selected).toHaveLength(0);
  });
});
