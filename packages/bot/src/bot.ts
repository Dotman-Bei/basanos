// The scripted challenger (account B). It signs as itself; the referee's grant is the only delegation. Every write is
// viem-direct (send.ts, P6) and read back from the chain; a write that does not take effect stops the bot, and nothing
// is re-sent (P6b).
import { BTC_POOL, explorerTx, readSnapshot, rulebookId, quantityForLeverage } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, notReady, openIoc, preflight, readBook, startRunAs } from "./actions";
import { describeWrite, type AccountWrite } from "./send";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? (rest[i + 1] as string) : fallback;
};
const pk = requirePrivateKey("ACCOUNT_B_PK");
const wallet = makeAccountWallet(pk, rpcHttp());
const account = wallet.account.address;
const client = makePublicClient(rpcHttp());
const markets = makeMarkets();
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");

/** Prints the write with its link; exits 1 unless it took effect on-chain. */
function took(w: AccountWrite | null, ifNot: string): void {
  if (!w) return;
  console.log(`${describeWrite(w)} ${w.sent.tx?.explorer ?? explorerTx(w.sent.hash)}`);
  if (w.effect === "done") return;
  console.error(`STOP: ${w.sent.label} did not take effect; nothing is re-sent. ${ifNot}`);
  process.exit(1);
}

if (cmd === "start") {
  const name = opt("--rulebook", "tokyo-sprint-demo") as keyof typeof RULEBOOK_FILES;
  const side = opt("--side", "short");
  const leverage = Number(opt("--leverage", String(DEMO_LEVERAGE_X)));
  const pf = await preflight(client, markets, account);
  const problems = notReady(pf);
  if (problems.length > 0) {
    console.error(`bot preflight failed: ${problems.join("; ")}`);
    process.exit(1);
  }
  took(await ensureGrant(client, wallet, referee), "No run was started; re-run once the cause is fixed (the grant is read first).");
  const start = await startRunAs(client, wallet, registry, rulebookId(loadRulebook(name)));
  took(start, "Re-run once the cause is fixed (the registry refuses a second active run).");
  console.log(`run ${start.runId} started`);
  const snap = await readSnapshot(client, [], BTC_POOL);
  const qty = quantityForLeverage(pf.equity, leverage, snap.markPrice, 8, await readBook(client));
  took(await openIoc(client, wallet, side === "long", qty), `Run ${start.runId} stays with the referee, which ends it by a rule or at its time limit.`);
  process.exit(0);
} else if (cmd === "breach") {
  const leverage = Number(opt("--leverage", "16"));
  const snap = await readSnapshot(client, [account], BTC_POOL);
  const a = snap.accounts[0];
  if (!a || a.size === 0n) {
    console.error("bot has no position to extend");
    process.exit(1);
  }
  const add = breachQuantity(a.size, a.totalEquity, leverage, snap.markPrice, 8, await readBook(client));
  took(await openIoc(client, wallet, a.size > 0n, add, "exposure top-up"), "The run goes on.");
  console.log(`exposure breach: +${add}`);
  process.exit(0);
} else {
  console.error(`usage: bot.ts start [--rulebook <name>] [--side short|long] [--leverage ${DEMO_LEVERAGE_X}] | breach [--leverage 16]`);
  process.exit(2);
}
