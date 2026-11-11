import type { Address } from "viem";
import { CLOSE_SLIPPAGE_STEPS_BPS, planClose, type BookParams, type OrderPlan } from "@basanos/core";
import type { TxRecord } from "./tx";

export interface CloseIO {
  openOrderIds(account: Address): Promise<readonly bigint[]>;
  cancel(account: Address, orderId: bigint): Promise<TxRecord>;
  position(account: Address): Promise<{ size: bigint; mark: bigint }>;
  book(): Promise<BookParams>;
  placeClose(account: Address, plan: OrderPlan): Promise<TxRecord>;
}

export interface CloseResult {
  flat: boolean;
  finalSize: bigint;
  attempts: number;
  txs: TxRecord[];
  notes: string[];
}

/** Spec §8 close protocol (R4). */
export async function flatten(io: CloseIO, account: Address): Promise<CloseResult> {
  const txs: TxRecord[] = [];
  const notes: string[] = [];
  const sweep = async (label: string): Promise<void> => {
    for (const id of await io.openOrderIds(account)) txs.push({ ...(await io.cancel(account, id)), label });
  };
  await sweep("cancel");
  const book = await io.book();
  let attempts = 0;
  for (const slippage of CLOSE_SLIPPAGE_STEPS_BPS) {
    const pos = await io.position(account);
    if (pos.size === 0n) break;
    const plan = planClose(pos.size, pos.mark, book, slippage);
    if (!plan) {
      notes.push(`residual ${pos.size} is below one lot`);
      break;
    }
    attempts += 1;
    const r = await io.placeClose(account, plan);
    txs.push({ ...r, label: "close" });
    if (r.status === "reverted") notes.push(`close attempt ${attempts} at ${slippage} bps reverted`);
  }
  await sweep("sweep");
  const final = await io.position(account);
  return { flat: final.size === 0n, finalSize: final.size, attempts, txs, notes };
}
