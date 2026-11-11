import { describe, expect, it } from "vitest";
import { compareReads, type StoredRead } from "../src/lib/replay";

const E18 = 10n ** 18n;
const stored: StoredRead = {
  blockNumber: 100n,
  equityOk: true,
  equity: 1_000n * E18,
  lockedCollateral: 0n,
  positionSize: -16_107_000n,
  markOk: true,
  markPrice: 74_500n * E18,
};

describe("compareReads", () => {
  it("marks exact and within-tolerance matches", () => {
    const rows = compareReads(stored, { ...stored, equity: 1_000n * E18 + 5n * 10n ** 17n });
    expect(rows.map((r) => [r.field, r.match])).toEqual([
      ["equity", "within-tolerance"],
      ["lockedCollateral", "exact"],
      ["positionSize", "exact"],
      ["markPrice", "exact"],
    ]);
  });
  it("flags a real difference and an unserved block", () => {
    expect(compareReads(stored, { ...stored, positionSize: 0n })[2]?.match).toBe("differs");
    expect(compareReads(stored, { ...stored, equity: 900n * E18 })[0]?.match).toBe("differs");
    expect(compareReads(stored, null).every((r) => r.match === "not-served" && r.chain === null)).toBe(true);
  });
});
