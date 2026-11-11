import { describe, expect, it } from "vitest";
import { clearsTarget, predictClosedEquity } from "../src/lock";

const E18 = 10n ** 18n;
const quote = (isBid: boolean, avg: bigint | null, fill = 16_107_000n) => ({
  priceable: true as const,
  isBid,
  quantity: 16_107_000n,
  referencePrice: 74_500n * E18,
  averagePrice: avg,
  fillableSize: fill,
});

describe("predictClosedEquity", () => {
  it("charges the close's distance from the mark", () => {
    expect(predictClosedEquity(1_006n * E18, quote(false, 74_496n * E18), 8)).toBe(1_006n * E18 - (4n * E18 * 16_107_000n) / 100_000_000n);
    expect(predictClosedEquity(1_006n * E18, quote(true, 74_504n * E18), 8)).toBe(1_006n * E18 - (4n * E18 * 16_107_000n) / 100_000_000n);
  });
  it("refuses an unpriceable or unfillable close", () => {
    expect(predictClosedEquity(1_006n * E18, { priceable: false }, 8)).toBeNull();
    expect(predictClosedEquity(1_006n * E18, quote(false, null), 8)).toBeNull();
    expect(predictClosedEquity(1_006n * E18, quote(false, 74_496n * E18, 1_000n), 8)).toBeNull();
  });
});

describe("clearsTarget", () => {
  it("compares the predicted closed equity with the target", () => {
    expect(clearsTarget(1_005n * E18, 1_000n * E18, 50)).toBe(true);
    expect(clearsTarget(1_004n * E18, 1_000n * E18, 50)).toBe(false);
    expect(clearsTarget(null, 1_000n * E18, 50)).toBe(false);
  });
});
