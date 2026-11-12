// Funding a challenge account from its own wallet USDso. B14/B15: the voucher claim reverts chain-wide, and the
// organizers sent USDso to the wallets instead. An account's own key approves its own USDso to the MarginBank and
// deposits it into its own MarginBank balance; nothing moves between accounts. Deposit before any startRun: a
// MarginBank money flow during a run voids it.
import { encodeFunctionData, erc20Abi, parseAbi, type Address } from "viem";
import { marginBankWriteAbi } from "@somnia-chain/markets-sdk";
import type { UnsignedCall } from "./live-lib";

/** MarginBank.getSystemConfig (the SDK 0.33.0 read ABI): collateralToken is the token a deposit pulls. */
export const marginBankConfigAbi = parseAbi([
  "function getSystemConfig() view returns ((address marginBank, address collateralToken, address perpPoolFactory, address liquidationEngine, address insuranceFund, address feeRecipient, uint16 maxLeverageLimit, bool fullyWired))",
]);

const E18 = 10n ** 18n;

/** The least unlocked MarginBank collateral spike:11's skeleton needs. Its minimum order (0.00013 BTC) is about
 *  9.6 USDso of notional, about 0.24 USDso of margin at the 40x market cap; 1 USDso leaves room for fees. */
export const SKELETON_MIN_UNLOCKED = E18;

export type DemoAccount = "A" | "B";

export interface DepositArgs {
  account: DemoAccount;
  amountWei: bigint | null;
  dryRun: boolean;
  check: boolean;
}

/** "50" or "50.25" USDso -> wei (18 decimals). */
export function parseUsdso(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) throw new Error(`not a USDso amount: ${text}`);
  return BigInt(m[1] ?? "0") * E18 + BigInt((m[2] ?? "").padEnd(18, "0"));
}

/** wei -> "50" or "50.25". */
export function formatUsdso(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const frac = (abs % E18).toString().padStart(18, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${abs / E18}${frac ? `.${frac}` : ""}`;
}

/** --account A|B (required), --amount <USDso> (a live deposit), --dry-run (reads only), --check (the gate). */
export function parseDepositArgs(argv: readonly string[]): DepositArgs {
  const valueOf = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const account = valueOf("--account");
  if (account !== "A" && account !== "B") throw new Error("--account must be A or B");
  const amount = valueOf("--amount");
  return { account, amountWei: amount === null ? null : parseUsdso(amount), dryRun: argv.includes("--dry-run"), check: argv.includes("--check") };
}

/** null when the wallet can fund the deposit; otherwise why not. */
export function depositProblem(walletWei: bigint, amountWei: bigint): string | null {
  if (amountWei <= 0n) return "the deposit amount must be above 0";
  if (amountWei > walletWei) return `the wallet holds ${formatUsdso(walletWei)} USDso, less than the ${formatUsdso(amountWei)} asked`;
  return null;
}

/** ERC-20 approve of exactly the deposit amount (never an unlimited allowance). */
export function approveCall(token: Address, spender: Address, amountWei: bigint): UnsignedCall {
  return { to: token, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amountWei] }) };
}

/** MarginBank.deposit(amount): the bank pulls the approved collateral into the caller's own balance. */
export function depositCall(bank: Address, amountWei: bigint): UnsignedCall {
  return { to: bank, value: 0n, data: encodeFunctionData({ abi: marginBankWriteAbi, functionName: "deposit", args: [amountWei] }) };
}

/** The funded test that replaces "holds a claimed voucher": unlocked MarginBank collateral at or above the need. */
export function fundedProblem(who: string, unlockedWei: bigint, needWei: bigint): string | null {
  if (unlockedWei >= needWei) return null;
  return `${who} has ${formatUsdso(unlockedWei)} USDso of unlocked margin in the MarginBank, below the ${formatUsdso(needWei)} USDso this run needs; deposit its own wallet USDso first (deposit.ts, spike:18 for A, spike:19 for B)`;
}

/** The leverage cap that applies: the voucher's cap only for a claimed voucher, else the market maximum (40x on BTC-PERP). */
export function capFromLeverage(
  lev: { voucherLeverageCapX: number; marketMaxLeverageBps: bigint | null; protocolMaxLeverageX: number },
  voucherClaimed: boolean,
): { capX: number; capSource: "voucher" | "market" } {
  const marketX = lev.marketMaxLeverageBps !== null ? Number(lev.marketMaxLeverageBps / 10_000n) : lev.protocolMaxLeverageX;
  if (voucherClaimed) return { capX: Math.min(lev.voucherLeverageCapX, marketX), capSource: "voucher" };
  return { capX: marketX, capSource: "market" };
}

/** The gate's check of a deposit evidence file. */
export function checkDeposit(data: Record<string, unknown> | null, account: DemoAccount): string[] {
  const name = `deposit-${account.toLowerCase()}`;
  if (!data) return [`${name}: evidence file is missing`];
  const p: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) p.push(`${name}: ${msg}`);
  };
  need(data.account === account, `account is ${String(data.account)}, expected ${account}`);
  need(data.ok === true, "ok is not true");
  const amount = BigInt(String(data.amountWei ?? "0"));
  const credited = BigInt(String(data.creditedWei ?? "0"));
  need(amount > 0n, "no deposit amount recorded");
  need(credited >= amount, `credited ${credited} is below the deposited ${amount}`);
  const txs = Array.isArray(data.txs) ? (data.txs as Record<string, unknown>[]) : [];
  need(txs.some((t) => t.label === "deposit" && t.status === "success"), "no successful deposit transaction");
  return p;
}
