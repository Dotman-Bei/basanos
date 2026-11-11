import { describe, expect, it } from "vitest";
import { ZERO_HASH, failArgs, ruleIndex, voidArgs, voidIndex } from "../src/writer";

const breach = {
  blockNumber: 130n,
  equityOk: true,
  equity: 994n * 10n ** 18n,
  lockedCollateral: 0n,
  positionSize: -16_107_000n,
  markOk: true,
  markPrice: 74_500n * 10n ** 18n,
};

describe("registry argument mapping", () => {
  it("maps rules and void reasons to the contract enums", () => {
    expect(ruleIndex("DailyLoss")).toBe(1);
    expect(ruleIndex("TrailingDrawdown")).toBe(2);
    expect(ruleIndex("MaxExposure")).toBe(3);
    expect(ruleIndex("TimeLimit")).toBe(4);
    expect(ruleIndex("Liquidated")).toBe(5);
    expect(voidIndex("Flow")).toBe(1);
    expect(voidIndex("ForeignMarket")).toBe(2);
  });
  it("builds recordFail and recordVoid arguments in contract order", () => {
    expect(failArgs(9n, "DailyLoss", breach, "0xaa", ["0x01", "0x02"])).toEqual([9n, 1, breach, "0xaa", ["0x01", "0x02"]]);
    expect(voidArgs(9n, "Flow", null, "0xbb")).toEqual([9n, 1, ZERO_HASH, "0xbb"]);
    expect(ZERO_HASH).toBe(`0x${"0".repeat(64)}`);
  });
});
