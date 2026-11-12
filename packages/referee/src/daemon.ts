import { pad, type Address, type Hex, type PublicClient } from "viem";
import {
  BTC_POOL,
  MARGIN_BANK,
  PRICE_FEED_SCHEDULER,
  decodeSnapshot,
  readSnapshot,
  snapshotCall,
  startWatch,
  type Rulebook,
  type Snapshot,
  type WatchHandle,
} from "@basanos/core";
import { bookCall, decodeBook, readBookLevels, type BookRead } from "@basanos/core/book";
import { flatten, type CloseIO } from "./close";
import { Engine, type Action } from "./engine";
import { attachVerdictTx, writeRunEvidence } from "./evidence";
import { LOCK_BUFFER_BPS, lockClears } from "./lock";
import { readActiveRuns, rulebookIndex } from "./runs";
import type { TxRecord } from "./tx";
import type { RegistryWriter } from "./writer";

export interface DaemonDeps {
  client: PublicClient;
  wss: string;
  registry: Address;
  rulebooks: readonly Rulebook[];
  closeIO: CloseIO;
  writer: RegistryWriter;
  /** The referee's fast sender (P7): its nonce is re-read on each idle refresh, in case another tool used the key. */
  sender?: { resync(): Promise<void> };
  log: (line: string) => void;
  pollMs?: number;
}

interface Gap {
  atMs: number;
  reason: string;
  lastBlock: string;
  resumedAtBlock: string | null;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
    }
  }
  throw last;
}

export async function runDaemon(d: DaemonDeps): Promise<void> {
  const engine = new Engine();
  const index = rulebookIndex(d.rulebooks);
  const gaps: Gap[] = [];
  const connected = new Set<number>();
  let watches: WatchHandle[] = [];
  let watchedKey = "";
  let lastSnap: Snapshot | null = null;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (actions: Action[]): void => {
    for (const a of actions) {
      queue = queue
        .then(() => act(a))
        .catch((e: unknown) => {
          d.log(`action error on run ${a.runId}: ${(e as Error).message}`);
          engine.release(a.runId);
        });
    }
  };

  // Rules judge closeable equity (spec §5), so every judged snapshot comes with the book of the same block; a missing
  // book pauses runs with an open position until the next push.
  const onSnap = (snap: Snapshot, book: BookRead | null): void => {
    lastSnap = snap;
    enqueue(engine.onSnapshot(snap, book));
  };

  const bookOf = (raw: Hex | undefined, block: bigint): BookRead | null => {
    try {
      const book = raw ? decodeBook(raw) : null;
      return book && book.blockNumber === block ? book : null;
    } catch {
      return null;
    }
  };

  const findFlowTx = async (account: Address, block: bigint): Promise<Hex | null> => {
    const tag = `0x${block.toString(16)}` as Hex;
    for (const topics of [[null, pad(account)], [null, null, pad(account)]]) {
      const logs = (await d.client.request({
        method: "eth_getLogs",
        params: [{ address: MARGIN_BANK, topics: topics as Hex[], fromBlock: tag, toBlock: tag }],
      })) as { transactionHash: Hex }[];
      const first = logs[0];
      if (first) return first.transactionHash;
    }
    return null;
  };

  const resumeAtHead = async (): Promise<void> => {
    const accounts = engine.watchedAccounts();
    if (accounts.length === 0) {
      engine.resume();
      return;
    }
    const snap = await readSnapshot(d.client, accounts, BTC_POOL);
    const gap = gaps.at(-1);
    if (gap && gap.resumedAtBlock === null) gap.resumedAtBlock = snap.blockNumber.toString();
    engine.resume();
    d.log(`resumed at block ${snap.blockNumber} after a gap; re-evaluating at head`);
    onSnap(snap, await readBookLevels(d.client, BTC_POOL, snap.blockNumber));
  };

  const resubscribe = (): void => {
    for (const w of watches) w.close();
    watches = [];
    connected.clear();
    const accounts = engine.watchedAccounts();
    watchedKey = accounts.map((a) => a.toLowerCase()).sort().join(",");
    if (accounts.length === 0) return;
    const call = snapshotCall(accounts, BTC_POOL);
    const topics = accounts.map((a) => pad(a));
    const decode = (results: Hex[]): Snapshot | null => {
      const raw = results[0];
      return raw ? decodeSnapshot(raw, accounts, BTC_POOL) : null;
    };
    const handlers = (i: number, onPush: (results: Hex[], logTopics: Hex[]) => void) => ({
      onPush: (p: { simulationResults: Hex[]; topics: Hex[] }) => onPush(p.simulationResults, p.topics),
      onConnected: ({ reconnects }: { reconnects: number }) => {
        connected.add(i);
        if (reconnects > 0 && connected.size === 3) void resumeAtHead().catch((e: unknown) => d.log(`resume error: ${(e as Error).message}`));
      },
      onGap: ({ atMs, reason }: { atMs: number; reason: string }) => {
        connected.delete(i);
        if (!engine.paused) {
          engine.pause();
          gaps.push({ atMs, reason, lastBlock: lastSnap ? lastSnap.blockNumber.toString() : "none", resumedAtBlock: null });
          d.log(`gap (${reason}): judging paused`);
        }
      },
    });
    watches.push(
      startWatch(
        d.wss,
        { address: PRICE_FEED_SCHEDULER, ethCalls: [call, bookCall(BTC_POOL)], pushChangesOnly: true },
        handlers(0, (results) => {
          const s = decode(results);
          if (s) onSnap(s, bookOf(results[1], s.blockNumber));
        }),
      ),
    );
    for (const position of [1, 2] as const) {
      const filterTopics = position === 1 ? [null, topics] : [null, null, topics];
      watches.push(
        startWatch(
          d.wss,
          { address: MARGIN_BANK, topics: filterTopics, ethCalls: [call] },
          handlers(position, (results, logTopics) => {
            const s = decode(results);
            if (s) lastSnap = s;
            const t = logTopics[position];
            const account = accounts.find((a) => t !== undefined && same(pad(a), t));
            if (account) enqueue(engine.onAccountLog(account, logTopics[0], null, s));
          }),
        ),
      );
    }
  };

  const act = async (a: Action): Promise<void> => {
    const er = engine.get(a.runId);
    if (!er) return;
    const rb = er.run.rulebook;
    const base = {
      runId: a.runId,
      account: a.account,
      rulebook: { name: rb.name, variant: rb.variant, label: rb.label, id: er.run.rulebookId },
      startBlock: er.run.startBlock,
      startEquity: er.run.startEquity,
      gaps: gaps.map((g) => ({ ...g })),
    };
    if (a.kind === "void") {
      const txHash = a.txHash ?? (lastSnap ? await findFlowTx(a.account, lastSnap.blockNumber) : null);
      const hash = writeRunEvidence(a.runId, { ...base, verdict: "VOIDED", reason: a.reason, flowTx: txHash });
      const tx = await retry(() => d.writer.recordVoid(a.runId, a.reason, txHash, hash));
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} VOIDED (${a.reason}) ${tx.explorer}`);
      return;
    }
    if (a.kind === "fail") {
      d.log(`run ${a.runId} breach ${a.rule} at block ${a.breach.blockNumber}: closing from the breach block's book, then cancelling`);
      // The first close is planned from the push itself (position, mark, book of the breach block) and sent at once (P7).
      const close = await flatten(d.closeIO, a.account, { size: a.breach.positionSize, mark: a.breach.markPrice, book: a.judged?.book ?? null });
      for (const t of close.txs) d.log(`  ${t.label} ${t.status} ${t.explorer}`);
      const hash = writeRunEvidence(a.runId, { ...base, verdict: "FAILED", rule: a.rule, breach: a.breach, judged: a.judged, close });
      const tx: TxRecord = await retry(() => d.writer.recordFail(a.runId, a.rule, a.breach, hash, close.txs.map((t) => t.hash)));
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} FAILED (${a.rule}) ${tx.explorer}`);
      return;
    }
    // The lock (P7): from the closeable equity of the push that raised the target, with LOCK_BUFFER_BPS of room so the
    // move before the close cannot take the realized equity back under the registered target; then the first close is
    // planned from that same push. No new quote, no read before the close.
    const seen = er.lastPush;
    if (!seen || !lockClears(seen.judged, er.run.startEquity, rb.profitTargetBps)) {
      engine.release(a.runId);
      return;
    }
    d.log(`run ${a.runId} target reached (closeable equity ${seen.judged} at block ${seen.blockNumber}, ${LOCK_BUFFER_BPS} bps past the target): locking`);
    const close = await flatten(d.closeIO, a.account, { size: seen.size, mark: seen.mark, book: seen.book });
    for (const t of close.txs) d.log(`  ${t.label} ${t.status} ${t.explorer}`);
    try {
      const tx = await d.writer.recordPass(a.runId);
      writeRunEvidence(a.runId, { ...base, verdict: "PASSED", lock: { blockNumber: seen.blockNumber, judgedEquity: seen.judged, bufferBps: LOCK_BUFFER_BPS }, close });
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} PASSED ${tx.explorer}`);
    } catch (e) {
      d.log(`run ${a.runId} recordPass refused (${(e as Error).message.slice(0, 160)}); the run continues`);
      engine.release(a.runId);
    }
  };

  const refresh = async (): Promise<void> => {
    if (d.sender) await d.sender.resync();
    const runs = await readActiveRuns(d.client, d.registry, index);
    for (const r of runs) if (engine.track(r)) d.log(`tracking run ${r.runId}: ${r.account} on ${r.rulebook.label}`);
    engine.retain(runs.map((r) => r.runId));
    const key = engine.watchedAccounts().map((a) => a.toLowerCase()).sort().join(",");
    if (key !== watchedKey) {
      resubscribe();
      // fresh sockets report reconnects === 0, so a pause from an earlier gap would otherwise never lift
      if (engine.paused) void resumeAtHead().catch((e: unknown) => d.log(`resume error: ${(e as Error).message}`));
    }
  };

  await refresh();
  setInterval(() => {
    void refresh().catch((e: unknown) => d.log(`refresh error: ${(e as Error).message}`));
  }, d.pollMs ?? 5_000);
  d.log(`referee watching registry ${d.registry}`);
  await new Promise<never>(() => undefined);
}
