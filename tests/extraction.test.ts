import { describe, expect, it } from "vitest";
import { emailFromEvidence, extractPeopleFromEvidence, extractSocialProfiles, inferEmailCandidates, normalizeSocialUrl } from "../src/extraction.js";
import type { ContactCandidate, Evidence } from "../src/types.js";

const evidence: Evidence = { source: "website", url: "https://company.ru/team", title: "Команда", snippet: "", discoveredAt: "2026-08-18T00:00:00Z" };

describe("social URL registry", () => {
  const cases = [
    ["https://t.me/ivan", "telegram"], ["https://vk.com/id1", "vk"], ["https://youtube.com/@anix", "youtube"],
    ["https://threads.net/@ivan", "threads"], ["https://instagram.com/ivan", "instagram"],
    ["https://tenchat.ru/ivan", "tenchat"], ["https://rutube.ru/channel/1", "rutube"],
  ];
  it.each(cases)("normalizes %s", (url, platform) => expect(normalizeSocialUrl(url)?.platform).toBe(platform));

  it("extracts profiles with strong official confidence", () => {
    const profiles = extractSocialProfiles([{ ...evidence, snippet: "Telegram https://t.me/ivan и https://vk.com/ivan" }], "Компания");
    expect(profiles.map((profile) => profile.platform)).toEqual(["telegram", "vk"]);
    expect(profiles.every((profile) => profile.confidence === 95)).toBe(true);
  });
});

describe("deterministic entity and email extraction", () => {
  it("links a Russian name to a target role", () => {
    const people = extractPeopleFromEvidence([{ ...evidence, snippet: "Иван Петров — директор по маркетингу компании." }], ["директор по маркетингу"]);
    expect(people[0]).toMatchObject({ fullName: "Иван Петров", position: "директор по маркетингу" });
  });

  it("supports initials before a Russian surname", () => {
    const people = extractPeopleFromEvidence([{ ...evidence, snippet: "И.И. Иванов — генеральный директор компании." }], ["генеральный директор"]);
    expect(people[0]).toMatchObject({ fullName: "И.И. Иванов", position: "генеральный директор" });
  });

  it("classifies found and general email", () => {
    expect(emailFromEvidence("ivan@company.ru", evidence)).toMatchObject({ status: "found", generic: false, confidence: 95 });
    expect(emailFromEvidence("info@company.ru", evidence)).toMatchObject({ status: "general", generic: true });
    expect(emailFromEvidence("hr@company.ru", evidence)).toMatchObject({ status: "general", generic: true });
  });

  it("marks generated email as inferred", () => {
    const person: ContactCandidate = { fullName: "Иван Иванов", position: "директор", emails: [], phones: [], socialUrls: [], evidence: [evidence], score: 0, scoreReasons: [] };
    const inferred = inferEmailCandidates(person, [{ value: "anna.sidorova@company.ru", generic: false, deliverability: "unknown", status: "found" }]);
    expect(inferred[0]).toMatchObject({ value: "ivan.ivanov@company.ru", status: "inferred", confidence: 35 });
  });
});
