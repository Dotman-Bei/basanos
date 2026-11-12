import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, type Address } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { SomniaMarkets, operatorRegistryWriteAbi } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  INDEXER_URL,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_IOC,
  PLACE_ORDER_FOR_SELECTOR,
  basanosRegistryAbi,
} from "../src/index";
import { grantCall, ownerOrderCall, ownerTx, startRunCall } from "../src/owner-tx";

const E18 = 10n ** 18n;
const REFEREE: Address = "0xE358D82209ea9360F411A041C0200adc385877eb";
const ACCOUNT: Address = "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1";
const REGISTRY: Address = "0xf5d8099239200dF961E0910a42c105214d1e9370";
const EXPIRY = 3_371_163_205_000_000_000n;

describe("account writes build the bytes the SDK encodes (P6)", () => {
  it("encodes an opening IOC exactly as the SDK's own build verb, on both sides", async () => {
    // A throwaway key, never funded: the SDK needs one to hand out a trader. Building sends nothing.
    const trader = new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES, privateKey: generatePrivateKey() }).trader;
    for (const isBid of [true, false]) {
      const price = isBid ? 72_797_900n * 10n ** 15n : 72_506_200n * 10n ** 15n;
      const { order } = await trader.buildPlacePerpOrder({ pool: BTC_POOL, isBid, price, quantity: 342_000n, orderType: ORDER_TYPE_IOC, expireTimestampNs: EXPIRY });
      const c = ownerOrderCall(BTC_POOL, isBid, price, 342_000n, ORDER_TYPE_IOC, EXPIRY);
      expect(c.to).toBe(order.to);
      expect(c.value).toBe(order.value);
      expect(c.data).toBe(order.data);
      expect(c.data.slice(0, 10)).toBe("0x4e978373");
    }
  });
  it("encodes the referee's grant exactly as the SDK's setOperatorApprovalForPool", () => {
    const selectors = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR];
    const c = grantCall(OPERATOR_REGISTRY, BTC_POOL, REFEREE, selectors);
    expect(c.to).toBe(OPERATOR_REGISTRY);
    expect(c.value).toBe(0n);
    expect(c.data.slice(0, 10)).toBe("0x7bbc67e6");
    expect(c.data).toBe(encodeFunctionData({ abi: operatorRegistryWriteAbi, functionName: "setOperatorApprovalForPool", args: [BTC_POOL, REFEREE, selectors, true] }));
  });
  it("encodes startRun for the account itself", () => {
    const id = "0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757";
    const c = startRunCall(REGISTRY, ACCOUNT, id);
    expect(c.to).toBe(REGISTRY);
    expect(c.value).toBe(0n);
    const d = decodeFunctionData({ abi: basanosRegistryAbi, data: c.data });
    expect(d.functionName).toBe("startRun");
    expect(d.args).toEqual([ACCOUNT, id]);
  });
  it("signs with ORDER_GAS and an explicit nonce", () => {
    const c = ownerOrderCall(BTC_POOL, true, 72_000n * E18, 13_000n, ORDER_TYPE_IOC, EXPIRY);
    expect(ownerTx(c, 2, ORDER_GAS)).toEqual({ to: BTC_POOL, data: c.data, value: 0n, gas: 10_000_000n, nonce: 2 });
  });
});
