import { describe, expect, it } from "vitest";
import { HISTORY_DEPTHS, appendTapePoint, depthBlocks, maxServed, timestampUnit } from "../src/lib";

describe("history depth helpers", () => {
  it("lists depths from 10 blocks to 20M", () => {
    expect(HISTORY_DEPTHS[0]).toBe(10);
    expect(HISTORY_DEPTHS.at(-1)).toBe(20_000_000);
  });
  it("skips depths that would go below block 0", () => {
    expect(depthBlocks(1_500n, [10, 1_000, 36_000])).toEqual([
      { back: 10, block: 1_490n },
      { back: 1_000, block: 500n },
    ]);
  });
  it("reports the deepest contiguous depth that was served", () => {
    expect(maxServed([{ back: 10, ok: true }, { back: 1_000, ok: true }, { back: 36_000, ok: false }, { back: 864_000, ok: true }])).toBe(1_000);
    expect(maxServed([{ back: 10, ok: false }])).toBe(0);
  });
});

describe("timestampUnit", () => {
  it("tells seconds from milliseconds against the wall clock", () => {
    expect(timestampUnit(1_794_326_598n, 1_794_326_600_000)).toBe("seconds");
    expect(timestampUnit(1_794_326_598_000n, 1_794_326_600_000)).toBe("milliseconds");
  });
});

describe("appendTapePoint", () => {
  it("keeps one point per block, in order", () => {
    let pts = appendTapePoint([], { block: 1n, ts: 10n, mark: 5n });
    pts = appendTapePoint(pts, { block: 1n, ts: 10n, mark: 6n });
    pts = appendTapePoint(pts, { block: 2n, ts: 11n, mark: 7n });
    pts = appendTapePoint(pts, { block: 1n, ts: 10n, mark: 8n });
    expect(pts).toEqual([
      { block: 1n, ts: 10n, mark: 5n },
      { block: 2n, ts: 11n, mark: 7n },
    ]);
  });
});
