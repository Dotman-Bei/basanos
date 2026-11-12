// The demo take's second leg (architect P7, 2026-11-12). The replay of 12 hours of real history (demo v2 at 10x, an
// opposite pair opened in the same block) gives at least one PASS in about 95% of windows, but the other run's own
// verdict is a coin flip. So once one run has PASSED, the demo pushes the other, still Active, past the exposure cap: a
// deterministic FAIL (MaxExposure) that the referee closes like any breach. The take is then one PASS and one FAIL.
import { RUN_STATUS } from "@basanos/core";

export type TakeStatus = (typeof RUN_STATUS)[number];

/** The index of the run to push past the exposure cap: the one still Active once another has PASSED; null otherwise
 *  (no PASS yet, nothing left Active, or the breach already sent). */
export function breachTarget(statuses: readonly TakeStatus[], alreadyBreached: boolean): number | null {
  if (alreadyBreached) return null;
  const passed = statuses.indexOf("Passed");
  if (passed < 0) return null;
  const other = statuses.findIndex((s, i) => i !== passed && s === "Active");
  return other < 0 ? null : other;
}
