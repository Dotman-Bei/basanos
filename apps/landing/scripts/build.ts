// Renders dist/index.html from the template and the featured snapshot, copies the design and kit files,
// then refuses to finish if the page shows anything the snapshot does not hold. It refuses a sample snapshot outright
// (sample-guard.ts): only landing:2's real snapshot may become the page.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoPath } from "@basanos/core/node";
import { withOracleRow } from "./oracle-row";
import { renderPage, type FeaturedLike } from "./render";
import { sampleProblems } from "./sample-guard";
import { findUnbacked } from "./truth";

const app = repoPath("apps/landing");
const dist = join(app, "dist");
const f = JSON.parse(readFileSync(join(app, "src", "featured-verdict.json"), "utf8")) as FeaturedLike;
const html = renderPage(withOracleRow(readFileSync(join(app, "src", "page.html"), "utf8"), f), f);
const samples = sampleProblems(f, html);
for (const p of samples) console.log(`FAIL sample: ${p}`);
if (samples.length > 0) process.exit(1);
const copies: [string, string][] = [
  [repoPath("packages/design/vendor/system.css"), "assets/system.css"],
  [repoPath("packages/design/vendor/motion/motion.css"), "assets/motion/motion.css"],
  [repoPath("packages/design/vendor/motion/motion.js"), "assets/motion/motion.js"],
  [repoPath("packages/design/tokens.css"), "assets/tokens.css"],
  [join(app, "vendor", "system.js"), "assets/system.js"],
  [join(app, "vendor", "layout", "layout.css"), "assets/layout/layout.css"],
  [join(app, "vendor", "layout", "layout.js"), "assets/layout/layout.js"],
  [join(app, "vendor", "layout", "demo.css"), "assets/layout/demo.css"],
  [join(app, "src", "landing.css"), "assets/landing.css"],
];
const shot = join(app, "src", "img", "verdict.png");
if (existsSync(shot)) copies.push([shot, "img/verdict.png"]);
for (const [from, to] of copies) {
  const dst = join(dist, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(from, dst);
}
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, "index.html"), html);
const unbacked = findUnbacked(html, f);
for (const u of unbacked) console.log(`FAIL truth: ${u}`);
if (unbacked.length > 0) process.exit(1);
console.log(`PASS truth (run ${f.runId}); built apps/landing/dist${existsSync(shot) ? "" : " (no screenshot yet: Task 4 adds img/verdict.png)"}`);
