import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RULE_NAMES, RUN_STATUS, basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "./chain";
import { jsonSafe } from "./evidence";

export function summarizeRehearsal(runs: readonly { runId: bigint; status: number; rule: number; closeTxs: number }[]): {
  ok: boolean;
  firstVerdictRunId: bigint | null;
  problems: string[];
} {
  const problems: string[] = [];
  const verdicts = runs.filter((r) => r.status === 2 || r.status === 3).sort((a, b) => (a.runId < b.runId ? -1 : 1));
  if (verdicts.length === 0) problems.push("no PASSED or FAILED run recorded");
  for (const r of runs) if (r.status === 3 && r.closeTxs === 0) problems.push(`run ${r.runId} FAILED without close transactions`);
  return { ok: problems.length === 0, firstVerdictRunId: verdicts[0]?.runId ?? null, problems };
}

const isMain = process.argv[1]?.endsWith("check-rehearsal.ts") ?? false;
if (isMain) {
  loadDotEnv();
  const takesPath = repoPath("docs/evidence/demo-takes.json");
  if (!existsSync(takesPath)) {
    console.log("FAIL rehearsal (docs/evidence/demo-takes.json is missing; run the demo first)");
    process.exit(1);
  }
  const takes = JSON.parse(readFileSync(takesPath, "utf8")) as { runs: { runId: string }[] }[];
  const registry = requireAddress("REGISTRY_ADDRESS");
  const client = makePublicClient(rpcHttp());
  const rows: { runId: bigint; status: number; rule: number; closeTxs: number }[] = [];
  for (const t of takes) {
    for (const r of t.runs) {
      const runId = BigInt(r.runId);
      const run = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
      const closes = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getCloseTxs", args: [runId] });
      rows.push({ runId, status: run.status, rule: run.rule, closeTxs: closes.length });
    }
  }
  const s = summarizeRehearsal(rows);
  const out = {
    evidence: "rehearsal",
    writtenAt: new Date().toISOString(),
    registry,
    firstVerdictRunId: s.firstVerdictRunId,
    runs: rows.map((r) => ({ ...r, statusName: RUN_STATUS[r.status], ruleName: RULE_NAMES[r.rule] })),
    problems: s.problems,
  };
  mkdirSync(dirname(repoPath("docs/evidence/rehearsal.json")), { recursive: true });
  writeFileSync(repoPath("docs/evidence/rehearsal.json"), `${JSON.stringify(jsonSafe(out), null, 2)}\n`);
  for (const p of s.problems) console.log(`FAIL ${p}`);
  console.log(s.ok ? `PASS rehearsal (first verdict run ${s.firstVerdictRunId})` : "FAIL rehearsal");
  process.exit(s.ok ? 0 : 1);
}
