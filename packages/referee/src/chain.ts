import { createPublicClient, createWalletClient, http, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, ORDER_GAS, ORDER_TYPE_IOC, farFutureNs, perpPoolAbi, readSnapshot } from "@basanos/core";
import type { CloseIO } from "./close";
import { txRecord } from "./tx";

export function makePublicClient(url: string): PublicClient {
  return createPublicClient({ chain: CHAIN, transport: http(url) }) as unknown as PublicClient;
}

/** Inferred return type: bound to CHAIN and the referee's account. */
export function makeRefereeWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type RefereeWallet = ReturnType<typeof makeRefereeWallet>;

export function chainCloseIO(client: PublicClient, wallet: RefereeWallet, pool: Address): CloseIO {
  return {
    // The pool answers getOwnOpenOrders for msg.sender: read as the owner via eth_call `from`, never through Multicall3.
    openOrderIds: (account) => client.readContract({ address: pool, abi: perpPoolAbi, functionName: "getOwnOpenOrders", account }),
    cancel: async (account, orderId) => {
      const hash = await wallet.writeContract({ address: pool, abi: perpPoolAbi, functionName: "cancelOrderFor", args: [account, orderId], gas: ORDER_GAS });
      return txRecord("cancel", await client.waitForTransactionReceipt({ hash }));
    },
    position: async (account) => {
      const snap = await readSnapshot(client, [account], pool);
      return { size: snap.accounts[0]?.size ?? 0n, mark: snap.markPrice };
    },
    book: async () => {
      const p = await client.readContract({ address: pool, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
      return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
    },
    placeClose: async (account, plan) => {
      const hash = await wallet.writeContract({
        address: pool,
        abi: perpPoolAbi,
        functionName: "placeOrderFor",
        args: [account, plan.isBid, 0n, plan.price, plan.quantity, farFutureNs(), ORDER_TYPE_IOC, 0, zeroAddress, 0n],
        gas: ORDER_GAS,
      });
      return txRecord("close", await client.waitForTransactionReceipt({ hash }));
    },
  };
}
