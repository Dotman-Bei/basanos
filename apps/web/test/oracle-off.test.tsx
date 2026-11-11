import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ORACLE_OFF_LINE, VerdictView, type VerdictData } from "../src/components/VerdictView";

const E18 = 10n ** 18n;
const read = (equity: bigint, block: bigint) => ({ blockNumber: block, equityOk: true, equity, lockedCollateral: 0n, positionSize: 0n, markOk: true, markPrice: 74_500n * E18 });
const data: VerdictData = {
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

describe("Price Oracle cross-check copy (cut 2026-11-11)", () => {
  it("says the cross-check is off and names neither Somnia Agents nor a Somnia Price Oracle reading", () => {
    const { container } = render(<VerdictView data={data} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />);
    expect(ORACLE_OFF_LINE).toBe(
      "Off for this build: the registry can request a Price Oracle reading at each verdict, but our test request on Tokyo testnet finalized Failed because the validators' answers differed and the default Majority consensus needs identical answers. Verdicts do not request one.",
    );
    expect(screen.getByText(ORACLE_OFF_LINE)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Price Oracle cross-check" })).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(/Somnia Price Oracle|Somnia Agents/);
  });
});
