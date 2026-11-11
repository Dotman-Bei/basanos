import { describe, expect, it } from "vitest";
import { alignDown, alignUp, iocPrice, planClose, planOpen, quantityForLeverage, type BookParams } from "../src/close";

const E18 = 10n ** 18n;
const MARK = 74_500n * E18;
const BOOK: BookParams = { tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n };

describe("alignment", () => {
  it("aligns down and up to a step", () => {
    expect(alignDown(12_500n, 1_000n)).toBe(12_000n);
    expect(alignUp(12_500n, 1_000n)).toBe(13_000n);
    expect(alignUp(13_000n, 1_000n)).toBe(13_000n);
    expect(() => alignDown(1n, 0n)).toThrow(/step/);
  });
});

describe("iocPrice", () => {
  it("prices a sell below the mark and a buy above, on the tick", () => {
    expect(iocPrice(false, MARK, BOOK.tickSize, 20)).toBe(74_351n * E18);
    expect(iocPrice(true, MARK, BOOK.tickSize, 20)).toBe(74_649n * E18);
  });
});

describe("planClose", () => {
  it("closes a long with a sell sized to the position", () => {
    expect(planClose(13_000n, MARK, BOOK, 20)).toEqual({ isBid: false, quantity: 13_000n, price: 74_351n * E18 });
  });
  it("closes a short with a buy, lot-aligned down", () => {
    expect(planClose(-12_500n, MARK, BOOK, 20)).toEqual({ isBid: true, quantity: 12_000n, price: 74_649n * E18 });
  });
  it("returns null when flat or below one lot", () => {
    expect(planClose(0n, MARK, BOOK, 20)).toBeNull();
    expect(planClose(500n, MARK, BOOK, 20)).toBeNull();
  });
});

describe("planOpen and sizing", () => {
  it("refuses a quantity below the market minimum", () => {
    expect(() => planOpen(true, 12_000n, MARK, BOOK, 20)).toThrow(/minQuantity/);
  });
  it("sizes 12x on 1,000 USDso at 74,500", () => {
    expect(quantityForLeverage(1_000n * E18, 12, MARK, 8, BOOK)).toBe(16_107_000n);
  });
});
