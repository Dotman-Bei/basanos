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
