import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, zeroAddress } from "viem";
import { perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  operatorRegistryAbi,
  priceOracleAbi,
} from "@basanos/core";
import {
  ORACLE_STATUS,
  decodeOraclePrices,
  grantCall,
  isFlat,
  ownerOrderCall,
  ownerTx,
  parseSendPath,
  sumCosts,
  txRecord,
} from "../src/live-lib";

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

describe("owner-side writes on the viem path", () => {
  it("encodes the raw placeOrder exactly as the SDK's perpPoolWriteAbi does", () => {
    const price = 66_000n * 10n ** 18n;
    const expiry = 3_371_163_205_000_000_000n;
    const c = ownerOrderCall(BTC_POOL, true, price, 13_000n, ORDER_TYPE_LIMIT, expiry);
    expect(c.to).toBe(BTC_POOL);
    expect(c.value).toBe(0n);
    expect(c.data.slice(0, 10)).toBe("0x4e978373");
    expect(c.data).toBe(
      encodeFunctionData({
        abi: perpPoolWriteAbi,
        functionName: "placeOrder",
        args: [true, 0n, price, 13_000n, expiry, ORDER_TYPE_LIMIT, 0, zeroAddress, 0n],
      }),
    );
  });
  it("grants the referee place and cancel on one pool through the registry", () => {
    const referee = "0xE358D82209ea9360F411A041C0200adc385877eb";
    const c = grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR]);
    expect(c.to).toBe(OPERATOR_REGISTRY);
    expect(c.data.slice(0, 10)).toBe("0x7bbc67e6");
    const d = decodeFunctionData({ abi: operatorRegistryAbi, data: c.data });
    expect(d.functionName).toBe("setOperatorApprovalForPool");
    expect(d.args).toEqual([BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR], true]);
  });
  it("signs with ORDER_GAS and an explicit nonce, and keeps the SDK send opt-in", () => {
    expect(ownerTx({ to: BTC_POOL, data: "0x4e978373", value: 0n }, 7, ORDER_GAS)).toEqual({
      to: BTC_POOL,
      data: "0x4e978373",
      value: 0n,
      gas: 10_000_000n,
      nonce: 7,
    });
    expect(parseSendPath(["node", "skeleton-close.ts"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--dry-run"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--sdk-send"])).toBe("sdk");
  });
});
