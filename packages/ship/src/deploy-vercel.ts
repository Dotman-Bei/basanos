// Deploys the assembled site/basanos to Vercel production and points https://basanos.suitz.xyz at it (P9), then writes
// deployments/site.json. VERCEL_TOKEN comes from the git-ignored .env; VERCEL_SCOPE (a team slug) is optional and
// passed as --scope to every call when set (the personal account needs none). It deploys to the project "basanos",
// which the first deploy creates, and touches no other project or domain. Runs from inside site/basanos, so no
// argument holds a path with a space. The token reaches the CLI in the child environment only, never on the command
// line (see vercel.ts).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadDotEnv, repoPath } from "@basanos/core/node";
import { SITE_DOMAIN, SITE_URL } from "./base-url";
import {
  aliasStop,
  argvLeaksToken,
  parseDeployOutput,
  parseWhoami,
  vercelAliasInvocation,
  vercelDeployInvocation,
  vercelWhoamiInvocation,
  type DeployResult,
  type VercelInvocation,
} from "./vercel";

loadDotEnv();
const token = process.env.VERCEL_TOKEN ?? "";
if (!token) {
  console.error("VERCEL_TOKEN is not set (.env)");
  process.exit(1);
}
const scope = process.env.VERCEL_SCOPE || undefined;
const dir = repoPath("site/basanos");
if (!existsSync(`${dir}/index.html`)) {
  console.error("site/basanos is not assembled (run assemble-site.ts first)");
  process.exit(1);
}
const run = (inv: VercelInvocation) => {
  if (argvLeaksToken(inv.args, token)) {
    console.error("refusing to put the Vercel token on the command line");
    process.exit(1);
  }
  return spawnSync(inv.command, inv.args, { cwd: dir, encoding: "utf8", shell: true, env: inv.env });
};
const tail = (s: string | null | undefined) => `${s ?? ""}`.trim().split("\n").slice(-8).join("\n");

const who = run(vercelWhoamiInvocation(token, process.env, scope));
let name: string;
try {
  name = parseWhoami(who.stdout);
} catch (e) {
  console.error(`vercel whoami failed (exit ${who.status}): ${(e as Error).message}\n${tail(who.stderr)}`);
  process.exit(1);
}
console.log(`vercel scope: ${name}${scope ? " (VERCEL_SCOPE)" : " (the token's own account)"}`);

const dep = run(vercelDeployInvocation(token, process.env, scope));
let deployed: DeployResult;
try {
  deployed = parseDeployOutput(dep.stdout);
  if (dep.status !== 0) throw new Error(`exit ${dep.status}`);
} catch (e) {
  console.error(`vercel deploy failed: ${(e as Error).message}\n${tail(dep.stderr)}`);
  process.exit(1);
}
console.log(`deployed ${deployed.deploymentUrl} (production)`);

const al = run(vercelAliasInvocation(token, process.env, deployed.deploymentUrl, SITE_DOMAIN, scope));
if (al.status !== 0) {
  console.error(aliasStop(SITE_DOMAIN, name));
  console.error(tail(al.stderr));
  process.exit(1);
}
console.log(`aliased ${SITE_URL} -> ${deployed.deploymentUrl}`);

const site = { url: SITE_URL, deploymentUrl: deployed.deploymentUrl, deployedAt: new Date().toISOString(), baseUrlTx: null };
mkdirSync(dirname(repoPath("deployments/site.json")), { recursive: true });
writeFileSync(repoPath("deployments/site.json"), `${JSON.stringify(site, null, 2)}\n`);
console.log(`wrote deployments/site.json (url ${SITE_URL})`);
process.exit(0);
