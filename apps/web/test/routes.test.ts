import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "../src/routes";

describe("hash routes", () => {
  it("parses the four routes", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/")).toEqual({ name: "home" });
    expect(parseRoute("#/challenge")).toEqual({ name: "challenge" });
    expect(parseRoute("#/run/12")).toEqual({ name: "run", runId: 12n });
    expect(parseRoute("#/cert/7")).toEqual({ name: "cert", runId: 7n });
  });
  it("falls back to home on anything else", () => {
    expect(parseRoute("#/run/abc")).toEqual({ name: "home" });
    expect(parseRoute("#/nope")).toEqual({ name: "home" });
  });
  it("builds hrefs that parse back", () => {
    for (const r of [{ name: "home" }, { name: "challenge" }, { name: "run", runId: 3n }, { name: "cert", runId: 4n }] as const) {
      expect(parseRoute(routeHref(r))).toEqual(r);
    }
  });
});
