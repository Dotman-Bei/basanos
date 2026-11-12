// Closeable equity and book-capped opens (spec §5; architect ruling P5, 2026-11-12). The BTC-PERP book trades about
// 19 bps above the on-chain mark (guide measurement, 2026-11-12), so equity marked at the mark misstates what an
// account would hold if it flattened: a long reads low by about the basis x its notional, a short reads high. The
// rules judge closeable equity instead: the marked equity revalued from the mark to the book levels that would fill
// the close (bids for a long, asks for a short), read in the same block. Opening IOCs are capped from the book too,
// since a cap of mark + 20 bps sits below the whole ask side and never fills.
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { multicall3Abi, perpPoolAbi } from "./abi";
import { alignDown, alignUp, planClose, type BookParams, type OrderPlan } from "./close";
import { MULTICALL3 } from "./config";

export interface BookLevel {
  price: bigint;
  quantity: bigint;
}

/** Best level first on each side: bids descending, asks ascending (PerpPool.getBookLevels order). */
export interface BookSides {
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
}

export interface BookRead extends BookSides {
  blockNumber: bigint;
}

/** Levels read per side. 20 levels held 3.3 BTC of bids and 42 BTC of asks on 2026-11-12, against a demo position of
 *  about 0.003 BTC and at most about 0.03 BTC for 40x of a 50 USDso account. */
export const BOOK_DEPTH = 20;

/** How far past the best opposite level an opening IOC may fill. The IOC fills at the book's prices; this only caps
 *  the slippage. */
export const OPEN_MARGIN_BPS = 20;

interface Row {
  success: boolean;
  returnData: Hex;
}

/** One Multicall3 call: the block number and both sides of the book, read in the same block. */
export function bookCall(pool: Address, depth: number = BOOK_DEPTH): { to: Address; data: Hex } {
  const side = (isBid: boolean) => ({
    target: pool,
    allowFailure: true,
    callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "getBookLevels", args: [isBid, BigInt(depth)] }),
  });
  const calls = [
    { target: MULTICALL3, allowFailure: true, callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getBlockNumber" }) },
    side(true),
    side(false),
  ];
  return { to: MULTICALL3, data: encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] }) };
}

/** The decoded book, or null when the block number or either side could not be read. */
export function decodeBook(result: Hex): BookRead | null {
  const rows = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: result }) as readonly Row[];
  const [blockRow, bidRow, askRow] = rows;
  if (!blockRow?.success || !bidRow?.success || !askRow?.success) return null;
  const blockNumber = decodeFunctionResult({ abi: multicall3Abi, functionName: "getBlockNumber", data: blockRow.returnData });
  const levels = (row: Row): BookLevel[] =>
    decodeFunctionResult({ abi: perpPoolAbi, functionName: "getBookLevels", data: row.returnData }).map((l) => ({ price: l.price, quantity: l.quantity }));
  return { blockNumber, bids: levels(bidRow), asks: levels(askRow) };
}

/** Both sides of the book at `blockNumber` (default: latest); null when the read fails. */
export async function readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth: number = BOOK_DEPTH): Promise<BookRead | null> {
  const call = bookCall(pool, depth);
  try {
    const res = await client.call({ to: call.to, data: call.data, ...(blockNumber === undefined ? {} : { blockNumber }) });
    return res.data ? decodeBook(res.data) : null;
  } catch {
    return null;
  }
}

/** The marked equity revalued from the mark to the levels that would fill a close of `size` (signed, raw base units):
 *  a long sells into the bids, a short buys from the asks. Flat returns totalEquity. null when the levels read cannot
 *  fill the whole close (the position cannot be priced from this book). */
export function closeableEquity(totalEquity: bigint, size: bigint, mark: bigint, book: BookSides, baseDecimals: number): bigint | null {
  if (size === 0n) return totalEquity;
  const long = size > 0n;
  let left = long ? size : -size;
  let diff = 0n;
  for (const level of long ? book.bids : book.asks) {
    if (left === 0n) break;
    const q = level.quantity < left ? level.quantity : left;
    diff += (level.price - mark) * q;
    left -= q;
  }
  if (left > 0n) return null;
  const adjust = diff / 10n ** BigInt(baseDecimals);
  return long ? totalEquity + adjust : totalEquity - adjust;
}

/** The average price an IOC of `quantity` would fill at, walking the opposite side (asks for a buy, bids for a sell);
 *  null when the levels read cannot fill it. */
export function averageFill(isBid: boolean, quantity: bigint, book: BookSides): bigint | null {
  if (quantity <= 0n) return null;
  let left = quantity;
  let cost = 0n;
  for (const level of isBid ? book.asks : book.bids) {
    if (left === 0n) break;
    const q = level.quantity < left ? level.quantity : left;
    cost += level.price * q;
    left -= q;
  }
  return left > 0n ? null : cost / quantity;
}

/** Quantity an IOC at `limit` can take from the opposite side: asks at or below a buy limit, bids at or above a sell limit. */
export function fillableAt(isBid: boolean, limit: bigint, book: BookSides): bigint {
  let total = 0n;
  for (const level of isBid ? book.asks : book.bids) {
    if (isBid ? level.price > limit : level.price < limit) break;
    total += level.quantity;
  }
  return total;
}

/** An opening IOC capped from the book: best ask + marginBps (rounded up to the tick) to buy, best bid - marginBps
 *  (rounded down) to sell. Throws when the quantity is below the pool minimum or the opposite side is empty. */
export function planOpenFromBook(isBid: boolean, quantity: bigint, book: BookSides, params: BookParams, marginBps: number = OPEN_MARGIN_BPS): OrderPlan {
  const q = alignDown(quantity, params.lotSize);
  if (q < params.minQuantity) throw new Error(`planOpenFromBook: quantity ${q} is below minQuantity ${params.minQuantity}`);
  const best = (isBid ? book.asks : book.bids)[0];
  if (!best) throw new Error(`planOpenFromBook: the book has no ${isBid ? "asks" : "bids"} to open against`);
  const m = BigInt(marginBps);
  const price = isBid ? alignUp((best.price * (10_000n + m)) / 10_000n, params.tickSize) : alignDown((best.price * (10_000n - m)) / 10_000n, params.tickSize);
  return { isBid, quantity: q, price };
}

/** The IOC that closes `size` (signed), capped from the book like an open (architect P7, 2026-11-12): best ask +
 *  slippageBps to buy back a short, best bid - slippageBps to sell a long, rounded to the tick. The mark ladder
 *  (planClose) stays the fallback: with no book, or no level on the closing side, it is used alone, and otherwise the
 *  more permissive of the two limits wins (higher to buy, lower to sell). An IOC fills at the book's prices, so the cap
 *  only bounds slippage. The rehearsal's first close of a short, a buy at mark + 20 bps, reverted under a book about 19
 *  bps above the mark. */
export function planCloseFromBook(size: bigint, mark: bigint, book: BookSides | null, params: BookParams, slippageBps: number): OrderPlan | null {
  const ladder = planClose(size, mark, params, slippageBps);
  if (!ladder || !book) return ladder;
  const best = (ladder.isBid ? book.asks : book.bids)[0];
  if (!best) return ladder;
  const s = BigInt(slippageBps);
  if (ladder.isBid) {
    const fromBook = alignUp((best.price * (10_000n + s)) / 10_000n, params.tickSize);
    return { ...ladder, price: fromBook > ladder.price ? fromBook : ladder.price };
  }
  const fromBook = alignDown((best.price * (10_000n - s)) / 10_000n, params.tickSize);
  return { ...ladder, price: fromBook < ladder.price ? fromBook : ladder.price };
}
