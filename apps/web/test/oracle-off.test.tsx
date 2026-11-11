import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ORACLE_NO_READING_LINE, VerdictView, type VerdictData } from "../src/components/VerdictView";

const E18 = 10n ** 18n;
const read = (equity: bigint, block: bigint) => ({ blockNumber: block, equityOk: true, equity, lockedCollateral: 0n, positionSize: 0n, markOk: true, markPrice: 74_500n * E18 });
const base: VerdictData = {
  runId: 4n,
  account: "0x00000000000000000000000000000000000000a1",
  status: 3,
  rule: 1,
  voidReason: 0,
  rulebookLabel: "Tokyo Sprint · Demo",
  rulebookId: `0x${"11".repeat(32)}`,
  rulebookJson: null,
  start: read(1_000n * E18, 100n),
  breach: read(994n * E18, 160n),
  end: read(993n * E18, 165n),
  closeTxs: [`0x${"aa".repeat(32)}`],
  oraclePrice: 0n,
  oracleSources: 0,
  oracleDone: false,
};

describe("Price Oracle cross-check line (truth by construction)", () => {
  it("shows a recorded reading beside the mark", () => {
    render(
      <VerdictView data={{ ...base, oraclePrice: 7_373_585n * 10n ** 16n, oracleSources: 6, oracleDone: true }} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />,
    );
    expect(screen.getByRole("heading", { name: "Price Oracle cross-check" })).toBeTruthy();
    expect(screen.getByText("73,735.85 (6 sources) vs mark 74,500.00")).toBeTruthy();
  });
  it("says no reading was recorded when there is none, and claims nothing else", () => {
    const { container } = render(<VerdictView data={base} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />);
    expect(ORACLE_NO_READING_LINE).toBe("No Price Oracle reading was recorded for this verdict.");
    expect(screen.getByText(ORACLE_NO_READING_LINE)).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/sources\) vs mark|Off for this build/);
  });
});
