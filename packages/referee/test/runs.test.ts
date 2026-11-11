import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { rulebookId } from "@basanos/core";
import { loadRulebook } from "@basanos/core/node";
import { readActiveRuns, rulebookIndex } from "../src/runs";

const demo = loadRulebook("tokyo-sprint-demo");
const standard = loadRulebook("tokyo-sprint");
const REG = "0x00000000000000000000000000000000000000f0";

describe("rulebookIndex", () => {
  it("maps lowercase on-chain ids to local rulebooks", () => {
    const idx = rulebookIndex([demo, standard]);
    expect(idx.get(rulebookId(demo).toLowerCase())?.variant).toBe("demo");
    expect(idx.size).toBe(2);
  });
});

describe("readActiveRuns", () => {
  it("reads active runs and skips rulebooks this referee does not judge", async () => {
    const fake = {
      readContract: async (p: { functionName: string; args?: readonly unknown[] }) => {
        if (p.functionName === "getActiveRunIds") return [1n, 2n];
        const id = (p.args ?? [])[0];
        return {
          account: "0x00000000000000000000000000000000000000a1",
          rulebookId: id === 1n ? rulebookId(demo) : `0x${"99".repeat(32)}`,
          startTime: 1_794_326_400n,
          start: { blockNumber: 46_725_618n, equityOk: true, equity: 1_000n * 10n ** 18n, lockedCollateral: 0n, positionSize: 0n, markOk: true, markPrice: 1n },
        };
      },
    } as unknown as PublicClient;
    const runs = await readActiveRuns(fake, REG, rulebookIndex([demo]));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe(1n);
    expect(runs[0]?.rulebook.variant).toBe("demo");
    expect(runs[0]?.startEquity).toBe(1_000n * 10n ** 18n);
    expect(runs[0]?.startBlock).toBe(46_725_618n);
  });
});
