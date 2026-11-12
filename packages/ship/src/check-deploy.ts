// The live site answers on its own domain (P9): / and /app/ on https://basanos.suitz.xyz, fetched unauthenticated, must
// answer 200 and stay on the domain after redirects, polled for up to 2 minutes after the alias. deployments/site.json
// names that site, the registry's baseUrl() points the certificates at it, and neither the live pages nor the assembled
// site/basanos output carries the landing's sample-fixture marker (ship:10).
import { existsSync, readFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { SITE_URL, baseUrlProblem, certBaseUrl } from "./base-url";
import { sampleInBuild } from "./sample";
import { fetchPage, pollSite } from "./site-check";

loadDotEnv();
const site = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string };
const { registry } = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const problems: string[] = [];
if (site.url !== SITE_URL) problems.push(`deployments/site.json names ${site.url}; expected ${SITE_URL}`);
const live = await pollSite(fetchPage, SITE_URL, ["/", "/app/"], { timeoutMs: 120_000, intervalMs: 5_000 });
console.log(`${SITE_URL}: ${live.problems.length === 0 ? "/ and /app/ answer 200 on the domain" : "still failing"} (${live.attempts} attempt${live.attempts === 1 ? "" : "s"})`);
problems.push(...live.problems);
const bodies: Record<string, string> = { ...live.bodies };
for (const rel of ["site/basanos/index.html", "site/basanos/app/index.html"]) {
  const p = repoPath(rel);
  if (existsSync(p)) bodies[rel] = readFileSync(p, "utf8");
}
problems.push(...sampleInBuild(bodies));
const onChain = String(await makePublicClient(rpcHttp()).readContract({ address: registry, abi: basanosRegistryAbi, functionName: "baseUrl" }));
const wrong = baseUrlProblem(certBaseUrl(SITE_URL), onChain);
if (wrong) problems.push(wrong);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? `PASS deploy (${SITE_URL})` : "FAIL deploy");
process.exit(problems.length === 0 ? 0 : 1);
