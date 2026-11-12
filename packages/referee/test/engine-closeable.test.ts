import { describe, expect, it } from "vitest";
import { toEventSelector, type Address, type Hex } from "viem";
import type { Snapshot } from "@basanos/core";
import { rulebookId } from "@basanos/core";
import type { BookRead } from "@basanos/core/book";
import { loadRulebook } from "@basanos/core/node";
import { Engine } from "../src/engine";
import type { TrackedRun } from "../src/runs";

const E18 = 10n ** 18n;
const POOL: Address = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const A: Address = "0x00000000000000000000000000000000000000a1";
const T0 = 1_794_326_400n;
const MARK = 72_800n * E18;
const START = 50n * E18;
const QTY = 824_000n; // 12x of 50 USDso at 72,800
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
const demo = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
const run: TrackedRun = { runId: 1n, account: A, rulebookId: rulebookId(demo), rulebook: demo, startTime: T0, startEquity: START, startBlock: 100n };
const POSITION_UPDATED: Hex = toEventSelector("PositionUpdated(address,address,int128,uint128,int256,int256)");

function snap(total: bigint, dt: bigint, size: bigint): Snapshot {
  return {
    blockNumber: 100n + dt,
    timestamp: T0 + dt,
    pool: POOL,
    markOk: true,
    markPrice: MARK,
    accounts: [{ account: A, equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: size === 0n ? [] : [POOL], size }],
  };
}
const book = (dt: bigint): BookRead => ({ blockNumber: 100n + dt, bids: [{ price: px(19), quantity: 1_373_000n }], asks: [{ price: px(21), quantity: 1_373_000n }] });
// A fresh 12x long bought at the ask: marked about -252 bps, closeable about -24 bps (the spread).
const freshLong = START - ((px(21) - MARK) * QTY) / 10n ** 8n;

describe("the referee judges closeable equity (spec §5, P5 ruling)", () => {
  it("keeps a fresh position running when the snapshot comes with its book, and pauses it without one", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onSnapshot(snap(freshLong, 5n, QTY), book(5n))).toEqual([]);
    expect(e.onSnapshot(snap(freshLong, 6n, QTY), null)).toEqual([]);
    expect(e.get(1n)?.phase).toBe("watching");
  });
  it("records the judged equity and its book beside the breach reads", () => {
    const e = new Engine();
    e.track(run);
    const lost = freshLong - (START * 60n) / 10_000n;
    const [action] = e.onSnapshot(snap(lost, 7n, QTY), book(7n));
    expect(action).toMatchObject({ kind: "fail", rule: "DailyLoss" });
    if (action?.kind !== "fail") throw new Error("expected a fail");
    expect(action.breach.equity).toBe(lost);
    expect(action.judged).toEqual({ equity: lost + ((px(19) - MARK) * QTY) / 10n ** 8n, book: book(7n) });
  });
  it("no longer judges a trading log at the mark (it carries no book)", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onAccountLog(A, POSITION_UPDATED, null, snap(freshLong, 5n, QTY))).toEqual([]);
    expect(e.get(1n)?.phase).toBe("watching");
  });
});
