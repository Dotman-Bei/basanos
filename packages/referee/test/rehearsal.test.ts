import { describe, expect, it } from "vitest";
import { summarizeRehearsal } from "../src/check-rehearsal";

describe("summarizeRehearsal", () => {
  it("passes when a real verdict exists and every FAIL carries close txs", () => {
    const r = summarizeRehearsal([
      { runId: 3n, status: 3, rule: 1, closeTxs: 2 },
      { runId: 4n, status: 2, rule: 0, closeTxs: 0 },
    ]);
    expect(r).toEqual({ ok: true, firstVerdictRunId: 3n, problems: [] });
  });
  it("fails with no verdict, or a FAIL without close txs", () => {
    expect(summarizeRehearsal([{ runId: 3n, status: 1, rule: 0, closeTxs: 0 }]).ok).toBe(false);
    const r = summarizeRehearsal([{ runId: 5n, status: 3, rule: 2, closeTxs: 0 }]);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/run 5/);
  });
});
