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
}

export interface Evaluation {
  state: RunState;
  verdict: Verdict;
  exposureX: number | null;
}

const DAY = 86_400n;

export function initRunState(startTime: bigint, startEquity: bigint): RunState {
  return { startTime, startEquity, hwm: startEquity, dayStart: startEquity, day: startTime / DAY };
}

export function notional(size: bigint, mark: bigint, baseDecimals: number): bigint {
  const abs = size < 0n ? -size : size;
  return (abs * mark) / 10n ** BigInt(baseDecimals);
}

/** Spec §5, in order: pause, void, state update, time limit, daily loss, trailing drawdown, exposure, target. */
export function evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation {
  if (!acct.equityOk || !market.markOk) return { state, verdict: { kind: "pause", reason: "unpriceable" }, exposureX: null };
  const pool = rb.market.pool.toLowerCase();
  if (acct.activePools.some((p) => p.toLowerCase() !== pool)) {
    return { state, verdict: { kind: "void", reason: "ForeignMarket" }, exposureX: null };
  }
  const total = acct.totalEquity;
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
  return { state: next, verdict, exposureX };
}
