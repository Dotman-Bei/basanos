// The demo runner. Primary: both builder-operated accounts take Tokyo Sprint · Demo (demo v2) with opposite positions
// at DEMO_LEVERAGE_X (10x; rules judge closeable equity, spec §5). Architect P7, 2026-11-12, from a replay of 12 hours
// of real history: both runs start together, and the pair opens in the same block (openPair: one book read, both IOCs
// signed first, sent back to back), or, with --a-manual, B opens as soon as A's long is seen. Once one run PASSES, the
// other, still Active, is pushed past the 15x exposure cap: a FAIL on demand (take.ts). Fallback (--one-account, only
// if account B cannot be funded): account A takes two runs in sequence. Run 1 is a FAIL on demand: a long, then size
// past the cap. Run 2 is the PASS attempt (--pass-side long|short), held until the referee locks the target or a rule
// ends it. A PASS is not guaranteed with one account, which is why the two-account demo is primary. Accounts must be
// FUNDED (own USDso deposited, spike:18 / spike:19); no voucher. The referee daemon (packages/referee/src/cli.ts start)
// must already be running in another terminal.
// Every account write (grant, startRun, opens) is viem-direct (send.ts, P6) and read back from the chain before the
// take goes on. When one does not take effect, or anything throws (onFailure, P6b): before the take has started a run
// it stops, and a re-run starts over; once a run has started the take aborts. Nothing is re-sent and no run is voided:
// the referee ends each run by a rule or at its time limit, the demo waits for every verdict, checks the accounts are
// flat, records the take in docs/evidence/demo-aborted.json (never demo-takes.json) and exits 1.
import type { Address, Hex } from "viem";
import { BTC_POOL, RULE_NAMES, RUN_STATUS, basanosRegistryAbi, explorerTx, quantityForLeverage, readSnapshot, rulebookId, type BookParams } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, type TxRecord } from "@basanos/referee";
import {
  DEMO_ABORTED,
  appendDemoTake,
  breachQuantity,
  ensureGrant,
  makeAccountWallet,
  makeMarkets,
  notReady,
  openIoc,
  openPair,
  preflight,
  readBook,
  startRunAs,
  waitForPosition,
  type AccountWallet,
} from "./actions";
import { VERDICT_GRACE_SEC, describeWrite, onFailure, verdictDeadline, type AccountWrite, type WriteKind } from "./send";
import { breachTarget } from "./take";

loadDotEnv();
const argv = process.argv.slice(2);
const manualA = argv.includes("--a-manual");
const oneAccount = argv.includes("--one-account");
const passSide = argv[argv.indexOf("--pass-side") + 1] === "short" ? "short" : "long";
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");
const rb = loadRulebook("tokyo-sprint-demo");
const id: Hex = rulebookId(rb);
const markets = makeMarkets();
const mode = oneAccount ? "one-account" : "two-account";
const txs: TxRecord[] = [];
const notes: string[] = [];
const started: { runId: bigint; account: Address }[] = [];
let lastStartMs = 0;
const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

say(
  oneAccount
    ? "Basanos demo (one-account fallback): account A is a burner operated by the builder; run 1 FAIL by exposure, run 2 the PASS attempt."
    : "Basanos demo: both challenge accounts are burners operated by the builder (A human-driven, B scripted).",
);
interface Account {
  name: string;
  wallet: AccountWallet;
  address: Address;
}
const accounts: Account[] = (oneAccount ? (["ACCOUNT_A_PK"] as const) : (["ACCOUNT_A_PK", "ACCOUNT_B_PK"] as const)).map((name) => {
  const wallet = makeAccountWallet(requirePrivateKey(name), rpcHttp());
  return { name, wallet, address: wallet.account.address };
});

class WriteFailed extends Error {
  constructor(
    readonly kind: WriteKind,
    message: string,
  ) {
    super(message);
  }
}

/** Keeps the write's receipt, and throws unless the write took effect on-chain. */
function check(kind: WriteKind, w: AccountWrite | null): void {
  if (!w) return;
  if (w.sent.tx) txs.push(w.sent.tx);
  if (w.effect !== "done") throw new WriteFailed(kind, describeWrite(w));
}

const statusOf = async (runId: bigint) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
type Run = Awaited<ReturnType<typeof statusOf>>;
const label = (r: Run | undefined) => (r ? `${RUN_STATUS[r.status] ?? r.status}${r.rule ? `/${RULE_NAMES[r.rule]}` : ""}` : "?");
const activeRunOf = async (account: Address) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [account] });

async function startRun(a: Account): Promise<bigint> {
  const { runId, ...w } = await startRunAs(client, a.wallet, registry, id);
  check("start", w);
  if (runId === null) throw new WriteFailed("start", describeWrite(w));
  started.push({ runId, account: a.address });
  lastStartMs = Date.now();
  say(`${a.name} run ${runId} on ${rb.label}: ${w.sent.tx?.explorer ?? explorerTx(w.sent.hash)}`);
  return runId;
}

/** Polls every 2 s until every run has left Active; null once `until` passes with one still Active. */
async function waitVerdicts(runIds: readonly bigint[], until: number, onTick?: (rs: Run[]) => Promise<void>): Promise<Run[] | null> {
  for (;;) {
    const rs = await Promise.all(runIds.map((r) => statusOf(r)));
    say(`runs ${runIds.join(", ")}: ${rs.map((r) => label(r)).join(" | ")}`);
    if (rs.every((r) => r.status !== 1)) return rs;
    if (Date.now() > until) return null;
    if (onTick) await onTick(rs);
    await sleep(2_000);
  }
}

async function flatAll(addresses: readonly Address[], waitMs: number): Promise<boolean> {
  const unique = [...new Set(addresses)];
  const until = Date.now() + waitMs;
  for (;;) {
    const s = await readSnapshot(client, unique, BTC_POOL);
    if (s.accounts.every((a) => a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0)) return true;
    if (Date.now() > until) return false;
    await sleep(3_000);
  }
}

/** The on-demand exposure breach: size past the 15x cap. If it does not take effect it is noted, never re-sent, and
 *  the take goes on (onFailure "note"). */
async function topUp(a: Account, book: BookParams): Promise<boolean> {
  const s = await readSnapshot(client, [a.address], BTC_POOL);
  const p = s.accounts[0];
  if (!p || p.size === 0n) return false;
  try {
    check("breach", await openIoc(client, a.wallet, p.size > 0n, breachQuantity(p.size, p.totalEquity, 16, s.markPrice, 8, book), "exposure top-up"));
    return true;
  } catch (e) {
    if (onFailure("breach", started.length) !== "note") throw e;
    const why = e instanceof Error ? e.message : String(e);
    notes.push(`exposure top-up did not take effect: ${why}`);
    say(`note: the exposure top-up did not take effect (${why}); nothing is re-sent and the runs go on`);
    return false;
  }
}

function runRows(final: readonly (Run | undefined)[]) {
  return started.map((r, i) => ({ runId: r.runId, account: r.account, status: RUN_STATUS[final[i]?.status ?? 0], rule: RULE_NAMES[final[i]?.rule ?? 0] }));
}

async function twoAccountTake(): Promise<void> {
  const [accA, accB] = accounts;
  if (!accA || !accB) throw new Error("two accounts expected");
  // Both runs start together, and the pair opens only once both have started (P7).
  await Promise.all(accounts.map((a) => startRun(a)));
  started.sort((x, y) => accounts.findIndex((a) => a.address === x.account) - accounts.findIndex((a) => a.address === y.account));
  const book = await readBook(client);
  const snap = await readSnapshot(client, accounts.map((a) => a.address), BTC_POOL);
  const qtyA = quantityForLeverage(snap.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, snap.markPrice, 8, book);
  const qtyB = quantityForLeverage(snap.accounts[1]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, snap.markPrice, 8, book);
  const until = verdictDeadline(lastStartMs, rb.timeLimitSec);
  if (manualA) {
    say(`A: open the long from the Basanos terminal now (${DEMO_LEVERAGE_X}x); B opens its short as soon as A's long is seen.`);
    const sizeA = await waitForPosition(client, accA.address, until);
    if (sizeA === null) throw new Error("account A opened no position before the time limit");
    check("open", await openIoc(client, accB.wallet, false, qtyB));
    say(`A long ${sizeA} seen; B short ${qtyB} at ${DEMO_LEVERAGE_X}x`);
  } else {
    const opens = await openPair(client, [
      { wallet: accA.wallet, isBid: true, quantity: qtyA },
      { wallet: accB.wallet, isBid: false, quantity: qtyB },
    ]);
    for (const w of opens) if (w.sent.tx) txs.push(w.sent.tx);
    const failed = opens.find((w) => w.effect !== "done");
    if (failed) throw new WriteFailed("open", opens.map((w) => describeWrite(w)).join("; "));
    say(`A long ${qtyA} and B short ${qtyB} at ${DEMO_LEVERAGE_X}x, sent together`);
  }
  // The FAIL on demand (take.ts): once one run PASSES, the other, still Active, is pushed past the exposure cap.
  let breached = false;
  const final = await waitVerdicts(started.map((r) => r.runId), until, async (rs) => {
    const i = breachTarget(rs.map((r) => RUN_STATUS[r.status] ?? "None"), breached);
    const target = i === null ? undefined : accounts[i];
    if (!target) return;
    breached = true;
    say(`a run PASSED: exposure breach on ${target.name} (FAIL on demand)`);
    await topUp(target, book);
  });
  if (!final) throw new Error(`a run is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after the last start; check the referee terminal`);
  const flat = await flatAll(started.map((r) => r.account), 120_000);
  const take = appendDemoTake({ at: new Date().toISOString(), mode, rulebook: { id, label: rb.label }, runs: runRows(final), breachedOnDemand: breached, flatAfter: flat, notes, txs });
  say(`take ${take} recorded in docs/evidence/demo-takes.json`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!flat) {
    say("STOP: an account still holds a position after its verdict; check the referee terminal");
    process.exit(1);
  }
}

async function oneAccountTake(): Promise<void> {
  const [accA] = accounts;
  if (!accA) throw new Error("account A expected");
  const book = await readBook(client);
  // Run 1: FAIL on demand by exposure.
  const r1 = await startRun(accA);
  const s1 = await readSnapshot(client, [accA.address], BTC_POOL);
  check("open", await openIoc(client, accA.wallet, true, quantityForLeverage(s1.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, s1.markPrice, 8, book)));
  if (await topUp(accA, book)) say("run 1: size added past the 15x exposure cap (FAIL on demand)");
  const v1 = await waitVerdicts([r1], verdictDeadline(lastStartMs, rb.timeLimitSec));
  if (!v1) throw new Error(`run 1 is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after its start; check the referee terminal`);
  if (!(await flatAll([accA.address], 5 * 60_000))) throw new Error("account A is not flat 5 min after run 1's verdict");
  // Run 2: the PASS attempt.
  const r2 = await startRun(accA);
  say(`run 2 (${r2}): ${passSide} ${DEMO_LEVERAGE_X}x`);
  const s2 = await readSnapshot(client, [accA.address], BTC_POOL);
  check("open", await openIoc(client, accA.wallet, passSide === "long", quantityForLeverage(s2.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, s2.markPrice, 8, book)));
  const v2 = await waitVerdicts([r2], verdictDeadline(lastStartMs, rb.timeLimitSec));
  if (!v2) throw new Error(`run 2 is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after its start; check the referee terminal`);
  const flat = await flatAll([accA.address], 120_000);
  const rows = runRows([...v1, ...v2]);
  const take = appendDemoTake({
    at: new Date().toISOString(),
    mode,
    rulebook: { id, label: rb.label },
    runs: rows.map((r, i) => (i === 1 ? { ...r, side: passSide } : r)),
    breachedOnDemand: true,
    flatAfter: flat,
    notes,
    txs,
  });
  say(`take ${take} recorded in docs/evidence/demo-takes.json (one-account fallback)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!flat) {
    say("STOP: account A still holds a position after its verdict; check the referee terminal");
    process.exit(1);
  }
}

/** P6b, once the take has started a run: nothing is re-sent and no run is voided. The referee ends each run by a rule
 *  or at its time limit; the demo waits for the verdicts, checks the accounts, records the take apart, and exits 1. */
async function abortTake(reason: string): Promise<never> {
  const ids = started.map((r) => r.runId);
  say(`STOP: take aborted: ${reason}`);
  say(
    `Nothing is re-sent and no run is voided. The referee keeps judging run(s) ${ids.join(", ")} and ends each by a rule or at ` +
      `its ${rb.timeLimitSec} s time limit, closing any position first. Keep the referee running until this exits.`,
  );
  const final = await waitVerdicts(ids, verdictDeadline(lastStartMs, rb.timeLimitSec));
  const flat = await flatAll(started.map((r) => r.account), 120_000);
  const stillActive: string[] = [];
  for (const a of accounts) {
    const r = await activeRunOf(a.address);
    if (r !== 0n) stillActive.push(`${a.name} run ${r}`);
  }
  const n = appendDemoTake(
    { at: new Date().toISOString(), mode, rulebook: { id, label: rb.label }, aborted: reason, runs: runRows(final ?? []), flatAfter: flat, stillActive, notes, txs },
    repoPath(DEMO_ABORTED),
  );
  say(`aborted take ${n} recorded in ${DEMO_ABORTED} (not demo-takes.json, which check-rehearsal judges)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!final || stillActive.length > 0) say(`STOP: still Active after the time limit + ${VERDICT_GRACE_SEC} s: ${stillActive.join(", ") || ids.join(", ")}; check the referee terminal`);
  if (!flat) say("STOP: an account still holds a position after its verdict; check the referee terminal");
  process.exit(1);
}

try {
  // Every account passes preflight before anything is sent.
  for (const a of accounts) {
    const pf = await preflight(client, markets, a.address);
    say(`${a.name} ${a.address}: stt ${pf.stt} unlocked margin ${pf.unlockedCollateral} flat ${pf.flat} equity ${pf.equity}`);
    const problems = notReady(pf);
    if (problems.length > 0) {
      say(`STOP: ${a.name} is not ready: ${problems.join("; ")}. No voucher is ever claimed here.`);
      process.exit(1);
    }
  }
  for (const a of accounts) {
    const g = await ensureGrant(client, a.wallet, referee);
    check("grant", g);
    if (g) say(`${a.name} granted the referee place + cancel on BTC-PERP: ${g.sent.tx?.explorer ?? explorerTx(g.sent.hash)}`);
  }
  if (oneAccount) await oneAccountTake();
  else await twoAccountTake();
  process.exit(0);
} catch (e) {
  const reason = e instanceof Error ? e.message : String(e);
  const step = onFailure(e instanceof WriteFailed ? e.kind : "error", started.length);
  if (step === "stop") {
    say(`STOP: ${reason}. The take started no run, so nothing needs cleaning up, and nothing was re-sent. Re-run demo.ts once the cause is fixed.`);
    process.exit(1);
  }
  await abortTake(reason);
}
