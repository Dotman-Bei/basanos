import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BookSides } from "@basanos/core/book";
import { VerdictView, type VerdictData } from "../src/components/VerdictView";
import { judgedFromBook } from "../src/lib/judged";

const E18 = 10n ** 18n;
const MARK = 72_800n * E18;
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
const BOOK: BookSides = { bids: [{ price: px(19), quantity: 1_373_000n }], asks: [{ price: px(21), quantity: 1_373_000n }] };
const read = (equity: bigint, block: bigint, positionSize = 0n) => ({ blockNumber: block, equityOk: true, equity, lockedCollateral: 0n, positionSize, markOk: true, markPrice: MARK });
// A short that breached daily loss: the stored (marked) equity reads high by the basis; the book shows the real loss.
const breach = read(4_990n * 10n ** 16n, 160n, -342_000n);
const data: VerdictData = {
  runId: 4n,
  account: "0x00000000000000000000000000000000000000a1",
  status: 3,
  rule: 1,
  voidReason: 0,
  rulebookLabel: "Tokyo Sprint · Demo",
  rulebookId: `0x${"11".repeat(32)}`,
  rulebookJson: null,
  start: read(50n * E18, 100n),
  breach,
  end: read(4_960n * 10n ** 16n, 165n),
  closeTxs: [],
  oraclePrice: 0n,
  oracleSources: 0,
  oracleDone: false,
};

describe("the verdict page replays the judged equity (spec §5, P5)", () => {
  it("revalues the stored breach read at the book of its block", () => {
    const j = judgedFromBook(breach, BOOK);
    expect(j).toEqual({ equity: breach.equity - ((px(21) - MARK) * 342_000n) / 10n ** 8n, served: true });
    expect(judgedFromBook(breach, null)).toEqual({ equity: null, served: false });
    expect(judgedFromBook({ ...breach, equityOk: false }, BOOK)).toEqual({ equity: null, served: true });
  });
  it("shows the closeable equity beside the stored reads after Replay, and says how it was judged", () => {
    const j = judgedFromBook(breach, BOOK);
    render(<VerdictView data={data} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} breachJudged={j} />);
    expect(screen.getByText("Closeable equity (judged)")).toBeTruthy();
    expect(screen.getByText("49.37 USDso")).toBeTruthy();
    expect(screen.getByText(/revalued at the book in this block/)).toBeTruthy();
  });
  it("labels a book the public RPC no longer serves, and shows nothing before Replay", () => {
    const { rerender } = render(<VerdictView data={data} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} breachJudged={{ equity: null, served: false }} />);
    expect(screen.getByText("book no longer served by the public RPC")).toBeTruthy();
    rerender(<VerdictView data={data} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />);
    expect(screen.queryByText("Closeable equity (judged)")).toBeNull();
  });
});
