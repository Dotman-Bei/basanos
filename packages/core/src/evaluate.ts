import { closeableEquity, type BookSides } from "./book";
import type { Rulebook } from "./rulebook";
import type { AccountSnapshot } from "./snapshot";

export type FailRule = "DailyLoss" | "TrailingDrawdown" | "MaxExposure" | "TimeLimit" | "Liquidated";

export type Verdict =
  | { kind: "ok" }
  | { kind: "pause"; reason: "unpriceable" }
  | { kind: "void"; reason: "ForeignMarket" }
  | { kind: "fail"; rule: FailRule }
  | { kind: "target" };

export interface RunState {
  startTime: bigint;
  startEquity: bigint;
  hwm: bigint;
  dayStart: bigint;
  day: bigint;
}

export interface MarketView {
  timestamp: bigint;
  markOk: boolean;
  markPrice: bigint;
  /** The book in the same block (spec §5: rules judge closeable equity). Omitted: equity is valued at the mark (tape
   *  simulations). null: the book read failed, so an open position cannot be judged and the run pauses. */
  book?: BookSides | null;
}

export interface Evaluation {
  state: RunState;
  verdict: Verdict;
  exposureX: number | null;
  /** The equity the rules judged: closeable equity when a book was given (marked equity when flat or when no book
   *  was given); null on a pause or void. */
  judgedEquity: bigint | null;
}

const DAY = 86_400n;

export function initRunState(startTime: bigint, startEquity: bigint): RunState {
  return { startTime, startEquity, hwm: startEquity, dayStart: startEquity, day: startTime / DAY };
}

export function notional(size: bigint, mark: bigint, baseDecimals: number): bigint {
  const abs = size < 0n ? -size : size;
  return (abs * mark) / 10n ** BigInt(baseDecimals);
}

/** The equity the rules judge (spec §5): the marked equity revalued at the book that would fill a close; the marked
 *  equity itself when flat or when no book was given; null when the book cannot price the position. */
export function equityToJudge(acct: AccountSnapshot, market: MarketView, baseDecimals: number): bigint | null {
  if (market.book === undefined || acct.size === 0n) return acct.totalEquity;
  if (market.book === null) return null;
  return closeableEquity(acct.totalEquity, acct.size, market.markPrice, market.book, baseDecimals);
}

/** Spec §5, in order: pause, void, book pause, state update, time limit, daily loss, trailing drawdown, exposure, target. */
export function evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation {
  const pause: Evaluation = { state, verdict: { kind: "pause", reason: "unpriceable" }, exposureX: null, judgedEquity: null };
  if (!acct.equityOk || !market.markOk) return pause;
  const pool = rb.market.pool.toLowerCase();
  if (acct.activePools.some((p) => p.toLowerCase() !== pool)) {
    return { state, verdict: { kind: "void", reason: "ForeignMarket" }, exposureX: null, judgedEquity: null };
  }
  const total = equityToJudge(acct, market, rb.market.baseDecimals);
  if (total === null) return pause;
  const day = market.timestamp / DAY;
  const next: RunState = {
    ...state,
    hwm: total > state.hwm ? total : state.hwm,
    ...(day !== state.day ? { day, dayStart: total } : {}),
  };
  const n = notional(acct.size, market.markPrice, rb.market.baseDecimals);
  const exposureX = total > 0n ? Number((n * 100n) / total) / 100 : null;
  let verdict: Verdict = { kind: "ok" };
  if (market.timestamp > state.startTime + BigInt(rb.timeLimitSec)) {
    verdict = { kind: "fail", rule: "TimeLimit" };
  } else if (total * 10_000n <= next.dayStart * BigInt(10_000 - rb.dailyLossBps)) {
    verdict = { kind: "fail", rule: "DailyLoss" };
  } else if (total * 10_000n <= next.hwm * BigInt(10_000 - rb.trailingDrawdownBps)) {
    verdict = { kind: "fail", rule: "TrailingDrawdown" };
  } else if (n > total * BigInt(rb.maxExposureX)) {
    verdict = { kind: "fail", rule: "MaxExposure" };
  } else if (
    total * 10_000n >= state.startEquity * BigInt(10_000 + rb.profitTargetBps) &&
    market.timestamp >= state.startTime + BigInt(rb.minDurationSec)
  ) {
    verdict = { kind: "target" };
  }
  return { state: next, verdict, exposureX, judgedEquity: total };
}
