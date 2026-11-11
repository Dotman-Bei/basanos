import type { Address, Hex, PublicClient } from "viem";
import { basanosRegistryAbi, rulebookId, type Rulebook } from "@basanos/core";

export interface TrackedRun {
  runId: bigint;
  account: Address;
  rulebookId: Hex;
  rulebook: Rulebook;
  startTime: bigint;
  startEquity: bigint;
  startBlock: bigint;
}

export function rulebookIndex(rbs: readonly Rulebook[]): Map<string, Rulebook> {
  return new Map(rbs.map((rb) => [rulebookId(rb).toLowerCase(), rb]));
}

/** Active runs from the registry; a run under a rulebook this referee does not hold locally is skipped. */
export async function readActiveRuns(client: PublicClient, registry: Address, index: Map<string, Rulebook>): Promise<TrackedRun[]> {
  const ids = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getActiveRunIds" });
  const out: TrackedRun[] = [];
  for (const runId of ids) {
    const run = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
    const rulebook = index.get(run.rulebookId.toLowerCase());
    if (!rulebook) continue;
    out.push({
      runId,
      account: run.account,
      rulebookId: run.rulebookId,
      rulebook,
      startTime: run.startTime,
      startEquity: run.start.equity + run.start.lockedCollateral,
      startBlock: run.start.blockNumber,
    });
  }
  return out;
}
