import { describe, expect, it } from "vitest";
import { fillSpec, summarize } from "../src/spec-evidence";

const SPEC = [
  "served `USDso.totalSupply()` at **10,000,000 blocks back (2026-10-30, ≈ 11.6 days)**, with values that",
  "| G1(a) referee close on a voucher account | `docs/evidence/g1a-close.json` | written by `spike:13` |",
  "| G1(c) equity history depth | `docs/evidence/g1c-history.json` | written by `spike:13` |",
].join("\n");

describe("summarize", () => {
  it("summarises the close and the history depth", () => {
    expect(
      summarize("g1a-close", { ok: true, closeAttempts: 1, txs: [{}, {}, {}], leverage: { voucherLeverageCapX: 20 }, entry: { costBps: 1.25 } }),
    ).toBe("PASS — flat after 1 close attempt(s), 3 txs; voucher cap 20x; entry 1.25 bps vs mark");
    expect(
      summarize("g1a-close", { ok: true, closeAttempts: 1, txs: [{}, {}], leverage: { voucherLeverageCapX: 20, capX: 40, capSource: "market" }, entry: { costBps: 22.4 } }),
    ).toBe("PASS — flat after 1 close attempt(s), 2 txs; leverage cap 40x (market); entry 22.4 bps vs mark");
    expect(summarize("g1c-history", { maxServedBack: 10_000_000 })).toBe("equity view served 10,000,000 blocks back (≈ 11.6 days)");
    expect(summarize("g1d-oracle", null)).toBe("not run");
  });
});

describe("fillSpec", () => {
  it("replaces every result cell it has a result for and the horizon line", () => {
    const out = fillSpec(SPEC, {
      "g1a-close": "PASS — x",
      "g1b-watch": "w",
      "g1c-history": "equity view served 20,000,000 blocks back (≈ 23.1 days)",
      "g1d-oracle": "o",
      "r1-indexer": "r",
      tape: "t",
    });
    expect(out).toContain("| `docs/evidence/g1a-close.json` | PASS — x |");
    expect(out).toContain("| `docs/evidence/g1c-history.json` | equity view served 20,000,000 blocks back (≈ 23.1 days) |");
    expect(out).toContain("measured with the equity view: equity view served 20,000,000 blocks back (≈ 23.1 days)");
    expect(out).not.toContain("written by `spike:13`");
  });
});
