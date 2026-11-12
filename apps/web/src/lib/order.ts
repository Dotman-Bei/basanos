import type { AccountSnapshot, BookParams, OrderPlan } from "@basanos/core";
import { closeableEquity, planOpenFromBook, type BookSides } from "@basanos/core/book";

/** BTC-PERP order-book parameters (getOrderBookParameters, read 2026-11-10). */
export const BTC_BOOK_PARAMS: BookParams = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };

/** The ticket's market order: an IOC capped from the book (best ask + 20 bps to buy, best bid - 20 bps to sell), never
 *  from the mark, which sat about 19 bps below the whole book on 2026-11-12 (P5). */
export function ticketOrder(isBid: boolean, quantity: bigint, book: BookSides | null): OrderPlan {
  if (!book) throw new Error("the BTC-PERP book could not be read; try again");
  return planOpenFromBook(isBid, quantity, book, BTC_BOOK_PARAMS);
}

/** The equity the referee judges now (spec §5): closeable equity, which is the marked equity when flat; null when the
 *  account is unpriceable or the book is not known yet. */
export function judgedNow(acct: AccountSnapshot | undefined, mark: bigint, book: BookSides | null): bigint | null {
  if (!acct?.equityOk) return null;
  if (acct.size === 0n) return acct.totalEquity;
  return book ? closeableEquity(acct.totalEquity, acct.size, mark, book, 8) : null;
}
