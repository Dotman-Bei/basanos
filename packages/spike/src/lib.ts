export const HISTORY_DEPTHS: readonly number[] = [10, 1_000, 36_000, 864_000, 3_000_000, 10_000_000, 20_000_000];

export function depthBlocks(head: bigint, depths: readonly number[]): { back: number; block: bigint }[] {
  return depths.filter((d) => BigInt(d) <= head).map((back) => ({ back, block: head - BigInt(back) }));
}

/** The deepest depth such that it and every shallower depth were served. */
export function maxServed(results: readonly { back: number; ok: boolean }[]): number {
  let deepest = 0;
  for (const r of results) {
    if (!r.ok) break;
    deepest = r.back;
  }
  return deepest;
}

export function timestampUnit(chainTs: bigint, nowMs: number): "seconds" | "milliseconds" {
  const asSeconds = Math.abs(Number(chainTs) - nowMs / 1000);
  const asMillis = Math.abs(Number(chainTs) - nowMs);
  return asSeconds <= asMillis ? "seconds" : "milliseconds";
}

export interface TapePoint {
  block: bigint;
  ts: bigint;
  mark: bigint;
}

export function appendTapePoint(points: TapePoint[], p: TapePoint): TapePoint[] {
  const last = points.at(-1);
  if (last && p.block <= last.block) return points;
  return [...points, p];
}
