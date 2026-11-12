import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { summarizePassTake, type PassTakeRow } from "../src/check-pass";

const A: Address = "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1";
const B: Address = "0x1609F6ABE3aD29B45D1F2fdd15a15d17AbB326aD";
const pass: PassTakeRow = { runId: 3n, account: A, status: 2, rule: 0, holder: A };
const fail: PassTakeRow = { runId: 4n, account: B, status: 3, rule: 3, holder: null };

describe("the PASS take's gate (P7)", () => {
  it("wants one PASSED run with its certificate on its own account and one FAILED run", () => {
    expect(summarizePassTake([pass, fail])).toEqual({ ok: true, passRunId: 3n, problems: [] });
    expect(summarizePassTake([{ ...pass, holder: null }, fail]).problems).toEqual(["run 3 PASSED but has no certificate"]);
    expect(summarizePassTake([{ ...pass, holder: B }, fail]).problems[0]).toMatch(/held by/);
    expect(summarizePassTake([{ ...pass, status: 3 }, fail]).ok).toBe(false);
    expect(summarizePassTake([pass]).problems).toContain("the latest take has 1 runs, not 2");
  });
});
