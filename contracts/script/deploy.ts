// Deploys BasanosRegistry with the referee burner as owner and referee, then registers both Tokyo Sprint
// variants. --dry-run prints the plan and sends nothing. Run `node contracts/script/forge.mjs build` first.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, MARGIN_BANK, SOMNIA_AGENTS, basanosRegistryAbi, explorerTx, registerArgs } from "@basanos/core";
import { loadDotEnv, loadRulebook, repoPath, requirePrivateKey, rpcHttp } from "@basanos/core/node";

loadDotEnv(repoPath(".env"));
const dryRun = process.argv.includes("--dry-run");
const CERT_BASE_URL = "https://basanos.vercel.app/app/#/cert/";
const artifact = JSON.parse(readFileSync(repoPath("contracts/out/BasanosRegistry.sol/BasanosRegistry.json"), "utf8")) as {
  bytecode: { object: Hex };
};
const account = privateKeyToAccount(requirePrivateKey("REFEREE_PK"));
const client = createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) });
const wallet = createWalletClient({ account, chain: CHAIN, transport: http(rpcHttp()) });
const books = (["tokyo-sprint", "tokyo-sprint-demo"] as const).map((name) => ({ name, args: registerArgs(loadRulebook(name)) }));

console.log(`deployer = owner = referee: ${account.address}; balance ${await client.getBalance({ address: account.address })} wei`);
for (const b of books) {
  console.log(`rulebook ${b.name}: id ${b.args[0]} pool ${b.args[1]} target ${b.args[2]}bps min ${b.args[3]}s limit ${b.args[4]}s oracle ${b.args[5]}`);
}
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}

const deployTx = await wallet.deployContract({
  abi: basanosRegistryAbi,
  bytecode: artifact.bytecode.object,
  args: [MARGIN_BANK, SOMNIA_AGENTS, account.address, CERT_BASE_URL],
});
const deployReceipt = await client.waitForTransactionReceipt({ hash: deployTx });
if (deployReceipt.status !== "success" || !deployReceipt.contractAddress) {
  console.error(`deploy failed: ${explorerTx(deployTx)} (if the chain rejected cancun bytecode, set evm_version = "paris" and rebuild)`);
  process.exit(1);
}
const registry = deployReceipt.contractAddress;
const rulebooks: { name: string; id: Hex; tx: Hex; status: string; gasUsed: string }[] = [];
for (const b of books) {
  const tx = await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "registerRulebook", args: [...b.args] });
  const r = await client.waitForTransactionReceipt({ hash: tx });
  rulebooks.push({ name: b.name, id: b.args[0], tx, status: r.status, gasUsed: r.gasUsed.toString() });
}
const out = {
  chainId: CHAIN.id,
  registry,
  deployTx,
  deployBlock: deployReceipt.blockNumber.toString(),
  owner: account.address,
  referee: account.address,
  marginBank: MARGIN_BANK,
  somniaAgents: SOMNIA_AGENTS,
  baseUrl: CERT_BASE_URL,
  solc: "0.8.28",
  evmVersion: "cancun",
  viaIr: true,
  deployGasUsed: deployReceipt.gasUsed.toString(),
  deployCostWei: (deployReceipt.gasUsed * deployReceipt.effectiveGasPrice).toString(),
  rulebooks,
};
mkdirSync(dirname(repoPath("deployments/hideki.json")), { recursive: true });
writeFileSync(repoPath("deployments/hideki.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`registry ${registry} — ${explorerTx(deployTx)}`);
console.log("next: put REGISTRY_ADDRESS=<registry> into .env");
process.exit(0);
