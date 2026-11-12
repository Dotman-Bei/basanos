// The sample refusal as a command (landing:5 runs it before the kit's checkers): the real snapshot and the built page
// must carry no sample marker. Run from the repo root: node --import tsx apps/landing/scripts/check-sample.ts
import { existsSync, readFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";
import { sampleProblems } from "./sample-guard";

const snapshot = repoPath("apps/landing/src/featured-verdict.json");
const page = repoPath("apps/landing/dist/index.html");
if (!existsSync(snapshot)) {
  console.log("FAIL sample: apps/landing/src/featured-verdict.json is missing (landing:2 writes it from a real verdict)");
  process.exit(1);
}
const problems = sampleProblems(JSON.parse(readFileSync(snapshot, "utf8")), existsSync(page) ? readFileSync(page, "utf8") : undefined);
for (const p of problems) console.log(`FAIL sample: ${p}`);
console.log(problems.length === 0 ? "PASS no sample" : "FAIL sample");
process.exit(problems.length === 0 ? 0 : 1);
