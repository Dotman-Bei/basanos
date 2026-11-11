// R5: calls the deployed registry's previewStart for account A at a pinned block and compares its in-contract
// MarginBank reads with the SDK's getAccountEquity at the same block. Read-only; needs ACCOUNT_A_ADDRESS.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { CHAIN, MARGIN_BANK, PREVIEW_CODES, basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { marketsFor } from "../../packages/spike/src/rpc";

loadDotEnv(repoPath(".env"));
const dep = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as {
  registry: Address;
  rulebooks: { name: string; id: Hex }[];
};
const demo = dep.rulebooks.find((r) => r.name === "tokyo-sprint-demo");
if (!demo) throw new Error("deployments/hideki.json has no tokyo-sprint-demo");
const account = requireAddress("ACCOUNT_A_ADDRESS");
const client = createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) });
const block = (await client.getBlockNumber()) - 2n;
const [code, read] = await client.readContract({
  address: dep.registry,
  abi: basanosRegistryAbi,
  functionName: "previewStart",
  args: [account, demo.id],
  blockNumber: block,
});
const sdk = await marketsFor().client.getAccountEquity(account, { scope: "perps", marginBank: MARGIN_BANK, blockNumber: block });
const match = code === 0 && read.equity === sdk.equity && read.lockedCollateral === sdk.lockedCollateral;
const evidence = {
  evidence: "r5-preview",
  writtenAt: new Date().toISOString(),
  registry: dep.registry,
  account,
  block: block.toString(),
  code,
  codeName: PREVIEW_CODES[code] ?? `code ${code}`,
  read: {
    blockNumber: read.blockNumber.toString(),
    equityOk: read.equityOk,
    equity: read.equity.toString(),
    lockedCollateral: read.lockedCollateral.toString(),
    positionSize: read.positionSize.toString(),
    markOk: read.markOk,
    markPrice: read.markPrice.toString(),
  },
  sdk: { equity: sdk.equity.toString(), lockedCollateral: sdk.lockedCollateral.toString(), asOfBlock: sdk.asOfBlock.toString() },
  match,
};
mkdirSync(dirname(repoPath("docs/evidence/r5-preview.json")), { recursive: true });
writeFileSync(repoPath("docs/evidence/r5-preview.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(match ? "PASS r5-preview" : `FAIL r5-preview (code ${code} ${PREVIEW_CODES[code] ?? ""}; registry ${read.equity} vs sdk ${sdk.equity})`);
process.exit(match ? 0 : 1);
