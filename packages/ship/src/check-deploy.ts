// The live site answers at / and /app/, the registry's baseUrl() points the certificates at this site, and neither the
// live pages nor the assembled site/basanos output carries the landing's sample-fixture marker (ship:10).
import { existsSync, readFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { baseUrlProblem, certBaseUrl } from "./base-url";
import { sampleInBuild } from "./sample";

loadDotEnv();
const { url } = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string };
const { registry } = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const problems: string[] = [];
const bodies: Record<string, string> = {};
for (const path of ["/", "/app/"]) {
  const res = await fetch(`${url}${path}`);
  const body = await res.text();
  bodies[`${url}${path}`] = body;
  if (res.status !== 200) problems.push(`${path} returned ${res.status}`);
  if (!body.includes("Basanos")) problems.push(`${path} does not mention Basanos`);
}
for (const rel of ["site/basanos/index.html", "site/basanos/app/index.html"]) {
  const p = repoPath(rel);
  if (existsSync(p)) bodies[rel] = readFileSync(p, "utf8");
}
problems.push(...sampleInBuild(bodies));
const onChain = String(await makePublicClient(rpcHttp()).readContract({ address: registry, abi: basanosRegistryAbi, functionName: "baseUrl" }));
const wrong = baseUrlProblem(certBaseUrl(url), onChain);
if (wrong) problems.push(wrong);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? `PASS deploy (${url})` : "FAIL deploy");
process.exit(problems.length === 0 ? 0 : 1);
