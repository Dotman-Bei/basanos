// Writes docs/evidence/featured-run.json for one real run: argv[2], else FEATURED_RUN_ID, else the rehearsal's first verdict.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import { basanosRegistryAbi, rulebookId } from "@basanos/core";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { jsonSafe, makePublicClient, readRunsEvidence } from "@basanos/referee";
import { FEATURED_PATH, buildFeatured } from "./featured";

loadDotEnv();
const pick = (): bigint => {
  if (process.argv[2]) return BigInt(process.argv[2]);
  if (process.env.FEATURED_RUN_ID) return BigInt(process.env.FEATURED_RUN_ID);
  const reh = repoPath("docs/evidence/rehearsal.json");
  if (existsSync(reh)) {
    const id = (JSON.parse(readFileSync(reh, "utf8")) as { firstVerdictRunId?: string }).firstVerdictRunId;
    if (id) return BigInt(id);
  }
  throw new Error("no run id: pass one, set FEATURED_RUN_ID, or run the rehearsal first");
};
const runId = pick();
const registry = requireAddress("REGISTRY_ADDRESS");
const client = makePublicClient(rpcHttp());
const run = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
const closeTxs = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getCloseTxs", args: [runId] });
const rb = [loadRulebook("tokyo-sprint"), loadRulebook("tokyo-sprint-demo"), loadRulebook("tokyo-sprint-demo-v1")].find(
  (r) => rulebookId(r).toLowerCase() === run.rulebookId.toLowerCase(),
);
if (!rb) throw new Error(`run ${runId} uses a rulebook that is not in rulebooks/`);
const stored = readRunsEvidence()[runId.toString()];
const verdictTx = ((stored?.verdictTx as { hash?: Hex } | undefined)?.hash ?? null) as Hex | null;
const featured = buildFeatured({ registry, runId, run, rulebook: rb, closeTxs, verdictTx });
mkdirSync(dirname(repoPath(FEATURED_PATH)), { recursive: true });
writeFileSync(repoPath(FEATURED_PATH), `${JSON.stringify(jsonSafe(featured), null, 2)}\n`);
console.log(`featured run ${runId}: ${featured.status}${featured.rule ? ` (${featured.rule})` : ""} -> ${FEATURED_PATH}`);
process.exit(0);
