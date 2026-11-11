// Owner-only (REFEREE_PK): points the certificates' external_url at the live site from deployments/site.json.
import { readFileSync, writeFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, makeRefereeWallet } from "@basanos/referee";

loadDotEnv();
const site = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string; deployedAt: string; baseUrlTx: string | null };
const dep = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
const client = makePublicClient(rpcHttp());
const url = `${site.url}/app/#/cert/`;
const hash = await wallet.writeContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "setBaseUrl", args: [url] });
const receipt = await client.waitForTransactionReceipt({ hash });
site.baseUrlTx = hash;
writeFileSync(repoPath("deployments/site.json"), `${JSON.stringify(site, null, 2)}\n`);
console.log(`setBaseUrl ${receipt.status} ${hash} -> ${url}`);
process.exit(receipt.status === "success" ? 0 : 1);
