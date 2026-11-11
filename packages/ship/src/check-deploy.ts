import { readFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

const { url } = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string };
const problems: string[] = [];
for (const path of ["/", "/app/"]) {
  const res = await fetch(`${url}${path}`);
  const body = await res.text();
  if (res.status !== 200) problems.push(`${path} returned ${res.status}`);
  if (!body.includes("Basanos")) problems.push(`${path} does not mention Basanos`);
}
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? `PASS deploy (${url})` : "FAIL deploy");
process.exit(problems.length === 0 ? 0 : 1);
