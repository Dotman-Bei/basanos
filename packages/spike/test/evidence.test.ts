import { describe, expect, it } from "vitest";
import { checkEvidence, toJsonSafe } from "../src/evidence";
import { pickMostFrequent } from "../src/find-active";

describe("toJsonSafe", () => {
  it("turns bigints into decimal strings, deeply", () => {
    expect(toJsonSafe({ a: 1n, b: [2n, { c: 3n }], d: "x" })).toEqual({ a: "1", b: ["2", { c: "3" }], d: "x" });
  });
});

describe("checkEvidence", () => {
  it("flags a missing file", () => {
    expect(checkEvidence("g1c-history", null)).toEqual(["g1c-history: evidence file is missing"]);
  });
  it("accepts a complete history file and rejects an empty one", () => {
    const good = { account: "0x1", depths: [{ back: 10, block: "1", ok: true }], maxServedBack: 10 };
    expect(checkEvidence("g1c-history", good)).toEqual([]);
    expect(checkEvidence("g1c-history", { account: "0x1", depths: [] })).not.toEqual([]);
  });
  it("requires ok: true and a flat end state for the referee close", () => {
    const base = {
      ok: true,
      txs: [
        { label: "grant", hash: "0x1", status: "success" },
        { label: "open", hash: "0x2", status: "success" },
        { label: "close", hash: "0x3", status: "success" },
      ],
      finalPositionSize: "0",
      leverage: { voucherLeverageCapX: 20 },
      entry: { costBps: 1.25 },
      costs: { totalWei: "1" },
    };
    expect(checkEvidence("g1a-close", base)).toEqual([]);
    expect(checkEvidence("g1a-close", { ...base, ok: false })).toContain("g1a-close: ok is not true (STOP and escalate)");
    expect(checkEvidence("g1a-close", { ...base, finalPositionSize: "13000" })).not.toEqual([]);
  });
  it("accepts an oracle file whatever the final status, as long as it was recorded", () => {
    expect(checkEvidence("g1d-oracle", { requestId: "7", finalStatus: "TimedOut", symbols: [] })).toEqual([]);
    expect(checkEvidence("g1d-oracle", { requestId: "7" })).not.toEqual([]);
  });
  it("needs three indexer reads, a watch with pushes and a tape with more than 100 points", () => {
    expect(checkEvidence("r1-indexer", { reads: [{}, {}, {}] })).toEqual([]);
    expect(checkEvidence("g1b-watch", { pushes: 3, blockNumbers: ["1"], timestampUnit: "seconds", equityDecoded: true })).toEqual([]);
    expect(checkEvidence("tape", { pool: "0x1", points: Array.from({ length: 101 }, (_, i) => ({ block: String(i + 1), ts: String(i + 2), mark: "3" })) })).toEqual([]);
    expect(checkEvidence("tape", { pool: "0x1", points: [] })).not.toEqual([]);
  });
});

describe("pickMostFrequent", () => {
  it("returns the address seen most often, or null", () => {
    expect(pickMostFrequent([])).toBeNull();
    expect(pickMostFrequent(["0xa", "0xb", "0xb"] as `0x${string}`[])).toBe("0xb");
  });
});
