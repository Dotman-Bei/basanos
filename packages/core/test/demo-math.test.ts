import { describe, expect, it } from "vitest";
import { costBpsVsMark, parseTape, recommendDemoTargetBps, roundTripEquityBps, simulateTape } from "../src/demo-math";
import { loadRulebook } from "../src/node";

const E18 = 10n ** 18n;
// Thresholds pinned to the registered Tokyo Sprint · Demo values, so a raised demo target (referee Task 10 Step 1) never turns this test red.
const rb = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
const T0 = 1_794_326_400n;
const opts = { leverageX: 12, startEquity: 1_000n * E18, lotSize: 1_000n, entryCostBps: 0, exitCostBps: 0 };

function ramp(fromMark: number, toMark: number, seconds: number) {
  return Array.from({ length: seconds + 1 }, (_, i) => ({
    block: BigInt(i + 1),
    ts: T0 + BigInt(i),
    mark: BigInt(Math.round((fromMark + ((toMark - fromMark) * i) / seconds) * 10)) * (E18 / 10n),
  }));
}

describe("simulateTape", () => {
  it("passes the long and fails the short on a 0.1% rise over 2 minutes", () => {
    const r = simulateTape(rb, ramp(74_500, 74_574.5, 120), opts);
    expect(r.quantity).toBe(16_107_000n);
    expect(r.long.outcome).toBe("target");
    expect(r.short.outcome).toBe("fail");
    expect(r.short.rule).toBe("DailyLoss");
  });
  it("leaves both unresolved on a flat tape", () => {
    const r = simulateTape(rb, ramp(74_500, 74_500, 120), opts);
    expect(r.long.outcome).toBe("unresolved");
    expect(r.short.outcome).toBe("unresolved");
  });
  it("lets costs block a pass the market alone would give", () => {
    const r = simulateTape(rb, ramp(74_500, 74_540, 120), { ...opts, entryCostBps: 3, exitCostBps: 3 });
    expect(r.long.outcome).not.toBe("target");
  });
});

describe("cost helpers", () => {
  it("measures fill cost against the mark for both sides", () => {
    expect(costBpsVsMark(true, 74_500n * E18, 74_507_450n * 10n ** 15n)).toBe(1);
    expect(costBpsVsMark(false, 74_500n * E18, 74_492_550n * 10n ** 15n)).toBe(1);
  });
  it("converts a one-way notional cost into equity terms and recommends a target", () => {
    expect(roundTripEquityBps(2, 12)).toBe(48);
    expect(recommendDemoTargetBps(48)).toBe(100);
    expect(recommendDemoTargetBps(10)).toBe(50);
  });
  it("parses a JSON tape with string fields and millisecond timestamps", () => {
    expect(parseTape({ points: [{ block: "7", ts: "1794326400000", mark: "5" }] })).toEqual([{ block: 7n, ts: 1_794_326_400n, mark: 5n }]);
  });
});
