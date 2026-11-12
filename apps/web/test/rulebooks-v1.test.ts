import { describe, expect, it } from "vitest";
import { rulebookId } from "@basanos/core";
import { RETIRED_RULEBOOKS, RULEBOOKS, rulebookById } from "../src/lib/rulebooks";

describe("retired rulebooks still resolve (architect P7)", () => {
  it("offers the standard and demo v2, and still shows the rehearsal's runs on demo v1 with v1's own numbers", () => {
    expect(RULEBOOKS).toHaveLength(2);
    expect(RULEBOOKS[1]?.dailyLossBps).toBe(150);
    const v1 = rulebookById("0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757");
    expect(v1?.dailyLossBps).toBe(50);
    expect(v1?.timeLimitSec).toBe(900);
    expect(RETIRED_RULEBOOKS.map((r) => rulebookId(r))).toEqual(["0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757"]);
    expect(rulebookById(rulebookId(RULEBOOKS[1]!))?.timeLimitSec).toBe(1200);
    expect(rulebookById("0x0000000000000000000000000000000000000000000000000000000000000000")).toBeNull();
  });
});
