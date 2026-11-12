import { createPublicClient, createWalletClient, encodeFunctionData, http, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, ORDER_GAS, ORDER_TYPE_IOC, farFutureNs, perpPoolAbi, readSnapshot, type BookParams } from "@basanos/core";
import { readBookLevels } from "@basanos/core/book";
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

/** How long cached fees are trusted before a refresh (they are refreshed in the background when stale). */
export const FEE_TTL_MS = 60_000;

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** The chain calls the fast sender needs; makeFastSender binds them to viem, tests fake them. */
export interface SenderIO {
  address: Address;
  pendingNonce(): Promise<number>;
  fees(): Promise<Fees>;
  sign(tx: { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number } & Fees): Promise<Hex>;
  sendRaw(raw: Hex): Promise<Hex>;
}

/** The referee's sends in one round trip (architect P7, 2026-11-12). A close used to cost seven sequential RPCs at about
 *  0.4 s each before it left (open orders, book parameters, position, chain id, nonce, fees, send): 7.7 s from the
 *  breach block to the first close in the rehearsal. Here the nonce is tracked locally and the fees are cached, so a
 *  send is a local signature and one eth_sendRawTransaction. All of the referee's writes go through one sender, in the
 *  daemon's one action queue, so nonces never race. A failed send forgets the nonce; `resync()` adopts the chain's
 *  pending nonce when it is ahead (a transaction sent by another tool with the same key). */
export interface FastSender {
  address: Address;
  /** Fetches the nonce and the fees ahead of the first send. */
  warm(): Promise<void>;
  send(to: Address, data: Hex, gas: bigint, value?: bigint): Promise<Hex>;
  resync(): Promise<void>;
}

export function fastSender(io: SenderIO, nowMs: () => number = Date.now): FastSender {
  let next: number | null = null;
  let fees: { at: number; value: Fees } | null = null;
  let inflight = 0;
  const loadFees = async (): Promise<Fees> => {
    const value = await io.fees();
    fees = { at: nowMs(), value };
    return value;
  };
  const currentFees = async (): Promise<Fees> => {
    if (!fees) return loadFees();
    if (nowMs() - fees.at > FEE_TTL_MS) void loadFees().catch(() => undefined);
    return fees.value;
  };
  return {
    address: io.address,
    warm: async () => {
      const [n] = await Promise.all([io.pendingNonce(), loadFees()]);
      next = next === null ? n : Math.max(next, n);
    },
    send: async (to, data, gas, value = 0n) => {
      inflight += 1;
      try {
        if (next === null) next = await io.pendingNonce();
        const nonce = next;
        next += 1;
        try {
          return await io.sendRaw(await io.sign({ to, data, value, gas, nonce, ...(await currentFees()) }));
        } catch (e) {
          next = null;
          throw e;
        }
      } finally {
        inflight -= 1;
      }
    },
    resync: async () => {
      if (inflight > 0) return;
      const n = await io.pendingNonce();
      if (inflight === 0) next = next === null ? n : Math.max(next, n);
    },
  };
}

/** Binds the fast sender to the referee's wallet (local signing) and the public client (standard RPC). Fees: the
 *  chain's estimate, with maxFeePerGas doubled for headroom; a transaction pays the base fee plus the tip, not the cap. */
export function makeFastSender(client: PublicClient, wallet: RefereeWallet): FastSender {
  const address = wallet.account.address;
  return fastSender({
    address,
    pendingNonce: () => client.getTransactionCount({ address, blockTag: "pending" }),
    fees: async () => {
      const f = await client.estimateFeesPerGas();
      return { maxFeePerGas: f.maxFeePerGas * 2n, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    },
    sign: (tx) => wallet.account.signTransaction({ ...tx, chainId: CHAIN.id, type: "eip1559" }),
    sendRaw: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
  });
}

export async function readBookParams(client: PublicClient, pool: Address): Promise<BookParams> {
  const p = await client.readContract({ address: pool, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
  return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
}

/** The close protocol's chain I/O. The pool's tick, minimum and lot are read once at start (they do not change), and
 *  every write goes through the fast sender. */
export function chainCloseIO(client: PublicClient, sender: FastSender, pool: Address, params: BookParams): CloseIO {
  return {
    // The pool answers getOwnOpenOrders for msg.sender: read as the owner via eth_call `from`, never through Multicall3.
    openOrderIds: (account) => client.readContract({ address: pool, abi: perpPoolAbi, functionName: "getOwnOpenOrders", account }),
    cancel: async (account, orderId) => {
      const hash = await sender.send(pool, encodeFunctionData({ abi: perpPoolAbi, functionName: "cancelOrderFor", args: [account, orderId] }), ORDER_GAS);
      return txRecord("cancel", await client.waitForTransactionReceipt({ hash }));
    },
    position: async (account) => {
      const snap = await readSnapshot(client, [account], pool);
      return { size: snap.accounts[0]?.size ?? 0n, mark: snap.markPrice };
    },
    book: async () => params,
    levels: () => readBookLevels(client, pool),
    placeClose: async (account, plan) => {
      const data = encodeFunctionData({
        abi: perpPoolAbi,
        functionName: "placeOrderFor",
        args: [account, plan.isBid, 0n, plan.price, plan.quantity, farFutureNs(), ORDER_TYPE_IOC, 0, zeroAddress, 0n],
      });
      const hash = await sender.send(pool, data, ORDER_GAS);
      return txRecord("close", await client.waitForTransactionReceipt({ hash }));
    },
  };
}
