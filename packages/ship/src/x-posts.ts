// Builds the 2–3 X-post drafts from the featured run (the claims match the landing's). The user publishes them.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";
import { FEATURED_PATH, type FeaturedRun } from "./featured";
import { TRUST_LINE } from "./text";

export function buildPosts(f: FeaturedRun, siteUrl: string | null): string[] {
  const base = siteUrl ?? "TBD-post-build:vercel-url";
  const verdictUrl = `${base}${f.links.verdict}`;
  const result = f.status === "Passed" ? "PASSED, and the certificate minted" : `${f.status.toUpperCase()}${f.rule ? ` on ${f.rule}` : ""}`;
  const oracle = f.oracle ? ` and records Somnia's Price Oracle median (${f.oracle.price}) beside the verdict` : "";
  return [
    `Basanos: prop-firm challenges on @DreamDEXSomnia perps. Run ${f.runId} on ${f.rulebook.label}: ${result}. Start equity ${f.start.equity} USDso, end ${f.end.equity}. Replay it: ${verdictUrl}`,
    `How a Basanos verdict works on @DreamDEXSomnia: a published rulebook, a referee key that can close but never withdraw, and an on-chain registry. ${TRUST_LINE}`,
    `Built on Somnia Tokyo testnet for @DreamDEXSomnia: the referee watches with somnia_watch and closes breaches with real perps orders${oracle}. Paper USDso; both demo accounts operated by the builder.`,
  ];
}

const isMain = process.argv[1]?.endsWith("x-posts.ts") ?? false;
if (isMain) {
  const f = JSON.parse(readFileSync(repoPath(FEATURED_PATH), "utf8")) as FeaturedRun;
  const sitePath = repoPath("deployments/site.json");
  const site = existsSync(sitePath) ? (JSON.parse(readFileSync(sitePath, "utf8")) as { url: string }).url : null;
  const posts = buildPosts(f, site);
  const md = [
    "# X post drafts (generated from docs/evidence/featured-run.json)",
    "",
    "The user publishes these (a human gate). Each tags @DreamDEXSomnia; the links go into the README's X posts section.",
    "",
    ...posts.flatMap((p, i) => [`## Post ${i + 1} (${p.length} characters)`, "", p, ""]),
  ].join("\n");
  writeFileSync(repoPath("docs/gates/x-posts-draft.md"), md);
  console.log(`wrote docs/gates/x-posts-draft.md (${posts.length} posts)`);
  process.exit(0);
}
