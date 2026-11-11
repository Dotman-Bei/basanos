// How deploy-vercel.ts calls the Vercel CLI. The token travels in the child's environment as VERCEL_TOKEN, which
// vercel@65.3.1 reads when no --token flag is given. It never goes on the command line, where the process list and
// the shell (spawnSync with shell: true) could expose it.
export const VERCEL_CLI = "vercel@65.3.1";

export interface VercelInvocation {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

export function vercelDeployInvocation(token: string, baseEnv: NodeJS.ProcessEnv): VercelInvocation {
  if (!token) throw new Error("VERCEL_TOKEN is empty");
  return { command: "npx", args: [VERCEL_CLI, "deploy", ".", "--prod", "--yes"], env: { ...baseEnv, VERCEL_TOKEN: token } };
}

/** True when a --token flag, or the token itself, appears anywhere in the arguments. */
export function argvLeaksToken(args: readonly string[], token: string): boolean {
  return args.some((a) => a === "--token" || a.startsWith("--token=") || (token.length > 0 && a.includes(token)));
}
