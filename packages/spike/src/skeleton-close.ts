// G1(a)+(e): account A grants the referee place+cancel on BTC-PERP, opens a minimum-size long and rests one
// far bid; the referee cancels the resting order, closes the long with an IOC placeOrderFor (no reduce-only
// flag exists), reads back flat. Follows the spec §8 close protocol: cancel first, fresh position read, IOC,
// read-back, at most 3 attempts with widening slippage, final cancel sweep. --dry-run only reads.
// Every write is signed locally by viem and sent to the standard RPC (rpcHttp()). Account A's grant, open and
// rest carry ORDER_GAS and an explicit pending nonce; --sdk-send routes those three through the SDK's own send
// path instead (fallback only). The evidence records which path ran as `sendPath`.
// Account A must be FUNDED, not voucher-backed (B14/B15, spike:20): at least 1 USDso of unlocked collateral in its
// own MarginBank balance (spike:18 deposits it). The leverage cap that applies is the voucher cap only for a claimed
// voucher, otherwise the market maximum (40x on BTC-PERP); the evidence records both.
import { zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CLOSE_SLIPPAGE_STEPS_BPS,
  MARGIN_BANK,
  marginBankAbi,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_IOC,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  farFutureNs,
  perpPoolAbi,
  planClose,
  planOpen,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { loadDotEnv, requirePrivateKey } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { SKELETON_MIN_UNLOCKED, capFromLeverage, formatUsdso, fundedProblem } from "./funding";
import {
  grantCall,
  isFlat,
  ownerOrderCall,
  ownerTx,
  parseSendPath,
  sumCosts,
  txRecord,
  type SendPath,
  type TxRecord,
  type UnsignedCall,
} from "./live-lib";
import { marketsFor, publicClient, walletFor } from "./rpc";

loadDotEnv();
const dryRun = process.argv.includes("--dry-run");
const sendPath: SendPath = parseSendPath(process.argv);
const ownerPk = requirePrivateKey("ACCOUNT_A_PK");
const refereePk = requirePrivateKey("REFEREE_PK");
const owner: Address = privateKeyToAccount(ownerPk).address;
const referee: Address = privateKeyToAccount(refereePk).address;
const client = publicClient();
const refWallet = walletFor(refereePk);
const ownerWallet = walletFor(ownerPk);
const ownerMarkets = marketsFor(ownerPk);
const txs: TxRecord[] = [];
const notes: string[] = [];

function stop(reason: string, extra: Record<string, unknown> = {}): never {
  console.error(`skeleton-close: STOP — ${reason}`);
  if (!dryRun) writeEvidence("g1a-close", { ok: false, reason, sendPath, owner, referee, pool: BTC_POOL, txs, notes, ...extra });
  process.exit(1);
}

/** One of account A's own writes. viem path: sign `call` with ORDER_GAS and the pending nonce, send it to the
 *  standard RPC and wait for the receipt there. sdk path (--sdk-send): the SDK's own send, kept as a fallback. */
async function ownerWrite(
  label: string,
  call: UnsignedCall,
  viaSdk: () => Promise<{ receipt: Parameters<typeof txRecord>[1] }>,
): Promise<TxRecord> {
  let rec: TxRecord;
  if (sendPath === "sdk") {
    rec = txRecord(label, (await viaSdk()).receipt);
  } else {
    const nonce = await client.getTransactionCount({ address: owner, blockTag: "pending" });
    const hash = await ownerWallet.sendTransaction(ownerTx(call, nonce, ORDER_GAS));
    rec = txRecord(label, await client.waitForTransactionReceipt({ hash }));
  }
  txs.push(rec);
  return rec;
}

async function authorized(selector: Hex): Promise<boolean> {
  return client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
}

async function openOrderIds(): Promise<readonly bigint[]> {
  // The pool answers for msg.sender, so read as the owner via eth_call `from` (never through Multicall3).
  return client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOwnOpenOrders", account: owner });
}

async function refereeCancelAll(label: string): Promise<void> {
  try {
    for (const id of await openOrderIds()) {
      const hash = await refWallet.writeContract({
        address: BTC_POOL,
        abi: perpPoolAbi,
        functionName: "cancelOrderFor",
        args: [owner, id],
        gas: ORDER_GAS,
      });
      txs.push(txRecord(label, await client.waitForTransactionReceipt({ hash })));
    }
  } catch (e) {
    notes.push(`${label} failed: ${(e as Error).message.slice(0, 200)}`);
  }
}

// 1. Preflight (reads only).
const [ownerStt, refereeStt] = await Promise.all([client.getBalance({ address: owner }), client.getBalance({ address: referee })]);
if (ownerStt < STT_WRITE_HEADROOM || refereeStt < STT_WRITE_HEADROOM) {
  stop(`STT below the 0.6 write headroom (owner ${ownerStt}, referee ${refereeStt}); top up from the Tokyo faucet`);
}
const voucher = await ownerMarkets.client.getPerpVoucher(MARGIN_BANK, owner);
const voucherClaimed = voucher?.claimed === true;
const ownerState = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [owner] });
const unfunded = fundedProblem("account A", ownerState.unlockedCollateralBalance, SKELETON_MIN_UNLOCKED);
if (unfunded) stop(unfunded);
const leverage = await ownerMarkets.client.getPerpLeverage({ marginBank: MARGIN_BANK, account: owner, pool: BTC_POOL });
const cap = capFromLeverage(leverage, voucherClaimed);
const params = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
const book: BookParams = { tickSize: params.tickSize, minQuantity: params.minQuantity, lotSize: params.lotSize };
const markets = await ownerMarkets.client.listPerpMarkets();
const btcRow = markets.find((m) => m.baseSymbol === "BTC");
if (!btcRow || btcRow.poolAddress.toLowerCase() !== BTC_POOL.toLowerCase()) stop("the live BTC-PERP pool differs from BTC_POOL in config");
const start = await readSnapshot(client, [owner], BTC_POOL);
const startAccount = start.accounts[0];
if (!startAccount || !isFlat(startAccount)) stop("account A is not flat; flatten it in the dreamDEX app first");
if (!start.markOk) stop("BTC-PERP has no fresh mark price");
const openQty = alignUp(book.minQuantity, book.lotSize);
console.log(
  `preflight ok: owner ${owner}, referee ${referee}, unlocked margin ${formatUsdso(ownerState.unlockedCollateralBalance)} USDso, ` +
    `leverage cap ${cap.capX}x (${cap.capSource}), voucher ${voucherClaimed ? "claimed" : "none"}, ` +
    `mark ${start.markPrice}, open qty ${openQty}, send path ${sendPath}`,
);
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}

// 2. Owner grants the referee place + cancel on the BTC pool only (a per-pool grant on the operator registry).
const selectors: Hex[] = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR];
if (!(await authorized(PLACE_ORDER_FOR_SELECTOR)) || !(await authorized(CANCEL_ORDER_FOR_SELECTOR))) {
  try {
    await ownerWrite("grant", grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, selectors), () =>
      ownerMarkets.trader.setOperatorApprovalForPool({
        pool: BTC_POOL,
        operator: referee,
        selectors,
        approved: true,
        operatorRegistry: OPERATOR_REGISTRY,
      }),
    );
  } catch (e) {
    stop(`the grant send failed before any order existed: ${(e as Error).message.slice(0, 200)}`);
  }
}
if (!(await authorized(PLACE_ORDER_FOR_SELECTOR)) || !(await authorized(CANCEL_ORDER_FOR_SELECTOR))) stop("the grant did not take effect");

// 3. Owner opens the minimum long (IOC) and rests one far bid (GTC) for the referee to cancel.
const preOpen = await readSnapshot(client, [owner], BTC_POOL);
const open = planOpen(true, openQty, preOpen.markPrice, book, 20);
try {
  const opened = await ownerWrite(
    "open",
    ownerOrderCall(BTC_POOL, true, open.price, open.quantity, ORDER_TYPE_IOC, farFutureNs()),
    () => ownerMarkets.trader.placePerpOrder({ pool: BTC_POOL, isBid: true, price: open.price, quantity: open.quantity, orderType: ORDER_TYPE_IOC }),
  );
  if (opened.status === "reverted") stop("the opening IOC reverted, so no position was opened");
} catch (e) {
  stop(`the opening IOC failed before any position existed: ${(e as Error).message.slice(0, 200)}`);
}
// Real entry fill vs mark (the demo's +0.5% target is only trusted once this cost is known; spec §5).
const openedPos = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getPosition", args: [owner, BTC_POOL] });
const entry = {
  side: "long",
  quantity: open.quantity,
  limitPrice: open.price,
  markBefore: preOpen.markPrice,
  markBlock: preOpen.blockNumber,
  avgEntryPrice: openedPos.avgEntryPrice,
  costBps: Number(((openedPos.avgEntryPrice - preOpen.markPrice) * 1_000_000n) / preOpen.markPrice) / 100,
};
console.log(`entry: avg ${entry.avgEntryPrice} vs mark ${entry.markBefore} = ${entry.costBps} bps`);
const restPrice = (start.markPrice * 9_000n) / 10_000n - ((start.markPrice * 9_000n) / 10_000n) % book.tickSize;
try {
  await ownerWrite(
    "rest",
    ownerOrderCall(BTC_POOL, true, restPrice, openQty, ORDER_TYPE_LIMIT, farFutureNs()),
    () => ownerMarkets.trader.placePerpOrder({ pool: BTC_POOL, isBid: true, price: restPrice, quantity: openQty, orderType: ORDER_TYPE_LIMIT }),
  );
} catch (e) {
  // A rejected resting order (e.g. outside the pool's price band) must not strand the open long: note it and close.
  notes.push(`resting order rejected: ${(e as Error).message.slice(0, 200)}; continuing to the referee close`);
}

// 4. Referee: cancel first, fresh read, IOC close, read back; at most 3 attempts.
await refereeCancelAll("cancel");
let attempts = 0;
for (const slippage of CLOSE_SLIPPAGE_STEPS_BPS) {
  const snap = await readSnapshot(client, [owner], BTC_POOL);
  const acct = snap.accounts[0];
  if (!acct || acct.size === 0n) break;
  const plan = planClose(acct.size, snap.markPrice, book, slippage);
  if (!plan) {
    notes.push(`residual ${acct.size} is below one lot`);
    break;
  }
  attempts += 1;
  try {
    const hash = await refWallet.writeContract({
      address: BTC_POOL,
      abi: perpPoolAbi,
      functionName: "placeOrderFor",
      args: [owner, plan.isBid, 0n, plan.price, plan.quantity, farFutureNs(), ORDER_TYPE_IOC, 0, zeroAddress, 0n],
      gas: ORDER_GAS,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    txs.push(txRecord("close", receipt));
    if (receipt.status === "reverted") notes.push(`close attempt ${attempts} at ${slippage} bps reverted (replay with eth_call at the parent block)`);
  } catch (e) {
    notes.push(`close attempt ${attempts} at ${slippage} bps failed to send: ${(e as Error).message.slice(0, 200)}`);
  }
}
await refereeCancelAll("sweep");

// 5. Read back and record.
const end = await readSnapshot(client, [owner], BTC_POOL);
const endAccount = end.accounts[0];
const flat = endAccount ? isFlat(endAccount) : false;
writeEvidence("g1a-close", {
  ok: flat && txs.some((t) => t.label === "close" && t.status === "success"),
  sdkVersion: "0.33.0",
  sendPath,
  owner,
  referee,
  pool: BTC_POOL,
  operatorRegistry: OPERATOR_REGISTRY,
  leverage: {
    voucherLeverageCapX: leverage.voucherLeverageCapX,
    accountMaxLeverageX: leverage.accountMaxLeverageX,
    protocolMaxLeverageX: leverage.protocolMaxLeverageX,
    marketMaxLeverageBps: leverage.marketMaxLeverageBps,
    creditFloor: leverage.creditFloor,
    voucherClaimed,
    // The cap that applies: the voucher cap only for a claimed voucher, else the market maximum (40x on BTC-PERP).
    capX: cap.capX,
    capSource: cap.capSource,
  },
  funding: { unlockedWei: ownerState.unlockedCollateralBalance, needWei: SKELETON_MIN_UNLOCKED, source: voucherClaimed ? "voucher" : "deposit" },
  book,
  entry,
  startSnapshot: start,
  endSnapshot: end,
  closeAttempts: attempts,
  finalPositionSize: endAccount?.size ?? -1n,
  finalLocked: endAccount?.lockedCollateral ?? -1n,
  txs,
  costs: { totalWei: sumCosts(txs), perTx: txs.map((t) => ({ label: t.label, gasUsed: t.gasUsed, costWei: t.costWei })) },
  notes,
});
console.log(`skeleton-close: ${flat ? "FLAT" : "NOT FLAT"} after ${attempts} close attempt(s); ${txs.length} txs (owner writes via ${sendPath})`);
for (const t of txs) console.log(`  ${t.label} ${t.status} ${t.explorer}`);
process.exit(flat ? 0 : 1);
