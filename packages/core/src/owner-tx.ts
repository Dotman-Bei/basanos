// The writes a challenge account signs itself, as unsigned calls, and the exact transaction it signs (P6, 2026-11-12).
// Moved here from packages/spike/src/live-lib.ts (spike:14), which re-exports them, so the bot and the spike build the
// same bytes. Each call encodes what the SDK's own write encodes: placeOrder as perpPoolWriteAbi (the SDK's
// placePerpOrder and buildPlacePerpOrder), the grant as operatorRegistryWriteAbi (the SDK's setOperatorApprovalForPool);
// owner-tx.test.ts pins both byte for byte. Nothing here sends: packages/bot/src/send.ts and the spike scripts do.
import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { operatorRegistryAbi } from "./abi";
import { basanosRegistryAbi } from "./abi/basanosRegistry";

/** An unsigned call: the same shape as the SDK's build verbs return (to, data, value). */
export interface UnsignedCall {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Owner-side PerpPool order: the SDK 0.33.0 perpPoolWriteAbi signature, selector 0x4e978373 (present in the BTC
 *  pool's beacon implementation; a far resting bid simulates OK from an active account). */
export const ownerPoolAbi = parseAbi([
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
]);

/** Raw placeOrder on the pool, with the arguments the SDK's placePerpOrder fills in (userData 0, no self-match option, no builder). */
export function ownerOrderCall(
  pool: Address,
  isBid: boolean,
  price: bigint,
  quantity: bigint,
  orderType: number,
  expireTimestampNs: bigint,
): UnsignedCall {
  return {
    to: pool,
    value: 0n,
    data: encodeFunctionData({
      abi: ownerPoolAbi,
      functionName: "placeOrder",
      args: [isBid, 0n, price, quantity, expireTimestampNs, orderType, 0, zeroAddress, 0n],
    }),
  };
}

/** The per-pool operator grant on the OperatorPermissionsRegistry (the SDK has no build verb for it). */
export function grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({
      abi: operatorRegistryAbi,
      functionName: "setOperatorApprovalForPool",
      args: [pool, operator, [...selectors], true],
    }),
  };
}

/** The account enrolls itself on a rulebook (msg.sender == account; the registry reads its start equity in the same tx). */
export function startRunCall(registry: Address, account: Address, rulebookId: Hex): UnsignedCall {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({ abi: basanosRegistryAbi, functionName: "startRun", args: [account, rulebookId] }),
  };
}

/** The exact transaction an account signs: a fixed gas limit and an explicit nonce. */
export function ownerTx(
  call: UnsignedCall,
  nonce: number,
  gas: bigint,
): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number } {
  return { to: call.to, data: call.data, value: call.value, gas, nonce };
}
