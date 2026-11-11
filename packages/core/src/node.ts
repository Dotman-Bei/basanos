import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRulebook, type Rulebook } from "./rulebook";

export * from "./env";

/** Absolute path of a repo-relative path (this file lives at packages/core/src/node.ts). */
export function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
}

export const RULEBOOK_FILES = {
  "tokyo-sprint": "rulebooks/tokyo-sprint.json",
  "tokyo-sprint-demo": "rulebooks/tokyo-sprint-demo.json",
} as const;

export function loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook {
  return parseRulebook(JSON.parse(readFileSync(repoPath(RULEBOOK_FILES[name]), "utf8")));
}
