import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { BookSides } from "../src/book";
import { evaluate, initRunState, type MarketView } from "../src/evaluate";
import type { AccountSnapshot } from "../src/snapshot";
import { loadRulebook } from "../src/node";

const E18 = 10n ** 18n;
const POOL: Address = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const OTHER: Address = "0x00000000000000000000000000000000000000aa";
const T0 = 1_794_268_800n; // 2026-11-10 00:00:00 UTC
const MARK = 72_800n * E18;
const START = 50n * E18;
// Thresholds pinned to the registered Tokyo Sprint · Demo values.
const rb = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
// The measured book (guide, 2026-11-12): best bid +19 bps and best ask +21 bps above the mark.
const BOOK: BookSides = { bids: [{ price: px(19), quantity: 1_373_000n }], asks: [{ price: px(21), quantity: 1_373_000n }] };
const QTY = 824_000n; // 12x of 50 USDso at 72,800

function acct(total: bigint, size: bigint, over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return { account: "0x00000000000000000000000000000000000000a1", equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: size === 0n ? [] : [POOL], size, ...over };
}
const market = (dt: bigint, book?: BookSides | null): MarketView => ({ timestamp: T0 + dt, markOk: true, markPrice: MARK, ...(book === undefined ? {} : { book }) });
// Marked equity right after opening at the book: a long bought at the ask, a short sold at the bid.
const longMarked = START - ((px(21) - MARK) * QTY) / 10n ** 8n;
const shortMarked = START + ((px(19) - MARK) * QTY) / 10n ** 8n;

describe("rules judge closeable equity (spec §5, P5 ruling 2026-11-12)", () => {
  it("valued at the mark, a fresh 12x long fails daily loss at once and a fresh 12x short shows a phantom target", () => {
    expect(evaluate(rb, initRunState(T0, START), acct(longMarked, QTY), market(5n)).verdict).toEqual({ kind: "fail", rule: "DailyLoss" });
    expect(evaluate(rb, initRunState(T0, START), acct(shortMarked, -QTY), market(61n)).verdict).toEqual({ kind: "target" });
  });
  it("valued at the book, both fresh positions are only the spread down and keep running", () => {
    const long = evaluate(rb, initRunState(T0, START), acct(longMarked, QTY), market(5n, BOOK));
    const short = evaluate(rb, initRunState(T0, START), acct(shortMarked, -QTY), market(61n, BOOK));
    expect(long.verdict).toEqual({ kind: "ok" });
    expect(short.verdict).toEqual({ kind: "ok" });
    const spread = ((px(21) - px(19)) * QTY) / 10n ** 8n;
    expect(long.judgedEquity).toBe(START - spread);
    expect(short.judgedEquity).toBe(START - spread);
    expect(long.state.hwm).toBe(START);
    expect(short.state.hwm).toBe(START);
  });
  it("still fails a real loss and reaches a real target, both measured at the book", () => {
    const down = acct(longMarked - (START * 60n) / 10_000n, QTY);
    expect(evaluate(rb, initRunState(T0, START), down, market(5n, BOOK)).verdict).toEqual({ kind: "fail", rule: "DailyLoss" });
    const up = acct(shortMarked + (START * 80n) / 10_000n, -QTY);
    expect(evaluate(rb, initRunState(T0, START), up, market(61n, BOOK)).verdict).toEqual({ kind: "target" });
  });
  it("pauses an open position when the book read failed or cannot price it; a flat account needs no book", () => {
    const pause = { kind: "pause", reason: "unpriceable" };
    expect(evaluate(rb, initRunState(T0, START), acct(longMarked, QTY), market(5n, null))).toMatchObject({ verdict: pause, judgedEquity: null });
    expect(evaluate(rb, initRunState(T0, START), acct(longMarked, 2_000_000n), market(5n, BOOK)).verdict).toEqual(pause);
    expect(evaluate(rb, initRunState(T0, START), acct(START, 0n), market(5n, null))).toMatchObject({ verdict: { kind: "ok" }, judgedEquity: START });
  });
  it("voids a foreign market before it pauses on the book", () => {
    expect(evaluate(rb, initRunState(T0, START), acct(longMarked, QTY, { activePools: [POOL, OTHER] }), market(5n, null)).verdict).toEqual({ kind: "void", reason: "ForeignMarket" });
  });
});
