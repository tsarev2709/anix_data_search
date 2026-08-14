import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const required = {
  AMO_BASE_URL: "https://example.amocrm.ru/",
  AMO_ACCESS_TOKEN: "token",
  AMO_PIPELINE_ID: "10",
  AMO_SOURCE_STATUS_ID: "20",
};

describe("configuration", () => {
  it("uses safe dry-run defaults and normalizes the host", () => {
    const config = loadConfig(required);
    expect(config.run.mode).toBe("dry-run");
    expect(config.run.operation).toBe("research");
    expect(config.amo.writeMode).toBe("enrich");
    expect(config.amo.baseUrl).toBe("https://example.amocrm.ru");
    expect(config.run.includeGenericEmails).toBe(true);
  });

  it("requires apply mode and Supabase for approved-contact synchronization", () => {
    expect(() => loadConfig({ ...required, CONTACT_SEARCH_OPERATION: "sync-approved" })).toThrow(/apply mode/);
    expect(() => loadConfig({ ...required, SUPABASE_URL: "https://project.supabase.co" })).toThrow(/configured together/);
    const config = loadConfig({
      ...required,
      CONTACT_SEARCH_OPERATION: "sync-approved",
      CONTACT_SEARCH_MODE: "apply",
      SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret",
    });
    expect(config.storage?.url).toBe("https://project.supabase.co");
  });

  it("requires an output stage in new_lead mode", () => {
    expect(() => loadConfig({ ...required, AMO_WRITE_MODE: "new_lead" })).toThrow(/AMO_OUTPUT_PIPELINE_ID/);
  });

  it("accepts a fully configured new_lead mode", () => {
    const config = loadConfig({ ...required, AMO_WRITE_MODE: "new_lead", AMO_OUTPUT_PIPELINE_ID: "30", AMO_OUTPUT_STATUS_ID: "40" });
    expect(config.amo.outputStatusId).toBe(40);
  });
});
