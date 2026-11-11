import { decodeEventLog, getAddress, type Hex } from "viem";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { BTC_POOL, CHAIN, HIDEKI_ADDRESSES, INDEXER_URL, ORACLE_DEPOSIT, basanosRegistryAbi, rulebookId } from "@basanos/core";
import { RULEBOOK_FILES, flag, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp, rpcWss } from "@basanos/core/node";
import { chainCloseIO, makePublicClient, makeRefereeWallet } from "./chain";
import { runDaemon } from "./daemon";
import { readActiveRuns, rulebookIndex } from "./runs";
import { makeRegistryWriter } from "./writer";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const rulebooks = [loadRulebook("tokyo-sprint"), loadRulebook("tokyo-sprint-demo")];

if (cmd === "start") {
  const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
  const markets = new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
  await runDaemon({
    client,
    wss: rpcWss(),
    registry,
    rulebooks,
    closeIO: chainCloseIO(client, wallet, BTC_POOL),
    writer: makeRegistryWriter(wallet, client, registry, flag("ORACLE_ENABLED") ? ORACLE_DEPOSIT : 0n),
    markets,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
} else if (cmd === "enroll") {
  const target = rest[0];
  const name = opt("--rulebook") as keyof typeof RULEBOOK_FILES | undefined;
  if (!target || !name || !(name in RULEBOOK_FILES)) {
    console.error("usage: cli.ts enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo>");
    process.exit(2);
  }
  const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
  const hash = await wallet.writeContract({
    address: registry,
    abi: basanosRegistryAbi,
    functionName: "startRun",
    args: [getAddress(target), rulebookId(loadRulebook(name))],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  let runId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") runId = ev.args.runId;
    } catch {
      // not a registry event
    }
  }
  console.log(runId === null ? `enroll failed: ${hash}` : `enrolled run ${runId} (${hash})`);
  process.exit(runId === null ? 1 : 0);
} else if (cmd === "status") {
  const runs = await readActiveRuns(client, registry, rulebookIndex(rulebooks));
  if (runs.length === 0) console.log("no active runs");
  for (const r of runs) console.log(`run ${r.runId}: ${r.account} on ${r.rulebook.label}, start equity ${r.startEquity} at block ${r.startBlock}`);
  process.exit(0);
} else {
  console.error("usage: cli.ts start | enroll <account> --rulebook <name> | status");
  process.exit(2);
}
