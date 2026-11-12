import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { iocPrice, type AccountSnapshot } from "@basanos/core";
import { closeableEquity, type BookSides } from "@basanos/core/book";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { Ticket } from "../src/components/Ticket";
import { BTC_BOOK_PARAMS, judgedNow, ticketOrder } from "../src/lib/order";

const E18 = 10n ** 18n;
const MARK = 72_800n * E18;
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
// The measured book (guide, 2026-11-12): best bid +19 bps and best ask +21 bps above the mark.
const BOOK: BookSides = { bids: [{ price: px(19), quantity: 1_373_000n }], asks: [{ price: px(21), quantity: 1_373_000n }] };
const acct = (total: bigint, size: bigint, equityOk = true): AccountSnapshot => ({
  account: "0x00000000000000000000000000000000000000a1",
  equityOk,
  equity: total,
  lockedCollateral: 0n,
  totalEquity: total,
  activePools: [],
  size,
});

describe("the terminal's market order (P5)", () => {
  it("caps the IOC from the book, 20 bps past the best opposite level, never from the mark", () => {
    expect(ticketOrder(true, 342_000n, BOOK)).toEqual({ isBid: true, quantity: 342_000n, price: iocPrice(true, px(21), BTC_BOOK_PARAMS.tickSize, 20) });
    expect(ticketOrder(false, 342_000n, BOOK).price).toBe(iocPrice(false, px(19), BTC_BOOK_PARAMS.tickSize, 20));
    expect(() => ticketOrder(true, 342_000n, null)).toThrow(/book could not be read/);
  });
  it("shows the equity the referee judges: closeable when holding, marked when flat", () => {
    expect(judgedNow(acct(50n * E18, 0n), MARK, null)).toBe(50n * E18);
    expect(judgedNow(acct(50n * E18, 342_000n), MARK, BOOK)).toBe(closeableEquity(50n * E18, 342_000n, MARK, BOOK, 8));
    expect(judgedNow(acct(50n * E18, 342_000n), MARK, null)).toBeNull();
    expect(judgedNow(acct(50n * E18, 0n, false), MARK, BOOK)).toBeNull();
    expect(judgedNow(undefined, MARK, BOOK)).toBeNull();
  });
  it("opens the ticket at the demo leverage", () => {
    const onOrder = vi.fn();
    render(<Ticket equity={1_000n * E18} mark={74_500n * E18} busy={false} defaultLeverage={DEMO_LEVERAGE_X} onOrder={onOrder} />);
    fireEvent.click(screen.getByRole("button", { name: "Buy / long" }));
    expect(onOrder).toHaveBeenCalledWith(true, 13_422_000n);
  });
});
