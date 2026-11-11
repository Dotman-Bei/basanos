// Decides whether the demo target is trustworthy given real trading costs (spec §5). Read-only.
import { existsSync, readFileSync } from "node:fs";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { BTC_POOL, CHAIN, HIDEKI_ADDRESSES, INDEXER_URL, MARGIN_BANK, quantityForLeverage, readSnapshot } from "@basanos/core";
import { costBpsVsMark, parseTape, recommendDemoTargetBps, roundTripEquityBps, simulateTape } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { readBook } from "./actions";

loadDotEnv();
const rb = loadRulebook("tokyo-sprint-demo");
const LEVERAGE = 12;
const client = makePublicClient(rpcHttp());
const markets = new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
const g1aPath = repoPath("docs/evidence/g1a-close.json");
const entryCost = existsSync(g1aPath) ? Number((JSON.parse(readFileSync(g1aPath, "utf8")) as { entry?: { costBps?: number } }).entry?.costBps ?? 0) : 0;
const book = await readBook(client);
const snap = await readSnapshot(client, [], BTC_POOL);
const qty = quantityForLeverage(1_000n * 10n ** 18n, LEVERAGE, snap.markPrice, rb.market.baseDecimals, book);
const live: number[] = [];
for (const isBid of [true, false]) {
  const q = await markets.client.quotePerpClose({ pool: BTC_POOL, marginBank: MARGIN_BANK, isBid, quantity: qty });
  if (q.priceable && q.averagePrice !== null && q.fillableSize === q.quantity) live.push(costBpsVsMark(isBid, q.referencePrice, q.averagePrice));
  else live.push(Number.POSITIVE_INFINITY);
}
const oneWay = Math.max(entryCost, ...live);
if (!Number.isFinite(oneWay)) {
  console.log(`FAIL demo-check: the book is too thin to fill the demo size ${qty} on both sides (live buy ${live[0]}, live sell ${live[1]}); retry when the book refills, or lower the demo leverage`);
  process.exit(1);
}
const roundTripEq = roundTripEquityBps(oneWay, LEVERAGE);
const halfTarget = rb.profitTargetBps / 2;
const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
const sim = simulateTape(rb, tape, { leverageX: LEVERAGE, startEquity: 1_000n * 10n ** 18n, lotSize: book.lotSize, entryCostBps: oneWay, exitCostBps: oneWay });
const costOk = roundTripEq <= halfTarget;
const tapeOk = sim.long.outcome === "target" || sim.short.outcome === "target";
console.log(`demo size ${qty} (${LEVERAGE}x); one-way cost ${oneWay} bps (g1a entry ${entryCost}, live buy ${live[0]}, live sell ${live[1]})`);
console.log(`round trip ${roundTripEq} equity bps vs half target ${halfTarget}: ${costOk ? "ok" : "too costly"}`);
console.log(`tape with costs: long ${sim.long.outcome}, short ${sim.short.outcome}`);
if (costOk && tapeOk) {
  console.log("PASS demo-check");
  process.exit(0);
}
console.log(`FAIL demo-check: raise profitTargetBps in rulebooks/tokyo-sprint-demo.json to ${recommendDemoTargetBps(roundTripEq)} and register it`);
process.exit(1);
