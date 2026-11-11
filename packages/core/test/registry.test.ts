import { describe, expect, it } from "vitest";
import { basanosRegistryAbi } from "../src/abi/basanosRegistry";
import { PREVIEW_CODES, RULE_NAMES, RUN_STATUS, VOID_REASONS, registerArgs } from "../src/registry";
import { rulebookId } from "../src/rulebook";
import { loadRulebook } from "../src/node";

describe("basanosRegistryAbi", () => {
  it("carries the spec §6.2 surface", () => {
    const fns = new Set<string>(basanosRegistryAbi.filter((e) => e.type === "function").map((e) => ("name" in e ? e.name : "")));
    for (const name of [
      "registerRulebook",
      "getRulebook",
      "previewStart",
      "startRun",
      "recordPass",
      "recordFail",
      "recordVoid",
      "voidRevoked",
      "handleOracle",
      "getRun",
      "getCloseTxs",
      "getActiveRunIds",
      "activeRunOf",
      "runCount",
      "tokenURI",
      "ownerOf",
      "setBaseUrl",
      "withdraw",
    ]) {
      expect(fns.has(name), name).toBe(true);
    }
    const events = new Set<string>(basanosRegistryAbi.filter((e) => e.type === "event").map((e) => ("name" in e ? e.name : "")));
    expect(events.has("RunStarted")).toBe(true);
    expect(events.has("RunPassed")).toBe(true);
    expect(events.has("RunFailed")).toBe(true);
  });
});

describe("registerArgs", () => {
  it("maps a rulebook to registerRulebook arguments", () => {
    // Distinct pinned numbers keep the field order checkable when referee Task 10 raises the demo target;
    // the oracle symbol comes from the rulebook itself (the spike's oracle probe may change its format).
    const rb = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 51, minDurationSec: 61, timeLimitSec: 901 };
    expect(registerArgs(rb)).toEqual([rulebookId(rb), rb.market.pool, 51, 61, 901, rb.oracleSymbol]);
  });
  it("names enum values in contract order", () => {
    expect(RUN_STATUS[2]).toBe("Passed");
    expect(RULE_NAMES[1]).toBe("DailyLoss");
    expect(VOID_REASONS[3]).toBe("GrantRevoked");
    expect(PREVIEW_CODES[3]).toBe("grant missing");
  });
});
