import { describe, expect, it } from "vitest";
import {
  aliasStop,
  argvLeaksToken,
  parseDeployOutput,
  parseWhoami,
  vercelAliasInvocation,
  vercelDeployInvocation,
  vercelWhoamiInvocation,
} from "../src/vercel";

const token = "vc_test_7d3f9a1e";
const DEPLOY = "https://basanos-4k2j9x7qe-acme-projects.vercel.app";
const PROD = "https://basanos-acme-projects.vercel.app";
// `vercel deploy --json` stdout in the two shapes vercel@65.3.1 prints (its getDeploymentOutputJson, and the
// non-interactive agent payload that wraps it); the ids and the scope are made up.
const deployment = {
  id: "dpl_9xQe4Kc2Lr7TnB1sVw3Yh5Zf",
  url: DEPLOY,
  productionUrl: PROD,
  inspectorUrl: "https://vercel.com/acme-projects/basanos/9xQe4Kc2Lr7TnB1sVw3Yh5Zf",
  readyState: "READY",
  target: "production",
  deploymentApiUrl: "https://api.vercel.com/v13/deployments/dpl_9xQe4Kc2Lr7TnB1sVw3Yh5Zf",
};
const HUMAN = `${JSON.stringify(deployment, null, 2)}\n`;
const AGENT = `${JSON.stringify(
  {
    status: "ok",
    deployment,
    message: `Deployment ${DEPLOY} ready. Production URL: ${PROD}`,
    next: [{ command: "vercel inspect basanos-4k2j9x7qe-acme-projects.vercel.app", when: "Inspect deployment" }],
  },
  null,
  2,
)}\n`;

describe("Vercel invocations", () => {
  it("deploys with the token in the child env only, JSON on stdout, and --scope only when set", () => {
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const inv = vercelDeployInvocation(token, base);
    expect(inv.command).toBe("npx");
    expect(inv.args).toEqual(["--yes", "vercel@65.3.1", "deploy", ".", "--prod", "--yes", "--project", "basanos", "--create-if-missing", "--json"]);
    expect(argvLeaksToken(inv.args, token)).toBe(false);
    expect(inv.env.VERCEL_TOKEN).toBe(token);
    expect(inv.env.PATH).toBe("/usr/bin");
    expect(base).toEqual({ PATH: "/usr/bin" });
    expect(vercelDeployInvocation(token, base, "my-team").args.slice(-2)).toEqual(["--scope", "my-team"]);
    expect(() => vercelDeployInvocation(token, base, "x; rm -rf /")).toThrow(/slug/);
    expect(() => vercelDeployInvocation("", {})).toThrow(/VERCEL_TOKEN/);
  });
  it("aliases one deployment to the domain, refusing anything that is not a deployment URL or a host name", () => {
    expect(vercelAliasInvocation(token, {}, DEPLOY, "basanos.suitz.xyz").args).toEqual(["--yes", "vercel@65.3.1", "alias", "set", DEPLOY, "basanos.suitz.xyz"]);
    expect(vercelAliasInvocation(token, {}, DEPLOY, "basanos.suitz.xyz", "my-team").args.slice(-2)).toEqual(["--scope", "my-team"]);
    expect(() => vercelAliasInvocation(token, {}, "https://evil.example", "basanos.suitz.xyz")).toThrow(/deployment URL/);
    expect(() => vercelAliasInvocation(token, {}, `${DEPLOY} && whoami`, "basanos.suitz.xyz")).toThrow(/deployment URL/);
    expect(() => vercelAliasInvocation(token, {}, DEPLOY, "basanos.suitz.xyz;ls")).toThrow(/domain/);
    expect(vercelWhoamiInvocation(token, {}).args).toEqual(["--yes", "vercel@65.3.1", "whoami", "--json"]);
  });
  it("flags any argv that would carry the token", () => {
    expect(argvLeaksToken(["deploy", "--token", "x"], "zz")).toBe(true);
    expect(argvLeaksToken(["deploy", "--token=x"], "zz")).toBe(true);
    expect(argvLeaksToken(["deploy", "abczzdef"], "zz")).toBe(true);
  });
});

describe("reading the CLI's answers", () => {
  it("takes the deployment URL from the deploy JSON, in both shapes, not the production alias printed after it", () => {
    expect(parseDeployOutput(HUMAN)).toEqual({ deploymentUrl: DEPLOY, productionUrl: PROD });
    expect(parseDeployOutput(AGENT)).toEqual({ deploymentUrl: DEPLOY, productionUrl: PROD });
    expect(AGENT.lastIndexOf(PROD)).toBeGreaterThan(AGENT.lastIndexOf(DEPLOY));
  });
  it("refuses a failed, unfinished or preview deploy, and output with no JSON", () => {
    expect(() => parseDeployOutput(JSON.stringify({ status: "error", reason: "deploy_failed", message: "boom" }))).toThrow(/deploy_failed: boom/);
    expect(() => parseDeployOutput(JSON.stringify({ ...deployment, readyState: "ERROR" }))).toThrow(/not READY/);
    expect(() => parseDeployOutput(JSON.stringify({ ...deployment, target: null }))).toThrow(/not production/);
    expect(() => parseDeployOutput(JSON.stringify({ ...deployment, url: "https://example.com" }))).toThrow(/no deployment URL/);
    expect(() => parseDeployOutput(`Production: ${DEPLOY} [3s]`)).toThrow(/no JSON/);
  });
  it("names the scope from whoami, and the stop message names it", () => {
    expect(parseWhoami(JSON.stringify({ team: null, plan: "hobby", username: "someone" }))).toBe("someone");
    expect(parseWhoami(JSON.stringify({ team: { id: "team_1", slug: "my-team", name: "My team", plan: "pro" }, username: "someone" }))).toBe("my-team");
    expect(() => parseWhoami("{}")).toThrow(/no team or user/);
    // Captured from vercel@65.3.1 with no token (exit 1): an expired VERCEL_TOKEN reads the same.
    expect(() => parseWhoami('{\n  "loggedIn": false,\n  "cliVersion": "65.3.1",\n  "linkedProject": null\n}\n')).toThrow(/missing, invalid or expired/);
    const stop = aliasStop("basanos.suitz.xyz", "someone");
    expect(stop).toMatch(/^STOP: /);
    expect(stop).toContain('the scope "someone"');
    expect(stop).toContain("basanos.suitz.xyz");
  });
});
