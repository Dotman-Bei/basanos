import type { Address, PublicClient } from "viem";
import { readSnapshot } from "@basanos/core";

export interface StoredRead {
  blockNumber: bigint;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  positionSize: bigint;
  markOk: boolean;
  markPrice: bigint;
}

export interface ReplayRow {
  field: "equity" | "lockedCollateral" | "positionSize" | "markPrice";
  call: string;
  stored: bigint;
  chain: bigint | null;
  match: "exact" | "within-tolerance" | "differs" | "not-served";
}

const CALLS: Record<ReplayRow["field"], string> = {
  equity: "MarginBank.tryGetAccountEquity(account)",
  lockedCollateral: "MarginBank.getAccountState(account).lockedCollateral",
  positionSize: "MarginBank.getPosition(account, pool).size",
  markPrice: "PerpPool.tryGetMarkPrice()",
};
const TOLERANT: ReadonlySet<ReplayRow["field"]> = new Set(["equity", "markPrice"]);
const TOLERANCE_BPS = 10n;

function judge(field: ReplayRow["field"], stored: bigint, chain: bigint): ReplayRow["match"] {
  if (stored === chain) return "exact";
  if (!TOLERANT.has(field)) return "differs";
  const diff = stored > chain ? stored - chain : chain - stored;
  const base = stored < 0n ? -stored : stored;
  return base > 0n && diff * 10_000n <= base * TOLERANCE_BPS ? "within-tolerance" : "differs";
}

export function compareReads(stored: StoredRead, chain: StoredRead | null): ReplayRow[] {
  return (["equity", "lockedCollateral", "positionSize", "markPrice"] as const).map((field) => ({
    field,
    call: CALLS[field],
    stored: stored[field],
    chain: chain ? chain[field] : null,
    match: chain ? judge(field, stored[field], chain[field]) : "not-served",
  }));
}

/** Re-runs the stored read's calls at its block (one Multicall3 call); "not served" past the RPC's history. */
export async function replayRead(client: PublicClient, account: Address, pool: Address, stored: StoredRead): Promise<ReplayRow[]> {
  try {
    const snap = await readSnapshot(client, [account], pool, stored.blockNumber);
    const a = snap.accounts[0];
    if (!a) return compareReads(stored, null);
    return compareReads(stored, {
      blockNumber: snap.blockNumber,
      equityOk: a.equityOk,
      equity: a.equity,
      lockedCollateral: a.lockedCollateral,
      positionSize: a.size,
      markOk: snap.markOk,
      markPrice: snap.markPrice,
    });
  } catch {
    return compareReads(stored, null);
  }
}
