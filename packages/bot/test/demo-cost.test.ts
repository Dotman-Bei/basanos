import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { demoCost } from "../src/sizing";

const E15 = 10n ** 15n;
const source = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("the demo at closeable equity (P5 ruling 2026-11-12; 10x since P7)", () => {
  it("charges the quoted spread once, at the demo leverage; a spread too wide for 10x waits for a tighter book", () => {
    expect(DEMO_LEVERAGE_X).toBe(10);
    expect(demoCost(73_043_800n * E15, 73_042_200n * E15, DEMO_LEVERAGE_X, 50)).toEqual({ spreadBps: 0.21, equityBps: 2.1, ok: true });
    expect(demoCost(73_053_500n * E15, 73_042_000n * E15, DEMO_LEVERAGE_X, 50)).toEqual({ spreadBps: 1.57, equityBps: 15.7, ok: true });
    expect(demoCost(73_068_000n * E15, 73_042_000n * E15, DEMO_LEVERAGE_X, 50)).toEqual({ spreadBps: 3.55, equityBps: 35.5, ok: false });
  });
  it("sizes every demo order at DEMO_LEVERAGE_X and opens from the book, not the mark", () => {
    for (const file of ["demo.ts", "bot.ts", "demo-check.ts"]) {
      expect(source(file), file).toContain("DEMO_LEVERAGE_X");
      expect(source(file), file).not.toMatch(/\b12x\b|, 12, |"12"/);
    }
    expect(source("actions.ts")).toContain("planOpenFromBook(isBid, quantity, levels, params)");
    expect(source("actions.ts")).not.toContain("planOpen(");
    expect(source("demo-check.ts")).not.toContain("costBpsVsMark");
  });
});
