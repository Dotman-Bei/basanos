import { describe, expect, it } from "vitest";
import { DEMO_LEVERAGE_X } from "../src/demo-math";
import { RULEBOOK_FILES, loadRulebook } from "../src/node";
import { rulebookId } from "../src/rulebook";

// The first demo rulebook as registered on Hideki (deployments/hideki.json, 2026-11-11): runs 1 and 2 use it.
const DEMO_V1_ID = "0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757";

describe("demo v2 (architect P7, 2026-11-12: parameters from a replay of real history)", () => {
  it("keeps the first registered demo byte-identical, so its id still resolves the rehearsal's runs", () => {
    expect(RULEBOOK_FILES["tokyo-sprint-demo-v1"]).toBe("rulebooks/tokyo-sprint-demo-v1.json");
    expect(rulebookId(loadRulebook("tokyo-sprint-demo-v1"))).toBe(DEMO_V1_ID);
  });
  it("keeps the +0.50% target, widens the floors and the time limit, and runs at 10x", () => {
    const v1 = loadRulebook("tokyo-sprint-demo-v1");
    const v2 = loadRulebook("tokyo-sprint-demo");
    expect(v2.label).toBe(v1.label);
    expect([v2.profitTargetBps, v2.dailyLossBps, v2.trailingDrawdownBps, v2.maxExposureX, v2.minDurationSec, v2.timeLimitSec]).toEqual([50, 150, 200, 15, 60, 1200]);
    expect([v1.profitTargetBps, v1.dailyLossBps, v1.trailingDrawdownBps, v1.timeLimitSec]).toEqual([50, 50, 75, 900]);
    expect(rulebookId(v2)).not.toBe(DEMO_V1_ID);
    expect(DEMO_LEVERAGE_X).toBe(10);
    expect(DEMO_LEVERAGE_X).toBeLessThan(v2.maxExposureX);
  });
});
