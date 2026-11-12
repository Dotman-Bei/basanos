import type { Hex } from "viem";
import { parseRulebook, rulebookId, type Rulebook } from "@basanos/core";
import standard from "../../../../rulebooks/tokyo-sprint.json";
import demo from "../../../../rulebooks/tokyo-sprint-demo.json";
import demoV1 from "../../../../rulebooks/tokyo-sprint-demo-v1.json";

/** The rulebooks a challenger can take today: the standard and the current demo (v2 since architect P7). */
export const RULEBOOKS: readonly Rulebook[] = [parseRulebook(standard), parseRulebook(demo)];

/** Registered rulebooks no longer offered, kept so their runs still resolve: the first demo (v1, the rehearsal's runs). */
export const RETIRED_RULEBOOKS: readonly Rulebook[] = [parseRulebook(demoV1)];

export function rulebookById(id: Hex): Rulebook | null {
  return [...RULEBOOKS, ...RETIRED_RULEBOOKS].find((rb) => rulebookId(rb).toLowerCase() === id.toLowerCase()) ?? null;
}
