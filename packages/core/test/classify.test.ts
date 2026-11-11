import { describe, expect, it } from "vitest";
import { toEventSelector } from "viem";
import { marginBankEventsAbi } from "@somnia-chain/markets-sdk";
import { LIQUIDATION_EVENT_SIGNATURES, TRADING_EVENT_SIGNATURES, classifyMarginBankLog } from "../src/classify";

function topicOf(name: string) {
  const ev = marginBankEventsAbi.find((e) => e.type === "event" && e.name === name);
  if (!ev) throw new Error(`the SDK ABI has no ${name}`);
  return toEventSelector(ev);
}

describe("classifyMarginBankLog", () => {
  it("matches the SDK's own MarginBank ABI for trading and liquidation events", () => {
    for (const sig of TRADING_EVENT_SIGNATURES) expect(classifyMarginBankLog(topicOf(sig.slice(0, sig.indexOf("("))))).toBe("trading");
    for (const sig of LIQUIDATION_EVENT_SIGNATURES) {
      expect(classifyMarginBankLog(topicOf(sig.slice(0, sig.indexOf("("))))).toBe("liquidation");
    }
  });
  it("treats deposits, withdrawals, transfers and unknown topics as money flows", () => {
    for (const name of ["Deposited", "DepositedFor", "Withdrawn", "PositionTransferred", "MainFundedChild", "IsolatedModeSet", "MaxLeverageSet"]) {
      expect(classifyMarginBankLog(topicOf(name))).toBe("flow");
    }
    expect(classifyMarginBankLog(`0x${"ab".repeat(32)}`)).toBe("flow");
    expect(classifyMarginBankLog(undefined)).toBe("flow");
  });
});
