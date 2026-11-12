// Owner-only (REFEREE_PK): points the certificates' external_url at the live site, https://basanos.suitz.xyz/app/#/cert/
// (P9), then reads baseUrl() back and refuses to finish unless it equals that route. It refuses to send at all unless
// deployments/site.json names that site (deploy-vercel.ts writes it after the alias). On success deployments/hideki.json's
// baseUrl (the constructor's placeholder) is replaced by the real value.
import { readFileSync, writeFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, makeRefereeWallet } from "@basanos/referee";
import { SITE_URL, baseUrlProblem, certBaseUrl } from "./base-url";

loadDotEnv();
const sitePath = repoPath("deployments/site.json");
const depPath = repoPath("deployments/hideki.json");
const site = JSON.parse(readFileSync(sitePath, "utf8")) as { url: string; deployedAt: string; baseUrlTx: string | null; baseUrl?: string };
const dep = JSON.parse(readFileSync(depPath, "utf8")) as Record<string, unknown> & { registry: Address; baseUrl?: string };
if (site.url !== SITE_URL) {
  console.log(`FAIL deployments/site.json names ${site.url}; expected ${SITE_URL} (run deploy-vercel.ts first: it aliases the domain)`);
  process.exit(1);
}
const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
const client = makePublicClient(rpcHttp());
const url = certBaseUrl(SITE_URL);
const hash = await wallet.writeContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "setBaseUrl", args: [url] });
const receipt = await client.waitForTransactionReceipt({ hash });
const onChain = String(await client.readContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "baseUrl" }));
const problem = receipt.status === "success" ? baseUrlProblem(url, onChain) : `setBaseUrl reverted (${hash})`;
site.baseUrlTx = hash;
site.baseUrl = onChain;
writeFileSync(sitePath, `${JSON.stringify(site, null, 2)}\n`);
if (!problem) {
  dep.baseUrl = onChain;
  writeFileSync(depPath, `${JSON.stringify(dep, null, 2)}\n`);
}
console.log(`setBaseUrl ${receipt.status} ${hash} -> ${url}`);
console.log(`baseUrl() read back: ${onChain}`);
if (problem) console.log(`FAIL ${problem}`);
process.exit(problem ? 1 : 0);
