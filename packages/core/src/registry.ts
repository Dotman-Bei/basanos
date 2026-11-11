import type { Address, Hex } from "viem";
import { rulebookId, type Rulebook } from "./rulebook";

export type RegisterArgs = readonly [Hex, Address, number, number, number, string];

export function registerArgs(rb: Rulebook): RegisterArgs {
  return [rulebookId(rb), rb.market.pool, rb.profitTargetBps, rb.minDurationSec, rb.timeLimitSec, rb.oracleSymbol] as const;
}

export const RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"] as const;
export const RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"] as const;
export const VOID_REASONS = ["None", "Flow", "ForeignMarket", "GrantRevoked"] as const;
export const PREVIEW_CODES = [
  "ok",
  "unknown rulebook",
  "active run exists",
  "grant missing",
  "not flat",
  "unpriceable",
  "non-positive equity",
] as const;
