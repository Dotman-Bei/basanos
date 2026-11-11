import { pad, type Address, type Hex } from "viem";
import { BTC_POOL, MARGIN_BANK, PRICE_FEED_SCHEDULER, decodeSnapshot, snapshotCall, startWatch } from "@basanos/core";
import { loadDotEnv, rpcWss } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { findActiveAccount } from "./find-active";
import { timestampUnit } from "./lib";
import { publicClient } from "./rpc";

loadDotEnv();
const seconds = Number(process.argv[2] ?? "30");
const account: Address = await findActiveAccount(publicClient());
const call = snapshotCall([account], BTC_POOL);
const blockNumbers: bigint[] = [];
let pushes = 0;
let accountPushes = 0;
let equityDecoded = false;
let unit: "seconds" | "milliseconds" | null = null;
let first: unknown = null;
const gaps: { atMs: number; reason: string }[] = [];

function take(results: Hex[]): void {
  const raw = results[0];
  if (!raw) return;
  const snap = decodeSnapshot(raw, [account], BTC_POOL);
  equityDecoded = true;
  if (blockNumbers.length < 50) blockNumbers.push(snap.blockNumber);
  unit ??= timestampUnit(snap.timestamp, Date.now());
  first ??= snap;
}

const prices = startWatch(rpcWss(), { address: PRICE_FEED_SCHEDULER, ethCalls: [call], pushChangesOnly: true }, {
  onPush: (p) => {
    pushes += 1;
    take(p.simulationResults);
  },
  onGap: (g) => gaps.push(g),
});
const own = startWatch(rpcWss(), { address: MARGIN_BANK, topics: [null, pad(account)], ethCalls: [call] }, {
  onPush: (p) => {
    accountPushes += 1;
    take(p.simulationResults);
  },
  onGap: (g) => gaps.push(g),
});

await new Promise((r) => setTimeout(r, seconds * 1000));
prices.close();
own.close();
writeEvidence("g1b-watch", {
  account,
  seconds,
  pushes,
  accountPushes,
  blockNumbers,
  timestampUnit: unit,
  equityDecoded,
  firstSnapshot: first,
  gaps,
  watches: ["PriceFeedScheduler + snapshot multicall (push_changes_only)", "MarginBank topic1=account + snapshot multicall"],
});
console.log(`watch-equity: ${pushes} price pushes, ${accountPushes} account pushes, unit ${unit}`);
process.exit(0);
