export const TRUST_LINE = "Every certificate is chain-checked at mint; every verdict is replayable.";
export const DEMO_DISCLOSURE = "Both demo accounts are burners operated by the builder: one human-driven, one scripted.";
export const TESTNET_NOTICE = "Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.";
/** Claims no Basanos surface may make (spec §2). */
export const FORBIDDEN_CLAIMS: readonly string[] = ["verifies every verdict", "guaranteed", "trusted by", "real money", "payout"];

export function usd(raw: bigint): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const cents = (abs * 100n) / 10n ** 18n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}
