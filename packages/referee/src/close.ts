import type { Address } from "viem";
import { CLOSE_SLIPPAGE_STEPS_BPS, type BookParams, type OrderPlan } from "@basanos/core";
import { planCloseFromBook, type BookSides } from "@basanos/core/book";
import type { TxRecord } from "./tx";

export interface CloseIO {
  openOrderIds(account: Address): Promise<readonly bigint[]>;
  cancel(account: Address, orderId: bigint): Promise<TxRecord>;
  position(account: Address): Promise<{ size: bigint; mark: bigint }>;
  book(): Promise<BookParams>;
  placeClose(account: Address, plan: OrderPlan): Promise<TxRecord>;
  /** Both sides of the book now (P7): retries are capped from it. Absent or null, the mark ladder alone is used. */
  levels?(): Promise<BookSides | null>;
}

/** What the push that raised the verdict already holds (architect P7): the position, the mark and the book of the
 *  breach block. With it the first close is planned and sent before any read. */
export interface FirstClose {
  size: bigint;
  mark: bigint;
  book: BookSides | null;
}

export interface CloseResult {
  flat: boolean;
  finalSize: bigint;
  attempts: number;
  txs: TxRecord[];
  notes: string[];
}

/** Spec §8 close protocol (R4), cut to one round trip before the first close (architect P7, 2026-11-12).
 *  - With `first` (the push's own reads): the first IOC is planned from that block's book and sent at once. The
 *    resting-order sweep follows it: a resting order can change the position only after the close, so the sweep and
 *    the read-back that follow catch it.
 *  - Without `first`: cancel first, as before, then close the fresh position.
 *  - Every retry reads the position and the book again; at most CLOSE_SLIPPAGE_STEPS_BPS.length attempts in all, each
 *    capped from the book with the mark ladder as the fallback; a final sweep and read-back. */
export async function flatten(io: CloseIO, account: Address, first?: FirstClose): Promise<CloseResult> {
  const txs: TxRecord[] = [];
  const notes: string[] = [];
  const sweep = async (label: string): Promise<void> => {
    for (const id of await io.openOrderIds(account)) txs.push({ ...(await io.cancel(account, id)), label });
  };
  const params = await io.book();
  let attempts = 0;
  const attempt = async (plan: OrderPlan, slippage: number): Promise<void> => {
    attempts += 1;
    const r = await io.placeClose(account, plan);
    txs.push({ ...r, label: "close" });
    if (r.status === "reverted") notes.push(`close attempt ${attempts} at ${slippage} bps reverted`);
  };
  let steps: readonly number[] = CLOSE_SLIPPAGE_STEPS_BPS;
  if (first && first.size !== 0n) {
    const step = CLOSE_SLIPPAGE_STEPS_BPS[0];
    const plan = planCloseFromBook(first.size, first.mark, first.book, params, step);
    if (plan) await attempt(plan, step);
    else notes.push(`residual ${first.size} is below one lot`);
    steps = CLOSE_SLIPPAGE_STEPS_BPS.slice(1);
  }
  await sweep(first ? "sweep" : "cancel");
  for (const slippage of steps) {
    const pos = await io.position(account);
    if (pos.size === 0n) break;
    const levels = io.levels ? await io.levels() : null;
    const plan = planCloseFromBook(pos.size, pos.mark, levels, params, slippage);
    if (!plan) {
      notes.push(`residual ${pos.size} is below one lot`);
      break;
    }
    await attempt(plan, slippage);
  }
  await sweep("sweep");
  const final = await io.position(account);
  return { flat: final.size === 0n, finalSize: final.size, attempts, txs, notes };
}
