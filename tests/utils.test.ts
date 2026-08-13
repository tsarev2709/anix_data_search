import { describe, expect, it } from "vitest";
import { domainFromUrl, isGenericEmail, normalizeEmail, normalizePhone, normalizeUrl } from "../src/utils.js";

describe("normalization", () => {
  it("normalizes public channels", () => {
    expect(normalizeEmail("MAILTO:John.Doe@Example.COM?subject=Hi")).toBe("john.doe@example.com");
    expect(normalizePhone("+7 (999) 123-45-67")).toBe("+79991234567");
    expect(normalizeUrl("example.com/contact")).toBe("https://example.com/contact");
    expect(domainFromUrl("https://www.example.com/contact")).toBe("example.com");
  });

  it("distinguishes generic email addresses", () => {
    expect(isGenericEmail("info@example.com")).toBe(true);
    expect(isGenericEmail("hello.team@example.com")).toBe(true);
    expect(isGenericEmail("andrey@example.com")).toBe(false);
  });
});
