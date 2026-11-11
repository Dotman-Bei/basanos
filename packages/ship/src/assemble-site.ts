// site/ = apps/landing/dist at / and apps/web/dist at /app/ (both already built).
import { cpSync, existsSync, rmSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

const landing = repoPath("apps/landing/dist");
const web = repoPath("apps/web/dist");
for (const [name, p] of [["landing", landing], ["web", web]] as const) {
  if (!existsSync(`${p}/index.html`)) {
    console.error(`${name} is not built (${p}/index.html missing)`);
    process.exit(1);
  }
}
const site = repoPath("site/basanos");
rmSync(site, { recursive: true, force: true });
cpSync(landing, site, { recursive: true });
cpSync(web, `${site}/app`, { recursive: true });
console.log("assembled site/basanos (landing at /, app at /app/)");
process.exit(0);
