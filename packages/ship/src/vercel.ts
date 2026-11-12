// How the ship scripts call the Vercel CLI. The token travels in the child's environment as VERCEL_TOKEN, which
// vercel@65.3.1 reads when no --token flag is given. It never goes on the command line, where the process list and
// the shell (spawnSync with shell: true) could expose it. Every other argument is checked before it reaches that
// shell: the scope is a slug, the deployment URL a *.vercel.app origin, the domain a host name.
export const VERCEL_CLI = "vercel@65.3.1";
/** The Vercel project the site deploys to; the first deploy creates it. */
export const VERCEL_PROJECT = "basanos";

export interface VercelInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

const SCOPE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const DEPLOYMENT_URL = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function invocation(token: string, baseEnv: NodeJS.ProcessEnv, scope: string | undefined, args: string[]): VercelInvocation {
  if (!token) throw new Error("VERCEL_TOKEN is empty");
  if (scope && !SCOPE.test(scope)) throw new Error(`VERCEL_SCOPE is not a Vercel team slug: ${scope}`);
  return { command: "npx", args: ["--yes", VERCEL_CLI, ...args, ...(scope ? ["--scope", scope] : [])], env: { ...baseEnv, VERCEL_TOKEN: token } };
}

/**
 * A production deploy of the current directory to the project "basanos": --create-if-missing makes the first run create
 * it (the CLI requires it with --yes), and later runs reuse it. --json makes the CLI print one JSON object on stdout.
 */
export function vercelDeployInvocation(token: string, baseEnv: NodeJS.ProcessEnv, scope?: string): VercelInvocation {
  return invocation(token, baseEnv, scope, ["deploy", ".", "--prod", "--yes", "--project", VERCEL_PROJECT, "--create-if-missing", "--json"]);
}

/** Points the domain at one deployment. */
export function vercelAliasInvocation(token: string, baseEnv: NodeJS.ProcessEnv, deploymentUrl: string, domain: string, scope?: string): VercelInvocation {
  if (!DEPLOYMENT_URL.test(deploymentUrl)) throw new Error(`not a Vercel deployment URL: ${deploymentUrl}`);
  if (!DOMAIN.test(domain)) throw new Error(`not a domain: ${domain}`);
  return invocation(token, baseEnv, scope, ["alias", "set", deploymentUrl, domain]);
}

/** Who the token acts as, as JSON. */
export function vercelWhoamiInvocation(token: string, baseEnv: NodeJS.ProcessEnv, scope?: string): VercelInvocation {
  return invocation(token, baseEnv, scope, ["whoami", "--json"]);
}

/** True when a --token flag, or the token itself, appears anywhere in the arguments. */
export function argvLeaksToken(args: readonly string[], token: string): boolean {
  return args.some((a) => a === "--token" || a.startsWith("--token=") || (token.length > 0 && a.includes(token)));
}

function jsonObject(stdout: string, what: string): Record<string, unknown> {
  const start = stdout.indexOf("{");
  try {
    if (start < 0) throw new Error("no JSON");
    const v: unknown = JSON.parse(stdout.slice(start));
    if (v === null || typeof v !== "object") throw new Error("not an object");
    return v as Record<string, unknown>;
  } catch {
    throw new Error(`${what} printed no JSON object: ${stdout.slice(0, 200)}`);
  }
}

export interface DeployResult {
  /** The per-deployment URL (it changes on every deploy and may sit behind Vercel's login). */
  deploymentUrl: string;
  /** The project's automatic production alias, when Vercel assigned one. */
  productionUrl: string | null;
}

/**
 * The deployment from `vercel deploy --json` (vercel@65.3.1): the object its getDeploymentOutputJson prints or,
 * when the CLI runs non-interactive (an agent without a TTY), that object under `deployment` with status "ok". Never
 * "the last *.vercel.app" in the output: it also names the production alias and follow-up commands.
 */
export function parseDeployOutput(stdout: string): DeployResult {
  const raw = jsonObject(stdout, "vercel deploy");
  if (raw.status === "error") throw new Error(`vercel deploy failed: ${String(raw.reason)}: ${String(raw.message)}`);
  const d = (raw.status === "ok" ? raw.deployment : raw) as Record<string, unknown> | undefined;
  if (!d || typeof d.url !== "string" || !DEPLOYMENT_URL.test(d.url)) throw new Error("vercel deploy printed no deployment URL");
  if (d.readyState !== "READY") throw new Error(`deployment ${d.url} is ${String(d.readyState)}, not READY`);
  if (d.target !== "production") throw new Error(`deployment ${d.url} targets ${String(d.target)}, not production`);
  return { deploymentUrl: d.url, productionUrl: typeof d.productionUrl === "string" ? d.productionUrl : null };
}

/** The scope the token acts in, from `vercel whoami --json`: the selected team's slug, else the username. */
export function parseWhoami(stdout: string): string {
  const raw = jsonObject(stdout, "vercel whoami") as { loggedIn?: unknown; team?: { slug?: unknown } | null; username?: unknown };
  if (raw.loggedIn === false) throw new Error("the Vercel CLI is not logged in: VERCEL_TOKEN is missing, invalid or expired");
  const name = raw.team?.slug ?? raw.username;
  if (typeof name !== "string" || name === "") throw new Error("vercel whoami printed no team or user");
  return name;
}

/** The stop message when the alias fails: the token's scope must own the domain. */
export function aliasStop(domain: string, scope: string): string {
  return (
    `STOP: vercel alias set failed: the scope "${scope}" could not point ${domain} at the deployment. ` +
    `The token's scope must own the domain: check that ${domain} belongs to "${scope}", or set VERCEL_SCOPE to the team ` +
    "that owns it, then re-run. The production deployment exists; only the alias is missing."
  );
}
