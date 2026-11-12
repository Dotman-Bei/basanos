// LIVE, human-gated (spike:18 for account A, spike:19 for B): the account's own key approves its own wallet USDso
// to the MarginBank and deposits it into its own MarginBank balance. viem-direct, as in spike:14: signed locally,
// sent to the standard RPC with ORDER_GAS and an explicit pending nonce. It reads unlockedCollateralBalance back and
// writes docs/evidence/deposit-a.json or deposit-b.json. Nothing moves between accounts. It refuses to run while the
// account has an active run, because a deposit during a run voids it.
//   --account A|B --dry-run            reads only and prints the plan
//   --account A|B --amount <USDso>     approves (if the allowance is short) and deposits
//   --account A|B --check              checks the evidence file (the gate; no key)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { erc20Abi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MARGIN_BANK, ORDER_GAS, STT_WRITE_HEADROOM, USDSO, basanosRegistryAbi, marginBankAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requirePrivateKey } from "@basanos/core/node";
import { toJsonSafe } from "./evidence";
import { approveCall, checkDeposit, depositCall, depositProblem, formatUsdso, marginBankConfigAbi, parseDepositArgs, type DepositArgs } from "./funding";
import { ownerTx, txRecord, type TxRecord, type UnsignedCall } from "./live-lib";
import { publicClient, walletFor } from "./rpc";

loadDotEnv();
let args: DepositArgs;
try {
  args = parseDepositArgs(process.argv);
} catch (e) {
  console.error(`deposit: ${(e as Error).message}`);
  process.exit(1);
}
const name = `deposit-${args.account.toLowerCase()}`;
const evidencePath = repoPath(`docs/evidence/${name}.json`);

if (args.check) {
  const data = existsSync(evidencePath) ? (JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>) : null;
  const problems = checkDeposit(data, args.account);
  for (const p of problems) console.log(`FAIL ${p}`);
  if (problems.length === 0) console.log(`PASS ${name}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

const pk = requirePrivateKey(args.account === "A" ? "ACCOUNT_A_PK" : "ACCOUNT_B_PK");
const owner: Address = privateKeyToAccount(pk).address;
const client = publicClient();
const wallet = walletFor(pk);
const txs: TxRecord[] = [];

const reads = async () => {
  const [walletWei, allowanceWei, state] = await Promise.all([
    client.readContract({ address: USDSO, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: USDSO, abi: erc20Abi, functionName: "allowance", args: [owner, MARGIN_BANK] }),
    client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [owner] }),
  ]);
  return { walletWei, allowanceWei, unlockedWei: state.unlockedCollateralBalance, lockedWei: state.lockedCollateral, activePools: state.activePerpPools.length };
};

function record(ok: boolean, extra: Record<string, unknown>): void {
  const body = { evidence: name, writtenAt: new Date().toISOString(), account: args.account, owner, token: USDSO, marginBank: MARGIN_BANK, txs, ok, ...extra };
  writeFileSync(evidencePath, `${JSON.stringify(toJsonSafe(body), null, 2)}\n`);
}

function stop(reason: string): never {
  console.error(`deposit ${args.account}: STOP — ${reason}`);
  if (txs.length > 0) record(false, { reason });
  process.exit(1);
}

const cfg = await client.readContract({ address: MARGIN_BANK, abi: marginBankConfigAbi, functionName: "getSystemConfig" });
if (cfg.collateralToken.toLowerCase() !== USDSO.toLowerCase()) stop(`the MarginBank collateral is ${cfg.collateralToken}, not USDso ${USDSO}`);
const before = await reads();
const stt = await client.getBalance({ address: owner });
const depPath = repoPath("deployments/hideki.json");
const registry = existsSync(depPath) ? (JSON.parse(readFileSync(depPath, "utf8")) as { registry: Address }).registry : null;
const activeRun = registry ? await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [owner] }) : 0n;
console.log(
  `deposit ${args.account}: owner ${owner}, wallet ${formatUsdso(before.walletWei)} USDso, allowance ${formatUsdso(before.allowanceWei)}, ` +
    `unlocked margin ${formatUsdso(before.unlockedWei)} USDso, STT ${stt}, active run ${activeRun}`,
);
if (activeRun !== 0n) stop(`account ${args.account} has active run ${activeRun}: a deposit now would void it; deposit only before startRun`);
if (stt < STT_WRITE_HEADROOM) stop(`STT ${stt} is below the 0.6 write headroom; top up from the Tokyo faucet`);
if (args.amountWei !== null) {
  const p = depositProblem(before.walletWei, args.amountWei);
  if (p) stop(p);
}
if (args.dryRun) {
  if (args.amountWei !== null) {
    const steps = before.allowanceWei < args.amountWei ? "approve, then deposit" : "deposit (the allowance already covers it)";
    console.log(`plan: ${steps} ${formatUsdso(args.amountWei)} USDso into account ${args.account}'s own MarginBank balance`);
  }
  console.log("dry-run: no transaction sent");
  process.exit(0);
}
if (args.amountWei === null) stop("--amount <USDso> is required for a live deposit");
const amountWei = args.amountWei;

async function send(label: string, call: UnsignedCall): Promise<void> {
  const nonce = await client.getTransactionCount({ address: owner, blockTag: "pending" });
  const hash = await wallet.sendTransaction(ownerTx(call, nonce, ORDER_GAS));
  const rec = txRecord(label, await client.waitForTransactionReceipt({ hash }));
  txs.push(rec);
  if (rec.status !== "success") stop(`${label} reverted: ${rec.explorer}`);
}

try {
  if (before.allowanceWei < amountWei) await send("approve", approveCall(USDSO, MARGIN_BANK, amountWei));
  await send("deposit", depositCall(MARGIN_BANK, amountWei));
} catch (e) {
  stop(`a send failed: ${(e as Error).message.slice(0, 200)}`);
}
const after = await reads();
const creditedWei = after.unlockedWei - before.unlockedWei;
const ok = creditedWei >= amountWei;
record(ok, { amountWei, before, after, creditedWei });
console.log(
  `deposit ${args.account}: ${ok ? "OK" : "MISMATCH"} — unlocked margin ${formatUsdso(before.unlockedWei)} -> ${formatUsdso(after.unlockedWei)} USDso ` +
    `(+${formatUsdso(creditedWei)}); wallet ${formatUsdso(before.walletWei)} -> ${formatUsdso(after.walletWei)} USDso`,
);
for (const t of txs) console.log(`  ${t.label} ${t.status} ${t.explorer}`);
process.exit(ok ? 0 : 1);
