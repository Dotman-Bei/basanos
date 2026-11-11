import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionResult, type Address, type Hex } from "viem";
import { marginBankAbi, multicall3Abi, perpPoolAbi } from "../src/abi";
import { BTC_POOL, MULTICALL3 } from "../src/config";
import { decodeSnapshot, snapshotCall } from "../src/snapshot";

const A: Address = "0x00000000000000000000000000000000000000a1";
const B: Address = "0x00000000000000000000000000000000000000b2";

function ok(data: Hex) {
  return { success: true, returnData: data };
}

describe("snapshot", () => {
  it("batches block, timestamp, mark and three reads per account", () => {
    const call = snapshotCall([A, B], BTC_POOL);
    expect(call.to).toBe(MULTICALL3);
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
    expect(decoded.functionName).toBe("aggregate3");
    expect((decoded.args[0] as readonly unknown[]).length).toBe(3 + 2 * 3);
  });

  it("decodes equity, locked collateral, pools and size; a failed sub-call marks the account unpriceable", () => {
    const rows = [
      ok(encodeFunctionResult({ abi: multicall3Abi, functionName: "getBlockNumber", result: 46_725_618n })),
      ok(encodeFunctionResult({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp", result: 1_794_326_598n })),
      ok(encodeFunctionResult({ abi: perpPoolAbi, functionName: "tryGetMarkPrice", result: [true, 74_500n * 10n ** 18n] })),
      ok(encodeFunctionResult({ abi: marginBankAbi, functionName: "tryGetAccountEquity", result: [true, 990n * 10n ** 18n] })),
      ok(
        encodeFunctionResult({
          abi: marginBankAbi,
          functionName: "getAccountState",
          result: { unlockedCollateralBalance: 980n * 10n ** 18n, lockedCollateral: 10n * 10n ** 18n, activePerpPools: [BTC_POOL] },
        }),
      ),
      ok(
        encodeFunctionResult({
          abi: marginBankAbi,
          functionName: "getPosition",
          result: { size: -13_000n, avgEntryPrice: 74_000n * 10n ** 18n, entryFundingIndex: 0n, lastUpdatedTimestampNs: 1n },
        }),
      ),
      { success: false, returnData: "0x" as Hex },
      ok(
        encodeFunctionResult({
          abi: marginBankAbi,
          functionName: "getAccountState",
          result: { unlockedCollateralBalance: 0n, lockedCollateral: 0n, activePerpPools: [] },
        }),
      ),
      ok(
        encodeFunctionResult({
          abi: marginBankAbi,
          functionName: "getPosition",
          result: { size: 0n, avgEntryPrice: 0n, entryFundingIndex: 0n, lastUpdatedTimestampNs: 0n },
        }),
      ),
    ];
    const result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: rows });
    const snap = decodeSnapshot(result, [A, B], BTC_POOL);
    expect(snap.blockNumber).toBe(46_725_618n);
    expect(snap.timestamp).toBe(1_794_326_598n);
    expect(snap.markOk).toBe(true);
    expect(snap.markPrice).toBe(74_500n * 10n ** 18n);
    const [a, b] = snap.accounts;
    expect(a?.equityOk).toBe(true);
    expect(a?.totalEquity).toBe(1000n * 10n ** 18n);
    expect(a?.lockedCollateral).toBe(10n * 10n ** 18n);
    expect(a?.activePools).toEqual([BTC_POOL]);
    expect(a?.size).toBe(-13_000n);
    expect(b?.equityOk).toBe(false);
    expect(b?.totalEquity).toBe(0n);
  });

  it("rejects a result with the wrong number of rows", () => {
    const result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: [] });
    expect(() => decodeSnapshot(result, [A], BTC_POOL)).toThrow(/expected 6 rows/);
  });
});
