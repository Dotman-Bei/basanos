// Decides whether the book is fit for a demo take right now (spec §5). Read-only. The demo parameters themselves come
// from the replay of real history (architect P7, docs/evidence/demo-replay.json), so a FAIL here means "wait for a
// tighter book and re-run", never "change the rulebook": a wide spread is a moment, not a parameter.
// Rules judge closeable equity (P5 ruling, 2026-11-12), so a run pays the spread between the two sides of the book at
// entry and nothing more at the close: the cost is the buy average minus the sell average for the demo size, both
// walked from ONE book read (one block), at DEMO_LEVERAGE_X. (The distance from the mark is the mark-to-book basis, about 19 bps on 2026-11-12, and is
// not a cost any more.) Sizes from the demo accounts' real equity (or --equity <USDso>), never from a fixed 1,000
// USDso, and checks the size against the pool's minimum order (0.00013 BTC on BTC-PERP).
import { readFileSync } from "node:fs";
import { BTC_POOL, readSnapshot } from "@basanos/core";
import { averageFill, readBookLevels } from "@basanos/core/book";
import { DEMO_LEVERAGE_X, parseTape, simulateTape } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { readBook } from "./actions";
import { demoCost, demoEquity, demoSize } from "./sizing";

loadDotEnv();
const rb = loadRulebook("tokyo-sprint-demo");
const flagAt = process.argv.indexOf("--equity");
const equityFlag = flagAt >= 0 ? (process.argv[flagAt + 1] ?? "") : null;
const client = makePublicClient(rpcHttp());
const book = await readBook(client);
const accounts = equityFlag === null ? [requireAddress("ACCOUNT_A_ADDRESS"), requireAddress("ACCOUNT_B_ADDRESS")] : [];
const snap = await readSnapshot(client, accounts, BTC_POOL);
let equity: bigint | null;
try {
  equity = demoEquity(equityFlag, snap.accounts.map((a) => a.totalEquity));
} catch (e) {
  console.log(`FAIL demo-check: ${(e as Error).message}`);
  process.exit(1);
}
if (equity === null) {
  console.log("FAIL demo-check: accounts A and B hold no equity yet; fund them, or pass --equity <USDso> (for example --equity 50)");
  process.exit(1);
}
const size = demoSize(equity, DEMO_LEVERAGE_X, snap.markPrice, rb.market.baseDecimals, book);
if (size.problem) {
  console.log(`FAIL demo-check: ${size.problem}`);
  process.exit(1);
}
const qty = size.qty;
const levels = await readBookLevels(client, BTC_POOL);
const buyAverage = levels ? averageFill(true, qty, levels) : null;
const sellAverage = levels ? averageFill(false, qty, levels) : null;
if (buyAverage === null || sellAverage === null) {
  console.log(`FAIL demo-check: the book is too thin to fill the demo size ${qty} on both sides; retry when the book refills, or lower the demo leverage`);
  process.exit(1);
}
const cost = demoCost(buyAverage, sellAverage, DEMO_LEVERAGE_X, rb.profitTargetBps);
const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
const sim = simulateTape(rb, tape, { leverageX: DEMO_LEVERAGE_X, startEquity: equity, lotSize: book.lotSize, entryCostBps: cost.spreadBps, exitCostBps: 0 });
const tapeOk = sim.long.outcome === "target" || sim.short.outcome === "target";
console.log(
  `demo size ${qty} (${DEMO_LEVERAGE_X}x on ${equity} wei of equity, ${equityFlag === null ? "the smaller live equity of A and B" : "from --equity"}); ` +
    `round trip ${cost.spreadBps} bps of notional at block ${levels?.blockNumber} (buy average ${buyAverage}, sell average ${sellAverage})`,
);
console.log(`round trip ${cost.equityBps} equity bps vs half target ${rb.profitTargetBps / 2}: ${cost.ok ? "ok" : "too costly"}`);
console.log(`tape with costs: long ${sim.long.outcome}, short ${sim.short.outcome}`);
if (cost.ok && tapeOk) {
  console.log("PASS demo-check");
  process.exit(0);
}
console.log(
  `FAIL demo-check: ${cost.ok ? "the tape does not resolve" : `the round trip is ${cost.spreadBps} bps of notional right now`}; ` +
    "wait a few minutes for a tighter book and re-run (do not edit or re-register the rulebook)",
);
process.exit(1);
