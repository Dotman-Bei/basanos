import { describe, expect, it } from "vitest";
import { encodeFunctionData, toFunctionSelector } from "viem";
import { BTC_POOL, OPERATOR_REGISTRY, VOUCHER_DISTRIBUTOR } from "@basanos/core";
import { claimVoucherCall, grantRefereeCall, placeOrderCall, startRunCall } from "../src/chain/calls";

const REF = "0x00000000000000000000000000000000000000f1";
const REG = "0x00000000000000000000000000000000000000f2";

describe("call builders", () => {
  it("claims the voucher with claim() on the distributor", () => {
    const c = claimVoucherCall();
    expect(c.address).toBe(VOUCHER_DISTRIBUTOR);
    expect(encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args })).toBe(toFunctionSelector("function claim()"));
  });
  it("grants the referee place + cancel on the BTC pool only", () => {
    const c = grantRefereeCall(REF);
    expect(c.address).toBe(OPERATOR_REGISTRY);
    expect(c.functionName).toBe("setOperatorApprovalForPool");
    expect(c.args).toEqual([BTC_POOL, REF, ["0x80054449", "0xe37b444b"], true]);
  });
  it("starts a run as the account itself", () => {
    const c = startRunCall(REG, "0x00000000000000000000000000000000000000a1", `0x${"22".repeat(32)}`);
    expect(c.address).toBe(REG);
    expect(c.args).toEqual(["0x00000000000000000000000000000000000000a1", `0x${"22".repeat(32)}`]);
  });
  it("places an owner order on the BTC pool with 10M gas", () => {
    const c = placeOrderCall(true, 74_649n * 10n ** 18n, 16_107_000n, 2);
    expect(c.address).toBe(BTC_POOL);
    expect(c.gas).toBe(10_000_000n);
    expect(c.functionName).toBe("placeOrder");
    expect(c.args.slice(0, 4)).toEqual([true, 0n, 74_649n * 10n ** 18n, 16_107_000n]);
    expect(c.args.slice(5)).toEqual([2, 0, "0x0000000000000000000000000000000000000000", 0n]);
  });
});
