import { describe, expect, it } from "vitest";
import { encodeFunctionData, toFunctionSelector, zeroAddress } from "viem";
import {
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  MARGIN_BANK,
  OPERATOR_REGISTRY,
  PLACE_ORDER_FOR_SELECTOR,
  REDUCE_ORDER_FOR_SELECTOR,
  explorerTx,
  farFutureNs,
} from "../src/config";
import { multicall3Abi, perpPoolAbi } from "../src/abi";

describe("config", () => {
  it("targets Hideki testnet", () => {
    expect(CHAIN.id).toBe(50383);
  });
  it("operator selectors match their function signatures", () => {
    expect(
      toFunctionSelector(
        "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
      ),
    ).toBe(PLACE_ORDER_FOR_SELECTOR);
    expect(toFunctionSelector("function cancelOrderFor(address owner, uint128 orderId)")).toBe(CANCEL_ORDER_FOR_SELECTOR);
    expect(toFunctionSelector("function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining)")).toBe(
      REDUCE_ORDER_FOR_SELECTOR,
    );
  });
  it("adds the operator registry the SDK constants omit", () => {
    expect(HIDEKI_ADDRESSES.operatorPermissionsRegistry).toBe(OPERATOR_REGISTRY);
    expect(HIDEKI_ADDRESSES.marginBank?.toLowerCase()).toBe(MARGIN_BANK.toLowerCase());
  });
  it("puts the far-future expiry fifty years out, in nanoseconds", () => {
    expect(farFutureNs(0)).toBe(50n * 365n * 86_400n * 1_000_000_000n);
  });
  it("builds Tokyo explorer links", () => {
    expect(explorerTx("0xabc")).toBe("https://explorer.testnet.somnia.network/tokyo/tx/0xabc");
  });
  it("encodes the ABIs it declares", () => {
    const cancel = encodeFunctionData({ abi: perpPoolAbi, functionName: "cancelOrderFor", args: [zeroAddress, 5n] });
    expect(cancel.slice(0, 10)).toBe(CANCEL_ORDER_FOR_SELECTOR);
    const block = encodeFunctionData({ abi: multicall3Abi, functionName: "getBlockNumber" });
    expect(block).toBe(toFunctionSelector("function getBlockNumber()"));
  });
});
