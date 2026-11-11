import { readFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

export function moneyShotOk(take: { runs: { status: string }[] }): boolean {
  const s = take.runs.map((r) => r.status).sort();
  return s.length === 2 && s[0] === "Failed" && s[1] === "Passed";
}

const isMain = process.argv[1]?.endsWith("check-money-shot.ts") ?? false;
if (isMain) {
  const takes = JSON.parse(readFileSync(repoPath("docs/evidence/demo-takes.json"), "utf8")) as { take: number; runs: { status: string }[] }[];
  const last = takes.at(-1);
  const ok = last ? moneyShotOk(last) : false;
  console.log(ok ? `PASS money-shot (take ${last?.take}: one PASS, one FAIL)` : "FAIL money-shot (the latest take is not one PASS and one FAIL)");
  process.exit(ok ? 0 : 1);
}
