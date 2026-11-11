import { describe, expect, it } from "vitest";
import { toEventSelector, type Address, type Hex } from "viem";
import type { AccountSnapshot, Snapshot } from "@basanos/core";
import { rulebookId } from "@basanos/core";
import { loadRulebook } from "@basanos/core/node";
import { Engine } from "../src/engine";
import type { TrackedRun } from "../src/runs";

const E18 = 10n ** 18n;
const POOL: Address = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const A: Address = "0x00000000000000000000000000000000000000a1";
const T0 = 1_794_326_400n;
// Thresholds pinned to the registered Tokyo Sprint · Demo values, so a raised demo target (referee Task 10 Step 1) never turns this test red.
const demo = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
const run: TrackedRun = { runId: 1n, account: A, rulebookId: rulebookId(demo), rulebook: demo, startTime: T0, startEquity: 1_000n * E18, startBlock: 100n };

function snap(total: bigint, dt: bigint, size = 0n, over: Partial<AccountSnapshot> = {}): Snapshot {
  return {
    blockNumber: 100n + dt,
    timestamp: T0 + dt,
    pool: POOL,
    markOk: true,
    markPrice: 74_500n * E18,
    accounts: [
      { account: A, equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: size === 0n ? [] : [POOL], size, ...over },
    ],
  };
}
const POSITION_UPDATED: Hex = toEventSelector("PositionUpdated(address,address,int128,uint128,int256,int256)");
const DEPOSITED: Hex = toEventSelector("Deposited(address,uint256)");
const CLOSE_OUT: Hex = toEventSelector("CloseOutMarginSettled(address,address,uint256)");

describe("Engine", () => {
  it("issues one lock at the target and waits until released", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onSnapshot(snap(1_005n * E18, 61n))).toEqual([{ kind: "lock", runId: 1n, account: A }]);
    expect(e.get(1n)?.phase).toBe("acting");
    expect(e.onSnapshot(snap(1_006n * E18, 62n))).toEqual([]);
    e.release(1n);
    expect(e.onSnapshot(snap(1_006n * E18, 63n))).toHaveLength(1);
  });

  it("issues a fail with the breach reads", () => {
    const e = new Engine();
    e.track(run);
    const [action] = e.onSnapshot(snap(994n * E18, 30n, -16_107_000n));
    expect(action).toMatchObject({ kind: "fail", runId: 1n, rule: "DailyLoss" });
    if (action?.kind !== "fail") throw new Error("expected a fail");
    expect(action.breach).toEqual({
      blockNumber: 130n,
      equityOk: true,
      equity: 994n * E18,
      lockedCollateral: 0n,
      positionSize: -16_107_000n,
      markOk: true,
      markPrice: 74_500n * E18,
    });
  });

  it("stays silent while paused and judges again after resume", () => {
    const e = new Engine();
    e.track(run);
    e.pause();
    expect(e.paused).toBe(true);
    expect(e.onSnapshot(snap(990n * E18, 10n))).toEqual([]);
    e.resume();
    expect(e.onSnapshot(snap(990n * E18, 11n))).toHaveLength(1);
  });

  it("voids on a money flow even while paused, and never on a trading log", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onAccountLog(A, POSITION_UPDATED, null, snap(1_000n * E18, 5n))).toEqual([]);
    e.pause();
    expect(e.onAccountLog(A, DEPOSITED, "0xdead", null)).toEqual([{ kind: "void", runId: 1n, account: A, reason: "Flow", txHash: "0xdead" }]);
  });

  it("fails on a liquidation log", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onAccountLog(A, CLOSE_OUT, null, snap(700n * E18, 5n))[0]).toMatchObject({ kind: "fail", rule: "Liquidated" });
  });

  it("voids a foreign-market position and drops finished or vanished runs", () => {
    const e = new Engine();
    e.track(run);
    e.track({ ...run, runId: 2n, account: "0x00000000000000000000000000000000000000b2" });
    expect(e.onSnapshot(snap(1_000n * E18, 5n, 0n, { activePools: ["0x00000000000000000000000000000000000000aa"] }))).toEqual([
      { kind: "void", runId: 1n, account: A, reason: "ForeignMarket", txHash: null },
    ]);
    e.finish(1n);
    expect(e.watchedAccounts()).toEqual(["0x00000000000000000000000000000000000000b2"]);
    expect(e.retain([2n])).toEqual([2n]);
    expect(e.retain([])).toEqual([]);
    expect(e.watchedAccounts()).toEqual([]);
  });
});
