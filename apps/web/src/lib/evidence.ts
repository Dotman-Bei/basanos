import type { Address, Hex } from "viem";
import runs from "../../../../docs/evidence/runs.json";

/** One run in the referee's evidence store, docs/evidence/runs.json (packages/referee/src/evidence.ts writes it). */
export interface EvidenceEntry {
  bundle: {
    account?: string;
    startBlock?: string;
    verdict?: string;
    lock?: { blockNumber: string; judgedEquity: string; bufferBps: number };
    close?: { txs?: { label: string; hash: string; status: string }[] };
  };
}

export type EvidenceStore = Record<string, EvidenceEntry>;

/** The evidence committed when the app was built. A run that ended later has none, and the page then shows nothing. */
export const EVIDENCE = runs as unknown as EvidenceStore;

/**
 * A PASS's lock close, from the referee's evidence bundle: recordPass stores no close, because the registry reads the
 * end state itself. Only a bundle for this very run counts: its account and start block match the registry's, its
 * verdict is PASSED and it locked. Only the transactions that succeeded are returned.
 */
export function lockTxsFromEvidence(store: EvidenceStore, run: { runId: bigint; account: Address; start: { blockNumber: bigint } }): Hex[] {
  const b = store[run.runId.toString()]?.bundle;
  if (!b || b.verdict !== "PASSED" || !b.lock) return [];
  if (b.account?.toLowerCase() !== run.account.toLowerCase() || b.startBlock !== run.start.blockNumber.toString()) return [];
  return (b.close?.txs ?? []).filter((t) => t.status === "success" && /^0x[0-9a-fA-F]{64}$/.test(t.hash)).map((t) => t.hash as Hex);
}
