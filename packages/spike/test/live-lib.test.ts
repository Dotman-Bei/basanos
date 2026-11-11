import { describe, expect, it } from "vitest";
import { encodeFunctionResult } from "viem";
import { priceOracleAbi } from "@basanos/core";
import { ORACLE_STATUS, decodeOraclePrices, isFlat, sumCosts, txRecord } from "../src/live-lib";

describe("txRecord", () => {
  it("records cost as gasUsed x effectiveGasPrice with an explorer link", () => {
    const r = txRecord("close", { transactionHash: "0xab", status: "success", gasUsed: 3_000_000n, effectiveGasPrice: 6_000_000_000n });
    expect(r.costWei).toBe(18_000_000_000_000_000n);
    expect(r.explorer).toBe("https://explorer.testnet.somnia.network/tokyo/tx/0xab");
    expect(sumCosts([r, r])).toBe(36_000_000_000_000_000n);
  });
});

describe("isFlat", () => {
  it("needs no position, no locked collateral and no active pools", () => {
    const base = { account: "0x1" as const, equityOk: true, equity: 1n, lockedCollateral: 0n, totalEquity: 1n, activePools: [], size: 0n };
    expect(isFlat(base)).toBe(true);
    expect(isFlat({ ...base, size: 1n })).toBe(false);
    expect(isFlat({ ...base, lockedCollateral: 1n })).toBe(false);
    expect(isFlat({ ...base, activePools: ["0x2"] })).toBe(false);
  });
});

describe("oracle decoding", () => {
  it("names statuses in the SomniaAgents enum order", () => {
    expect(ORACLE_STATUS[2]).toBe("Success");
    expect(ORACLE_STATUS[4]).toBe("TimedOut");
  });
  it("pairs each symbol with its median, sources and update time", () => {
    const data = encodeFunctionResult({
      abi: priceOracleAbi,
      functionName: "getPrices",
      result: [[74_500n * 10n ** 18n, 0n], [3, 0], [1_794_326_598_000n, 0n]],
    });
    expect(decodeOraclePrices(data, ["BTC/USDC:PERP", "BTC/USDC"])).toEqual([
      { symbol: "BTC/USDC:PERP", price: 74_500n * 10n ** 18n, numSources: 3, lastUpdated: 1_794_326_598_000n },
      { symbol: "BTC/USDC", price: 0n, numSources: 0, lastUpdated: 0n },
    ]);
  });
});
