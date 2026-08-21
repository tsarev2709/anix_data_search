import { describe, expect, it } from "vitest";
import { companyNameFromLead } from "../src/amocrm.js";

describe("AmoCRM company name fallback", () => {
  it("reads the configured company name from the lead custom field", () => {
    const lead = { custom_fields_values: [{ field_id: 777, field_name: "Компания", values: [{ value: "Мосфарма" }] }] };
    expect(companyNameFromLead(lead, 777)).toBe("Мосфарма");
    expect(companyNameFromLead(lead, 778)).toBeNull();
  });
});
