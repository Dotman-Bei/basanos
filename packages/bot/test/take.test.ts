import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { keccak256, type Address, type Hex } from "viem";
import { BTC_POOL, ORDER_GAS, ORDER_TYPE_IOC } from "@basanos/core";
import { ownerOrderCall } from "@basanos/core/owner-tx";
import { prepareWrite, submitWrite, type Receipt, type Sender } from "../src/send";
import { breachTarget } from "../src/take";

const source = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("the FAIL on demand comes right after the first PASS (P7)", () => {
  it("pushes the run still Active once the other has PASSED, once", () => {
    expect(breachTarget(["Passed", "Active"], false)).toBe(1);
    expect(breachTarget(["Active", "Passed"], false)).toBe(0);
    expect(breachTarget(["Passed", "Active"], true)).toBeNull();
    expect(breachTarget(["Active", "Active"], false)).toBeNull();
    expect(breachTarget(["Failed", "Active"], false)).toBeNull();
    expect(breachTarget(["Passed", "Failed"], false)).toBeNull();
  });
});

describe("the opposite pair enters together (P7)", () => {
  it("signs both opens first, then sends both before either receipt comes back", async () => {
    const order: string[] = [];
    const release: (() => void)[] = [];
    const sender = (name: string, nonce: number): Sender => {
      const raw = `0x${name.charCodeAt(0).toString(16)}` as Hex;
      return {
        address: "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1" as Address,
        pendingNonce: async () => nonce,
        sign: vi.fn(async (tx) => {
          order.push(`sign ${name} gas ${tx.gas}`);
          return raw;
        }),
        sendRaw: async () => {
          order.push(`send ${name}`);
          return keccak256(raw);
        },
        waitReceipt: (hash) =>
          new Promise<Receipt>((resolve) => {
            order.push(`wait ${name}`);
            release.push(() => resolve({ transactionHash: hash, status: "success", gasUsed: 1n, effectiveGasPrice: 1n }));
          }),
        receipt: async () => null,
      };
    };
    const call = ownerOrderCall(BTC_POOL, true, 72_000n * 10n ** 18n, 700_000n, ORDER_TYPE_IOC, 3_371_163_205_000_000_000n);
    const a = sender("A", 6);
    const b = sender("B", 2);
    const prepared = await Promise.all([prepareWrite(a, "open long", call), prepareWrite(b, "open short", call)]);
    expect(prepared.map((p) => p.nonce)).toEqual([6, 2]);
    const done = Promise.all([submitWrite(a, prepared[0]!), submitWrite(b, prepared[1]!)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([`sign A gas ${ORDER_GAS}`, `sign B gas ${ORDER_GAS}`, "send A", "send B", "wait A", "wait B"]);
    for (const r of release) r();
    expect((await done).map((s) => s.outcome)).toEqual(["landed", "landed"]);
  });
  it("starts both runs before the pair opens, follows a human A, and breaches only after a PASS", () => {
    const demo = source("demo.ts");
    expect(demo).toContain("await Promise.all(accounts.map((a) => startRun(a)));");
    expect(demo).toContain("openPair(client, [");
    expect(demo).toContain("waitForPosition(client, accA.address, until)");
    expect(demo).toContain("breachTarget(");
    expect(demo).not.toContain("--wait-min");
    expect(demo).not.toContain("market still");
  });
});
