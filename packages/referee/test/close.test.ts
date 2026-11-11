import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { OrderPlan } from "@basanos/core";
import { flatten, type CloseIO } from "../src/close";
import type { TxRecord } from "../src/tx";

const A: Address = "0x00000000000000000000000000000000000000a1";
const E18 = 10n ** 18n;
const rec = (label: string, status: "success" | "reverted" = "success"): TxRecord => ({
  label,
  hash: `0x${label.length.toString(16).padStart(64, "0")}` as Hex,
  status,
  gasUsed: 1n,
  costWei: 1n,
  explorer: "https://x",
});

function fakeIO(start: { size: bigint; orders: bigint[] }, onClose: (size: bigint, plan: OrderPlan) => bigint, revert = false) {
  let size = start.size;
  let orders = [...start.orders];
  const calls: string[] = [];
  const io: CloseIO = {
    openOrderIds: async () => orders,
    cancel: async (_a, id) => {
      calls.push(`cancel:${id}`);
      orders = orders.filter((o) => o !== id);
      return rec("cancel");
    },
    position: async () => ({ size, mark: 74_500n * E18 }),
    book: async () => ({ tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n }),
    placeClose: async (_a, plan) => {
      calls.push(`close:${plan.isBid ? "buy" : "sell"}:${plan.quantity}`);
      if (revert) return rec("close", "reverted");
      size = onClose(size, plan);
      return rec("close");
    },
  };
  return { io, calls };
}

describe("flatten", () => {
  it("cancels first, closes the fresh position, reads back flat", async () => {
    const { io, calls } = fakeIO({ size: 13_000n, orders: [5n, 6n] }, () => 0n);
    const r = await flatten(io, A);
    expect(calls).toEqual(["cancel:5", "cancel:6", "close:sell:13000"]);
    expect(r).toMatchObject({ flat: true, finalSize: 0n, attempts: 1 });
  });

  it("closes a flipped remainder after a concurrent fill", async () => {
    let first = true;
    const { io, calls } = fakeIO({ size: 13_000n, orders: [] }, (size, plan) => {
      if (first) {
        first = false;
        return -2_000n;
      }
      return size + (plan.isBid ? plan.quantity : -plan.quantity);
    });
    const r = await flatten(io, A);
    expect(calls).toEqual(["close:sell:13000", "close:buy:2000"]);
    expect(r.flat).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it("stops after three reverted attempts and reports the residual", async () => {
    const { io } = fakeIO({ size: 13_000n, orders: [] }, (s) => s, true);
    const r = await flatten(io, A);
    expect(r.attempts).toBe(3);
    expect(r.flat).toBe(false);
    expect(r.finalSize).toBe(13_000n);
    expect(r.notes).toHaveLength(3);
  });

  it("notes a residual below one lot", async () => {
    const { io } = fakeIO({ size: 500n, orders: [] }, (s) => s);
    const r = await flatten(io, A);
    expect(r.attempts).toBe(0);
    expect(r.notes[0]).toMatch(/below one lot/);
  });
});
