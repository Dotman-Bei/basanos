import { BTC_POOL, PRICE_FEED_SCHEDULER, decodeSnapshot, snapshotCall, startWatch } from "@basanos/core";
import { loadDotEnv, rpcWss } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { appendTapePoint, type TapePoint } from "./lib";

loadDotEnv();
const seconds = Number(process.argv[2] ?? "540");
const call = snapshotCall([], BTC_POOL);
let points: TapePoint[] = [];
const gaps: { atMs: number; reason: string }[] = [];
const startedAt = new Date().toISOString();

const handle = startWatch(rpcWss(), { address: PRICE_FEED_SCHEDULER, ethCalls: [call], pushChangesOnly: true }, {
  onPush: (p) => {
    const raw = p.simulationResults[0];
    if (!raw) return;
    const snap = decodeSnapshot(raw, [], BTC_POOL);
    if (snap.markOk) points = appendTapePoint(points, { block: snap.blockNumber, ts: snap.timestamp, mark: snap.markPrice });
  },
  onGap: (g) => gaps.push(g),
});

await new Promise((r) => setTimeout(r, seconds * 1000));
handle.close();
writeEvidence("tape", { pool: BTC_POOL, market: "BTC-PERP", startedAt, seconds, gaps, points });
console.log(`tape: ${points.length} points over ${seconds}s`);
process.exit(0);
