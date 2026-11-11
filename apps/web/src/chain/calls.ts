import { parseAbi, zeroAddress, type Abi, type Address, type Hex } from "viem";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  PLACE_ORDER_FOR_SELECTOR,
  VOUCHER_DISTRIBUTOR,
  basanosRegistryAbi,
  farFutureNs,
  operatorRegistryAbi,
} from "@basanos/core";

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  gas?: bigint;
}

/** The SDK's voucherDistributorWriteAbi and the isClaimed read (SDK 0.33.0 readsAbi). */
export const voucherAbi = parseAbi(["function claim()", "function isClaimed(address account) view returns (bool)"]);

/** Owner-side PerpPool order (SDK 0.33.0 perpPoolWriteAbi). */
export const ownerPoolAbi = parseAbi([
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
]);

export function claimVoucherCall(): ContractCall {
  return { address: VOUCHER_DISTRIBUTOR, abi: voucherAbi, functionName: "claim", args: [] };
}

export function grantRefereeCall(referee: Address): ContractCall {
  return {
    address: OPERATOR_REGISTRY,
    abi: operatorRegistryAbi,
    functionName: "setOperatorApprovalForPool",
    args: [BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR], true],
  };
}

export function startRunCall(registry: Address, account: Address, rulebookId: Hex): ContractCall {
  return { address: registry, abi: basanosRegistryAbi as unknown as Abi, functionName: "startRun", args: [account, rulebookId] };
}

export function placeOrderCall(isBid: boolean, price: bigint, quantity: bigint, orderType: number): ContractCall {
  return {
    address: BTC_POOL,
    abi: ownerPoolAbi,
    functionName: "placeOrder",
    args: [isBid, 0n, price, quantity, farFutureNs(), orderType, 0, zeroAddress, 0n],
    gas: ORDER_GAS,
  };
}
