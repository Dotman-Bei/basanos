// Demo parameters from real history (architect P7, 2026-11-12). The chain serves historical getMarkPrice and
// getBookLevels, so a recorded block range can be replayed through the real evaluator: an opposite pair opened in the
// same block, both judged on closeable equity at every sample, a FAIL closed and a PASS locked `latencySec` after the
// verdict at the book of that later sample. Pure: demo-replay.ts collects the samples and prints the summary.
import { BTC_POOL, quantityForLeverage, type AccountSnapshot, type BookParams, type Rulebook } from "@basanos/core";
import { averageFill, closeableEquity, type BookLevel, type BookSides } from "@basanos/core/book";
import { evaluate, initRunState, type FailRule } from "@basanos/core/evaluate";

/** One recorded block: its timestamp (seconds), the mark and both sides of the book. */
export interface Sample {
  block: bigint;
  timestamp: bigint;
  markOk: boolean;
  mark: bigint;
  book: BookSides;
}

/** Ledger blocks are 100 ms apart on Hideki (hidekiTestnet.blockTime), so a delay in seconds is ten blocks a second. */
export const BLOCKS_PER_SEC = 10n;

/** One line of the collector's JSONL: {"b","t","ok","m","bid":[[price,qty]…],"ask":[[price,qty]…]}. */
export function parseSample(line: string): Sample {
  const r = JSON.parse(line) as { b: string; t: string; ok: boolean; m: string; bid: [string, string][]; ask: [string, string][] };
  const lv = (xs: [string, string][]): BookLevel[] => xs.map(([p, q]) => ({ price: BigInt(p), quantity: BigInt(q) }));
  return { block: BigInt(r.b), timestamp: BigInt(r.t), markOk: r.ok, mark: BigInt(r.m), book: { bids: lv(r.bid), asks: lv(r.ask) } };
}

export interface ReplayOptions {
  leverageX: number;
  startEquity: bigint;
  /** Seconds from a verdict to the close that executes it (the referee's breach-to-close latency). */
  latencySec: number;
  /** The referee locks a PASS only when closeable equity clears the target by this many equity bps (P7). */
  lockBufferBps: number;
  /** Seconds between startRun and the pair's opens (the run's clock starts first). */
  entryDelaySec: number;
  params: BookParams;
  baseDecimals: number;
}

export type SideOutcome = "pass" | "fail" | "refused" | "open";

export interface SideResult {
  outcome: SideOutcome;
  /** The rule that failed it, "PassRefused" when the lock's close slipped under the target, or null. */
  rule: FailRule | "PassRefused" | null;
  /** Seconds from startRun to the verdict's close (the PASS or the FAIL), or to the end of the replay. */
  atSec: number;
  /** Closeable equity the verdict was judged on, and what the close realized, in equity bps of the start. */
  judgedBps: number | null;
  realizedBps: number | null;
}

export interface PairResult {
  entryBlock: bigint;
  long: SideResult;
  short: SideResult;
}

const bps = (equity: bigint, start: bigint): number => Number(((equity - start) * 1_000_000n) / start) / 100;

/** The sample `sec` seconds after index i (by block number), or -1 past the end. */
export function after(samples: readonly Sample[], i: number, sec: number): number {
  const target = (samples[i]?.block ?? 0n) + BigInt(Math.round(sec * 10));
  for (let k = i; k < samples.length; k++) if ((samples[k]?.block ?? 0n) >= target) return k;
  return -1;
}

/** One side of the pair, opened at sample `entry` with an IOC walked through that block's book, judged at every later
 *  sample by the real evaluator until a verdict or the time limit. */
export function replaySide(rb: Rulebook, samples: readonly Sample[], entry: number, isLong: boolean, o: ReplayOptions): SideResult | null {
  const open = samples[entry];
  if (!open || !open.markOk) return null;
  const qty = quantityForLeverage(o.startEquity, o.leverageX, open.mark, o.baseDecimals, o.params);
  if (qty < o.params.minQuantity) return null;
  const avg = averageFill(isLong, qty, open.book);
  if (avg === null) return null;
  const size = isLong ? qty : -qty;
  const one = 10n ** BigInt(o.baseDecimals);
  const startTime = open.timestamp - BigInt(o.entryDelaySec);
  let state = initRunState(startTime, o.startEquity);
  const marked = (s: Sample) => o.startEquity + (size * (s.mark - avg)) / one;
  const closeAt = (j: number): { realized: bigint | null; k: number } => {
    const k = after(samples, j, o.latencySec);
    const s = k < 0 ? undefined : samples[k];
    return { realized: s ? closeableEquity(marked(s), size, s.mark, s.book, o.baseDecimals) : null, k };
  };
  const sec = (k: number) => Number((samples[k]?.timestamp ?? startTime) - startTime);
  for (let j = entry + 1; j < samples.length; j++) {
    const s = samples[j]!;
    const total = marked(s);
    const acct: AccountSnapshot = { account: "0x0000000000000000000000000000000000000001", equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: [BTC_POOL], size };
    const ev = evaluate(rb, state, acct, { timestamp: s.timestamp, markOk: s.markOk, markPrice: s.mark, book: s.book });
    state = ev.state;
    const v = ev.verdict;
    if (v.kind === "fail") {
      const { realized, k } = closeAt(j);
      return { outcome: "fail", rule: v.rule, atSec: sec(k < 0 ? j : k), judgedBps: ev.judgedEquity === null ? null : bps(ev.judgedEquity, o.startEquity), realizedBps: realized === null ? null : bps(realized, o.startEquity) };
    }
    if (v.kind === "target" && ev.judgedEquity !== null && ev.judgedEquity * 10_000n >= o.startEquity * BigInt(10_000 + rb.profitTargetBps + o.lockBufferBps)) {
      const { realized, k } = closeAt(j);
      const passed = realized !== null && realized * 10_000n >= o.startEquity * BigInt(10_000 + rb.profitTargetBps);
      return {
        outcome: passed ? "pass" : "refused",
        rule: passed ? null : "PassRefused",
        atSec: sec(k < 0 ? j : k),
        judgedBps: bps(ev.judgedEquity, o.startEquity),
        realizedBps: realized === null ? null : bps(realized, o.startEquity),
      };
    }
  }
  return { outcome: "open", rule: null, atSec: sec(samples.length - 1), judgedBps: null, realizedBps: null };
}

/** The opposite pair the demo opens in the same block: A long, B short. null when either side cannot open there or
 *  the replay ends before the time limit. */
export function replayPair(rb: Rulebook, samples: readonly Sample[], entry: number, o: ReplayOptions): PairResult | null {
  const lastNeeded = after(samples, entry, rb.timeLimitSec + o.latencySec + 2);
  if (lastNeeded < 0) return null;
  const long = replaySide(rb, samples, entry, true, o);
  const short = replaySide(rb, samples, entry, false, o);
  if (!long || !short) return null;
  return { entryBlock: samples[entry]!.block, long, short };
}

export interface ReplaySummary {
  windows: number;
  /** P(at least one PASS): with the demo's FAIL on demand (an exposure breach on the other account once one PASSES),
   *  this is also P(one PASS + one FAIL). */
  pAnyPass: number;
  /** P(one PASS + one FAIL) with no FAIL on demand: the two runs left to the market. */
  pOnePassOneFailNatural: number;
  pBothPass: number;
  pBothFail: number;
  /** Locks whose close slipped under the target (counted as no PASS). */
  pRefused: number;
  medianFirstPassSec: number | null;
  p90FirstPassSec: number | null;
  /** How far a FAIL's realized loss went past the daily-loss floor, in equity bps (median and worst). */
  medianFailOvershootBps: number | null;
  worstFailOvershootBps: number | null;
}

const quantile = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? null;
};
const share = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 1000);

export function summarize(rb: Rulebook, pairs: readonly PairResult[]): ReplaySummary {
  const n = pairs.length;
  let any = 0, natural = 0, both = 0, refused = 0;
  const firstPass: number[] = [];
  const overshoot: number[] = [];
  for (const p of pairs) {
    const passes = [p.long, p.short].filter((s) => s.outcome === "pass");
    if (passes.length > 0) {
      any += 1;
      firstPass.push(Math.min(...passes.map((s) => s.atSec)));
    }
    if (passes.length === 2) both += 1;
    if (passes.length === 1) natural += 1;
    for (const s of [p.long, p.short]) {
      if (s.outcome === "refused") refused += 1;
      if (s.outcome === "fail" && s.rule === "DailyLoss" && s.realizedBps !== null) overshoot.push(-s.realizedBps - rb.dailyLossBps);
    }
  }
  return {
    windows: n,
    pAnyPass: share(any, n),
    pOnePassOneFailNatural: share(natural, n),
    pBothPass: share(both, n),
    pBothFail: share(n - any, n),
    pRefused: share(refused, 2 * n),
    medianFirstPassSec: quantile(firstPass, 0.5),
    p90FirstPassSec: quantile(firstPass, 0.9),
    medianFailOvershootBps: quantile(overshoot, 0.5),
    worstFailOvershootBps: overshoot.length ? Math.max(...overshoot) : null,
  };
}
