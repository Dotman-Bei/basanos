import { describe, expect, it } from "vitest";
import { planOpen } from "@basanos/core";
import { planOpenFromBook, type BookRead } from "@basanos/core/book";
import { entryRecord, openProblem } from "../src/entry";

const E18 = 10n ** 18n;
const MARK = 72_880n * E18;
const PARAMS = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };
const px = (bps: number): bigint => (MARK * BigInt(Math.round(1_000_000 + bps * 100))) / 1_000_000n;
// spike:11's stop (2026-11-12): best ask +22.4 bps and best bid +22.2 bps above the mark.
const BOOK: BookRead = { blockNumber: 48_298_786n, bids: [{ price: px(22.2), quantity: 1_373_000n }], asks: [{ price: px(22.4), quantity: 1_373_000n }] };

describe("the skeleton's opening IOC (P5)", () => {
  it("names why a mark + 20 bps buy cannot fill, and accepts the book-capped buy", () => {
    expect(openProblem(planOpen(true, 13_000n, MARK, PARAMS, 20), BOOK)).toMatch(/can take 0 of 13000 \(best ask .* at block 48298786\)/);
    expect(openProblem(planOpenFromBook(true, 13_000n, BOOK, PARAMS), BOOK)).toBeNull();
    expect(openProblem(planOpenFromBook(true, 13_000n, BOOK, PARAMS), { ...BOOK, asks: [] })).toMatch(/no asks/);
  });
  it("records the fill against the mark, against the book, and the spread", () => {
    const open = planOpenFromBook(true, 13_000n, BOOK, PARAMS);
    const e = entryRecord(open, MARK, 48_298_785n, BOOK, px(22.4));
    expect(e).toMatchObject({ side: "long", quantity: 13_000n, limitPrice: open.price, markBefore: MARK, bookBlock: 48_298_786n, avgEntryPrice: px(22.4) });
    expect(e.costBps).toBe(22.4);
    expect(e.costVsBookBps).toBe(0);
    expect(e.spreadBps).toBe(0.19);
  });
});
