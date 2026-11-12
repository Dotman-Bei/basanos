// Demo parameters from real history (architect P7, 2026-11-12). Read-only and free: the chain serves historical
// getMarkPrice and getBookLevels, so a block range is sampled through Multicall3 at past blocks and replayed through the
// real evaluator (replay.ts).
//   collect --from <block> --to <block> [--step 10] [--out <file>]  samples every `step` blocks (10 = 1 s) into JSONL;
//                                                                   resumable; default out under node_modules/.cache
//   run --history <file> [--every 60] [--out <file>]                 replays an opposite pair opened every `every`
//                                                                   seconds for each candidate, prints the table and
//                                                                   writes docs/evidence/demo-replay.json
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import { BTC_POOL, MULTICALL3, multicall3Abi, perpPoolAbi, rulebookId, type Rulebook } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { loadRulebook, repoPath, rpcHttp } from "@basanos/core/node";
import { LOCK_BUFFER_BPS, jsonSafe } from "@basanos/referee";
import { parseSample, replayPair, summarize, type PairResult, type ReplayOptions, type Sample } from "./replay";

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BOOK_PARAMS = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };
const DEPTH = 10n;

/** One Multicall3 read per sample: block timestamp, mark, and 10 levels of each side, all at the sample's block. */
export function sampleCall(): Hex {
  const calls = [
    { target: MULTICALL3, allowFailure: true, callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" }) },
    { target: BTC_POOL, allowFailure: true, callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "tryGetMarkPrice" }) },
    { target: BTC_POOL, allowFailure: true, callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "getBookLevels", args: [true, DEPTH] }) },
    { target: BTC_POOL, allowFailure: true, callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "getBookLevels", args: [false, DEPTH] }) },
  ];
  return encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] });
}

/** The JSONL line for one block, or null when any of the four reads failed there. */
export function sampleLine(block: bigint, result: Hex): string | null {
  const rs = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: result });
  if (rs.length !== 4 || !rs.every((r) => r.success)) return null;
  const ts = decodeFunctionResult({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp", data: rs[0]!.returnData });
  const [ok, mark] = decodeFunctionResult({ abi: perpPoolAbi, functionName: "tryGetMarkPrice", data: rs[1]!.returnData });
  const lv = (data: Hex) =>
    decodeFunctionResult({ abi: perpPoolAbi, functionName: "getBookLevels", data }).map((x) => [x.price.toString(), x.quantity.toString()]);
  return JSON.stringify({ b: block.toString(), t: ts.toString(), ok, m: mark.toString(), bid: lv(rs[2]!.returnData), ask: lv(rs[3]!.returnData) });
}

async function collect(): Promise<void> {
  const from = BigInt(opt("--from") ?? "0");
  const to = BigInt(opt("--to") ?? "0");
  const step = BigInt(opt("--step") ?? "10");
  if (from <= 0n || to < from || step <= 0n) throw new Error("collect needs --from <block> --to <block> [--step 10]");
  const out = opt("--out") ?? repoPath(`node_modules/.cache/basanos/replay-${from}-${to}.jsonl`);
  mkdirSync(dirname(out), { recursive: true });
  const done = new Set<string>();
  if (existsSync(out)) for (const line of readFileSync(out, "utf8").split("\n")) if (line) done.add(String((JSON.parse(line) as { b: string }).b));
  const blocks: bigint[] = [];
  for (let b = from; b <= to; b += step) if (!done.has(b.toString())) blocks.push(b);
  console.log(`${blocks.length} samples to read into ${out} (${done.size} already there)`);
  const data = sampleCall();
  const BATCH = 20;
  let next = 0;
  let written = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += BATCH;
      if (i >= blocks.length) return;
      const slice = blocks.slice(i, i + BATCH);
      const body = slice.map((b, k) => ({ jsonrpc: "2.0", id: k, method: "eth_call", params: [{ to: MULTICALL3, data }, `0x${b.toString(16)}`] }));
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch(rpcHttp(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const replies = (await res.json()) as { id: number; result?: Hex }[];
          if (!Array.isArray(replies)) throw new Error("the RPC did not answer the batch");
          const lines: string[] = [];
          for (const r of replies) {
            const b = slice[r.id];
            const line = b !== undefined && r.result ? sampleLine(b, r.result) : null;
            if (line) lines.push(line);
            else failed += 1;
          }
          if (lines.length) appendFileSync(out, `${lines.join("\n")}\n`);
          written += lines.length;
          break;
        } catch (e) {
          if (attempt === 4) {
            failed += slice.length;
            console.log(`batch at block ${slice[0]} failed: ${(e as Error).message.slice(0, 120)}`);
          }
          await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  console.log(`collected ${written} samples, ${failed} failed -> ${out}`);
}

interface Candidate {
  label: string;
  rulebook: Rulebook;
  options: ReplayOptions;
}

/** The candidates the P7 ruling compared: the first demo as rehearsed, the chosen demo v2 at 10x, and its neighbours. */
export function candidates(): Candidate[] {
  const v1 = loadRulebook("tokyo-sprint-demo-v1");
  const v2 = loadRulebook("tokyo-sprint-demo");
  const o = (leverageX: number, latencySec: number, lockBufferBps: number): ReplayOptions => ({
    leverageX,
    startEquity: 50n * 10n ** 18n,
    latencySec,
    lockBufferBps,
    entryDelaySec: 3,
    params: BOOK_PARAMS,
    baseDecimals: 8,
  });
  const vary = (p: Partial<Rulebook>): Rulebook => ({ ...v2, ...p });
  return [
    { label: "demo v1 at 5x, closes 7 s after the verdict (the rehearsal)", rulebook: v1, options: o(5, 7, 0) },
    { label: "demo v2 at 10x, closes 3 s after the verdict (chosen)", rulebook: v2, options: o(DEMO_LEVERAGE_X, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 10x, closes 7 s after the verdict", rulebook: v2, options: o(DEMO_LEVERAGE_X, 7, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 10x, 900 s time limit", rulebook: vary({ timeLimitSec: 900 }), options: o(DEMO_LEVERAGE_X, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 5x", rulebook: v2, options: o(5, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 8x", rulebook: v2, options: o(8, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 12x", rulebook: v2, options: o(12, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 with a +0.40% target at 10x", rulebook: vary({ profitTargetBps: 40 }), options: o(DEMO_LEVERAGE_X, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 with v1's floors (0.50% daily, 0.75% trailing) at 10x", rulebook: vary({ dailyLossBps: 50, trailingDrawdownBps: 75 }), options: o(DEMO_LEVERAGE_X, 3, LOCK_BUFFER_BPS) },
  ];
}

export function replayAll(samples: readonly Sample[], everySec: number, list: readonly Candidate[] = candidates()) {
  return list.map((c) => {
    const pairs: PairResult[] = [];
    for (let i = 0; i < samples.length; i += everySec) {
      const p = replayPair(c.rulebook, samples, i, c.options);
      if (p) pairs.push(p);
    }
    const r = c.rulebook;
    return {
      label: c.label,
      rulebookId: rulebookId(r),
      rulebook: { profitTargetBps: r.profitTargetBps, dailyLossBps: r.dailyLossBps, trailingDrawdownBps: r.trailingDrawdownBps, maxExposureX: r.maxExposureX, minDurationSec: r.minDurationSec, timeLimitSec: r.timeLimitSec },
      leverageX: c.options.leverageX,
      latencySec: c.options.latencySec,
      lockBufferBps: c.options.lockBufferBps,
      summary: summarize(r, pairs),
    };
  });
}

async function run(): Promise<void> {
  const file = opt("--history");
  if (!file || !existsSync(file)) throw new Error("run needs --history <file.jsonl> (from collect)");
  const everySec = Number(opt("--every") ?? "60");
  const samples = readFileSync(file, "utf8").split("\n").filter(Boolean).map(parseSample).sort((a, b) => (a.block < b.block ? -1 : 1));
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) throw new Error("the history file is empty");
  const rows = replayAll(samples, everySec);
  for (const r of rows) {
    const s = r.summary;
    console.log(
      `${r.label}: ${s.windows} windows, P(at least one PASS) ${s.pAnyPass}, P(one PASS + one FAIL, no FAIL on demand) ${s.pOnePassOneFailNatural}, ` +
        `P(both FAIL) ${s.pBothFail}, refused locks ${s.pRefused}, first PASS median ${s.medianFirstPassSec} s (p90 ${s.p90FirstPassSec} s)`,
    );
  }
  const out = opt("--out") ?? repoPath("docs/evidence/demo-replay.json");
  const evidence = {
    evidence: "demo-replay",
    writtenAt: new Date().toISOString(),
    history: { fromBlock: first.block, toBlock: last.block, fromTime: first.timestamp, toTime: last.timestamp, samples: samples.length, stepBlocks: samples[1] ? samples[1].block - first.block : 0n },
    method:
      "An opposite pair (A long, B short, 50 USDso each) opened in the same block every `everySec` seconds of the history, each IOC walked through that block's book; " +
      "both runs judged at every sample by the core evaluator on closeable equity; a FAIL closed and a PASS locked `latencySec` after the verdict at the book of that later sample; " +
      "a lock only once closeable equity clears the target by `lockBufferBps`, and refused when the close realizes less than the target. With the demo's FAIL on demand " +
      "(the other run pushed past the exposure cap once one PASSES), P(at least one PASS) is also P(one PASS + one FAIL). Funding and fees are not modeled (fees are 0 on BTC-PERP).",
    everySec,
    candidates: rows,
    chosen: rows[1]?.label ?? null,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(jsonSafe(evidence), null, 2)}\n`);
  console.log(`wrote ${out}`);
}

const isMain = process.argv[1]?.endsWith("demo-replay.ts") ?? false;
if (isMain) {
  if (cmd === "collect") await collect();
  else if (cmd === "run") await run();
  else {
    console.error("usage: demo-replay.ts collect --from <block> --to <block> [--step 10] [--out <file>] | run --history <file> [--every 60] [--out <file>]");
    process.exit(2);
  }
  process.exit(0);
}
