import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { marginBankWriteAbi } from "@somnia-chain/markets-sdk";
import { MARGIN_BANK, USDSO } from "@basanos/core";
import {
  SKELETON_MIN_UNLOCKED,
  approveCall,
  capFromLeverage,
  checkDeposit,
  depositCall,
  depositProblem,
  formatUsdso,
  fundedProblem,
  parseDepositArgs,
  parseUsdso,
} from "../src/funding";

const E18 = 10n ** 18n;

describe("funding a challenge account from its own wallet USDso", () => {
  it("reads the account, the amount and the mode from the flags", () => {
    expect(parseDepositArgs(["node", "deposit.ts", "--account", "A", "--dry-run"])).toEqual({ account: "A", amountWei: null, dryRun: true, check: false });
    expect(parseDepositArgs(["node", "deposit.ts", "--account", "B", "--amount", "50"])).toEqual({ account: "B", amountWei: 50n * E18, dryRun: false, check: false });
    expect(parseDepositArgs(["node", "deposit.ts", "--account", "A", "--check"]).check).toBe(true);
    expect(() => parseDepositArgs(["node", "deposit.ts", "--amount", "50"])).toThrow(/--account/);
    expect(() => parseDepositArgs(["node", "deposit.ts", "--account", "C"])).toThrow(/--account/);
  });
  it("parses and prints USDso amounts", () => {
    expect(parseUsdso("50.25")).toBe(50n * E18 + 25n * 10n ** 16n);
    expect(formatUsdso(50n * E18)).toBe("50");
    expect(formatUsdso(50n * E18 + 25n * 10n ** 16n)).toBe("50.25");
    expect(() => parseUsdso("-1")).toThrow(/USDso/);
  });
  it("refuses a deposit the wallet cannot cover", () => {
    expect(depositProblem(50n * E18, 50n * E18)).toBeNull();
    expect(depositProblem(50n * E18, 0n)).toMatch(/above 0/);
    expect(depositProblem(50n * E18, 51n * E18)).toMatch(/holds 50 USDso/);
  });
  it("encodes an exact approve and the MarginBank deposit the SDK encodes", () => {
    const a = approveCall(USDSO, MARGIN_BANK, 50n * E18);
    expect(a.to).toBe(USDSO);
    expect(a.data.slice(0, 10)).toBe("0x095ea7b3");
    const d = depositCall(MARGIN_BANK, 50n * E18);
    expect(d.to).toBe(MARGIN_BANK);
    expect(d.data.slice(0, 10)).toBe("0xb6b55f25");
    expect(d.data).toBe(encodeFunctionData({ abi: marginBankWriteAbi, functionName: "deposit", args: [50n * E18] }));
  });
  it("tests funded instead of a claimed voucher, and takes the market cap for a non-voucher account", () => {
    expect(fundedProblem("account A", 0n, SKELETON_MIN_UNLOCKED)).toMatch(/below the 1 USDso this run needs; deposit/);
    expect(fundedProblem("account A", 50n * E18, SKELETON_MIN_UNLOCKED)).toBeNull();
    const lev = { voucherLeverageCapX: 20, marketMaxLeverageBps: 400_000n, protocolMaxLeverageX: 40 };
    expect(capFromLeverage(lev, false)).toEqual({ capX: 40, capSource: "market" });
    expect(capFromLeverage(lev, true)).toEqual({ capX: 20, capSource: "voucher" });
  });
  it("checks a deposit evidence file", () => {
    const ok = { account: "A", ok: true, amountWei: "50000000000000000000", creditedWei: "50000000000000000000", txs: [{ label: "approve", status: "success" }, { label: "deposit", status: "success" }] };
    expect(checkDeposit(ok, "A")).toEqual([]);
    expect(checkDeposit({ ...ok, creditedWei: "0" }, "A")).not.toEqual([]);
    expect(checkDeposit(ok, "B")).not.toEqual([]);
    expect(checkDeposit(null, "A")).toEqual(["deposit-a: evidence file is missing"]);
  });
});
