import { describe, expect, it } from "vitest";
import { PLACEHOLDER_BASE_URL, baseUrlProblem, certBaseUrl } from "../src/base-url";

describe("certificate base URL", () => {
  it("points at the deployed site's certificate route", () => {
    expect(certBaseUrl("https://basanos-k3x9.vercel.app")).toBe("https://basanos-k3x9.vercel.app/app/#/cert/");
    expect(certBaseUrl("https://basanos-k3x9.vercel.app/")).toBe("https://basanos-k3x9.vercel.app/app/#/cert/");
    expect(() => certBaseUrl("http://basanos-k3x9.vercel.app")).toThrow(/https/);
  });
  it("accepts only an on-chain value equal to the deployed route, and names the placeholder", () => {
    const route = "https://basanos-k3x9.vercel.app/app/#/cert/";
    expect(baseUrlProblem(route, route)).toBeNull();
    expect(baseUrlProblem(route, PLACEHOLDER_BASE_URL)).toMatch(/placeholder/);
    expect(baseUrlProblem(route, "https://other.vercel.app/app/#/cert/")).toMatch(/expected/);
  });
});
