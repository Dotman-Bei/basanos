import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { canonicalJson, parseRulebook, rulebookId } from "../src/rulebook";
import { loadRulebook } from "../src/node";

describe("canonicalJson", () => {
  it("sorts keys recursively and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
  });
  it("writes bigints as decimal strings", () => {
    expect(canonicalJson({ x: 10n ** 20n })).toBe('{"x":"100000000000000000000"}');
  });
});

describe("rulebooks", () => {
  it("loads both Tokyo Sprint variants", () => {
    const standard = loadRulebook("tokyo-sprint");
    const demo = loadRulebook("tokyo-sprint-demo");
    expect(standard.variant).toBe("standard");
    expect(demo.variant).toBe("demo");
    expect(demo.label).toBe("Tokyo Sprint · Demo");
    expect(standard.profitTargetBps).toBe(150);
    expect(demo.profitTargetBps).toBe(50);
    expect(rulebookId(standard)).not.toBe(rulebookId(demo));
  });
  it("hashes the canonical JSON, independent of key order", () => {
    const rb = loadRulebook("tokyo-sprint");
    expect(rulebookId(rb)).toBe(keccak256(toBytes(canonicalJson(rb))));
    const reordered = parseRulebook(Object.fromEntries(Object.entries(rb).reverse()));
    expect(rulebookId(reordered)).toBe(rulebookId(rb));
  });
  it("rejects a rulebook with a missing field", () => {
    const rb = loadRulebook("tokyo-sprint") as unknown as Record<string, unknown>;
    const broken = { ...rb };
    delete broken.profitTargetBps;
    expect(() => parseRulebook(broken)).toThrow(/profitTargetBps/);
  });
});
