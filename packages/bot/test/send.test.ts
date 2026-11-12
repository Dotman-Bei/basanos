import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { keccak256, type Address, type Hex } from "viem";
import { BTC_POOL, ORDER_GAS, ORDER_TYPE_IOC } from "@basanos/core";
import { ownerOrderCall } from "@basanos/core/owner-tx";
import { RECEIPT_WAIT_MS, describeWrite, effectOf, onFailure, sendWrite, verdictDeadline, type Receipt, type SendResult, type Sender } from "../src/send";

// Any signed bytes will do: the fake signer returns them, and the hash is theirs.
const RAW: Hex = "0x02f8b28301c8cf0284017d784084017d784083989680944181dd08e73bbcdd1ba3e615a18f6abd941b94c080";
const HASH = keccak256(RAW);
const ACCOUNT: Address = "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1";
const OPEN = ownerOrderCall(BTC_POOL, false, 72_506_200n * 10n ** 15n, 342_000n, ORDER_TYPE_IOC, 3_371_163_205_000_000_000n);
const receipt = (status: "success" | "reverted"): Receipt => ({ transactionHash: HASH, status, gasUsed: 3_149_456n, effectiveGasPrice: 6_000_000_000n });
// What B's grant hit on the SDK's send path in the first rehearsal (2026-11-12).
const timedOut = () => Promise.reject(new Error("TransactionOutcomeUnknownError: eth_sendRawTransactionSync timed out"));

function fakeSender(over: Partial<Sender> = {}) {
  const s = {
    address: ACCOUNT,
    pendingNonce: vi.fn(async () => 2),
    sign: vi.fn(async () => RAW),
    sendRaw: vi.fn(async () => HASH as unknown),
    waitReceipt: vi.fn(async () => receipt("success")),
    receipt: vi.fn(async (): Promise<Receipt | null> => null),
    ...over,
  };
  return s;
}

const source = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("bot writes are viem-direct and sent once (P6a)", () => {
  it("signs at the pending nonce with ORDER_GAS, sends the raw bytes once and takes the receipt by their hash", async () => {
    const s = fakeSender();
    const r = await sendWrite(s, "open short", OPEN);
    expect(s.sign).toHaveBeenCalledWith({ to: BTC_POOL, data: OPEN.data, value: 0n, gas: ORDER_GAS, nonce: 2 });
    expect(s.sendRaw).toHaveBeenCalledTimes(1);
    expect(s.sendRaw).toHaveBeenCalledWith(RAW);
    expect(s.waitReceipt).toHaveBeenCalledWith(HASH, RECEIPT_WAIT_MS);
    expect(r.outcome).toBe("landed");
    expect(r.hash).toBe(HASH);
    expect(r.nonce).toBe(2);
    expect(r.tx?.costWei).toBe(18_896_736_000_000_000n);
  });
  it("looks a failed send up by the hash it signed, and never sends twice", async () => {
    const landedAnyway = fakeSender({ sendRaw: vi.fn(timedOut) });
    expect((await sendWrite(landedAnyway, "grant", OPEN)).outcome).toBe("landed");
    expect(landedAnyway.sendRaw).toHaveBeenCalledTimes(1);

    const late = fakeSender({ sendRaw: vi.fn(timedOut), waitReceipt: vi.fn(timedOut), receipt: vi.fn(async () => receipt("reverted")) });
    const lateResult = await sendWrite(late, "open short", OPEN);
    expect(lateResult.outcome).toBe("landed");
    expect(lateResult.tx?.status).toBe("reverted");

    const lost = fakeSender({ sendRaw: vi.fn(timedOut), waitReceipt: vi.fn(timedOut) });
    const lostResult = await sendWrite(lost, "open short", OPEN);
    expect(lostResult).toMatchObject({ outcome: "unknown", hash: HASH, nonce: 2, tx: null });
    expect(lostResult.reason).toMatch(/^send failed: TransactionOutcomeUnknownError/);
    expect(lost.sendRaw).toHaveBeenCalledTimes(1);

    const noReceipt = fakeSender({ waitReceipt: vi.fn(timedOut) });
    expect((await sendWrite(noReceipt, "startRun", OPEN, 1_000)).reason).toMatch(/^no receipt within 1 s/);
  });
  it("leaves the SDK out of every bot write", () => {
    for (const file of readdirSync(new URL("../src/", import.meta.url))) {
      expect(source(file), file).not.toMatch(/\.trader\.|placePerpOrder|privateKey\s*:/);
    }
    const actions = source("actions.ts");
    expect(actions.match(/sendWrite\(viemSender\(wallet, client\)/g)).toHaveLength(3);
    expect(actions).toContain("planOpenFromBook(isBid, quantity, levels, params)");
  });
});

describe("a write counts only when the chain shows it (P6b)", () => {
  const landed = (status: "success" | "reverted"): SendResult => ({ outcome: "landed", label: "open short", hash: HASH, nonce: 2, tx: { label: "open short", hash: HASH, status, gasUsed: 1n, costWei: 1n, explorer: "" }, reason: null });
  const unknown: SendResult = { outcome: "unknown", label: "open short", hash: HASH, nonce: 2, tx: null, reason: "send failed: timed out" };
  it("reads the effect back: a position, a grant or a run, never the send call", () => {
    expect(effectOf(landed("success"), true, 3)).toBe("done");
    expect(effectOf(landed("reverted"), false, 3)).toBe("not-done");
    expect(effectOf(unknown, true, 2)).toBe("done");
    expect(effectOf(unknown, false, 3)).toBe("not-done");
    expect(effectOf(unknown, false, 2)).toBe("unknown");
    expect(describeWrite({ sent: unknown, effect: "unknown" })).toBe(`open short: unknown (send failed: timed out; tx ${HASH}, nonce 2)`);
    expect(describeWrite({ sent: landed("reverted"), effect: "not-done" })).toBe(`open short: not-done (receipt reverted; tx ${HASH}, nonce 2)`);
  });
  it("stops before any run, aborts once a run has started, and only notes a failed exposure top-up", () => {
    for (const kind of ["grant", "start", "open", "error"] as const) expect(onFailure(kind, 0)).toBe("stop");
    for (const kind of ["start", "open", "error"] as const) expect(onFailure(kind, 1)).toBe("abort");
    expect(onFailure("open", 2)).toBe("abort");
    expect(onFailure("breach", 2)).toBe("note");
    expect(verdictDeadline(1_000, 900)).toBe(1_201_000);
  });
  it("records an aborted take apart from the takes check-rehearsal judges, and never voids a run", () => {
    const demo = source("demo.ts");
    expect(demo).toContain("repoPath(DEMO_ABORTED)");
    expect(demo).toContain("onFailure(e instanceof WriteFailed ? e.kind : \"error\", started.length)");
    expect(demo).not.toMatch(/voidRun|setOperatorApproval|approved: false/);
  });
});
