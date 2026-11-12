import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_LEVERAGE_X, parseTape, roundTripEquityBps, roundTripSpreadBps, simulateTape } from "../src/demo-math";
import { loadRulebook, repoPath } from "../src/node";

const E18 = 10n ** 18n;

describe("the demo at closeable equity (P5 ruling 2026-11-12)", () => {
  it("measures the round trip as the spread between the two sides, not the distance from the mark", () => {
    expect(roundTripSpreadBps(73_043_800n * 10n ** 15n, 73_042_200n * 10n ** 15n)).toBe(0.21);
    expect(roundTripSpreadBps(100_036n * E18, 100_000n * E18)).toBe(3.59);
    expect(() => roundTripSpreadBps(0n, 0n)).toThrow(/positive/);
  });
  it("runs at 5x, where the widest measured spread costs well under half the demo target", () => {
    expect(DEMO_LEVERAGE_X).toBe(5);
    expect(roundTripEquityBps(3.6 / 2, DEMO_LEVERAGE_X)).toBe(18);
    expect(roundTripEquityBps(3.6 / 2, DEMO_LEVERAGE_X)).toBeLessThanOrEqual(50 / 2);
  });
  it("resolves both opposite accounts on the recorded tape at 5x with a 3.6 bps round trip paid at entry", () => {
    const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
    const demo = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
    const r = simulateTape(demo, tape, { leverageX: DEMO_LEVERAGE_X, startEquity: 50n * E18, lotSize: 1_000n, entryCostBps: 3.6, exitCostBps: 0 });
    expect(r.quantity).toBeGreaterThanOrEqual(13_000n);
    expect([r.long.outcome, r.short.outcome].sort()).toEqual(["fail", "target"]);
  });
});
