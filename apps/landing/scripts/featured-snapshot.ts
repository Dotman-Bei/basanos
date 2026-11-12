import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { repoPath } from "@basanos/core/node";
import type { FeaturedLike } from "./render";

const f = JSON.parse(readFileSync(repoPath("docs/evidence/featured-run.json"), "utf8")) as FeaturedLike & { schema: string };
if (f.schema !== "basanos.featured/1") throw new Error("docs/evidence/featured-run.json is not a basanos.featured/1 snapshot");
const out = repoPath("apps/landing/src/featured-verdict.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(f, null, 2)}\n`);
console.log(`wrote apps/landing/src/featured-verdict.json (run ${f.runId})`);
