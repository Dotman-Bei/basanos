import { describe, expect, it } from "vitest";
import { encodeFunctionResult, encodeAbiParameters } from "viem";
import { multicall3Abi } from "../src/abi";
import { BOOK_DEPTH, OPEN_MARGIN_BPS, averageFill, bookCall, closeableEquity, decodeBook, fillableAt, planOpenFromBook, type BookSides } from "../src/book";
import { CLOSE_SLIPPAGE_STEPS_BPS, iocPrice, planClose, planOpen } from "../src/close";
import { BTC_POOL } from "../src/config";

const E18 = 10n ** 18n;
const MARK = 72_800n * E18;
const PARAMS = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };
const at = (bps: number): bigint => (MARK * BigInt(10_000 * 100 + Math.round(bps * 100))) / 1_000_000n;
const levels = (bps: number[], quantity: bigint) => bps.map((b) => ({ price: at(b), quantity }));
// The measured book (guide, 2026-11-12): bids +17..+19 bps and asks +21..+25 bps above the mark, and its mirror image.
const ABOVE: BookSides = { bids: levels([19, 18, 17], 1_373_000n), asks: levels([21, 23, 25], 1_373_000n) };
const BELOW: BookSides = { bids: levels([-21, -23, -25], 1_373_000n), asks: levels([-19, -18, -17], 1_373_000n) };

describe("closeable equity (spec §5, P5 ruling)", () => {
  it("cancels the mark-to-book basis: a 12x long opened at the ask pays the spread, not the basis", () => {
    const start = 50n * E18;
    const qty = 824_000n; // 12x of 50 USDso at 72,800, about 0.00824 BTC
    const ask = ABOVE.asks[0]?.price ?? 0n;
    const marked = start - ((ask - MARK) * qty) / 10n ** 8n;
    const closeable = closeableEquity(marked, qty, MARK, ABOVE, 8);
    const bps = (e: bigint) => Math.round(Number(((e - start) * 1_000_000n) / start) / 100);
    expect(bps(marked)).toBe(-252);
    expect(closeable).not.toBeNull();
    expect(bps(closeable ?? 0n)).toBe(-24);
  });
  it("revalues a long at the bids and a short at the asks, walking the levels", () => {
    const total = 50n * E18;
    const twoLevels = 2_000_000n;
    const long = total + ((at(19) - MARK) * 1_373_000n + (at(18) - MARK) * 627_000n) / 10n ** 8n;
    const short = total - ((at(21) - MARK) * 1_373_000n + (at(23) - MARK) * 627_000n) / 10n ** 8n;
    expect(closeableEquity(total, twoLevels, MARK, ABOVE, 8)).toBe(long);
    expect(closeableEquity(total, -twoLevels, MARK, ABOVE, 8)).toBe(short);
    expect(closeableEquity(total, 0n, MARK, { bids: [], asks: [] }, 8)).toBe(total);
  });
  it("cannot price a close larger than the levels read", () => {
    expect(closeableEquity(50n * E18, 5_000_000n, MARK, ABOVE, 8)).toBeNull();
    expect(closeableEquity(50n * E18, -1_000n, MARK, { bids: ABOVE.bids, asks: [] }, 8)).toBeNull();
  });
});

describe("average fills from one book read", () => {
  it("walks the asks to buy and the bids to sell, and refuses a size the levels cannot fill", () => {
    expect(averageFill(true, 2_000_000n, ABOVE)).toBe((at(21) * 1_373_000n + at(23) * 627_000n) / 2_000_000n);
    expect(averageFill(false, 13_000n, ABOVE)).toBe(at(19));
    expect(averageFill(true, 5_000_000n, ABOVE)).toBeNull();
    expect(averageFill(false, 0n, ABOVE)).toBeNull();
  });
});

describe("opening IOCs are capped from the book", () => {
  it("a mark + 20 bps buy cannot fill a book above the mark; the book-capped buy can", () => {
    const fromMark = planOpen(true, 13_000n, MARK, PARAMS, 20);
    expect(fillableAt(true, fromMark.price, ABOVE)).toBe(0n);
    const fromBook = planOpenFromBook(true, 13_000n, ABOVE, PARAMS);
    expect(fromBook.price).toBe(iocPrice(true, ABOVE.asks[0]?.price ?? 0n, PARAMS.tickSize, OPEN_MARGIN_BPS));
    expect(fillableAt(true, fromBook.price, ABOVE)).toBeGreaterThanOrEqual(13_000n);
    const sell = planOpenFromBook(false, 13_000n, BELOW, PARAMS);
    expect(sell.price % PARAMS.tickSize).toBe(0n);
    expect(fillableAt(false, sell.price, BELOW)).toBeGreaterThanOrEqual(13_000n);
  });
  it("refuses an empty opposite side and a size below the pool minimum", () => {
    expect(() => planOpenFromBook(true, 13_000n, { bids: ABOVE.bids, asks: [] }, PARAMS)).toThrow(/no asks/);
    expect(() => planOpenFromBook(false, 13_000n, { bids: [], asks: ABOVE.asks }, PARAMS)).toThrow(/no bids/);
    expect(() => planOpenFromBook(true, 12_999n, ABOVE, PARAMS)).toThrow(/below minQuantity/);
  });
});

describe("the close ladder (20, 50, 100 bps from the mark) on a book skewed both ways", () => {
  const firstFill = (size: bigint, book: BookSides): number | null => {
    for (const step of CLOSE_SLIPPAGE_STEPS_BPS) {
      const plan = planClose(size, MARK, PARAMS, step);
      if (plan && fillableAt(plan.isBid, plan.price, book) >= plan.quantity) return step;
    }
    return null;
  };
  it("closes both sides within the ladder; the side against the skew needs the 50 bps step", () => {
    expect(firstFill(13_000n, ABOVE)).toBe(20);
    expect(firstFill(-13_000n, ABOVE)).toBe(50);
    expect(firstFill(13_000n, BELOW)).toBe(50);
    expect(firstFill(-13_000n, BELOW)).toBe(20);
  });
});

describe("book reads", () => {
  it("reads the block number and both sides in one Multicall3 call, and decodes them", () => {
    expect(bookCall(BTC_POOL).data.startsWith("0x82ad56cb")).toBe(true);
    expect(BOOK_DEPTH).toBe(20);
    const side = (b: BookSides["bids"]) =>
      encodeAbiParameters([{ type: "tuple[]", components: [{ name: "price", type: "uint256" }, { name: "quantity", type: "uint256" }] }], [b.map((l) => ({ ...l }))]);
    const ok = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [
        { success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [48_306_001n]) },
        { success: true, returnData: side(ABOVE.bids) },
        { success: true, returnData: side(ABOVE.asks) },
      ],
    });
    expect(decodeBook(ok)).toEqual({ blockNumber: 48_306_001n, bids: ABOVE.bids, asks: ABOVE.asks });
    const failed = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [
        { success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [1n]) },
        { success: false, returnData: "0x" },
        { success: true, returnData: side(ABOVE.asks) },
      ],
    });
    expect(decodeBook(failed)).toBeNull();
  });
});
