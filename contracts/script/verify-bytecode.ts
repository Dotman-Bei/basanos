// Matches the on-chain runtime code against the forge artifact with immutable slots masked (independent of
// the explorer). --explorer additionally tries `forge verify-contract` against the Tokyo explorer and records
// its output; that attempt never decides the result.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { CHAIN } from "@basanos/core";
import { repoPath, rpcHttp } from "@basanos/core/node";

interface Artifact {
  deployedBytecode: { object: Hex; immutableReferences?: Record<string, { start: number; length: number }[]> };
}
const dep = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const artifact = JSON.parse(readFileSync(repoPath("contracts/out/BasanosRegistry.sol/BasanosRegistry.json"), "utf8")) as Artifact;
const client = createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) });
const onchain = (await client.getCode({ address: dep.registry })) ?? "0x";
const local = artifact.deployedBytecode.object;
const refs = Object.values(artifact.deployedBytecode.immutableReferences ?? {}).flat();
let masked = onchain.slice(2);
for (const r of refs) {
  masked = masked.slice(0, r.start * 2) + "0".repeat(r.length * 2) + masked.slice((r.start + r.length) * 2);
}
const match = masked.toLowerCase() === local.slice(2).toLowerCase();
let explorer: { attempted: boolean; status: number | null; output: string } = { attempted: false, status: null, output: "" };
if (process.argv.includes("--explorer")) {
  const res = spawnSync(
    "forge",
    [
      "verify-contract",
      dep.registry,
      "src/BasanosRegistry.sol:BasanosRegistry",
      "--root",
      repoPath("contracts"),
      "--chain-id",
      "50383",
      "--verifier",
      "blockscout",
      "--verifier-url",
      "https://explorer.testnet.somnia.network/tokyo/api/",
      "--rpc-url",
      rpcHttp(),
      "--guess-constructor-args",
    ],
    { encoding: "utf8" },
  );
  explorer = { attempted: true, status: res.status, output: `${res.stdout ?? ""}${res.stderr ?? ""}`.slice(0, 4000) };
}
const evidence = {
  evidence: "verify",
  writtenAt: new Date().toISOString(),
  registry: dep.registry,
  runtimeBytes: (onchain.length - 2) / 2,
  immutableSlots: refs.length,
  match,
  explorer,
};
mkdirSync(dirname(repoPath("docs/evidence/verify.json")), { recursive: true });
writeFileSync(repoPath("docs/evidence/verify.json"), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(match ? "PASS verify" : "FAIL verify (runtime bytecode differs from the artifact)");
process.exit(match ? 0 : 1);
