import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { evaluate, initRunState, notional, type MarketView, type RunState } from "../src/evaluate";
import type { AccountSnapshot } from "../src/snapshot";
import { loadRulebook } from "../src/node";

const E18 = 10n ** 18n;
const POOL: Address = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const OTHER: Address = "0x00000000000000000000000000000000000000aa";
const T0 = 1_794_268_800n; // 2026-11-10 00:00:00 UTC
// Thresholds pinned to the registered Tokyo Sprint · Demo values, so a raised demo target (referee Task 10 Step 1) never turns this test red.
const rb = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };

function acct(total: bigint, size = 0n, over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    account: "0x00000000000000000000000000000000000000a1",
    equityOk: true,
    equity: total,
    lockedCollateral: 0n,
    totalEquity: total,
    activePools: size === 0n ? [] : [POOL],
    size,
    ...over,
  };
}
const at = (dt: bigint, markOk = true): MarketView => ({ timestamp: T0 + dt, markOk, markPrice: 74_500n * E18 });
const fresh = (): RunState => initRunState(T0, 1_000n * E18);

describe("evaluate (Tokyo Sprint · Demo: +0.5% / -0.5% daily / -0.75% trailing / 15x / 60 s / 900 s)", () => {
  it("pauses on an unpriceable account or mark", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18, 0n, { equityOk: false }), at(1n)).verdict).toEqual({ kind: "pause", reason: "unpriceable" });
    expect(evaluate(rb, fresh(), acct(1_000n * E18), at(1n, false)).verdict).toEqual({ kind: "pause", reason: "unpriceable" });
  });
  it("voids on a position in another market", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18, 0n, { activePools: [OTHER] }), at(1n)).verdict).toEqual({
      kind: "void",
      reason: "ForeignMarket",
    });
  });
  it("is ok at the start", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18), at(1n)).verdict).toEqual({ kind: "ok" });
  });
  it("reaches the target only after the minimum time", () => {
    expect(evaluate(rb, fresh(), acct(1_005n * E18), at(59n)).verdict).toEqual({ kind: "ok" });
    expect(evaluate(rb, fresh(), acct(1_005n * E18), at(60n)).verdict).toEqual({ kind: "target" });
  });
  it("fails the daily-loss floor", () => {
    expect(evaluate(rb, fresh(), acct(995n * E18), at(5n)).verdict).toEqual({ kind: "fail", rule: "DailyLoss" });
  });
  it("fails the trailing drawdown from the high-water mark", () => {
    const up = evaluate(rb, fresh(), acct(1_004n * E18), at(5n));
    expect(up.state.hwm).toBe(1_004n * E18);
    expect(evaluate(rb, up.state, acct(9_964n * 10n ** 17n), at(6n)).verdict).toEqual({ kind: "fail", rule: "TrailingDrawdown" });
  });
  it("fails the exposure cap and reports exposure", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18, 20_200_000n), at(5n)).verdict).toEqual({ kind: "fail", rule: "MaxExposure" });
    expect(evaluate(rb, fresh(), acct(1_000n * E18, 16_107_000n), at(5n)).exposureX).toBe(11.99);
  });
  it("fails the time limit on the chain clock", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18), at(900n)).verdict).toEqual({ kind: "ok" });
    expect(evaluate(rb, fresh(), acct(1_000n * E18), at(901n)).verdict).toEqual({ kind: "fail", rule: "TimeLimit" });
  });
  it("resets the daily start equity on a new UTC day", () => {
    const loose = { ...rb, trailingDrawdownBps: 5_000, timeLimitSec: 200_000 };
    const nextDay = evaluate(loose, fresh(), acct(990n * E18), at(86_400n + 10n));
    expect(nextDay.verdict).toEqual({ kind: "ok" });
    expect(nextDay.state.dayStart).toBe(990n * E18);
    expect(evaluate(loose, nextDay.state, acct(985n * E18), at(86_400n + 20n)).verdict).toEqual({ kind: "fail", rule: "DailyLoss" });
  });
  it("computes notional from signed size", () => {
    expect(notional(-16_107_000n, 74_500n * E18, 8)).toBe((16_107_000n * 74_500n * E18) / 100_000_000n);
  });
});
