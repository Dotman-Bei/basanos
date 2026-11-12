// The gate of the rehearsal's PASS take (architect P7, 2026-11-12): the latest take in docs/evidence/demo-takes.json is
// one PASSED run whose certificate is minted to its own account, and one FAILED run. The live PASS path (the referee's
// lock, the registry's recordPass checks, the certificate mint) had never run before this take. Read-only; writes
// docs/evidence/rehearsal-pass.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";
import { RULE_NAMES, RUN_STATUS, basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "./chain";
import { jsonSafe } from "./evidence";

export interface PassTakeRow {
  runId: bigint;
  account: Address;
  status: number;
  rule: number;
  /** ownerOf(runId), or null when no certificate exists for the run. */
  holder: Address | null;
}

export function summarizePassTake(rows: readonly PassTakeRow[]): { ok: boolean; passRunId: bigint | null; problems: string[] } {
  const problems: string[] = [];
  const passed = rows.filter((r) => r.status === 2);
  const failed = rows.filter((r) => r.status === 3);
  if (rows.length !== 2) problems.push(`the latest take has ${rows.length} runs, not 2`);
  if (passed.length !== 1) problems.push(`${passed.length} PASSED runs in the latest take, not 1`);
  if (failed.length !== 1) problems.push(`${failed.length} FAILED runs in the latest take, not 1`);
  for (const p of passed) {
    if (p.holder === null) problems.push(`run ${p.runId} PASSED but has no certificate`);
    else if (p.holder.toLowerCase() !== p.account.toLowerCase()) problems.push(`run ${p.runId}'s certificate is held by ${p.holder}, not ${p.account}`);
  }
  return { ok: problems.length === 0, passRunId: passed[0]?.runId ?? null, problems };
}

const isMain = process.argv[1]?.endsWith("check-pass.ts") ?? false;
if (isMain) {
  loadDotEnv();
  const takesPath = repoPath("docs/evidence/demo-takes.json");
  const takes = existsSync(takesPath) ? (JSON.parse(readFileSync(takesPath, "utf8")) as { take: number; runs: { runId: string }[] }[]) : [];
  const last = takes.at(-1);
  if (!last) {
    console.log("FAIL pass-take (docs/evidence/demo-takes.json has no take; run the demo first)");
    process.exit(1);
  }
  const registry = requireAddress("REGISTRY_ADDRESS");
  const client = makePublicClient(rpcHttp());
  const rows: PassTakeRow[] = [];
  for (const r of last.runs) {
    const runId = BigInt(r.runId);
    const run = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
    let holder: Address | null = null;
    try {
      holder = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "ownerOf", args: [runId] });
    } catch {
      holder = null;
    }
    rows.push({ runId, account: run.account, status: run.status, rule: run.rule, holder });
  }
  const s = summarizePassTake(rows);
  const out = {
    evidence: "rehearsal-pass",
    writtenAt: new Date().toISOString(),
    registry,
    take: last.take,
    passRunId: s.passRunId,
    runs: rows.map((r) => ({ ...r, statusName: RUN_STATUS[r.status], ruleName: RULE_NAMES[r.rule] })),
    problems: s.problems,
  };
  mkdirSync(dirname(repoPath("docs/evidence/rehearsal-pass.json")), { recursive: true });
  writeFileSync(repoPath("docs/evidence/rehearsal-pass.json"), `${JSON.stringify(jsonSafe(out), null, 2)}\n`);
  for (const p of s.problems) console.log(`FAIL ${p}`);
  console.log(s.ok ? `PASS pass-take (take ${last.take}: run ${s.passRunId} PASSED with its certificate, one FAILED)` : "FAIL pass-take");
  process.exit(s.ok ? 0 : 1);
}
