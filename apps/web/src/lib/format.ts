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

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
