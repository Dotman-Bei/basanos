// The live site answers at / and /app/, and the registry's baseUrl() points the certificates at this site.
import { readFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { baseUrlProblem, certBaseUrl } from "./base-url";

loadDotEnv();
const { url } = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string };
const { registry } = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const problems: string[] = [];
for (const path of ["/", "/app/"]) {
  const res = await fetch(`${url}${path}`);
  const body = await res.text();
  if (res.status !== 200) problems.push(`${path} returned ${res.status}`);
  if (!body.includes("Basanos")) problems.push(`${path} does not mention Basanos`);
}
const onChain = String(await makePublicClient(rpcHttp()).readContract({ address: registry, abi: basanosRegistryAbi, functionName: "baseUrl" }));
const wrong = baseUrlProblem(certBaseUrl(url), onChain);
if (wrong) problems.push(wrong);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? `PASS deploy (${url})` : "FAIL deploy");
process.exit(problems.length === 0 ? 0 : 1);
