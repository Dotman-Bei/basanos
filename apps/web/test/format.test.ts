import { describe, expect, it } from "vitest";
import { formatBps, formatUsdso, shortHash } from "../src/lib/format";

describe("format", () => {
  it("formats 18-decimal USDso with two decimals and separators", () => {
    expect(formatUsdso(1_005_123_456_789_000_000_000n)).toBe("1,005.12");
    expect(formatUsdso(-994_500_000_000_000_000_000n)).toBe("-994.50");
    expect(formatUsdso(0n)).toBe("0.00");
  });
  it("formats bps as a signed percentage", () => {
    expect(formatBps(50)).toBe("+0.50%");
    expect(formatBps(-75)).toBe("-0.75%");
  });
  it("shortens hashes", () => {
    expect(shortHash(`0x${"ab".repeat(32)}`)).toBe("0xabab…abab");
  });
});
