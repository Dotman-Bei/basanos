import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createWalletClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  INDEXER_URL,
  MARGIN_BANK,
  OPERATOR_REGISTRY,
  ORDER_TYPE_IOC,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  basanosRegistryAbi,
  farFutureNs,
  marginBankAbi,
  perpPoolAbi,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { planOpenFromBook, readBookLevels } from "@basanos/core/book";
import { repoPath } from "@basanos/core/node";
import { grantCall, ownerOrderCall, startRunCall } from "@basanos/core/owner-tx";
import { jsonSafe } from "@basanos/referee";
import { effectOf, prepareWrite, sendWrite, submitWrite, type AccountWrite, type SendResult, type Sender } from "./send";

export interface Preflight {
  account: Address;
  stt: bigint;
  sttOk: boolean;
  voucherClaimed: boolean;
  /** MarginBank getAccountState().unlockedCollateralBalance: the account's own deposited USDso not locked in a position. */
  unlockedCollateral: bigint;
  /** unlockedCollateral at or above what a demo run needs (DEMO_MIN_UNLOCKED unless the caller passes another need). */
  funded: boolean;
  flat: boolean;
  equity: bigint;
}

/** The least unlocked MarginBank margin a demo run needs: its DEMO_LEVERAGE_X (10x since P7) size must clear the
 *  0.00013 BTC pool minimum (about 0.95 USDso of equity) with room for costs. */
export const DEMO_MIN_UNLOCKED = 5n * 10n ** 18n;

/** Inferred return type: bound to CHAIN and the key's account. */
export function makeAccountWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type AccountWallet = ReturnType<typeof makeAccountWallet>;

/** Read-only: the bot uses the SDK for reads only (the voucher read in preflight). It never hands the SDK a key, so no
 *  SDK write can leave the bot (P6, 2026-11-12). */
export function makeMarkets(): SomniaMarkets {
  return new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
}

/** Binds send.ts to an account wallet, which signs locally, and the public client on the standard RPC (rpcHttp()),
 *  which gives the nonce, takes the raw transaction and returns the receipt. */
export function viemSender(wallet: AccountWallet, client: PublicClient): Sender {
  const address = wallet.account.address;
  return {
    address,
    pendingNonce: () => client.getTransactionCount({ address, blockTag: "pending" }),
    sign: async (tx) => wallet.signTransaction(await wallet.prepareTransactionRequest(tx)),
    sendRaw: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
    waitReceipt: (hash, timeout) => client.waitForTransactionReceipt({ hash, timeout }),
    receipt: (hash) => client.getTransactionReceipt({ hash }).catch(() => null),
  };
}

/** The latest nonce is read before the effect, so a write that lands between the two reads is seen, not missed. */
async function settle(client: PublicClient, account: Address, sent: SendResult, seen: () => Promise<boolean>): Promise<AccountWrite> {
  const latest = await client.getTransactionCount({ address: account, blockTag: "latest" });
  return { sent, effect: effectOf(sent, await seen(), latest) };
}

async function positionSize(client: PublicClient, account: Address): Promise<bigint> {
  const p = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getPosition", args: [account, BTC_POOL] });
  return p.size;
}

/** Reads only. Never claims a voucher: claim() reverts chain-wide (B14), so an account is ready when it is FUNDED,
 *  with its own wallet USDso deposited into its own MarginBank balance (spike:18 for A, spike:19 for B). */
export async function preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei: bigint = DEMO_MIN_UNLOCKED): Promise<Preflight> {
  const [stt, voucher, snap, state] = await Promise.all([
    client.getBalance({ address: account }),
    markets.client.getPerpVoucher(MARGIN_BANK, account),
    readSnapshot(client, [account], BTC_POOL),
    client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [account] }),
  ]);
  const a = snap.accounts[0];
  return {
    account,
    stt,
    sttOk: stt >= STT_WRITE_HEADROOM,
    voucherClaimed: voucher?.claimed ?? false,
    unlockedCollateral: state.unlockedCollateralBalance,
    funded: state.unlockedCollateralBalance >= needWei,
    flat: a ? a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0 : false,
    equity: a?.totalEquity ?? 0n,
  };
}

/** Why an account cannot start a demo run, or [] when it can. A voucher is never required. */
export function notReady(pf: Preflight): string[] {
  const p: string[] = [];
  if (!pf.sttOk) p.push(`STT ${pf.stt} is below the 0.6 write headroom (top up from the Tokyo faucet)`);
  if (!pf.funded) {
    p.push(
      `unlocked MarginBank margin is ${pf.unlockedCollateral} wei, below what a demo run needs; deposit the account's own wallet USDso first (deposit.ts: spike:18 for A, spike:19 for B)`,
    );
  }
  if (!pf.flat) p.push("the account is not flat (flatten it in the dreamDEX app first)");
  return p;
}

export async function readBook(client: PublicClient): Promise<BookParams> {
  const p = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
  return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
}

/** Grants the referee place + cancel on the BTC pool only, if not already granted (null: nothing sent). viem-direct
 *  (send.ts, P6); it counts only when the pool reports both selectors authorized. A grant is idempotent, so a re-run
 *  after a stop re-reads it first. */
export async function ensureGrant(client: PublicClient, wallet: AccountWallet, referee: Address): Promise<AccountWrite | null> {
  const owner = wallet.account.address;
  const has = async (selector: Hex) =>
    client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
  const granted = async () => (await has(PLACE_ORDER_FOR_SELECTOR)) && (await has(CANCEL_ORDER_FOR_SELECTOR));
  if (await granted()) return null;
  const selectors = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR];
  const sent = await sendWrite(viemSender(wallet, client), "grant", grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, selectors));
  return settle(client, owner, sent, granted);
}

export function runIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], registry: Address): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") return ev.args.runId;
    } catch {
      // another registry event
    }
  }
  return null;
}

/** The account itself enrolls (msg.sender == account); the registry reads its start equity in the same tx. viem-direct
 *  (send.ts, P6). The run is read back from activeRunOf, so it counts once the registry holds it, receipt or not. */
export async function startRunAs(
  client: PublicClient,
  wallet: AccountWallet,
  registry: Address,
  rulebookId: Hex,
): Promise<AccountWrite & { runId: bigint | null }> {
  const account = wallet.account.address;
  const activeRun = async () => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [account] });
  const before = await activeRun();
  const sent = await sendWrite(viemSender(wallet, client), "startRun", startRunCall(registry, account, rulebookId));
  let after = before;
  const w = await settle(client, account, sent, async () => {
    after = await activeRun();
    return after !== 0n && after !== before;
  });
  return { ...w, runId: w.effect === "done" ? after : null };
}

/** Extra size so the account's notional strictly exceeds targetX x equity (the on-demand exposure breach). */
export function breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint {
  const oneBase = 10n ** BigInt(baseDecimals);
  const abs = currentSize < 0n ? -currentSize : currentSize;
  const targetNotional = equity * BigInt(targetX);
  const current = (abs * mark) / oneBase;
  const neededNotional = targetNotional > current ? targetNotional - current : 0n;
  const qty = alignUp((neededNotional * oneBase) / mark + 1n, book.lotSize);
  return qty < book.minQuantity ? book.minQuantity : qty;
}

/** An opening IOC capped from the book (best ask + 20 bps to buy, best bid - 20 bps to sell), never from the mark:
 *  the BTC-PERP book trades about 19 bps above the mark, so a mark + 20 bps buy does not fill (P5, 2026-11-12).
 *  viem-direct (send.ts, P6): it took effect only if the account's position size moved. An open is never re-sent. */
export async function openIoc(
  client: PublicClient,
  wallet: AccountWallet,
  isBid: boolean,
  quantity: bigint,
  label: string = isBid ? "open long" : "open short",
): Promise<AccountWrite> {
  const account = wallet.account.address;
  const params = await readBook(client);
  const levels = await readBookLevels(client, BTC_POOL);
  if (!levels) throw new Error("the BTC-PERP book could not be read; no order was sent");
  const plan = planOpenFromBook(isBid, quantity, levels, params);
  const before = await positionSize(client, account);
  const order = ownerOrderCall(BTC_POOL, isBid, plan.price, plan.quantity, ORDER_TYPE_IOC, farFutureNs());
  const sent = await sendWrite(viemSender(wallet, client), label, order);
  return settle(client, account, sent, async () => (await positionSize(client, account)) !== before);
}

/** One leg of an opposite pair: the account, its side and its size. */
export interface PairLeg {
  wallet: AccountWallet;
  isBid: boolean;
  quantity: bigint;
}

/** Opens an opposite pair together (architect P7, 2026-11-12). Opposite positions only anti-correlate if they enter
 *  at the same moment: in the rehearsal the two opens landed 13 s apart, inside a whipsaw, and both lost. Both IOCs are
 *  capped from ONE book read, both are signed first, then both are sent back to back, so they land in the same block or
 *  the next. Each leg counts only if its position moved (P6b); nothing is re-sent. */
export async function openPair(client: PublicClient, legs: readonly PairLeg[]): Promise<AccountWrite[]> {
  const params = await readBook(client);
  const levels = await readBookLevels(client, BTC_POOL);
  if (!levels) throw new Error("the BTC-PERP book could not be read; no order was sent");
  const ready = await Promise.all(
    legs.map(async (leg) => {
      const plan = planOpenFromBook(leg.isBid, leg.quantity, levels, params);
      const account = leg.wallet.account.address;
      const sender = viemSender(leg.wallet, client);
      const before = await positionSize(client, account);
      const order = ownerOrderCall(BTC_POOL, leg.isBid, plan.price, plan.quantity, ORDER_TYPE_IOC, farFutureNs());
      return { account, sender, before, prepared: await prepareWrite(sender, leg.isBid ? "open long" : "open short", order) };
    }),
  );
  const sent = await Promise.all(ready.map((r) => submitWrite(r.sender, r.prepared)));
  return Promise.all(ready.map(async (r, i) => settle(client, r.account, sent[i]!, async () => (await positionSize(client, r.account)) !== r.before)));
}

/** The --a-manual follower (P7): polls the account's position every `pollMs` until it is open, so the scripted side opens
 *  right after the human's fill. Returns the size, or null once `untilMs` passes. */
export async function waitForPosition(client: PublicClient, account: Address, untilMs: number, pollMs = 250): Promise<bigint | null> {
  for (;;) {
    const size = await positionSize(client, account);
    if (size !== 0n) return size;
    if (Date.now() > untilMs) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export const DEMO_TAKES = "docs/evidence/demo-takes.json";

/** Takes that aborted after a run started (P6b). Kept apart from DEMO_TAKES, which check-rehearsal and the money-shot
 *  check judge: an aborted take's runs end FAIL TimeLimit without a close, and must not fail a later good take. */
export const DEMO_ABORTED = "docs/evidence/demo-aborted.json";

export function appendDemoTake(take: Record<string, unknown>, path: string = repoPath(DEMO_TAKES)): number {
  const all = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
  const n = all.length + 1;
  all.push(jsonSafe({ take: n, ...take }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
  return n;
}
