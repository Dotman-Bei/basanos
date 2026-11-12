// The demo runner. Primary: both builder-operated accounts take Tokyo Sprint · Demo with opposite 12x positions.
// Fallback (--one-account, only if account B cannot be funded): account A takes two runs in sequence. Run 1 is a FAIL
// on demand: 12x long, then size past the 15x exposure cap. Run 2 is the PASS attempt: 12x (--pass-side long|short),
// held until the referee locks the target or a rule ends it. A PASS is not guaranteed with one account, which is why
// the two-account demo is primary. Accounts must be FUNDED (own USDso deposited, spike:18 / spike:19); no voucher.
// The referee daemon (packages/referee/src/cli.ts start) must already be running in another terminal.
import type { Address, Hex } from "viem";
import { BTC_POOL, RULE_NAMES, RUN_STATUS, basanosRegistryAbi, explorerTx, quantityForLeverage, readSnapshot, rulebookId } from "@basanos/core";
import { loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, type TxRecord } from "@basanos/referee";
import { appendDemoTake, breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, notReady, openIoc, preflight, readBook, startRunAs } from "./actions";

loadDotEnv();
const argv = process.argv.slice(2);
const manualA = argv.includes("--a-manual");
const oneAccount = argv.includes("--one-account");
const passSide = argv[argv.indexOf("--pass-side") + 1] === "short" ? "short" : "long";
const waitMin = Number(argv[argv.indexOf("--wait-min") + 1] ?? "10") || 10;
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");
const rb = loadRulebook("tokyo-sprint-demo");
const id: Hex = rulebookId(rb);
const txs: TxRecord[] = [];
const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

say(
  oneAccount
    ? "Basanos demo (one-account fallback): account A is a burner operated by the builder; run 1 FAIL by exposure, run 2 the PASS attempt."
    : "Basanos demo: both challenge accounts are burners operated by the builder (A human-driven, B scripted).",
);
const accounts = (oneAccount ? (["ACCOUNT_A_PK"] as const) : (["ACCOUNT_A_PK", "ACCOUNT_B_PK"] as const)).map((name) => {
  const pk = requirePrivateKey(name);
  const wallet = makeAccountWallet(pk, rpcHttp());
  return { name, wallet, markets: makeMarkets(pk), address: wallet.account.address as Address };
});
for (const a of accounts) {
  const pf = await preflight(client, a.markets, a.address);
  say(`${a.name} ${a.address}: stt ${pf.stt} unlocked margin ${pf.unlockedCollateral} flat ${pf.flat} equity ${pf.equity}`);
  const problems = notReady(pf);
  if (problems.length > 0) {
    say(`STOP: ${a.name} is not ready: ${problems.join("; ")}. No voucher is ever claimed here.`);
    process.exit(1);
  }
  const g = await ensureGrant(client, a.markets, a.address, referee);
  if (g) txs.push(g);
}
const statusOf = async (runId: bigint) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
const label = (r: Awaited<ReturnType<typeof statusOf>> | undefined) => (r ? `${RUN_STATUS[r.status] ?? r.status}${r.rule ? `/${RULE_NAMES[r.rule]}` : ""}` : "?");

if (oneAccount) {
  const [accA] = accounts;
  if (!accA) throw new Error("account A expected");
  const book = await readBook(client);
  const waitVerdict = async (runId: bigint) => {
    for (;;) {
      const r = await statusOf(runId);
      say(`run ${runId}: ${label(r)}`);
      if (r && r.status !== 1) return r;
      await new Promise((res) => setTimeout(res, 2_000));
    }
  };
  const waitFlat = async () => {
    const until = Date.now() + 5 * 60_000;
    for (;;) {
      const a = (await readSnapshot(client, [accA.address], BTC_POOL)).accounts[0];
      if (a && a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0) return;
      if (Date.now() > until) throw new Error("account A is not flat 5 min after run 1's verdict");
      await new Promise((res) => setTimeout(res, 3_000));
    }
  };
  const runIds: bigint[] = [];
  // Run 1: FAIL on demand by exposure.
  const r1 = await startRunAs(accA.wallet, client, registry, id);
  runIds.push(r1.runId);
  txs.push(r1.tx);
  say(`run 1 (${r1.runId}) on ${rb.label}: ${r1.tx.explorer}`);
  const s1 = await readSnapshot(client, [accA.address], BTC_POOL);
  txs.push(await openIoc(accA.markets, client, true, quantityForLeverage(s1.accounts[0]?.totalEquity ?? 0n, 12, s1.markPrice, 8, book)));
  const s1b = (await readSnapshot(client, [accA.address], BTC_POOL)).accounts[0];
  if (s1b && s1b.size !== 0n) {
    txs.push(await openIoc(accA.markets, client, true, breachQuantity(s1b.size, s1b.totalEquity, 16, s1.markPrice, 8, book)));
    say("run 1: size added past the 15x exposure cap (FAIL on demand)");
  }
  const v1 = await waitVerdict(r1.runId);
  await waitFlat();
  // Run 2: the PASS attempt.
  const r2 = await startRunAs(accA.wallet, client, registry, id);
  runIds.push(r2.runId);
  txs.push(r2.tx);
  say(`run 2 (${r2.runId}) on ${rb.label}, ${passSide} 12x: ${r2.tx.explorer}`);
  const s2 = await readSnapshot(client, [accA.address], BTC_POOL);
  txs.push(await openIoc(accA.markets, client, passSide === "long", quantityForLeverage(s2.accounts[0]?.totalEquity ?? 0n, 12, s2.markPrice, 8, book)));
  const v2 = await waitVerdict(r2.runId);
  const take = appendDemoTake({
    at: new Date().toISOString(),
    mode: "one-account",
    rulebook: { id, label: rb.label },
    runs: [
      { runId: r1.runId, account: accA.address, status: RUN_STATUS[v1.status], rule: RULE_NAMES[v1.rule] },
      { runId: r2.runId, account: accA.address, status: RUN_STATUS[v2.status], rule: RULE_NAMES[v2.rule], side: passSide },
    ],
    breachedOnDemand: true,
    txs,
  });
  say(`take ${take} recorded in docs/evidence/demo-takes.json (one-account fallback)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  process.exit(0);
}

const runs: bigint[] = [];
for (const a of accounts) {
  const { runId, tx } = await startRunAs(a.wallet, client, registry, id);
  runs.push(runId);
  txs.push(tx);
  say(`${a.name} run ${runId} on ${rb.label}: ${tx.explorer}`);
}
const book = await readBook(client);
const snap = await readSnapshot(client, accounts.map((a) => a.address), BTC_POOL);
const [accA, accB] = accounts;
if (!accA || !accB) throw new Error("two accounts expected");
const qtyB = quantityForLeverage(snap.accounts[1]?.totalEquity ?? 0n, 12, snap.markPrice, 8, book);
txs.push(await openIoc(accB.markets, client, false, qtyB));
say(`B short ${qtyB} at 12x`);
if (manualA) {
  say("A: open the long from the Basanos terminal now (12x).");
} else {
  const qtyA = quantityForLeverage(snap.accounts[0]?.totalEquity ?? 0n, 12, snap.markPrice, 8, book);
  txs.push(await openIoc(accA.markets, client, true, qtyA));
  say(`A long ${qtyA} at 12x`);
}
const openedAt = Date.now();
let breached = false;
for (;;) {
  const [ra, rbRun] = await Promise.all(runs.map((r) => statusOf(r)));
  const states = [ra, rbRun].map((r) => label(r));
  say(`runs ${runs.join(", ")}: ${states.join(" | ")}`);
  if (ra && rbRun && ra.status !== 1 && rbRun.status !== 1) break;
  if (!breached && Date.now() - openedAt > waitMin * 60_000 && rbRun?.status === 1) {
    say("market still — take aborted: exposure breach on B (FAIL on demand); A resolves or hits its time limit");
    const s = await readSnapshot(client, [accB.address], BTC_POOL);
    const b = s.accounts[0];
    if (b && b.size !== 0n) txs.push(await openIoc(accB.markets, client, b.size > 0n, breachQuantity(b.size, b.totalEquity, 16, s.markPrice, 8, book)));
    breached = true;
  }
  await new Promise((r) => setTimeout(r, 2_000));
}
const final = await Promise.all(runs.map((r) => statusOf(r)));
const take = appendDemoTake({
  at: new Date().toISOString(),
  mode: "two-account",
  rulebook: { id, label: rb.label },
  runs: runs.map((r, i) => ({ runId: r, account: accounts[i]?.address, status: RUN_STATUS[final[i]?.status ?? 0], rule: RULE_NAMES[final[i]?.rule ?? 0] })),
  breachedOnDemand: breached,
  txs,
});
say(`take ${take} recorded in docs/evidence/demo-takes.json`);
for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
process.exit(0);
