import type { Hex } from "viem";
import { parseRulebook, rulebookId, type Rulebook } from "@basanos/core";
import standard from "../../../../rulebooks/tokyo-sprint.json";
import demo from "../../../../rulebooks/tokyo-sprint-demo.json";

export const RULEBOOKS: readonly Rulebook[] = [parseRulebook(standard), parseRulebook(demo)];

export function rulebookById(id: Hex): Rulebook | null {
  return RULEBOOKS.find((rb) => rulebookId(rb).toLowerCase() === id.toLowerCase()) ?? null;
}
