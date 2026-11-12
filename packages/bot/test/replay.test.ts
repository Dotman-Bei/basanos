import { describe, expect, it } from "vitest";
import { loadRulebook } from "@basanos/core/node";
import { after, parseSample, replayPair, replaySide, summarize, type ReplayOptions, type Sample } from "../src/replay";

const E18 = 10n ** 18n;
const demo = loadRulebook("tokyo-sprint-demo");
const o: ReplayOptions = {
  leverageX: 10,
  startEquity: 50n * E18,
  latencySec: 3,
  lockBufferBps: 10,
  entryDelaySec: 3,
  params: { tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n },
  baseDecimals: 8,
};
// One sample a second; the book sits 19 bps (bids) and 21 bps (asks) above the mark, as measured on 2026-11-12.
function tape(markBps: (sec: number) => number, seconds = 1_300): Sample[] {
  const out: Sample[] = [];
  for (let s = 0; s <= seconds; s++) {
    const mark = (72_000n * E18 * BigInt(Math.round(1_000_000 + markBps(s) * 100))) / 1_000_000n;
    const at = (bps: bigint) => (mark * (10_000n + bps)) / 10_000n;
    out.push({ block: 1_000n + BigInt(s) * 10n, timestamp: 5_000n + BigInt(s), markOk: true, mark, book: { bids: [{ price: at(19n), quantity: 10n ** 8n }], asks: [{ price: at(21n), quantity: 10n ** 8n }] } });
  }
  return out;
}

describe("the demo replay (architect P7)", () => {
  it("reads the collector's lines and finds the sample a delay later by block", () => {
    const s = parseSample('{"b":"100","t":"7","ok":true,"m":"5","bid":[["6","1"]],"ask":[["7","2"]]}');
    expect(s).toEqual({ block: 100n, timestamp: 7n, markOk: true, mark: 5n, book: { bids: [{ price: 6n, quantity: 1n }], asks: [{ price: 7n, quantity: 2n }] } });
    const t = tape(() => 0, 20);
    expect(after(t, 2, 3)).toBe(5);
    expect(after(t, 18, 5)).toBe(-1);
  });
  it("passes the long and fails the short in a steady rally, closing each at the book 3 s after its verdict", () => {
    const t = tape((s) => s * 0.05);
    const p = replayPair(demo, t, 0, o)!;
    expect(p.long.outcome).toBe("pass");
    expect(p.long.atSec).toBeGreaterThanOrEqual(demo.minDurationSec);
    expect(p.long.realizedBps!).toBeGreaterThanOrEqual(demo.profitTargetBps);
    expect(p.short.outcome).toBe("fail");
    expect(p.short.rule).toBe("DailyLoss");
    expect(p.short.realizedBps!).toBeLessThanOrEqual(-demo.dailyLossBps);
    expect(summarize(demo, [p])).toMatchObject({ windows: 1, pAnyPass: 1, pOnePassOneFailNatural: 1, pBothFail: 0, pRefused: 0 });
  });
  it("refuses a lock whose close slips back under the target, and waits for the buffer before locking", () => {
    // A long bought at the ask and valued at the bid starts 2 bps of price down, so at 10x the +0.50% target needs the
    // mark 7 bps up. Here it jumps 7.5 bps at 60 s (closeable +0.55%) and falls 2 bps a second: the close 3 s later
    // realizes under the target.
    const spike = tape((s) => (s < 60 ? 0 : 7.5 - (s - 60) * 2));
    expect(replaySide(demo, spike, 0, true, { ...o, lockBufferBps: 0 })).toMatchObject({ outcome: "refused", rule: "PassRefused" });
    // Held at 7.4 bps (closeable +0.54%): without a buffer it locks and passes; with 10 bps it never locks.
    const shy = tape((s) => (s < 60 ? 0 : 7.4));
    expect(replaySide(demo, shy, 0, true, { ...o, lockBufferBps: 0 })!.outcome).toBe("pass");
    expect(replaySide(demo, shy, 0, true, o)).toMatchObject({ outcome: "fail", rule: "TimeLimit" });
  });
  it("fails both sides of a still market at the time limit", () => {
    const p = replayPair(demo, tape(() => 0), 0, o)!;
    expect([p.long.rule, p.short.rule]).toEqual(["TimeLimit", "TimeLimit"]);
    expect(summarize(demo, [p]).pBothFail).toBe(1);
    expect(replayPair(demo, tape(() => 0, 100), 0, o)).toBeNull();
  });
});
