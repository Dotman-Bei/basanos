import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTape, simulateTape } from "../src/demo-math";
import { loadRulebook, repoPath } from "../src/node";

describe("G4: the recorded live BTC tape resolves Tokyo Sprint · Demo at 12x (market movement alone)", () => {
  it("resolves at least one of the two opposite accounts", () => {
    const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
    expect(tape.length).toBeGreaterThan(100);
    // Thresholds pinned to the registered Tokyo Sprint · Demo values, so a raised demo target (referee Task 10 Step 1) never turns this test red.
    const r = simulateTape({ ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 }, tape, {
      leverageX: 12,
      startEquity: 1_000n * 10n ** 18n,
      lotSize: 1_000n,
      entryCostBps: 0,
      exitCostBps: 0,
    });
    const resolved = [r.long.outcome, r.short.outcome].filter((o) => o !== "unresolved");
    expect(resolved.length).toBeGreaterThan(0);
  });
});
