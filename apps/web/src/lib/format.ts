import { formatUnits } from "viem";

export function formatUsdso(raw: bigint, decimals = 18): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const cents = (abs * 100n) / 10n ** BigInt(decimals);
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function formatBps(bps: number): string {
  return `${bps >= 0 ? "+" : "-"}${(Math.abs(bps) / 100).toFixed(2)}%`;
}

/** End against start as a signed percent with 2 decimals ("+0.79%"); "—" when there is no positive start. */
export function formatGain(start: bigint, end: bigint): string {
  if (start <= 0n) return "—";
  return formatBps(Number(((end - start) * 1_000_000n) / start) / 100);
}

/** A BTC-PERP position size (8 base decimals) in plain words: "Flat", "0.0035 BTC long", "0.00342 BTC short". */
export function formatBtc(size: bigint, baseDecimals = 8): string {
  if (size === 0n) return "Flat";
  return `${formatUnits(size < 0n ? -size : size, baseDecimals)} BTC ${size > 0n ? "long" : "short"}`;
}

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
