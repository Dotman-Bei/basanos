import { describe, expect, it } from "vitest";
import { argvLeaksToken, vercelDeployInvocation } from "../src/vercel";

describe("Vercel deploy invocation", () => {
  it("passes the token in the child env and never on the command line", () => {
    const token = "vc_test_7d3f9a1e";
    const base: NodeJS.ProcessEnv = { PATH: "/usr/bin" };
    const inv = vercelDeployInvocation(token, base);
    expect(inv.command).toBe("npx");
    expect(inv.args).toEqual(["vercel@65.3.1", "deploy", ".", "--prod", "--yes"]);
    expect(inv.args.join(" ")).not.toContain(token);
    expect(inv.args).not.toContain("--token");
    expect(argvLeaksToken(inv.args, token)).toBe(false);
    expect(inv.env.VERCEL_TOKEN).toBe(token);
    expect(inv.env.PATH).toBe("/usr/bin");
    expect(base).toEqual({ PATH: "/usr/bin" });
  });
  it("flags any argv that would carry the token, and refuses an empty token", () => {
    expect(argvLeaksToken(["deploy", "--token", "x"], "zz")).toBe(true);
    expect(argvLeaksToken(["deploy", "--token=x"], "zz")).toBe(true);
    expect(argvLeaksToken(["deploy", "abczzdef"], "zz")).toBe(true);
    expect(() => vercelDeployInvocation("", {})).toThrow(/VERCEL_TOKEN/);
  });
});
