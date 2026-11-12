// The skeleton's opening IOC is capped from the book, not the mark (architect ruling P5, 2026-11-12): the BTC-PERP book
// trades about 19 bps above the on-chain mark, so a mark + 20 bps buy cannot fill (spike:11 stopped on exactly that).
import type { OrderPlan } from "@basanos/core";
import { fillableAt, type BookRead } from "@basanos/core/book";

/** (a - b) / b in bps, two decimals; null when b is zero. */
function bpsOver(a: bigint, b: bigint): number | null {
  return b === 0n ? null : Number(((a - b) * 1_000_000n) / b) / 100;
}

/** Why the planned opening IOC cannot fill this book, or null when the levels inside its cap cover the quantity. */
export function openProblem(plan: OrderPlan, levels: BookRead): string | null {
  const best = (plan.isBid ? levels.asks : levels.bids)[0];
  if (!best) return `the book has no ${plan.isBid ? "asks" : "bids"} at block ${levels.blockNumber}`;
  const fillable = fillableAt(plan.isBid, plan.price, levels);
  if (fillable >= plan.quantity) return null;
  return `the opening IOC capped at ${plan.price} can take ${fillable} of ${plan.quantity} (best ${plan.isBid ? "ask" : "bid"} ${best.price} at block ${levels.blockNumber})`;
}

export interface EntryRecord {
  side: "long" | "short";
  quantity: bigint;
  limitPrice: bigint;
  markBefore: bigint;
  markBlock: bigint;
  bookBlock: bigint;
  bestBidBefore: bigint;
  bestAskBefore: bigint;
  avgEntryPrice: bigint;
  /** Fill vs the mark (positive = worse). Since P5 this is the mark-to-book basis (about +19 bps on 2026-11-12), not
   *  a cost: the rules judge closeable equity. */
  costBps: number;
  /** Fill vs the best opposite level before the open (positive = worse): slippage past the top of the book. */
  costVsBookBps: number | null;
  /** Best ask over best bid before the open: what closeable equity charges at entry, in bps of notional. */
  spreadBps: number | null;
}

/** The entry evidence: the fill against the mark, against the book and the spread, all read before the open. */
export function entryRecord(plan: OrderPlan, mark: bigint, markBlock: bigint, levels: BookRead, avgEntryPrice: bigint): EntryRecord {
  const bid = levels.bids[0]?.price ?? 0n;
  const ask = levels.asks[0]?.price ?? 0n;
  const vsMark = plan.isBid ? bpsOver(avgEntryPrice, mark) : bpsOver(mark, avgEntryPrice);
  return {
    side: plan.isBid ? "long" : "short",
    quantity: plan.quantity,
    limitPrice: plan.price,
    markBefore: mark,
    markBlock,
    bookBlock: levels.blockNumber,
    bestBidBefore: bid,
    bestAskBefore: ask,
    avgEntryPrice,
    costBps: vsMark ?? 0,
    costVsBookBps: plan.isBid ? bpsOver(avgEntryPrice, ask) : bid === 0n ? null : bpsOver(bid, avgEntryPrice),
    spreadBps: bid === 0n ? null : bpsOver(ask, bid),
  };
}
