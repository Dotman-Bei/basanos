import { describe, expect, it } from "vitest";
import { initRunState } from "@basanos/core/evaluate";
import { computeRails, railPercent } from "../src/lib/rails";
import { RULEBOOKS, rulebookById } from "../src/lib/rulebooks";
import { rulebookId } from "@basanos/core";

const E18 = 10n ** 18n;

describe("rulebooks", () => {
  it("ships the two Tokyo Sprint variants and finds them by on-chain id", () => {
    expect(RULEBOOKS.map((r) => r.label)).toEqual(["Tokyo Sprint", "Tokyo Sprint · Demo"]);
    const demo = RULEBOOKS[1];
    if (!demo) throw new Error("demo rulebook missing");
    expect(rulebookById(rulebookId(demo))?.variant).toBe("demo");
    expect(rulebookById(`0x${"00".repeat(32)}`)).toBeNull();
  });
});

describe("computeRails", () => {
  it("places the target, daily floor and trailing floor for the demo rulebook", () => {
    const loaded = RULEBOOKS[1];
    if (!loaded) throw new Error("demo rulebook missing");
    // thresholds pinned, so a raised demo target (referee Task 10 Step 1) never turns this test red
    const demo = { ...loaded, profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75 };
    const state = { ...initRunState(0n, 1_000n * E18), hwm: 1_004n * E18 };
    expect(computeRails(demo, state)).toEqual({
      start: 1_000n * E18,
      target: 1_005n * E18,
      dailyFloor: 995n * E18,
      trailingFloor: (1_004n * E18 * 9_925n) / 10_000n,
    });
    expect(railPercent(1_005n * E18, 1_000n * E18)).toBe(0.5);
  });
});
