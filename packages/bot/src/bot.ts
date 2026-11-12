// The scripted challenger (account B). It signs as itself; the referee's grant is the only delegation.
import { BTC_POOL, readSnapshot, rulebookId, quantityForLeverage } from "@basanos/core";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, notReady, openIoc, preflight, readBook, startRunAs } from "./actions";

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
const markets = makeMarkets(pk);
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");

if (cmd === "start") {
  const name = opt("--rulebook", "tokyo-sprint-demo") as keyof typeof RULEBOOK_FILES;
  const side = opt("--side", "short");
  const leverage = Number(opt("--leverage", "12"));
  const pf = await preflight(client, markets, account);
  const problems = notReady(pf);
  if (problems.length > 0) {
    console.error(`bot preflight failed: ${problems.join("; ")}`);
    process.exit(1);
  }
  const grant = await ensureGrant(client, markets, account, referee);
  if (grant) console.log(`grant ${grant.explorer}`);
  const { runId, tx } = await startRunAs(wallet, client, registry, rulebookId(loadRulebook(name)));
  console.log(`run ${runId} started ${tx.explorer}`);
  const snap = await readSnapshot(client, [], BTC_POOL);
  const qty = quantityForLeverage(pf.equity, leverage, snap.markPrice, 8, await readBook(client));
  const open = await openIoc(markets, client, side === "long", qty);
  console.log(`${open.label} ${qty} ${open.status} ${open.explorer}`);
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
  const tx = await openIoc(markets, client, a.size > 0n, add);
  console.log(`exposure breach: +${add} ${tx.status} ${tx.explorer}`);
  process.exit(0);
} else {
  console.error("usage: bot.ts start [--rulebook <name>] [--side short|long] [--leverage 12] | breach [--leverage 16]");
  process.exit(2);
}
