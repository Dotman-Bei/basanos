// Demo sizing from real equity (guide, 2026-11-11). The demo accounts may hold 100–200 USDso instead of the
// 1,000-USDso voucher, so nothing assumes 1,000, and every size is checked against the pool's minimum order.
import { quantityForLeverage, type BookParams } from "@basanos/core";

const E18 = 10n ** 18n;

/** "150" or "150.25" USDso -> wei (18 decimals). */
export function parseUsdso(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) throw new Error(`not a USDso amount: ${text}`);
  return BigInt(m[1] ?? "0") * E18 + BigInt((m[2] ?? "").padEnd(18, "0"));
}

/** --equity wins; otherwise the smaller live equity of the demo accounts that hold any; null when neither does. */
export function demoEquity(flagValue: string | null, live: readonly bigint[]): bigint | null {
  if (flagValue !== null) return parseUsdso(flagValue);
  const funded = live.filter((e) => e > 0n);
  return funded.length === 0 ? null : funded.reduce((a, b) => (a < b ? a : b));
}

/** The least equity (wei) whose leveraged size reaches the pool minimum. */
export function minEquityFor(book: BookParams, leverageX: number, mark: bigint, baseDecimals: number): bigint {
  const unit = 10n ** BigInt(baseDecimals);
  const minNotional = (book.minQuantity * mark + unit - 1n) / unit;
  return (minNotional + BigInt(leverageX) - 1n) / BigInt(leverageX);
}

/** The demo order size for an equity, or why it cannot trade. */
export function demoSize(
  equity: bigint,
  leverageX: number,
  mark: bigint,
  baseDecimals: number,
  book: BookParams,
): { qty: bigint; problem: string | null } {
  const qty = quantityForLeverage(equity, leverageX, mark, baseDecimals, book);
  if (qty >= book.minQuantity) return { qty, problem: null };
  return {
    qty,
    problem: `the demo size ${qty} is below the pool minimum ${book.minQuantity}; at ${leverageX}x the account needs at least ${minEquityFor(book, leverageX, mark, baseDecimals)} wei of equity`,
  };
}
