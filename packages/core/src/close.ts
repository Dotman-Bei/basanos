export interface BookParams {
  tickSize: bigint;
  minQuantity: bigint;
  lotSize: bigint;
}

export interface OrderPlan {
  isBid: boolean;
  quantity: bigint;
  price: bigint;
}

/** The referee widens the IOC price band on each retry (spec §8). */
export const CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100] as const;

export function alignDown(x: bigint, step: bigint): bigint {
  if (step <= 0n) throw new Error("alignDown: step must be positive");
  return x - (x % step);
}

export function alignUp(x: bigint, step: bigint): bigint {
  if (step <= 0n) throw new Error("alignUp: step must be positive");
  const r = x % step;
  return r === 0n ? x : x + (step - r);
}

/** An IOC limit price "through the book with slippage room": above the mark to buy, below to sell. */
export function iocPrice(isBid: boolean, mark: bigint, tickSize: bigint, slippageBps: number): bigint {
  if (mark <= 0n) throw new Error("iocPrice: mark must be positive");
  const s = BigInt(slippageBps);
  return isBid ? alignUp((mark * (10_000n + s)) / 10_000n, tickSize) : alignDown((mark * (10_000n - s)) / 10_000n, tickSize);
}

/** The opposite-side IOC that closes `size` (signed, raw base units). There is no reduce-only flag. */
export function planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null {
  if (size === 0n) return null;
  const abs = size < 0n ? -size : size;
  const quantity = alignDown(abs, book.lotSize);
  if (quantity === 0n) return null;
  const isBid = size < 0n;
  return { isBid, quantity, price: iocPrice(isBid, mark, book.tickSize, slippageBps) };
}

export function planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan {
  const q = alignDown(quantity, book.lotSize);
  if (q < book.minQuantity) throw new Error(`planOpen: quantity ${q} is below minQuantity ${book.minQuantity}`);
  return { isBid, quantity: q, price: iocPrice(isBid, mark, book.tickSize, slippageBps) };
}

/** Base quantity whose notional is `leverageX` times `equity` (both 18-decimal quote units). */
export function quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint {
  if (mark <= 0n) throw new Error("quantityForLeverage: mark must be positive");
  const notional = equity * BigInt(leverageX);
  return alignDown((notional * 10n ** BigInt(baseDecimals)) / mark, book.lotSize);
}
