/** The subset of the SDK's PerpCloseQuote the lock needs (client.quotePerpClose, SDK 0.33.0). */
export type CloseQuoteLike =
  | { priceable: false }
  | { priceable: true; isBid: boolean; quantity: bigint; referencePrice: bigint; averagePrice: bigint | null; fillableSize: bigint };

/** Equity after closing at the quoted average instead of the mark; null if the close cannot be priced or fully filled. */
export function predictClosedEquity(totalEquity: bigint, quote: CloseQuoteLike, baseDecimals: number): bigint | null {
  if (!quote.priceable) return null;
  if (quote.quantity === 0n) return totalEquity;
  if (quote.averagePrice === null || quote.fillableSize < quote.quantity) return null;
  const diff = quote.isBid ? quote.averagePrice - quote.referencePrice : quote.referencePrice - quote.averagePrice;
  return totalEquity - (diff * quote.quantity) / 10n ** BigInt(baseDecimals);
}

export function clearsTarget(predicted: bigint | null, startEquity: bigint, targetBps: number): boolean {
  return predicted !== null && predicted * 10_000n >= startEquity * BigInt(10_000 + targetBps);
}

/** How far past the target closeable equity must be before the referee locks a PASS (architect P7, 2026-11-12). The
 *  lock closes the position and the registry then checks the realized equity against the registered target, so the
 *  move between the verdict and the close must not take it back under. In the replay of 12 hours of history (demo v2
 *  at 10x, closes 3 s after the verdict) a 10 bps buffer kept refused locks under 1% at no cost in PASS odds. It is a
 *  referee execution margin, like close slippage; the rulebook's target is unchanged and stays the registry's check. */
export const LOCK_BUFFER_BPS = 10;

/** Lock from the closeable equity of the push that raised the target (the same block's book), not from a new quote. */
export function lockClears(judged: bigint | null, startEquity: bigint, targetBps: number, bufferBps: number = LOCK_BUFFER_BPS): boolean {
  return clearsTarget(judged, startEquity, targetBps + bufferBps);
}
