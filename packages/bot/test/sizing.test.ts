import { describe, expect, it } from "vitest";
import { demoEquity, demoSize, minEquityFor, parseUsdso } from "../src/sizing";

const E18 = 10n ** 18n;
// BTC-PERP on 2026-11-11: tick 0.1, minimum 0.00013 BTC (13,000 at 8 decimals), lot 0.00001 BTC.
const book = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };
const mark = 74_000n * E18;

describe("demo sizing from real equity", () => {
  it("reads --equity first, else the smaller funded live equity, else nothing", () => {
    expect(parseUsdso("150")).toBe(150n * E18);
    expect(parseUsdso("150.25")).toBe(150n * E18 + 25n * 10n ** 16n);
    expect(() => parseUsdso("1e3")).toThrow(/USDso/);
    expect(demoEquity("120", [500n * E18])).toBe(120n * E18);
    expect(demoEquity(null, [200n * E18, 150n * E18])).toBe(150n * E18);
    expect(demoEquity(null, [0n, 150n * E18])).toBe(150n * E18);
    expect(demoEquity(null, [0n, 0n])).toBeNull();
  });
  it("sizes 100–200 USDso at 12x far above the 0.00013 BTC minimum", () => {
    const at100 = demoSize(100n * E18, 12, mark, 8, book);
    expect(at100.problem).toBeNull();
    expect(at100.qty).toBe(1_621_000n);
    expect(demoSize(200n * E18, 12, mark, 8, book).qty).toBe(3_243_000n);
  });
  it("refuses a size under the pool minimum and says how much equity is needed", () => {
    expect(minEquityFor(book, 12, mark, 8)).toBe(801_666_666_666_666_667n);
    const tiny = demoSize(E18 / 2n, 12, mark, 8, book);
    expect(tiny.qty < book.minQuantity).toBe(true);
    expect(tiny.problem).toMatch(/below the pool minimum 13000/);
  });
});
