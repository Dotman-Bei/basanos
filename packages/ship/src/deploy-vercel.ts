// Deploys the assembled site/basanos to Vercel production with VERCEL_TOKEN from the git-ignored .env, and
// writes deployments/site.json. Runs from inside site/basanos so no argument holds a path with a space.
// The token goes to the CLI in the child environment only, never on the command line (see vercel.ts).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadDotEnv, repoPath } from "@basanos/core/node";
import { argvLeaksToken, vercelDeployInvocation } from "./vercel";

loadDotEnv();
const token = process.env.VERCEL_TOKEN;
if (!token) {
  console.error("VERCEL_TOKEN is not set (it comes from the concierge signup gate)");
  process.exit(1);
}
const dir = repoPath("site/basanos");
if (!existsSync(`${dir}/index.html`)) {
  console.error("site/basanos is not assembled (run assemble-site.ts first)");
  process.exit(1);
}
const inv = vercelDeployInvocation(token, process.env);
if (argvLeaksToken(inv.args, token)) {
  console.error("refusing to put the Vercel token on the command line");
  process.exit(1);
}
const r = spawnSync(inv.command, inv.args, { cwd: dir, encoding: "utf8", shell: true, env: inv.env });
const urls = `${r.stdout ?? ""}`.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/g) ?? [];
const url = urls.at(-1);
if (r.status !== 0 || !url) {
  console.error(`vercel deploy failed (exit ${r.status}): ${`${r.stderr ?? ""}`.slice(-600)}`);
  process.exit(1);
}
mkdirSync(dirname(repoPath("deployments/site.json")), { recursive: true });
writeFileSync(repoPath("deployments/site.json"), `${JSON.stringify({ url, deployedAt: new Date().toISOString(), baseUrlTx: null }, null, 2)}\n`);
console.log(`deployed ${url}`);
process.exit(0);
