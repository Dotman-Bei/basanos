import { fileURLToPath } from "node:url";

/** Absolute path of a repo-relative path (this file lives at packages/core/src/node.ts). */
export function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
}
