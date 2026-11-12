import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { repoPath } from "@basanos/core/node";
import { PLACEHOLDER_BASE_URL, SITE_URL, certBaseUrl } from "../src/base-url";
import { FEATURED_PATH, type FeaturedRun } from "../src/featured";
import { buildPosts } from "../src/x-posts";

// Every surface a judge or a reader sees: the README, the submission draft, the X-post drafts and the evidence index
// (once ship:7 writes them), and the sources of the landing and the app.
const SURFACES = ["README.md", "docs/gates/submission-draft.md", "docs/gates/x-posts-draft.md", "docs/evidence/INDEX.md", "apps/landing/src", "apps/web/src", "apps/web/index.html"];
const TEXT = /\.(md|html|css|ts|tsx|json|js|mjs|txt)$/;
const walk = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((n) => walk(join(p, n))) : TEXT.test(p) ? [p] : []);
const files = SURFACES.map((s) => repoPath(s)).filter((p) => existsSync(p)).flatMap(walk);
const PLACEHOLDER_HOST = new URL(PLACEHOLDER_BASE_URL).host;

describe("public surfaces name the live site, never the placeholder (P9)", () => {
  it("no public surface contains basanos.vercel.app, someone else's site", () => {
    expect(PLACEHOLDER_HOST).toBe("basanos.vercel.app");
    expect(files.length).toBeGreaterThan(20);
    expect(files.filter((f) => readFileSync(f, "utf8").includes(PLACEHOLDER_HOST))).toEqual([]);
  });
  it("the README and the submission draft give https://basanos.suitz.xyz as the live site", () => {
    const lf = (rel: string) => readFileSync(repoPath(rel), "utf8").replace(/\r\n/g, "\n");
    const readme = lf("README.md");
    const draft = lf("docs/gates/submission-draft.md");
    expect(readme).toContain("- Live site (landing, terminal at `/app/#/challenge`): https://basanos.suitz.xyz\n");
    expect(draft).toContain("- Live site (landing at `/`, terminal at `/app/#/challenge`):\n  https://basanos.suitz.xyz\n");
    for (const text of [readme, draft]) expect(text).not.toContain("TBD-post-build:vercel-url");
  });
  it("the X posts link the verdict on the live site, and the certificates point there", () => {
    const featured = JSON.parse(readFileSync(repoPath(FEATURED_PATH), "utf8")) as FeaturedRun;
    const posts = buildPosts(featured, SITE_URL);
    expect(posts[0]).toContain(`https://basanos.suitz.xyz/app/#/run/${featured.runId}`);
    for (const p of posts) expect(p).not.toContain(PLACEHOLDER_HOST);
    expect(certBaseUrl(SITE_URL)).toBe("https://basanos.suitz.xyz/app/#/cert/");
  });
});
