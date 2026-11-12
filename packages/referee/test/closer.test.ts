import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { planClose, rulebookId, type OrderPlan, type Snapshot } from "@basanos/core";
import { fillableAt, planCloseFromBook, type BookRead, type BookSides } from "@basanos/core/book";
import { loadRulebook } from "@basanos/core/node";
import { flatten, type CloseIO } from "../src/close";
import { fastSender, type SenderIO } from "../src/chain";
import { Engine } from "../src/engine";
import { LOCK_BUFFER_BPS, lockClears } from "../src/lock";
import type { TrackedRun } from "../src/runs";
import type { TxRecord } from "../src/tx";

const E18 = 10n ** 18n;
const A: Address = "0x00000000000000000000000000000000000000a1";
const PARAMS = { tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n };
// Run 2's breach block (48,411,444): mark 71,417.785, the book about 19-21 bps above it.
const MARK = 71_417_785n * 10n ** 15n;
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
const ABOVE: BookSides = { bids: [{ price: px(19), quantity: 2_800_000n }], asks: [{ price: px(21), quantity: 2_800_000n }] };
const BELOW: BookSides = { bids: [{ price: px(-21), quantity: 2_800_000n }], asks: [{ price: px(-19), quantity: 2_800_000n }] };
const rec = (label: string, status: "success" | "reverted" = "success"): TxRecord => ({ label, hash: `0x${"0".repeat(64)}` as Hex, status, gasUsed: 1n, costWei: 1n, explorer: "" });

describe("closes are capped from the book, the mark ladder as the fallback (P7b)", () => {
  it("buys back a short above the best ask, where the old mark + 20 bps cap could not fill", () => {
    const plan = planCloseFromBook(-350_000n, MARK, ABOVE, PARAMS, 20) as OrderPlan;
    expect(plan.isBid).toBe(true);
    expect(fillableAt(true, plan.price, ABOVE)).toBeGreaterThanOrEqual(350_000n);
    expect(fillableAt(true, planClose(-350_000n, MARK, PARAMS, 20)!.price, ABOVE)).toBe(0n);
  });
  it("takes the more permissive limit on each side and either skew, and the ladder alone without a book", () => {
    const ladderSell = planClose(350_000n, MARK, PARAMS, 20)!;
    expect(planCloseFromBook(350_000n, MARK, ABOVE, PARAMS, 20)).toEqual(ladderSell);
    expect(planCloseFromBook(350_000n, MARK, BELOW, PARAMS, 20)!.price).toBeLessThan(ladderSell.price);
    expect(fillableAt(false, planCloseFromBook(350_000n, MARK, BELOW, PARAMS, 20)!.price, BELOW)).toBeGreaterThanOrEqual(350_000n);
    expect(planCloseFromBook(-350_000n, MARK, BELOW, PARAMS, 20)).toEqual(planClose(-350_000n, MARK, PARAMS, 20));
    expect(planCloseFromBook(-350_000n, MARK, null, PARAMS, 20)).toEqual(planClose(-350_000n, MARK, PARAMS, 20));
    expect(planCloseFromBook(-350_000n, MARK, { bids: [], asks: [] }, PARAMS, 20)).toEqual(planClose(-350_000n, MARK, PARAMS, 20));
    expect(planCloseFromBook(500n, MARK, ABOVE, PARAMS, 20)).toBeNull();
  });
});

function fakeIO(start: bigint, book: BookSides, fills: (plan: OrderPlan, size: bigint) => bigint) {
  let size = start;
  const log: string[] = [];
  const io: CloseIO = {
    openOrderIds: async () => (log.push("orders"), [] as bigint[]),
    cancel: async () => rec("cancel"),
    position: async () => (log.push("position"), { size, mark: MARK }),
    book: async () => PARAMS,
    levels: async () => (log.push("levels"), book),
    placeClose: async (_a, plan) => {
      log.push(`close:${plan.isBid ? "buy" : "sell"}:${plan.quantity}`);
      const after = fills(plan, size);
      const filled = after !== size;
      size = after;
      return rec("close", filled ? "success" : "reverted");
    },
  };
  return { io, log };
}

describe("the first close leaves before any read (P7b latency)", () => {
  it("plans the first close from the push and sweeps after it", async () => {
    const { io, log } = fakeIO(-350_000n, ABOVE, (plan, size) => (fillableAt(true, plan.price, ABOVE) >= plan.quantity ? 0n : size));
    const r = await flatten(io, A, { size: -350_000n, mark: MARK, book: ABOVE });
    expect(log[0]).toBe("close:buy:350000");
    expect(log.slice(1)).toEqual(["orders", "position", "orders", "position"]);
    expect(r).toMatchObject({ flat: true, attempts: 1, notes: [] });
  });
  it("retries from a fresh read and a fresh book when the first close does not fill", async () => {
    let first = true;
    const { io, log } = fakeIO(-350_000n, ABOVE, (_plan, size) => {
      if (first) {
        first = false;
        return size;
      }
      return 0n;
    });
    const r = await flatten(io, A, { size: -350_000n, mark: MARK, book: null });
    expect(log).toEqual(["close:buy:350000", "orders", "position", "levels", "close:buy:350000", "position", "orders", "position"]);
    expect(r).toMatchObject({ flat: true, attempts: 2 });
    expect(r.notes).toEqual(["close attempt 1 at 20 bps reverted"]);
  });
});

let chainNonce = 7;
function senderIO(over: Partial<SenderIO> = {}) {
  chainNonce = 7;
  const sent: { nonce: number }[] = [];
  const io = {
    address: A,
    pendingNonce: vi.fn(async () => chainNonce),
    fees: vi.fn(async () => ({ maxFeePerGas: 12n, maxPriorityFeePerGas: 1n })),
    sign: vi.fn(async (tx: { nonce: number }) => {
      sent.push({ nonce: tx.nonce });
      return `0x${tx.nonce.toString(16).padStart(2, "0")}` as Hex;
    }),
    sendRaw: vi.fn(async (raw: Hex) => raw),
    ...over,
  };
  return { io, sent };
}

describe("the fast sender: one round trip per send (P7b latency)", () => {
  it("tracks the nonce locally and caches the fees after warm()", async () => {
    const { io, sent } = senderIO();
    const s = fastSender(io);
    await s.warm();
    for (let i = 0; i < 3; i++) await s.send(A, "0x", 10_000_000n);
    expect(sent.map((x) => x.nonce)).toEqual([7, 8, 9]);
    expect(io.pendingNonce).toHaveBeenCalledTimes(1);
    expect(io.fees).toHaveBeenCalledTimes(1);
  });
  it("forgets the nonce after a failed send, and a resync only ever moves it forward", async () => {
    let fail = true;
    const { io, sent } = senderIO({
      sendRaw: vi.fn(async (raw: Hex) => {
        if (fail) {
          fail = false;
          throw new Error("timed out");
        }
        return raw;
      }),
    });
    const s = fastSender(io);
    await expect(s.send(A, "0x", 1n)).rejects.toThrow(/timed out/);
    await s.send(A, "0x", 1n);
    expect(io.pendingNonce).toHaveBeenCalledTimes(2);
    chainNonce = 20;
    await s.resync();
    await s.send(A, "0x", 1n);
    chainNonce = 3;
    await s.resync();
    await s.send(A, "0x", 1n);
    expect(sent.map((x) => x.nonce)).toEqual([7, 7, 20, 21]);
  });
  it("refreshes stale fees in the background without delaying a send", async () => {
    let now = 0;
    const { io } = senderIO();
    const s = fastSender(io, () => now);
    await s.warm();
    now = 61_000;
    await s.send(A, "0x", 1n);
    expect(io.fees).toHaveBeenCalledTimes(2);
  });
});

describe("the PASS lock (P7)", () => {
  it("locks only 10 bps past the target, from the closeable equity of the push that raised it", () => {
    expect(LOCK_BUFFER_BPS).toBe(10);
    expect(lockClears(10_059n * E18, 10_000n * E18, 50)).toBe(false);
    expect(lockClears(10_060n * E18, 10_000n * E18, 50)).toBe(true);
    expect(lockClears(null, 10_000n * E18, 50)).toBe(false);
  });
  it("keeps that push on the run while the lock acts", () => {
    const demo = loadRulebook("tokyo-sprint-demo");
    const run: TrackedRun = { runId: 1n, account: A, rulebookId: rulebookId(demo), rulebook: demo, startTime: 1_000n, startEquity: 50n * E18, startBlock: 100n };
    const e = new Engine();
    e.track(run);
    const snap = (dt: bigint, total: bigint, size: bigint): Snapshot => ({
      blockNumber: 100n + dt,
      timestamp: 1_000n + dt,
      pool: demo.market.pool,
      markOk: true,
      markPrice: MARK,
      accounts: [{ account: A, equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: [demo.market.pool], size }],
    });
    const book = (dt: bigint): BookRead => ({ blockNumber: 100n + dt, ...ABOVE });
    // A long whose closeable equity (bids +19 bps over the mark) clears +0.5% after the 60 s minimum.
    const total = 50n * E18 + (60n * E18) / 100n;
    expect(e.onSnapshot(snap(61n, total, 70_000n), book(61n))).toEqual([{ kind: "lock", runId: 1n, account: A }]);
    const seen = e.get(1n)?.lastPush;
    expect(seen).toMatchObject({ blockNumber: 161n, size: 70_000n, mark: MARK });
    expect(seen?.judged).toBeGreaterThan(total);
    e.onSnapshot(snap(62n, 50n * E18, 70_000n), book(62n));
    expect(e.get(1n)?.lastPush?.blockNumber).toBe(161n);
  });
});
