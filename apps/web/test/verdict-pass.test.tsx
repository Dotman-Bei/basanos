import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { keccak256, toBytes, type Hex } from "viem";
import { rulebookId } from "@basanos/core";
import { VerdictView, type VerdictData } from "../src/components/VerdictView";
import { EVIDENCE, lockTxsFromEvidence, type EvidenceStore } from "../src/lib/evidence";
import { RULEBOOKS } from "../src/lib/rulebooks";
import { rulebookText } from "../src/pages/Verdict";

const A = "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1";
const LOCK: Hex = "0xfdf79939e50b31b3b5452d5a854d78932dedefafa1d34154a289cc5e38b75548";
const MARK = 71_916_580_939_002_933_000_000n;
const read = (equity: bigint, block: bigint, positionSize = 0n) => ({ blockNumber: block, equityOk: true, equity, lockedCollateral: 0n, positionSize, markOk: true, markPrice: MARK });
// Run 3 as the registry stores it (the first live PASS): flat at both ends, no close transaction recorded.
const pass: VerdictData = {
  runId: 3n,
  account: A,
  status: 2,
  rule: 0,
  voidReason: 0,
  rulebookLabel: "Tokyo Sprint · Demo",
  rulebookId: rulebookId(RULEBOOKS[1]),
  rulebookJson: null,
  start: read(49_671_425_000_000_000_000n, 48_539_976n),
  breach: { blockNumber: 0n, equityOk: false, equity: 0n, lockedCollateral: 0n, positionSize: 0n, markOk: false, markPrice: 0n },
  end: read(50_063_345_000_000_000_000n, 48_541_698n),
  closeTxs: [],
  oraclePrice: 0n,
  oracleSources: 0,
  oracleDone: false,
};
// Run 1's breach (a FAIL): a 0.0035 BTC long.
const fail: VerdictData = { ...pass, runId: 1n, status: 3, rule: 1, breach: read(49_249_049_431_589_214_500n, 48_411_742n, 350_000n), closeTxs: [LOCK] };
const bundle = (over: Record<string, unknown> = {}) => ({
  bundle: {
    account: A,
    startBlock: "48539976",
    verdict: "PASSED",
    lock: { blockNumber: "48541592", judgedEquity: "50063345000000000000", bufferBps: 10 },
    close: { txs: [{ label: "close", hash: LOCK, status: "success" }, { label: "close", hash: `0x${"bb".repeat(32)}`, status: "reverted" }] },
    ...over,
  },
});
const LOCK_HEADING = "Referee lock transaction (from the evidence bundle)";

describe("the verdict page for a PASS (P8)", () => {
  it("takes the lock close from the evidence bundle only for this very run", () => {
    expect(lockTxsFromEvidence({ "3": bundle() }, pass)).toEqual([LOCK]);
    const wrong: EvidenceStore[] = [{}, { "3": bundle({ account: `0x${"11".repeat(20)}` }) }, { "3": bundle({ startBlock: "1" }) }, { "3": bundle({ verdict: "FAILED" }) }, { "3": bundle({ lock: undefined }) }];
    for (const store of wrong) expect(lockTxsFromEvidence(store, pass)).toEqual([]);
  });
  it("finds run 3's lock close in the committed evidence (docs/evidence/runs.json)", () => {
    expect(lockTxsFromEvidence(EVIDENCE, pass)).toEqual([LOCK]);
  });
  it("shows the lock close on a PASS, labelled as from the evidence bundle, and never on a FAIL", () => {
    const { rerender } = render(<VerdictView data={pass} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} lockTxs={[LOCK]} />);
    expect(screen.getByText(LOCK_HEADING)).toBeTruthy();
    expect(screen.getByRole("link", { name: "0xfdf7…5548" }).getAttribute("href")).toContain(LOCK);
    rerender(<VerdictView data={pass} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />);
    expect(screen.queryByText(LOCK_HEADING)).toBeNull();
    rerender(<VerdictView data={fail} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} lockTxs={[LOCK]} />);
    expect(screen.queryByText(LOCK_HEADING)).toBeNull();
  });
  it("shows position sizes in BTC, never as a raw integer", () => {
    const { container, rerender } = render(<VerdictView data={pass} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />);
    expect(screen.getAllByText("Flat")).toHaveLength(2);
    rerender(<VerdictView data={fail} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />);
    expect(screen.getByText("0.0035 BTC long")).toBeTruthy();
    expect(container.textContent).not.toContain("350000");
  });
  it("shows the rulebook as the canonical JSON whose keccak256 is its id", () => {
    const id = rulebookId(RULEBOOKS[1]);
    const text = rulebookText(id);
    expect(text).not.toBeNull();
    expect(keccak256(toBytes(text!))).toBe(id);
    expect(rulebookText(`0x${"00".repeat(32)}`)).toBeNull();
  });
});
