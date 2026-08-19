import { describe, expect, it } from "vitest";
import { MultiSearchProvider } from "../src/providers/multi-search.js";
import { selectHealthyInstances } from "../src/providers/searxng.js";
import type { SearchProvider } from "../src/providers/search-provider.js";

function provider(name: string, behavior: "ok" | "throw", url = "https://example.com"): SearchProvider {
  return {
    name,
    source: "search",
    async searchCompany() {
      if (behavior === "throw") throw new Error("offline");
      return { provider: name, source: "search", status: "used", queries: [`${name} query`], results: [{ title: name, url, content: name }], warnings: [] };
    },
  };
}

describe("MultiSearchProvider", () => {
  it("keeps useful results when one free provider fails and deduplicates URLs", async () => {
    const search = new MultiSearchProvider([provider("one", "ok"), provider("broken", "throw"), provider("duplicate", "ok")]);
    const outcome = await search.searchCompany("Anix", []);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.providers).toMatchObject({ one: "used", broken: "failed", duplicate: "used" });
    expect(outcome.failures[0]?.provider).toBe("broken");
  });
});

describe("SearXNG instance discovery", () => {
  it("keeps only healthy public instances and ranks by latency", () => {
    const instances = selectHealthyInstances({ instances: {
      "https://slow.example/": { analytics: false, network_type: "normal", http: { status_code: 200 }, timing: { search: { success_percentage: 100, all: { median: 1.2 } } }, uptime: { uptimeDay: 100 } },
      "https://fast.example/": { analytics: false, network_type: "normal", http: { status_code: 200 }, timing: { search: { success_percentage: 99, all: { median: 0.4 } } }, uptime: { uptimeDay: 99 } },
      "https://broken.example/": { analytics: false, network_type: "normal", http: { status_code: 500 }, timing: { search: { success_percentage: 0 } }, uptime: { uptimeDay: 10 } },
    } });
    expect(instances).toEqual(["https://fast.example/", "https://slow.example/"]);
  });
});
