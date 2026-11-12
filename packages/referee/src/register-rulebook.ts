// Owner-only (REFEREE_PK): registers a rulebook file's id and contract-checked fields, and records it in
// deployments/hideki.json. Used for a new demo variant (architect P7: demo v2). Each recorded entry is named after the
// rulebook file whose id it holds, so the first demo's entry reads tokyo-sprint-demo-v1 once v2 takes its file name.
import { readFileSync, writeFileSync } from "node:fs";
import type { Hex } from "viem";
import { basanosRegistryAbi, registerArgs, rulebookId } from "@basanos/core";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, repoPath, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, makeRefereeWallet } from "./chain";

loadDotEnv();
const name = process.argv[2] as keyof typeof RULEBOOK_FILES | undefined;
if (!name || !(name in RULEBOOK_FILES)) {
  console.error(`usage: register-rulebook.ts <${Object.keys(RULEBOOK_FILES).join("|")}>`);
  process.exit(2);
}
const fileNameOf = (id: Hex): string | undefined =>
  (Object.keys(RULEBOOK_FILES) as (keyof typeof RULEBOOK_FILES)[]).find((n) => rulebookId(loadRulebook(n)).toLowerCase() === id.toLowerCase());
const registry = requireAddress("REGISTRY_ADDRESS");
const client = makePublicClient(rpcHttp());
const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
const args = registerArgs(loadRulebook(name));
const existing = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRulebook", args: [args[0]] });
if (existing.exists) {
  console.log(`rulebook ${name} (${args[0]}) is already registered`);
  process.exit(0);
}
const tx = await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "registerRulebook", args: [...args] });
const receipt = await client.waitForTransactionReceipt({ hash: tx });
const depPath = repoPath("deployments/hideki.json");
const dep = JSON.parse(readFileSync(depPath, "utf8")) as { rulebooks: { name: string; id: Hex; tx: Hex; status: string; gasUsed: string }[] };
dep.rulebooks = dep.rulebooks.map((r) => ({ ...r, name: fileNameOf(r.id) ?? r.name }));
dep.rulebooks.push({ name, id: args[0], tx, status: receipt.status, gasUsed: receipt.gasUsed.toString() });
writeFileSync(depPath, `${JSON.stringify(dep, null, 2)}\n`);
console.log(`registered ${name} ${args[0]} (${receipt.status}) ${tx}`);
process.exit(receipt.status === "success" ? 0 : 1);
