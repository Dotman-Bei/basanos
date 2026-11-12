// How a challenge account's own writes reach the chain (P6, 2026-11-12). viem-direct, as spike:14 does for account A:
// the transaction is signed locally with ORDER_GAS and an explicit pending nonce, sent once with
// eth_sendRawTransaction to the standard RPC (rpcHttp()), and its receipt is taken from the public client. Signing
// first gives the hash before the send, so a send that fails or times out can still be looked up.
// The SDK's send path (eth_sendRawTransactionSync on send.hideki…) ended "outcome unknown" with nothing on-chain twice:
// the voucher claim (2026-11-11) and B's grant in the first rehearsal (2026-11-12). No bot write uses it.
// Nothing here re-sends. Whether a write took effect is read back from the chain (effectOf), never assumed from the
// send call: a grant is idempotent, but an open is not, and a blind re-send could double a position.
import { keccak256, type Address, type Hex } from "viem";
import { ORDER_GAS } from "@basanos/core";
import { ownerTx, type UnsignedCall } from "@basanos/core/owner-tx";
import { txRecord, type TxRecord } from "@basanos/referee";

/** How long a send waits for its receipt before its outcome counts as unknown. Hideki blocks are about 0.1 s apart. */
export const RECEIPT_WAIT_MS = 60_000;

/** After the last run starts, how long past the rulebook's time limit the demo waits for the verdicts. */
export const VERDICT_GRACE_SEC = 300;

export type Receipt = Parameters<typeof txRecord>[1];
export type SignedTx = ReturnType<typeof ownerTx>;

/** The chain calls one send makes. viemSender() in actions.ts binds them to an account wallet and the public client;
 *  tests fake them. */
export interface Sender {
  address: Address;
  pendingNonce(): Promise<number>;
  sign(tx: SignedTx): Promise<Hex>;
  sendRaw(raw: Hex): Promise<unknown>;
  waitReceipt(hash: Hex, timeoutMs: number): Promise<Receipt>;
  receipt(hash: Hex): Promise<Receipt | null>;
}

/** A write that reached a receipt (success or reverted), or one whose outcome is not known yet. */
export type SendResult =
  | { outcome: "landed"; label: string; hash: Hex; nonce: number; tx: TxRecord; reason: null }
  | { outcome: "unknown"; label: string; hash: Hex; nonce: number; tx: null; reason: string };

const short = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 160) ?? "";

/** Signs `call` at the pending nonce with ORDER_GAS, sends it once, and waits for its receipt by the hash known before
 *  the send. A failed send still waits, since a timed-out send may have reached the node. Never re-sends. */
export async function sendWrite(s: Sender, label: string, call: UnsignedCall, waitMs: number = RECEIPT_WAIT_MS): Promise<SendResult> {
  const nonce = await s.pendingNonce();
  const raw = await s.sign(ownerTx(call, nonce, ORDER_GAS));
  const hash = keccak256(raw);
  let reason = "";
  try {
    await s.sendRaw(raw);
  } catch (e) {
    reason = `send failed: ${short(e)}`;
  }
  try {
    return { outcome: "landed", label, hash, nonce, tx: txRecord(label, await s.waitReceipt(hash, waitMs)), reason: null };
  } catch (e) {
    if (!reason) reason = `no receipt within ${waitMs / 1000} s: ${short(e)}`;
  }
  const late = await s.receipt(hash);
  if (late) return { outcome: "landed", label, hash, nonce, tx: txRecord(label, late), reason: null };
  return { outcome: "unknown", label, hash, nonce, tx: null, reason };
}

export type Effect = "done" | "not-done" | "unknown";

/** Whether a write took effect, from the chain (P6b). `seen` is the effect itself, read back after the send: both
 *  grant selectors authorized, the account's active run, or its position size moving. Unseen, the write did not
 *  happen if it has a receipt (it reverted) or its nonce was used by another transaction; otherwise its outcome is
 *  unknown and it may still land. */
export function effectOf(sent: SendResult, seen: boolean, latestNonce: number): Effect {
  if (seen) return "done";
  if (sent.outcome === "landed" || latestNonce > sent.nonce) return "not-done";
  return "unknown";
}

/** One account write and what it did on-chain. */
export interface AccountWrite {
  sent: SendResult;
  effect: Effect;
}

export function describeWrite(w: AccountWrite): string {
  const how = w.sent.outcome === "landed" ? `receipt ${w.sent.tx.status}` : w.sent.reason;
  return `${w.sent.label}: ${w.effect} (${how}; tx ${w.sent.hash}, nonce ${w.sent.nonce})`;
}

export type WriteKind = "grant" | "start" | "open" | "breach";

/** What a demo take does when a write does not take effect, or anything else throws (P6b):
 *  - "stop": the take has started no run, so there is nothing to clean up. The demo exits 1, and a re-run starts
 *    over: the grant and the active run are read before anything is sent, so nothing is sent twice.
 *  - "abort": the take has started a run. Nothing is re-sent and no run is voided: a void is the referee's verdict on
 *    a flow, a foreign market or a revoked grant, and none of those happened. Revoking the grant to force one would
 *    also leave the referee unable to close an open that lands late. The referee keeps judging and ends each run by a
 *    rule or at its time limit (FAIL TimeLimit), closing any position first. The demo waits for every verdict, checks
 *    the accounts are flat, records the take in demo-aborted.json, and exits 1.
 *  - "note": the on-demand exposure top-up did not take effect. The take goes on; its runs still end by a rule or at
 *    their time limits. */
export function onFailure(kind: WriteKind | "error", runsStarted: number): "stop" | "abort" | "note" {
  if (runsStarted === 0) return "stop";
  return kind === "breach" ? "note" : "abort";
}

/** When the demo stops waiting for verdicts: the rulebook's time limit plus VERDICT_GRACE_SEC after the last start. */
export function verdictDeadline(lastStartMs: number, timeLimitSec: number): number {
  return lastStartMs + (timeLimitSec + VERDICT_GRACE_SEC) * 1_000;
}
