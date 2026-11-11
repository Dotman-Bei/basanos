import { readFileSync } from "node:fs";
import { createPublicClient, getAddress, http, type Address, type Hex } from "viem";
import { CHAIN, basanosRegistryAbi } from "@basanos/core";
import { repoPath, rpcHttp } from "@basanos/core/node";

interface Deployment {
  registry: Address;
  referee: Address;
  rulebooks: { name: string; id: Hex; status: string }[];
}
const dep = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as Deployment;
const client = createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) });
const problems: string[] = [];
const code = await client.getCode({ address: dep.registry });
if (!code || code === "0x") problems.push("no code at the registry address");
const referee = await client.readContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "referee" });
if (getAddress(referee) !== getAddress(dep.referee)) problems.push(`referee() is ${referee}, expected ${dep.referee}`);
if (dep.rulebooks.length !== 2) problems.push("expected two registered rulebooks");
for (const rb of dep.rulebooks) {
  const params = await client.readContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "getRulebook", args: [rb.id] });
  if (!params.exists) problems.push(`rulebook ${rb.name} (${rb.id}) is not registered`);
}
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? "PASS deployment" : "FAIL deployment");
process.exit(problems.length === 0 ? 0 : 1);
