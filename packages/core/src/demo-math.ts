import type { Address } from "viem";
import { quantityForLeverage } from "./close";
import { evaluate, initRunState, type FailRule } from "./evaluate";
import type { Rulebook } from "./rulebook";
import type { AccountSnapshot } from "./snapshot";

export interface TapePoint {
  block: bigint;
  ts: bigint;
  mark: bigint;
}

/** Tape JSON (bigints as strings); millisecond timestamps are converted to seconds. */
export function parseTape(raw: unknown): TapePoint[] {
  const points = ((raw as { points?: unknown[] }).points ?? []) as { block: string; ts: string; mark: string }[];
  return points.map((p) => {
    const ts = BigInt(p.ts);
    return { block: BigInt(p.block), ts: ts > 10_000_000_000n ? ts / 1000n : ts, mark: BigInt(p.mark) };
  });
}

export interface SimOptions {
  leverageX: number;
  startEquity: bigint;
  lotSize: bigint;
  entryCostBps: number;
  exitCostBps: number;
}

export interface SimSide {
  side: "long" | "short";
  outcome: "target" | "fail" | "unresolved";
  rule: FailRule | null;
  atTs: bigint | null;
}

const ACCOUNT: Address = "0x000000000000000000000000000000000000dEaD";

function simulateSide(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions, qty: bigint, sign: 1n | -1n): SimSide {
  const side = sign === 1n ? "long" : "short";
  const first = tape[0];
  if (!first) return { side, outcome: "unresolved", rule: null, atTs: null };
  const oneBase = 10n ** BigInt(rb.market.baseDecimals);
  const entryNotional = (qty * first.mark) / oneBase;
  const entryCost = (entryNotional * BigInt(Math.round(o.entryCostBps * 100))) / 1_000_000n;
  let state = initRunState(first.ts, o.startEquity);
  for (const p of tape) {
    const pnl = (sign * qty * (p.mark - first.mark)) / oneBase;
    const total = o.startEquity - entryCost + pnl;
    const acct: AccountSnapshot = {
      account: ACCOUNT,
      equityOk: true,
      equity: total,
      lockedCollateral: 0n,
      totalEquity: total,
      activePools: [rb.market.pool],
      size: sign * qty,
    };
    const ev = evaluate(rb, state, acct, { timestamp: p.ts, markOk: true, markPrice: p.mark });
    state = ev.state;
    if (ev.verdict.kind === "fail") return { side, outcome: "fail", rule: ev.verdict.rule, atTs: p.ts };
    if (ev.verdict.kind === "target") {
      const exitCost = (((qty * p.mark) / oneBase) * BigInt(Math.round(o.exitCostBps * 100))) / 1_000_000n;
      const lockedEquity = total - exitCost;
      if (lockedEquity * 10_000n >= o.startEquity * BigInt(10_000 + rb.profitTargetBps)) {
        return { side, outcome: "target", rule: null, atTs: p.ts };
      }
    }
  }
  return { side, outcome: "unresolved", rule: null, atTs: null };
}

/** Two opposite accounts opened at the first tape point, judged by the real evaluator; a pass counts only once the lock's close cost still clears the target. */
export function simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint } {
  const first = tape[0];
  const quantity = first
    ? quantityForLeverage(o.startEquity, o.leverageX, first.mark, rb.market.baseDecimals, { tickSize: 1n, minQuantity: 0n, lotSize: o.lotSize })
    : 0n;
  return { long: simulateSide(rb, tape, o, quantity, 1n), short: simulateSide(rb, tape, o, quantity, -1n), quantity };
}

/** Fill cost against the mark, in bps of notional (positive = worse than the mark). */
export function costBpsVsMark(isBid: boolean, reference: bigint, average: bigint): number {
  const diff = isBid ? average - reference : reference - average;
  return Number((diff * 1_000_000n) / reference) / 100;
}

/** A round trip (entry + lock close) costs 2 x one-way notional bps x leverage in equity bps. */
export function roundTripEquityBps(oneWayCostBps: number, leverageX: number): number {
  return 2 * oneWayCostBps * leverageX;
}

/** Spec §5: the round trip may use at most half the demo target; never below the registered 50 bps. */
export function recommendDemoTargetBps(roundTripEqBps: number): number {
  return Math.max(50, Math.ceil((2 * roundTripEqBps) / 25) * 25);
}

/** Demo leverage (architect ruling P5, 2026-11-12). Rules judge closeable equity, so opening costs the spread x
 *  leverage at once: at most about 18 bps of equity at 5x on the measured 0.2-3.6 bps spread, inside the demo's 50 bps
 *  daily-loss floor. At 12x a 4.2 bps spread alone would breach it. */
export const DEMO_LEVERAGE_X = 5;

/** What a closeable-equity run pays at entry, in bps of notional: buying at the ask side and being valued at the bid
 *  side (or the reverse). The demo-cost input since P5; costBpsVsMark measured the mark-to-book basis instead. */
export function roundTripSpreadBps(buyAverage: bigint, sellAverage: bigint): number {
  const mid = (buyAverage + sellAverage) / 2n;
  if (mid <= 0n) throw new Error("roundTripSpreadBps: prices must be positive");
  return Number(((buyAverage - sellAverage) * 1_000_000n) / mid) / 100;
}
