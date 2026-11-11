import { toEventSelector, type Hex } from "viem";

/** Signatures from @somnia-chain/markets-sdk 0.33.0 marginBankEventsAbi (spec §5). */
export const TRADING_EVENT_SIGNATURES = [
  "PositionUpdated(address,address,int128,uint128,int256,int256)",
  "FundingSettled(address,address,int256)",
  "CollateralLocked(address,address,uint256)",
  "CollateralUnlocked(address,address,uint256)",
  "FeeCharged(address,address,uint256,uint256)",
  "RebatePaid(address,address,uint256)",
  "BuilderFeeCharged(address,address,address,uint256)",
] as const;

export const LIQUIDATION_EVENT_SIGNATURES = [
  "AutoDeleveraged(address,address,address,int128,uint256)",
  "CloseOutMarginSettled(address,address,uint256)",
  "BadDebtAbsorbed(address,uint256,uint256,address)",
  "LiquidationOrderPanicked(address,address,uint256)",
] as const;

const TRADING = new Set<string>(TRADING_EVENT_SIGNATURES.map((s) => toEventSelector(s)));
const LIQUIDATION = new Set<string>(LIQUIDATION_EVENT_SIGNATURES.map((s) => toEventSelector(s)));

export type LogClass = "trading" | "liquidation" | "flow";

/** Anything that is not trading or liquidation — deposits, withdrawals, voucher credits, unknown topics — is a money flow. */
export function classifyMarginBankLog(topic0: Hex | undefined): LogClass {
  if (!topic0) return "flow";
  const t = topic0.toLowerCase();
  if (TRADING.has(t)) return "trading";
  if (LIQUIDATION.has(t)) return "liquidation";
  return "flow";
}
