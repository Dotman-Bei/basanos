import type { Rulebook } from "@basanos/core";
import type { RunState } from "@basanos/core/evaluate";

export interface Rails {
  start: bigint;
  target: bigint;
  dailyFloor: bigint;
  trailingFloor: bigint;
}

export function computeRails(rb: Rulebook, state: RunState): Rails {
  return {
    start: state.startEquity,
    target: (state.startEquity * BigInt(10_000 + rb.profitTargetBps)) / 10_000n,
    dailyFloor: (state.dayStart * BigInt(10_000 - rb.dailyLossBps)) / 10_000n,
    trailingFloor: (state.hwm * BigInt(10_000 - rb.trailingDrawdownBps)) / 10_000n,
  };
}

/** Percentage change from start, two decimals. */
export function railPercent(value: bigint, start: bigint): number {
  if (start === 0n) return 0;
  return Number(((value - start) * 10_000n) / start) / 100;
}
