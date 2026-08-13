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
    expect(config.amo.writeMode).toBe("enrich");
    expect(config.amo.baseUrl).toBe("https://example.amocrm.ru");
    expect(config.run.includeGenericEmails).toBe(true);
  });

  it("requires an output stage in new_lead mode", () => {
    expect(() => loadConfig({ ...required, AMO_WRITE_MODE: "new_lead" })).toThrow(/AMO_OUTPUT_PIPELINE_ID/);
  });

  it("accepts a fully configured new_lead mode", () => {
    const config = loadConfig({ ...required, AMO_WRITE_MODE: "new_lead", AMO_OUTPUT_PIPELINE_ID: "30", AMO_OUTPUT_STATUS_ID: "40" });
    expect(config.amo.outputStatusId).toBe(40);
  });
});
