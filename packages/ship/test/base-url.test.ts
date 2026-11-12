import { describe, expect, it } from "vitest";
import { PLACEHOLDER_BASE_URL, SITE_DOMAIN, SITE_URL, baseUrlProblem, certBaseUrl } from "../src/base-url";

describe("the live site and the certificate base URL", () => {
  it("is the user's domain, and its certificate route", () => {
    expect(SITE_DOMAIN).toBe("basanos.suitz.xyz");
    expect(SITE_URL).toBe("https://basanos.suitz.xyz");
    expect(certBaseUrl(SITE_URL)).toBe("https://basanos.suitz.xyz/app/#/cert/");
    expect(certBaseUrl(`${SITE_URL}/`)).toBe("https://basanos.suitz.xyz/app/#/cert/");
    expect(() => certBaseUrl("http://basanos.suitz.xyz")).toThrow(/https/);
  });
  it("accepts only an on-chain value equal to the deployed route, and names the placeholder", () => {
    const route = certBaseUrl(SITE_URL);
    expect(baseUrlProblem(route, route)).toBeNull();
    expect(baseUrlProblem(route, PLACEHOLDER_BASE_URL)).toMatch(/placeholder/);
    expect(baseUrlProblem(route, "https://other.example/app/#/cert/")).toMatch(/expected/);
    expect(PLACEHOLDER_BASE_URL).not.toContain(SITE_DOMAIN);
  });
});
