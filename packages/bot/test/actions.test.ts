import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { appendDemoTake, breachQuantity, runIdFromLogs } from "../src/actions";

const E18 = 10n ** 18n;
const BOOK = { tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n };
const REG = "0x00000000000000000000000000000000000000f0";

describe("breachQuantity", () => {
  it("adds just enough size to pass the target exposure", () => {
    const add = breachQuantity(-16_107_000n, 1_000n * E18, 16, 74_500n * E18, 8, BOOK);
    const after = 16_107_000n + add;
    expect((after * 74_500n * E18) / 100_000_000n > 16_000n * E18).toBe(true);
    expect(((after - 1_000n) * 74_500n * E18) / 100_000_000n <= 16_000n * E18 + (1_000n * 74_500n * E18) / 100_000_000n).toBe(true);
    expect(add % 1_000n).toBe(0n);
  });
  it("is at least the market minimum", () => {
    expect(breachQuantity(-30_000_000n, 1_000n * E18, 16, 74_500n * E18, 8, BOOK)).toBe(13_000n);
  });
});

describe("runIdFromLogs", () => {
  it("decodes RunStarted from the registry's own logs only", () => {
    const topics = encodeEventTopics({
      abi: basanosRegistryAbi,
      eventName: "RunStarted",
      args: { runId: 42n, account: "0x00000000000000000000000000000000000000a1", rulebookId: `0x${"11".repeat(32)}` },
    }) as Hex[];
    const data = encodeAbiParameters([{ type: "uint64" }, { type: "int256" }], [100n, 1_000n * E18]);
    expect(runIdFromLogs([{ address: REG, data, topics }], REG)).toBe(42n);
    expect(runIdFromLogs([{ address: "0x00000000000000000000000000000000000000ee", data, topics }], REG)).toBeNull();
  });
});

describe("appendDemoTake", () => {
  it("appends numbered takes to one file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "basanos takes ")), "demo-takes.json");
    expect(appendDemoTake({ outcome: "a" }, path)).toBe(1);
    expect(appendDemoTake({ outcome: "b", big: 5n }, path)).toBe(2);
    const all = JSON.parse(readFileSync(path, "utf8")) as { take: number; big?: string }[];
    expect(all.map((t) => t.take)).toEqual([1, 2]);
    expect(all[1]?.big).toBe("5");
  });
});
