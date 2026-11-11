import { getAddress, type Address } from "viem";
import { MARGIN_BANK, marginBankAbi } from "@basanos/core";
import { loadDotEnv } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { findActiveAccount } from "./find-active";
import { HISTORY_DEPTHS, depthBlocks, maxServed } from "./lib";
import { marketsFor, publicClient } from "./rpc";

loadDotEnv();
const client = publicClient();
const account: Address = process.argv[2] ? getAddress(process.argv[2]) : await findActiveAccount(client);
const head = await client.getBlockNumber();
console.log(`history: account ${account}, head ${head}`);

const depths: { back: number; block: bigint; ok: boolean; equityOk?: boolean; equity?: bigint; error?: string }[] = [];
for (const { back, block } of depthBlocks(head, HISTORY_DEPTHS)) {
  try {
    const [equityOk, equity] = await client.readContract({
      address: MARGIN_BANK,
      abi: marginBankAbi,
      functionName: "tryGetAccountEquity",
      args: [account],
      blockNumber: block,
    });
    depths.push({ back, block, ok: true, equityOk, equity });
    console.log(`  back ${back}: served (equityOk=${equityOk})`);
  } catch (e) {
    depths.push({ back, block, ok: false, error: (e as Error).message.slice(0, 300) });
    console.log(`  back ${back}: NOT served`);
  }
}
writeEvidence("g1c-history", { account, head, depths, maxServedBack: maxServed(depths), call: "MarginBank.tryGetAccountEquity(account)" });

const markets = marketsFor();
const reads: { name: string; ok: boolean; rows?: number; sample?: unknown; error?: string }[] = [];
async function attempt(name: string, fn: () => Promise<unknown[]>): Promise<void> {
  try {
    const rows = await fn();
    reads.push({ name, ok: true, rows: rows.length, sample: rows.slice(0, 2) });
    console.log(`  ${name}: ok, ${rows.length} rows`);
  } catch (e) {
    const err = e as Error;
    reads.push({ name, ok: false, error: `${err.name}: ${err.message}`.slice(0, 600) });
    console.log(`  ${name}: FAILED (${err.name})`);
  }
}
await attempt("getMarginEvents", () => markets.client.getMarginEvents(account));
await attempt("listPerpMarginPulls", () => markets.client.listPerpMarginPulls({ account, limit: 5 }));
await attempt("listPerpMainFundingEvents", () => markets.client.listPerpMainFundingEvents({ account, limit: 5 }));
writeEvidence("r1-indexer", { account, sdkVersion: "0.33.0", indexer: "https://hideki-dev.smk.somnia.host/v1/graphql", reads });
process.exit(0);
