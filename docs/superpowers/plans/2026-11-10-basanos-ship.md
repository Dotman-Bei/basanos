# Basanos Ship Implementation Plan

**Goal:** Ship Basanos:
- snapshot the featured real run (first the Nov 12 rehearsal, then the money shot);
- land the money shot;
- write the README (schema R1 plus the event overlay) and the X-post drafts;
- file the reproducible feedback items;
- deploy the static site to Vercel;
- point the certificates at it;
- index the evidence for judges.
**Architecture:** `@basanos/ship` holds small read-only tools:
- the featured-run snapshot (`docs/evidence/featured-run.json`), the single source every public claim is generated from, which the landing renders and the X posts quote;
- the money-shot check, the feedback-template check, the site assembler (`site/` = landing at `/`, app at `/app/`), the deploy check and the evidence index.

Human-gated tasks: the money shot (wallet), the Vercel deploy and the certificate base-URL update (deploy).
**Tech Stack:** Node 22, TypeScript 6.0.3 (tsx 4.23.15), vitest 4.1.12, viem 2.57.12, `vercel` CLI 65.3.1 via npx (closing only).
**Source spec:** docs/superpowers/specs/2026-11-10-basanos-design.md

**Boot notes for the orchestrator:**
- Append-only: push-1 and earlier push-2 task ids, files and gates are unchanged. This plan depends on `referee:*`, `web:*`, `contracts:*` and `landing:*` tasks by id.
- Claims are truthful by construction (spec §11). Every number, hash and run id in the README, the landing and the X posts comes from `docs/evidence/featured-run.json`, `deployments/hideki.json` or `deployments/site.json`, never typed by hand. Each surface carries:
  - the trust line, verbatim: "Every certificate is chain-checked at mint; every verdict is replayable." (never "the contract verifies every verdict");
  - the demo disclosure: "Both demo accounts are burners operated by the builder: one human-driven, one scripted.";
  - the testnet notice: Somnia Tokyo testnet, paper USDso, no real funds, no payouts, not a financial service.
- **No task claims a voucher.** Security issues never go into `feedback/`; they go privately to security@dreamdex.io.
- `site/basanos/` is build output (git-ignored); Vercel deploys it as prebuilt static files, and the folder name becomes the Vercel project name.
- The README's `TBD-post-build:*` lines are resolved by the Step 3 gate-concierge closing pass (kit doctrine), not by a task here.

---

### Task 1: `@basanos/ship` — featured snapshot, X posts, checks, site assembly, evidence index

**Files:**
- Modify: `.gitignore`
- Create: `packages/ship/package.json`
- Create: `packages/ship/tsconfig.json`
- Create: `packages/ship/vitest.config.ts`
- Create: `packages/ship/src/text.ts`
- Create: `packages/ship/src/featured.ts`
- Create: `packages/ship/src/snapshot-run.ts`
- Create: `packages/ship/src/x-posts.ts`
- Create: `packages/ship/src/check-money-shot.ts`
- Create: `packages/ship/src/check-feedback.ts`
- Create: `packages/ship/src/assemble-site.ts`
- Create: `packages/ship/src/check-deploy.ts`
- Create: `packages/ship/src/evidence-index.ts`
- Create: `packages/ship/src/deploy-vercel.ts`
- Create: `packages/ship/src/set-base-url.ts`
- Test: `packages/ship/test/ship.test.ts`

**Depends on:** referee:Task 3, referee:Task 6, spike:Task 1, spike:Task 2, spike:Task 3, contracts:Task 8
**Effort:** medium
**Provides:** `TRUST_LINE`, `DEMO_DISCLOSURE`, `TESTNET_NOTICE`, `FORBIDDEN_CLAIMS: readonly string[]`, `interface ReadOut { block: string; equity: string; equityRaw: string; size: string; mark: string }`, `interface FeaturedRun { schema: "basanos.featured/1"; chainId: 50383; registry: Address; runId: string; status: string; rule: string | null; rulebook: { label: string; id: Hex; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number }; account: Address; start: ReadOut; breach: ReadOut | null; end: ReadOut; closeTxs: { hash: Hex; url: string }[]; verdictTx: { hash: Hex; url: string } | null; oracle: { price: string; sources: number } | null; links: { verdict: string; certificate: string | null }; trustLine: string; demoDisclosure: string; testnetNotice: string }`, `buildFeatured(input: FeaturedInput): FeaturedRun`, `FEATURED_PATH = "docs/evidence/featured-run.json"`, `buildPosts(f: FeaturedRun, siteUrl: string | null): string[]`, `moneyShotOk(take: { runs: { status: string }[] }): boolean`, `checkFeedbackText(name: string, text: string): string[]`, `renderEvidenceIndex(items: readonly { title: string; path: string; links: readonly string[] }[]): string`, `CLI: npx tsx packages/ship/src/snapshot-run.ts [runId] -> writes docs/evidence/featured-run.json`, `CLI: npx tsx packages/ship/src/x-posts.ts -> writes docs/gates/x-posts-draft.md`, `CLI: npx tsx packages/ship/src/check-money-shot.ts -> PASS money-shot`, `CLI: npx tsx packages/ship/src/check-feedback.ts -> PASS feedback`, `CLI: npx tsx packages/ship/src/assemble-site.ts -> writes site/basanos/ (landing at /, app at /app/)`, `CLI: npx tsx packages/ship/src/check-deploy.ts -> PASS deploy`, `CLI: npx tsx packages/ship/src/evidence-index.ts -> writes docs/evidence/INDEX.md`, `CLI: npx tsx packages/ship/src/deploy-vercel.ts -> deploys site/basanos to Vercel production, writes deployments/site.json`, `CLI: npx tsx packages/ship/src/set-base-url.ts -> registry.setBaseUrl(<site>/app/#/cert/) as the owner, records baseUrlTx`
**Requires:** `@basanos/referee package (exports "." -> src/index.ts)`, `jsonSafe(value: unknown): unknown`, `readRunsEvidence(path?: string): Record<string, { bundle: unknown; evidenceHash: Hex; verdictTx?: unknown }>`, `makePublicClient(url: string): PublicClient`, `makeRefereeWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `repoPath(rel: string): string`, `loadDotEnv(path?: string): boolean`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `rulebookId(rb: Rulebook): Hex`, `explorerTx(hash: Hex): string`, `explorerAddress(address: Address): string`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`

- [ ] **Step 1: Ignore the site build output**
Append this line to the end of `.gitignore` (keep every existing line):
```gitignore
site/
```

- [ ] **Step 2: Write the package files**

`packages/ship/package.json`:
```json
{
  "name": "@basanos/ship",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@basanos/core": "*",
    "@basanos/referee": "*",
    "viem": "2.57.12"
  }
}
```

`packages/ship/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/ship/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 3: Write the failing test**

`packages/ship/test/ship.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkFeedbackText } from "../src/check-feedback";
import { moneyShotOk } from "../src/check-money-shot";
import { renderEvidenceIndex } from "../src/evidence-index";
import { buildFeatured } from "../src/featured";
import { DEMO_DISCLOSURE, FORBIDDEN_CLAIMS, TRUST_LINE } from "../src/text";
import { buildPosts } from "../src/x-posts";

const E18 = 10n ** 18n;
const read = (equity: bigint, block: bigint) => ({ blockNumber: block, equityOk: true, equity, lockedCollateral: 0n, positionSize: 0n, markOk: true, markPrice: 74_500n * E18 });
const featured = buildFeatured({
  registry: "0x00000000000000000000000000000000000000f0",
  runId: 3n,
  run: {
    account: "0x00000000000000000000000000000000000000a1",
    rulebookId: `0x${"11".repeat(32)}`,
    status: 2,
    rule: 0,
    start: read(1_000n * E18, 100n),
    breach: read(0n, 0n),
    end: read(1_006n * E18, 900n),
    oraclePrice: 74_510n * E18,
    oracleSources: 3,
    oracleDone: true,
  },
  rulebook: { label: "Tokyo Sprint · Demo", profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 },
  closeTxs: [`0x${"aa".repeat(32)}`],
  verdictTx: `0x${"bb".repeat(32)}`,
});

describe("buildFeatured", () => {
  it("formats the run from chain values and carries the trust line and disclosure", () => {
    expect(featured.status).toBe("Passed");
    expect(featured.rule).toBeNull();
    expect(featured.start.equity).toBe("1,000.00");
    expect(featured.end.equity).toBe("1,006.00");
    expect(featured.breach).toBeNull();
    expect(featured.links).toEqual({ verdict: "/app/#/run/3", certificate: "/app/#/cert/3" });
    expect(featured.closeTxs[0]?.url).toBe(`https://explorer.testnet.somnia.network/tokyo/tx/0x${"aa".repeat(32)}`);
    expect(featured.trustLine).toBe(TRUST_LINE);
    expect(featured.demoDisclosure).toBe(DEMO_DISCLOSURE);
    expect(featured.oracle).toEqual({ price: "74,510.00", sources: 3 });
  });
});

describe("buildPosts", () => {
  it("writes three posts that tag @DreamDEXSomnia, fit 280 characters and say nothing forbidden", () => {
    const posts = buildPosts(featured, "https://basanos.vercel.app");
    expect(posts).toHaveLength(3);
    for (const p of posts) {
      expect(p).toContain("@DreamDEXSomnia");
      expect(p.length).toBeLessThanOrEqual(280);
      for (const bad of FORBIDDEN_CLAIMS) expect(p.toLowerCase()).not.toContain(bad);
    }
    expect(posts.some((p) => p.includes(TRUST_LINE))).toBe(true);
    expect(posts.some((p) => p.includes("operated by the builder"))).toBe(true);
    expect(posts[0]).toContain("https://basanos.vercel.app/app/#/run/3");
  });
  it("leaves a marked placeholder when the site URL is not known yet", () => {
    expect(buildPosts(featured, null)[0]).toContain("TBD-post-build:vercel-url");
  });
});

describe("checks", () => {
  it("accepts a take with one PASS and one FAIL only", () => {
    expect(moneyShotOk({ runs: [{ status: "Passed" }, { status: "Failed" }] })).toBe(true);
    expect(moneyShotOk({ runs: [{ status: "Failed" }, { status: "Failed" }] })).toBe(false);
  });
  it("validates the event's feedback template", () => {
    const good = [
      "# The SDK's Hideki constants omit the operator registry",
      "Severity: normal",
      "Area: SDK",
      "",
      "## Steps to reproduce",
      "1. Read SOMNIA_HIDEKI_TESTNET_ADDRESSES.",
      "",
      "## Expected",
      "It names the OperatorPermissionsRegistry.",
      "",
      "## Actual",
      "It has no operatorPermissionsRegistry key.",
      "",
      "## Evidence",
      "Output: undefined",
      "",
      "## Environment",
      "SDK version 0.33.0, network Somnia Tokyo testnet (Hideki 50383), wallet address: read-only (no wallet)",
    ].join("\n");
    expect(checkFeedbackText("a.md", good)).toEqual([]);
    expect(checkFeedbackText("b.md", good.replace("Severity: normal", "Severity: low"))).not.toEqual([]);
    expect(checkFeedbackText("c.md", good.replace("## Evidence\nOutput: undefined\n", "## Evidence\n"))).not.toEqual([]);
  });
  it("renders an evidence index with links", () => {
    const md = renderEvidenceIndex([{ title: "Referee close", path: "docs/evidence/g1a-close.json", links: ["https://x/tx/1"] }]);
    expect(md).toContain("# Basanos evidence index");
    expect(md).toContain("[docs/evidence/g1a-close.json](g1a-close.json)");
    expect(md).toContain("https://x/tx/1");
  });
});
```

- [ ] **Step 4: Run to confirm it fails**
Run: `npm install`
Expected: exits 0 (links the new workspace).
Run: `npm test -w @basanos/ship`
Expected: FAIL — `Failed to resolve import "../src/check-feedback"`.

- [ ] **Step 5: Write the modules**

`packages/ship/src/text.ts`:
```ts
export const TRUST_LINE = "Every certificate is chain-checked at mint; every verdict is replayable.";
export const DEMO_DISCLOSURE = "Both demo accounts are burners operated by the builder: one human-driven, one scripted.";
export const TESTNET_NOTICE = "Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.";
/** Claims no Basanos surface may make (spec §2). */
export const FORBIDDEN_CLAIMS: readonly string[] = ["verifies every verdict", "guaranteed", "trusted by", "real money", "payout"];

export function usd(raw: bigint): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const cents = (abs * 100n) / 10n ** 18n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}
```

`packages/ship/src/featured.ts`:
```ts
import type { Address, Hex } from "viem";
import { RULE_NAMES, RUN_STATUS, explorerTx } from "@basanos/core";
import { DEMO_DISCLOSURE, TESTNET_NOTICE, TRUST_LINE, usd } from "./text";

export interface ReadOut {
  block: string;
  equity: string;
  equityRaw: string;
  size: string;
  mark: string;
}

export interface FeaturedRun {
  schema: "basanos.featured/1";
  chainId: 50383;
  registry: Address;
  runId: string;
  status: string;
  rule: string | null;
  rulebook: { label: string; id: Hex; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number };
  account: Address;
  start: ReadOut;
  breach: ReadOut | null;
  end: ReadOut;
  closeTxs: { hash: Hex; url: string }[];
  verdictTx: { hash: Hex; url: string } | null;
  oracle: { price: string; sources: number } | null;
  links: { verdict: string; certificate: string | null };
  trustLine: string;
  demoDisclosure: string;
  testnetNotice: string;
}

interface RawRead {
  blockNumber: bigint;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  positionSize: bigint;
  markOk: boolean;
  markPrice: bigint;
}

export interface FeaturedInput {
  registry: Address;
  runId: bigint;
  run: {
    account: Address;
    rulebookId: Hex;
    status: number;
    rule: number;
    start: RawRead;
    breach: RawRead;
    end: RawRead;
    oraclePrice: bigint;
    oracleSources: number;
    oracleDone: boolean;
  };
  rulebook: { label: string; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number };
  closeTxs: readonly Hex[];
  verdictTx: Hex | null;
}

const out = (r: RawRead): ReadOut => ({
  block: r.blockNumber.toString(),
  equity: usd(r.equity + r.lockedCollateral),
  equityRaw: (r.equity + r.lockedCollateral).toString(),
  size: r.positionSize.toString(),
  mark: usd(r.markPrice),
});

export const FEATURED_PATH = "docs/evidence/featured-run.json";

export function buildFeatured(i: FeaturedInput): FeaturedRun {
  const status = RUN_STATUS[i.run.status] ?? "Unknown";
  return {
    schema: "basanos.featured/1",
    chainId: 50383,
    registry: i.registry,
    runId: i.runId.toString(),
    status,
    rule: status === "Failed" ? (RULE_NAMES[i.run.rule] ?? null) : null,
    rulebook: { ...i.rulebook, id: i.run.rulebookId },
    account: i.run.account,
    start: out(i.run.start),
    breach: status === "Failed" ? out(i.run.breach) : null,
    end: out(i.run.end),
    closeTxs: i.closeTxs.map((hash) => ({ hash, url: explorerTx(hash) })),
    verdictTx: i.verdictTx ? { hash: i.verdictTx, url: explorerTx(i.verdictTx) } : null,
    oracle: i.run.oracleDone && i.run.oracleSources > 0 ? { price: usd(i.run.oraclePrice), sources: i.run.oracleSources } : null,
    links: { verdict: `/app/#/run/${i.runId}`, certificate: status === "Passed" ? `/app/#/cert/${i.runId}` : null },
    trustLine: TRUST_LINE,
    demoDisclosure: DEMO_DISCLOSURE,
    testnetNotice: TESTNET_NOTICE,
  };
}
```

`packages/ship/src/snapshot-run.ts`:
```ts
// Writes docs/evidence/featured-run.json for one real run: argv[2], else FEATURED_RUN_ID, else the rehearsal's first verdict.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Hex } from "viem";
import { basanosRegistryAbi, rulebookId } from "@basanos/core";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { jsonSafe, makePublicClient, readRunsEvidence } from "@basanos/referee";
import { FEATURED_PATH, buildFeatured } from "./featured";

loadDotEnv();
const pick = (): bigint => {
  if (process.argv[2]) return BigInt(process.argv[2]);
  if (process.env.FEATURED_RUN_ID) return BigInt(process.env.FEATURED_RUN_ID);
  const reh = repoPath("docs/evidence/rehearsal.json");
  if (existsSync(reh)) {
    const id = (JSON.parse(readFileSync(reh, "utf8")) as { firstVerdictRunId?: string }).firstVerdictRunId;
    if (id) return BigInt(id);
  }
  throw new Error("no run id: pass one, set FEATURED_RUN_ID, or run the rehearsal first");
};
const runId = pick();
const registry = requireAddress("REGISTRY_ADDRESS");
const client = makePublicClient(rpcHttp());
const run = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
const closeTxs = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getCloseTxs", args: [runId] });
const rb = [loadRulebook("tokyo-sprint"), loadRulebook("tokyo-sprint-demo")].find((r) => rulebookId(r).toLowerCase() === run.rulebookId.toLowerCase());
if (!rb) throw new Error(`run ${runId} uses a rulebook that is not in rulebooks/`);
const stored = readRunsEvidence()[runId.toString()];
const verdictTx = ((stored?.verdictTx as { hash?: Hex } | undefined)?.hash ?? null) as Hex | null;
const featured = buildFeatured({ registry, runId, run, rulebook: rb, closeTxs, verdictTx });
mkdirSync(dirname(repoPath(FEATURED_PATH)), { recursive: true });
writeFileSync(repoPath(FEATURED_PATH), `${JSON.stringify(jsonSafe(featured), null, 2)}\n`);
console.log(`featured run ${runId}: ${featured.status}${featured.rule ? ` (${featured.rule})` : ""} -> ${FEATURED_PATH}`);
process.exit(0);
```

`packages/ship/src/x-posts.ts`:
```ts
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
```

`packages/ship/src/check-money-shot.ts`:
```ts
import { readFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

export function moneyShotOk(take: { runs: { status: string }[] }): boolean {
  const s = take.runs.map((r) => r.status).sort();
  return s.length === 2 && s[0] === "Failed" && s[1] === "Passed";
}

const isMain = process.argv[1]?.endsWith("check-money-shot.ts") ?? false;
if (isMain) {
  const takes = JSON.parse(readFileSync(repoPath("docs/evidence/demo-takes.json"), "utf8")) as { take: number; runs: { status: string }[] }[];
  const last = takes.at(-1);
  const ok = last ? moneyShotOk(last) : false;
  console.log(ok ? `PASS money-shot (take ${last?.take}: one PASS, one FAIL)` : "FAIL money-shot (the latest take is not one PASS and one FAIL)");
  process.exit(ok ? 0 : 1);
}
```

`packages/ship/src/check-feedback.ts`:
```ts
// Validates every feedback/*.md against the event's template (pack event.md §3).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

const HEADINGS = ["## Steps to reproduce", "## Expected", "## Actual", "## Evidence", "## Environment"];

export function checkFeedbackText(name: string, text: string): string[] {
  const p: string[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith("# ")) p.push(`${name}: line 1 must be "# <short title>"`);
  if (!lines.some((l) => /^Severity: (critical|major|normal)$/.test(l))) p.push(`${name}: Severity must be critical, major or normal`);
  if (!lines.some((l) => /^Area: (API|SDK|docs|app|contracts)$/.test(l))) p.push(`${name}: Area must be API, SDK, docs, app or contracts`);
  let at = -1;
  for (const h of HEADINGS) {
    const i = lines.indexOf(h);
    if (i <= at) p.push(`${name}: missing or out-of-order heading ${h}`);
    at = Math.max(at, i);
  }
  const section = (h: string): string => {
    const i = lines.indexOf(h);
    if (i < 0) return "";
    const next = lines.findIndex((l, j) => j > i && l.startsWith("## "));
    return lines.slice(i + 1, next < 0 ? undefined : next).join("\n").trim();
  };
  if (section("## Evidence").length === 0) p.push(`${name}: Evidence is empty`);
  const env = section("## Environment");
  if (!env.includes("Somnia Tokyo testnet")) p.push(`${name}: Environment must name Somnia Tokyo testnet`);
  if (!/SDK version/.test(env)) p.push(`${name}: Environment must give the SDK version`);
  return p;
}

const isMain = process.argv[1]?.endsWith("check-feedback.ts") ?? false;
if (isMain) {
  const dir = repoPath("feedback");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
  const problems = files.flatMap((f) => checkFeedbackText(f, readFileSync(`${dir}/${f}`, "utf8")));
  if (files.length === 0) problems.push("feedback/ holds no items");
  for (const x of problems) console.log(`FAIL ${x}`);
  console.log(problems.length === 0 ? `PASS feedback (${files.length} items)` : "FAIL feedback");
  process.exit(problems.length === 0 ? 0 : 1);
}
```

`packages/ship/src/assemble-site.ts`:
```ts
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
```

`packages/ship/src/check-deploy.ts`:
```ts
import { readFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

const { url } = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string };
const problems: string[] = [];
for (const path of ["/", "/app/"]) {
  const res = await fetch(`${url}${path}`);
  const body = await res.text();
  if (res.status !== 200) problems.push(`${path} returned ${res.status}`);
  if (!body.includes("Basanos")) problems.push(`${path} does not mention Basanos`);
}
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? `PASS deploy (${url})` : "FAIL deploy");
process.exit(problems.length === 0 ? 0 : 1);
```

`packages/ship/src/evidence-index.ts`:
```ts
// Writes docs/evidence/INDEX.md: every evidence file and the transaction links it holds, for judges.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

export function renderEvidenceIndex(items: readonly { title: string; path: string; links: readonly string[] }[]): string {
  const lines = ["# Basanos evidence index", "", "Every file below is committed evidence from Somnia Tokyo testnet (Hideki, 50383).", ""];
  for (const it of items) {
    lines.push(`## ${it.title}`, "", `[${it.path}](${it.path.replace("docs/evidence/", "")})`, "");
    for (const l of it.links) lines.push(`- ${l}`);
    lines.push("");
  }
  return lines.join("\n");
}

const isMain = process.argv[1]?.endsWith("evidence-index.ts") ?? false;
if (isMain) {
  const FILES: [string, string][] = [
    ["Referee close on a voucher account (G1 a)", "docs/evidence/g1a-close.json"],
    ["somnia_watch with the equity multicall (G1 b)", "docs/evidence/g1b-watch.json"],
    ["Replay horizon (G1 c)", "docs/evidence/g1c-history.json"],
    ["Price Oracle on Tokyo testnet (G1 d)", "docs/evidence/g1d-oracle.json"],
    ["Indexer reads (R1)", "docs/evidence/r1-indexer.json"],
    ["Registry previewStart vs the SDK (R5)", "docs/evidence/r5-preview.json"],
    ["Bytecode verification", "docs/evidence/verify.json"],
    ["Rehearsal (first real verdicts)", "docs/evidence/rehearsal.json"],
    ["Demo takes", "docs/evidence/demo-takes.json"],
    ["Per-run evidence bundles", "docs/evidence/runs.json"],
    ["Featured run", "docs/evidence/featured-run.json"],
  ];
  const items = FILES.filter(([, p]) => existsSync(repoPath(p))).map(([title, path]) => {
    const text = readFileSync(repoPath(path), "utf8");
    const links = [...new Set(text.match(/https:\/\/explorer\.testnet\.somnia\.network\/tokyo\/tx\/0x[0-9a-fA-F]{64}/g) ?? [])];
    return { title, path, links };
  });
  writeFileSync(repoPath("docs/evidence/INDEX.md"), renderEvidenceIndex(items));
  console.log(`wrote docs/evidence/INDEX.md (${items.length} files)`);
  process.exit(0);
}
```

`packages/ship/src/deploy-vercel.ts`:
```ts
// Deploys the assembled site/basanos to Vercel production with VERCEL_TOKEN from the git-ignored .env, and
// writes deployments/site.json. Runs from inside site/basanos so no argument holds a path with a space.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadDotEnv, repoPath } from "@basanos/core/node";

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
const r = spawnSync("npx", ["vercel@65.3.1", "deploy", ".", "--prod", "--yes", "--token", token], { cwd: dir, encoding: "utf8", shell: true });
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
```

`packages/ship/src/set-base-url.ts`:
```ts
// Owner-only (REFEREE_PK): points the certificates' external_url at the live site from deployments/site.json.
import { readFileSync, writeFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, makeRefereeWallet } from "@basanos/referee";

loadDotEnv();
const site = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string; deployedAt: string; baseUrlTx: string | null };
const dep = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
const client = makePublicClient(rpcHttp());
const url = `${site.url}/app/#/cert/`;
const hash = await wallet.writeContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "setBaseUrl", args: [url] });
const receipt = await client.waitForTransactionReceipt({ hash });
site.baseUrlTx = hash;
writeFileSync(repoPath("deployments/site.json"), `${JSON.stringify(site, null, 2)}\n`);
console.log(`setBaseUrl ${receipt.status} ${hash} -> ${url}`);
process.exit(receipt.status === "success" ? 0 : 1);
```

- [ ] **Step 6: Run the tests (the gate)**
Run: `npm test -w @basanos/ship`
Expected: PASS — `6 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `feat(ship): featured-run snapshot, X-post drafts, checks, site assembly and evidence index`

---

### Task 2: LIVE read-only — snapshot the first real verdict run (the rehearsal) as the featured run

**Files:**
- Create: `docs/evidence/featured-run.json`

**Depends on:** Task 1, referee:Task 10
**Effort:** low
**Provides:** `docs/evidence/featured-run.json (featured run: the first real verdict from the Nov 12 rehearsal; schema basanos.featured/1)`
**Requires:** `CLI: npx tsx packages/ship/src/snapshot-run.ts [runId] -> writes docs/evidence/featured-run.json`, `docs/evidence/rehearsal.json (first real verdict runs: firstVerdictRunId, runs with statusName, ruleName, closeTxs)`

Read-only (no key, no STT). The landing plan builds against this file (spec §11). After the money shot, task 3 regenerates it, and only `FEATURED_RUN_ID` changes.

- [ ] **Step 1: Snapshot the rehearsal's first verdict**
Run: `npx tsx packages/ship/src/snapshot-run.ts`
Expected: `featured run <id>: Passed -> docs/evidence/featured-run.json` (or `Failed (DailyLoss)`, etc.).

- [ ] **Step 2: Check the file's shape (the gate)**
Run: `node -e "const f=require('./docs/evidence/featured-run.json'); if(f.schema!=='basanos.featured/1'||!/^(Passed|Failed)$/.test(f.status)) process.exit(1); console.log('PASS featured', f.runId, f.status)"`
Expected: PASS — `PASS featured <id> Passed` (or `Failed`).

- [ ] **Step 3: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): featured run = the rehearsal's first real verdict`

---

### Task 3: LIVE — the money shot (one PASS, one FAIL) and the final featured run

**Files:**
- Modify: `docs/evidence/demo-takes.json`
- Modify: `docs/evidence/runs.json`
- Modify: `docs/evidence/featured-run.json`
- Modify: `apps/landing/src/featured-verdict.json`
- Modify: `apps/landing/src/img/verdict.png`

**Depends on:** Task 1, Task 2, referee:Task 7, referee:Task 8, referee:Task 10, landing:Task 2, landing:Task 4, referee:Task 12, referee:Task 14, referee:Task 15, referee:Task 17, referee:Task 18, referee:Task 20, referee:Task 21, referee:Task 22, web:Task 11
**Effort:** medium
**Model tier:** top
**Provides:** `money shot take in docs/evidence/demo-takes.json (one PASS, one FAIL)`, `FEATURED_RUN_ID (the money-shot PASS run; set in .env)`
**Requires:** `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--one-account [--pass-side long|short]] (two funded accounts; both runs start together and the pair opens in the same block, or B right after a human A's long with --a-manual; the FAIL on demand once one run PASSES; writes viem-direct and read back; a take that fails after a run started aborts into docs/evidence/demo-aborted.json, exit 1)`, `CLI: npx tsx packages/referee/src/cli.ts start | enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo> | status`, `CLI: npx tsx packages/ship/src/snapshot-run.ts [runId] -> writes docs/evidence/featured-run.json`, `CLI: npx tsx packages/ship/src/check-money-shot.ts -> PASS money-shot`, `CLI: npx tsx apps/landing/scripts/featured-snapshot.ts -> writes apps/landing/src/featured-verdict.json from docs/evidence/featured-run.json`, `CLI: node apps/landing/scripts/shoot-verdict.mjs <runId> <registry> <referee>`

**Human-gated (wallet).** This signs with `REFEREE_PK`, `ACCOUNT_A_PK` (pasted into the terminal's challenge wallet for the recording) and `ACCOUNT_B_PK`. Top up all three to about 1 STT first. Both challenge accounts must be funded: their own USDso deposited in their own MarginBank balance (spike:18, spike:19; no voucher). Run it on Nov 14, with demo-studio recording if Step 2.5 runs. No voucher is claimed. Set `ORACLE_ENABLED=true` in `.env` for this take: the money shot asks the Price Oracle, best effort (on 3 of 4 tries the Majority-consensus request finalized Failed, and the verdict page then says no reading was recorded). If neither run PASSES within demo v2's 20 minutes (about 4% of takes in the replay), both end FAILED: top up and take again. If a write fails after a run started, the demo prints `STOP: take aborted: …` (referee:17). Nothing is re-sent; it waits for the verdicts, so keep terminal 1 running until it exits. It records the take in `docs/evidence/demo-aborted.json` and exits 1: stop and report.

- [ ] **Step 1: Start the referee (terminal 1, leave it running)**
Run: `npx tsx packages/referee/src/cli.ts start`
Expected: `referee watching registry 0x…`.

- [ ] **Step 2: Take the money shot (terminal 2), with account A opened by a human from the terminal**
Run: `npx tsx packages/bot/src/demo.ts --a-manual`
Expected:
1. The disclosure line, two `run <id>` lines, and `A: open the long from the Basanos terminal now (10x); B opens its short as soon as A's long is seen.`
2. Open the app at `/app/#/challenge`, paste `ACCOUNT_A_PK` into the challenge wallet's import field, and press **Buy / long** at the ticket's default 10× (the terminal caps the IOC from the book and shows the closeable equity the referee judges).
3. Within 20 minutes (median about 4), one run PASSES. The demo then pushes the other past the exposure cap (`a run PASSED: exposure breach on …`), so the take ends one `Passed` and one `Failed/<rule>`, and it is recorded.

- [ ] **Step 3: Make the money-shot PASS run the featured run**
Set `FEATURED_RUN_ID=<the Passed run id>` in `.env`.
Run: `npx tsx packages/ship/src/snapshot-run.ts`
Expected: `featured run <id>: Passed -> docs/evidence/featured-run.json`.
Run: `npx tsx apps/landing/scripts/featured-snapshot.ts`
Expected: `wrote apps/landing/src/featured-verdict.json (run <id>)`.
Run: `node apps/landing/scripts/shoot-verdict.mjs <runId> <registry> <referee>` (the money-shot run id, the registry from `deployments/hideki.json`, `REFEREE_ADDRESS`)
Expected: `saved …apps\landing\src\img\verdict.png`. The screenshot now shows the money-shot run, so the landing's text and picture describe the same run (spec §11).

- [ ] **Step 4: Stop the referee and check the take (the gate)**
Stop terminal 1 with Ctrl+C.
Run: `npx tsx packages/ship/src/check-money-shot.ts`
Expected: PASS — `PASS money-shot (take <n>: one PASS, one FAIL)`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): money shot — one PASS with certificate, one FAIL closed by the referee`

---

### Task 4: Feedback items from build friction (Feedback track, by-product)

**Files:**
- Create: `feedback/sdk-hideki-addresses-missing-operator-registry.md`
- Create: `feedback/docs-perps-market-list-drift.md`
- Create: `feedback/docs-somnia-watch-push-has-no-block-number.md`
- Create: `feedback/sdk-indexer-reads-fail-on-hideki.md`
- Create: `feedback/explorer-verify-cancun-build.md`

**Depends on:** Task 1, spike:Task 9, contracts:Task 12
**Effort:** medium
**Provides:** `feedback/*.md (event template; reproducible, de-duplicated items)`
**Requires:** `CLI: npx tsx packages/ship/src/check-feedback.ts -> PASS feedback`, `docs/evidence/g1b-watch.json`, `docs/evidence/r1-indexer.json`, `docs/evidence/verify.json (runtime bytecode match with immutables masked; explorer attempt output)`

Rules (spec §16):
- Write a file only for a defect that you reproduced in this step and that is not already filed. Skip it otherwise; a declared file you don't create is fine.
- Never file a security issue here; send it privately to security@dreamdex.io.
- Skip bot-kit issues #26–#45 and the items in prior-art §C.

Each file follows the event template verbatim: title, `Severity:`, `Area:`, then `## Steps to reproduce`, `## Expected`, `## Actual`, `## Evidence`, `## Environment`. Evidence is the real command output.

- [ ] **Step 1: Check for duplicates first**
Run: `gh issue list -R somnia-chain/dreamdex-bot-kit --state all --limit 100 --search "operatorPermissionsRegistry OR somnia_watch OR blockNumber OR markets OR getMarginEvents OR verify"`
Expected: a list of issues (possibly empty). Drop any candidate below whose defect already appears there, or in `docs/resources/2026-11-10-dreamdex-perps-bounty/prior-art.md` §C, or in bot-kit #26–#45.

- [ ] **Step 2: Reproduce and write `feedback/sdk-hideki-addresses-missing-operator-registry.md`**
Run: `node --input-type=module -e "import { SOMNIA_HIDEKI_TESTNET_ADDRESSES as A } from '@somnia-chain/markets-sdk'; console.log(JSON.stringify({ operatorPermissionsRegistry: A.operatorPermissionsRegistry ?? null, marginBank: A.marginBank }))"`
Expected: `{"operatorPermissionsRegistry":null,"marginBank":"0x478769E1177C0773c43A593DCCc4Ad15F15F1394"}`. If it prints a registry address, skip this item.
Write the file with this content, pasting the command's real output under Evidence:
```markdown
# SOMNIA_HIDEKI_TESTNET_ADDRESSES has no operatorPermissionsRegistry, so the SDK's perp operator grants fail on Hideki
Severity: normal
Area: SDK

## Steps to reproduce
1. Install `@somnia-chain/markets-sdk@0.33.0`.
2. Read `SOMNIA_HIDEKI_TESTNET_ADDRESSES.operatorPermissionsRegistry`.
3. Create a client with `addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES` and call `trader.setOperatorApprovalForPool({ pool, operator, selectors, approved: true })` without `operatorRegistry`.

## Expected
The Hideki address set names the perps OperatorPermissionsRegistry the dreamDEX docs list for Hideki (`0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a`), so grants and `isOperatorAuthorized`-style reads work with the shipped constants, as they do for Somnia Tokyo (`SOMNIA_TOKYO_ADDRESSES.operatorPermissionsRegistry`).

## Actual
The key is absent, so the grant throws `NotConfiguredError` unless the caller passes `operatorRegistry` by hand. The grant helper's comment also says "SPOT-ONLY", although perp stop orders write `setOperatorApprovalForPool` on the same registry.

## Evidence
<paste the command and its output here>

## Environment
SDK version 0.33.0, network Somnia Tokyo testnet (Hideki, chain 50383), wallet address: read-only (no wallet needed)
```

- [ ] **Step 3: Reproduce and write `feedback/docs-perps-market-list-drift.md`**
Run: `node --input-type=module -e "import { SomniaMarkets } from '@somnia-chain/markets-sdk'; import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains'; const m = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql' }); const p = await m.client.listPerpMarkets(); const b = p.find((x) => x.baseSymbol === 'BTC'); console.log(JSON.stringify({ count: p.length, btcInitialMarginBps: b?.initialMarginBps })); process.exit(0)"`
Expected: a JSON line with `count` (40 on 2026-11-10) and `btcInitialMarginBps` (250 on 2026-11-10). If `count` is 21 and BTC's IM is 500, skip this item.
Write the file with this content, pasting the real output under Evidence:
```markdown
# Perps docs list 21 markets and BTC at 20x (5% IM); the live Hideki pool list has more markets and BTC at 2.5% IM
Severity: normal
Area: docs

## Steps to reproduce
1. Open the dreamDEX trader docs page `trading/perps-testnet` and read the markets table (21 rows; BTC-PERP "20x, 5% / 2.5%").
2. Run `client.listPerpMarkets()` with `@somnia-chain/markets-sdk@0.33.0` against Hideki and count the rows; read BTC's `initialMarginBps`.

## Expected
The documented market list and margin parameters match the live markets, or the page says which subset it shows.

## Actual
The live list and BTC's initial margin differ from the table (see Evidence). The Somnia SDK perps page still says only BTC and ETH perps are live.

## Evidence
<paste the command and its output here>

## Environment
SDK version 0.33.0, network Somnia Tokyo testnet (Hideki, chain 50383), wallet address: read-only (no wallet needed)
```

- [ ] **Step 4: Write `feedback/docs-somnia-watch-push-has-no-block-number.md` from the spike evidence**
Open `docs/evidence/g1b-watch.json` and confirm that `firstSnapshot` was decoded from the attached call, and that the raw push carried only `address, topics, data, simulationResults` (the spec's Stage-1 table records the keys). Write:
```markdown
# somnia_watch notifications carry no block number or transaction hash, and the docs do not say so
Severity: normal
Area: docs

## Steps to reproduce
1. Open a WebSocket to `wss://api.hideki.infra.testnet.somnia.network/ws`.
2. Send `eth_subscribe` with `["somnia_watch", { "address": "0x478769E1177C0773c43A593DCCc4Ad15F15F1394", "eth_calls": [{ "to": "0xcA11bde05977b3631167028862bE2a173976CA11", "data": "0x42cbb15c" }] }]`.
3. Read the keys of `params.result` in the pushes.

## Expected
Each push identifies the block (and ideally the transaction) of the matched log, like `eth_subscribe("logs")` notifications, or the reactivity docs state that it does not and recommend attaching `Multicall3.getBlockNumber()`.

## Actual
The push holds only `address`, `topics`, `data` and `simulationResults`; a consumer must attach a block-number `eth_call` to place the event, and must look up the transaction with `eth_getLogs` afterwards.

## Evidence
<paste one push's JSON from a re-run of the subscription, and the block numbers decoded in docs/evidence/g1b-watch.json>

## Environment
SDK version 0.33.0 (raw JSON-RPC), network Somnia Tokyo testnet (Hideki, chain 50383), wallet address: read-only (no wallet needed)
```

- [ ] **Step 5: Write the two conditional items only if the evidence shows a defect**
- **Indexer reads:** if `docs/evidence/r1-indexer.json` shows any read with `ok: false`, write `feedback/sdk-indexer-reads-fail-on-hideki.md`:
  - **Steps:** call that read with SDK 0.33.0 against the public Hideki indexer.
  - **Expected:** rows, or an empty page.
  - **Actual:** the error.
  - **Evidence:** the `error` string from the JSON.
  - **Header:** Severity `major`, Area `SDK`.

  If every read is `ok: true`, skip it.
- **Explorer verification:** if `docs/evidence/verify.json` has `explorer.attempted: true` and a non-zero `explorer.status` for a reason other than osaka (bot-kit #36), write `feedback/explorer-verify-cancun-build.md`:
  - **Steps:** the `forge verify-contract` command in `contracts/script/verify-bytecode.ts`.
  - **Evidence:** the `explorer.output`.
  - **Header:** Severity `normal`, Area `app`.

  Otherwise skip it.
Every item uses the same template and Environment line as above.

- [ ] **Step 6: Check every item (the gate)**
Run: `npx tsx packages/ship/src/check-feedback.ts`
Expected: PASS — `PASS feedback (<n> items)` with n ≥ 1.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `docs(feedback): reproducible dreamDEX/Somnia items met while building Basanos`

---

### Task 5: README (schema R1-web-app v1 + event overlay) and LICENSE

**Files:**
- Modify: `README.md`
- Create: `LICENSE`
- Create: `scripts/check-readme.ps1`

**Depends on:** Task 1, referee:Task 7, referee:Task 8, referee:Task 9, web:Task 2, web:Task 7, contracts:Task 9
**Effort:** medium
**Provides:** `README.md (R1-web-app v1 + event-overlay; TBD-post-build lines for live facts)`, `LICENSE (MIT, Basanos code; vendored kit files excluded)`
**Requires:** `CLI: npx tsx packages/referee/src/cli.ts start | enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo> | status`, `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--wait-min 10]`, `CLI: npm run build -w @basanos/web (check-env, then vite build)`, `CLI: npx tsx contracts/script/deploy.ts [--dry-run] (REFEREE_PK deploys and owns; registers tokyo-sprint and tokyo-sprint-demo; writes deployments/hideki.json)`

Schema `R1-web-app v1` (`references/readme-schemas.md`): the UI is the demo, and contracts back it, so the optional Contract addresses section is included. Event overlay (pack `event.md` §3: "Your README explains what it does, who it is for and how to run it." / "Your README has an X posts section with links to 2 or 3 posts about your MVP that tag @DreamDEXSomnia.") adds `## Who it is for` and `## X posts` in the overlay slot. Stamp: `<!-- readme-schema: R1-web-app v1 + event-overlay -->`. Resolved headings, in order:
`# Basanos` · `## Demo` · `## What it does` · `## Quickstart` · `## Built at dreamDEX Perps Builder Bounty` · `## How it works` · `## Tech stack` · `## Run locally` · `## Contract addresses` · `## Who it is for` · `## X posts` · `## Roadmap` · `## License`.
It leads with the verdict and the certificate (G6), carries the trust line verbatim, the demo disclosure and the testnet notice, and states the known limitations (spec §19).

- [ ] **Step 1: Write `README.md` (replace the stub entirely)**

`README.md`:
````markdown
<!-- readme-schema: R1-web-app v1 + event-overlay -->
# Basanos

Prop-firm challenges for dreamDEX perps: a published rulebook, a referee that closes on a breach, and a verdict anyone can replay.

## Demo

- Live site (landing, terminal at `/app/#/challenge`): TBD-post-build:vercel-url
- Featured verdict, a real run on Somnia Tokyo testnet: TBD-post-build:featured-verdict-url
- Demo video: TBD-post-build:demo-video-url
- Screenshot of the featured verdict page: TBD-post-build:verdict-screenshot

## What it does

Basanos (Greek for the touchstone, the original test a metal's purity is checked against) turns a dreamDEX perps account into a prop-firm evaluation with a public result. A trader or a bot takes the published "Tokyo Sprint" rulebook, grants the Basanos referee key place and cancel rights only (it can close a position, never withdraw), and enrolls in the Basanos registry on Somnia, which reads the starting equity from the dreamDEX MarginBank itself. The referee watches the account at every price write; on a breach it cancels resting orders and closes the position with real perps orders, then records **FAILED** with the rule, the block and the close transactions. When the profit target is reached after the minimum time, the referee locks the gain and the registry checks the end state itself before it records **PASSED** and mints a non-transferable certificate.

**Every certificate is chain-checked at mint; every verdict is replayable.** Path rules (daily loss, trailing drawdown, exposure) are enforced by the referee and shown by replay; they are not checked by the contract.

Both demo accounts are burners operated by the builder: one human-driven, one scripted. Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.

## Quickstart

```bash
git clone https://github.com/Dotman-Bei/basanos.git
cd basanos
npm install
cp .env.example .env   # fill in three testnet burner keys and REGISTRY_ADDRESS / REFEREE_ADDRESS
npx tsx packages/referee/src/cli.ts start   # terminal 1: the referee
npx tsx packages/bot/src/demo.ts            # terminal 2: two accounts, opposite 12x positions, one PASS and one FAIL
```

## Built at dreamDEX Perps Builder Bounty

Built for the dreamDEX Perps Builder Bounty (Somnia × dreamDEX, DoraHacks), MVP track, category trader tools, with bots and agents served by the same rulebook; reproducible defects met along the way are in `feedback/` for the Feedback track. Built by a solo builder with an AI agent pool (Claude Code). Everything in this repository was written during the event window (2026-11-10 to 2026-11-15): the referee, the verdict registry and certificate, the challenge terminal, the verdict and certificate pages, and the landing page.

## How it works

- **Rulebook.** `rulebooks/tokyo-sprint.json` and `rulebooks/tokyo-sprint-demo.json` (the demo parameter set, labelled "Tokyo Sprint · Demo" everywhere it appears). The registry stores each rulebook's id (keccak256 of its canonical JSON) and the contract-checked fields.
- **Start (chain-checked).** `startRun` reads MarginBank in the transaction: the account must be flat and must have granted the referee place and cancel on BTC-PERP; the start equity is stored with its block.
- **Referee.** Off-chain Somnia Reactivity: `somnia_watch` on price writes and on the account's MarginBank logs, each push carrying a Multicall3 snapshot of block, time, mark and equity. A watch gap pauses judging; the referee re-reads at head before it resumes. Money flows void a run; liquidations fail it.
- **Close protocol.** Cancel resting orders, read the position fresh, close with an opposite-side IOC `placeOrderFor`, read back, retry at most three times, sweep. Every transaction is recorded.
- **Verdicts.** FAIL and VOID are recorded by the referee with the raw reads (block, equity, locked collateral, size, mark) and an evidence hash of the bundle in `docs/evidence/runs.json`. PASS is checked by the registry at mint: flat, equity at or above the target, minimum time, time limit, grant still held. Each PASS or FAIL verdict also asks Somnia's Price Oracle for the BTC perp median, inside `try`, so a failed request never blocks a verdict; the verdict page shows the reading only when one was recorded.
- **Replay.** The verdict page re-runs every stored read at its block; past the public RPC's history it shows the values stored on-chain.

## Tech stack

TypeScript on Node 22 (strict ESM), `@somnia-chain/markets-sdk` 0.33.0, viem 2.57.12, Solidity 0.8.28 with Foundry 1.7.1 (`evm_version = cancun`), React 19 + Vite 8, vitest 4. Chain: Somnia Tokyo testnet (Hideki, chain 50383). Somnia primitives: off-chain Reactivity (`somnia_watch`) and Somnia Agents (the Price Oracle, asked at each verdict).

## Run locally

```bash
npm install
npm test                                   # all workspaces
node contracts/script/forge.mjs test       # the registry's Foundry suite
npm run build -w @basanos/web              # the app (served at /app/)
npx tsx packages/referee/src/cli.ts status # active runs in the registry
```

| Variable | Purpose |
|---|---|
| `REFEREE_PK` | the referee burner's key (closes, verdicts; it owns the registry) |
| `REFEREE_ADDRESS` | the referee's address (the app's grant target) |
| `ACCOUNT_A_PK`, `ACCOUNT_A_ADDRESS` | the human challenge account (demo) |
| `ACCOUNT_B_PK`, `ACCOUNT_B_ADDRESS` | the scripted bot's account |
| `REGISTRY_ADDRESS` | the deployed BasanosRegistry |
| `HIDEKI_RPC_HTTP`, `HIDEKI_RPC_WSS` | optional RPC overrides |
| `ORACLE_ENABLED` | `true` (this build): sends 0.0309 STT per PASS or FAIL verdict for a Price Oracle reading; most of it is rebated |
| `FEATURED_RUN_ID` | the run the landing page shows |
| `VITE_REGISTRY_ADDRESS`, `VITE_REFEREE_ADDRESS` | public values baked into the app build |

Keys stay in the git-ignored `.env`; the app build refuses any `VITE_*_PK` variable.

## Contract addresses

| network | address | explorer |
|---|---|---|
| Somnia Tokyo testnet (Hideki, 50383): BasanosRegistry | `0xf5D8099239200DF961E0910A42C105214D1E9370` | https://explorer.testnet.somnia.network/tokyo/address/0xf5D8099239200DF961E0910A42C105214D1E9370 |
| Somnia Tokyo testnet: dreamDEX MarginBank | `0x478769E1177C0773c43A593DCCc4Ad15F15F1394` | https://explorer.testnet.somnia.network/tokyo/address/0x478769E1177C0773c43A593DCCc4Ad15F15F1394 |
| Somnia Tokyo testnet: BTC-PERP pool | `0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0` | https://explorer.testnet.somnia.network/tokyo/address/0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0 |
| Somnia Tokyo testnet: OperatorPermissionsRegistry | `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a` | https://explorer.testnet.somnia.network/tokyo/address/0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a |
| Somnia Tokyo testnet: SomniaAgents (Price Oracle requests) | `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3` | https://explorer.testnet.somnia.network/tokyo/address/0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3 |

## Who it is for

- **Traders** who want a pass they can show: take the challenge from the Basanos terminal, the dreamDEX app or your own bot, retry when you fail.
- **Bot and AI-agent builders** who need to show that a bot trades inside a rulebook before anyone links its key: the referee does not care whether a human or a bot trades the account.
- **Later, on mainnet:** desks, funds and DAOs that publish a rulebook and fund the accounts that pass.

## X posts

- TBD-post-build:x-post-1-url
- TBD-post-build:x-post-2-url
- TBD-post-build:x-post-3-url

## Roadmap

Known limitations: path rules are referee-enforced and replayable, not contract-checked; a referee watch gap pauses judging, and a breach that recovers inside a gap is not seen (gaps are logged in the evidence); the referee's grant could also open orders, so every referee order is public evidence and its code is open; self-trading against a second account at the band edge can manufacture a pass (anti-collusion forensics are out of scope); replay depends on the public RPC's history, after which the page shows the stored reads.

Next: the registry checks every breach on-chain before the close; an on-chain Reactivity judge; anyone-callable expiry; multi-market rulebooks; anti-collusion forensics.

## License

MIT for the Basanos code (see `LICENSE`). The files under `packages/design/vendor/` and `apps/landing/vendor/`, and `docs/design/frontend.md` (a copy of the design skill's `SKILL.md`), are third-party frontend-kit files (tasteskill 2.5.0), listed in `docs/gates/submission-draft.md`, and are not covered by this licence.
````

- [ ] **Step 2: Write `LICENSE`**

`LICENSE`:
```text
MIT License

Copyright (c) 2026 Dotman-Bei

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Files under packages/design/vendor/ and apps/landing/vendor/, and
docs/design/frontend.md (a copy of the design skill's SKILL.md), are third-party
(tasteskill 2.5.0) and are not covered by this licence.
```

- [ ] **Step 3: Write the schema check (the kit's conformance check, resolved for this README)**

`scripts/check-readme.ps1`:
```powershell
$want = @('# Basanos','## Demo','## What it does','## Quickstart','## Built at dreamDEX Perps Builder Bounty','## How it works','## Tech stack','## Run locally','## Contract addresses','## Who it is for','## X posts','## Roadmap','## License')
$stamp = '<!-- readme-schema: R1-web-app v1 + event-overlay -->'
$lines = Get-Content README.md -Encoding UTF8
$inFence = $false
$got = foreach ($l in $lines) {
  if ($l -match '^```') { $inFence = -not $inFence }
  elseif (-not $inFence -and $l -cmatch '^#{1,2} ') { $l } }
$ok = ($got.Count -eq $want.Count)
if ($ok) { for ($i = 0; $i -lt $want.Count; $i++) { if ($got[$i] -cne $want[$i]) { $ok = $false } } }
if ($ok -and ($lines[0] -ceq $stamp)) { 'PASS' } else { 'FAIL' }
```

- [ ] **Step 4: Check the README against the schema (the gate)**
Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-readme.ps1`
Expected: PASS — `PASS`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `docs: README (R1-web-app v1 + event overlay) and MIT licence`

---

### Task 6: LIVE — deploy the site to Vercel and point the certificates at it

**Files:**
- Create: `deployments/site.json`
- Modify: `deployments/hideki.json`

**Depends on:** Task 1, Task 3, Task 5, Task 8, Task 9, Task 10, web:Task 2, web:Task 7, web:Task 8, web:Task 9, web:Task 10, web:Task 11, web:Task 12, referee:Task 18, landing:Task 3, landing:Task 5, contracts:Task 10
**Effort:** medium
**Model tier:** top
**Provides:** `deployments/site.json ({ url, deployedAt, baseUrlTx })`, `public site: landing at /, app at /app/`
**Requires:** `CLI: npx tsx packages/ship/src/assemble-site.ts -> writes site/basanos/ (landing at /, app at /app/)`, `CLI: npx tsx packages/ship/src/check-deploy.ts -> PASS deploy (the site answers at / and /app/, the registry's baseUrl() is the live certificate route, and no live page or assembled site/basanos file carries the sample marker)`, `CLI: npm run build -w @basanos/web (check-env, then vite build)`, `CLI: npm run build -w @basanos/landing (render from the featured snapshot, then the truth check)`, `deployments/hideki.json (registry address, deploy block, rulebook ids)`, `CLI: npx tsx packages/ship/src/deploy-vercel.ts -> deploys site/basanos to Vercel production with VERCEL_TOKEN in the child env (never on argv), writes deployments/site.json`, `CLI: npx tsx packages/ship/src/set-base-url.ts -> registry.setBaseUrl(<site>/app/#/cert/) as the owner, reads baseUrl() back (FAIL unless equal), records it in deployments/site.json and deployments/hideki.json`

**Human-gated (deploy).**
- **Needs:** a Vercel account and `VERCEL_TOKEN` in `.env`, both from the concierge signup gate. `setBaseUrl` signs with `REFEREE_PK`, the registry owner.
- **Rules:** the site is public. Run the public-flip secret scan first (runsheet B5/B11). Never deploy a build that holds a key; the app build already refuses `VITE_*_PK`.

- [ ] **Step 1: Build both apps with the public build values**
Set `VITE_REGISTRY_ADDRESS` (the registry from `deployments/hideki.json`) and `VITE_REFEREE_ADDRESS` (the referee address) in the shell, both public values.
Run: `npm run build -w @basanos/web`
Expected: `check-env: no VITE_*_PK variables` and `✓ built`.
Run: `npm run build -w @basanos/landing`
Expected: `PASS truth` and `✓ built`.

- [ ] **Step 2: Assemble and deploy**
Run: `npx tsx packages/ship/src/assemble-site.ts`
Expected: `assembled site/basanos (landing at /, app at /app/)`.
Run: `npx tsx packages/ship/src/deploy-vercel.ts`
Expected: `deployed https://<project>.vercel.app`; it writes `deployments/site.json` with `baseUrlTx: null`.

- [ ] **Step 3: Point the certificates at the live site**
Run: `npx tsx packages/ship/src/set-base-url.ts`
Expected: `setBaseUrl success 0x… -> https://<project>.vercel.app/app/#/cert/`, then `baseUrl() read back: https://<project>.vercel.app/app/#/cert/`.
- This replaces the constructor's placeholder `https://basanos.vercel.app/app/#/cert/` in the registry and in `deployments/hideki.json`.
- A `FAIL registry baseUrl() …` line means the read-back differs: stop, and fix it before Step 4.
- [ ] **Step 4: Check the live site (the gate)**
This also reads the registry's `baseUrl()` and fails unless it is the live certificate route. It also fails if a live page or the assembled `site/basanos` output carries the landing's sample-fixture marker (ship:10).
Run: `npx tsx packages/ship/src/check-deploy.ts`
Expected: PASS — `PASS deploy (https://<project>.vercel.app)`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `chore(deploy): Basanos site live on Vercel; certificates point at it`

---

### Task 7: X-post drafts and the evidence index from the final facts

**Files:**
- Create: `docs/gates/x-posts-draft.md`
- Create: `docs/evidence/INDEX.md`

**Depends on:** Task 1, Task 3, Task 6
**Effort:** low
**Provides:** `docs/gates/x-posts-draft.md (3 drafts generated from the featured run and the live URL)`, `docs/evidence/INDEX.md (evidence files and their tx links)`
**Requires:** `CLI: npx tsx packages/ship/src/x-posts.ts -> writes docs/gates/x-posts-draft.md`, `CLI: npx tsx packages/ship/src/evidence-index.ts -> writes docs/evidence/INDEX.md`, `deployments/site.json ({ url, deployedAt, baseUrlTx })`

Publishing the posts is the user's human gate (Step 3 closing); this task only drafts them from the same facts the landing shows.

- [ ] **Step 1: Generate the X-post drafts**
Run: `npx tsx packages/ship/src/x-posts.ts`
Expected: `wrote docs/gates/x-posts-draft.md (3 posts)`.

- [ ] **Step 2: Generate the evidence index (the gate)**
Run: `npx tsx packages/ship/src/evidence-index.ts`
Expected: PASS — `wrote docs/evidence/INDEX.md (<n> files)`.

- [ ] **Step 3: Commit (kernel-performed — no agent runs this)**
Message: `docs: X-post drafts and the evidence index from the final run`

---

### Task 8: Vercel deploy — `VERCEL_TOKEN` only in the child environment, never on the command line

**Files:**
- Create: `packages/ship/src/vercel.ts`
- Modify: `packages/ship/src/deploy-vercel.ts`
- Test: `packages/ship/test/vercel.test.ts`

**Depends on:** Task 1, spike:Task 1, spike:Task 3
**Effort:** low
**Model tier:** top
**Provides:** `VERCEL_CLI = "vercel@65.3.1"`, `vercelDeployInvocation(token: string, baseEnv: NodeJS.ProcessEnv): { command: string; args: string[]; env: NodeJS.ProcessEnv }`, `argvLeaksToken(args: readonly string[], token: string): boolean`, `CLI: npx tsx packages/ship/src/deploy-vercel.ts -> deploys site/basanos to Vercel production with VERCEL_TOKEN in the child env (never on argv), writes deployments/site.json`
**Requires:** `repoPath(rel: string): string`, `loadDotEnv(path?: string): boolean`

Why (guide, 2026-11-11):
- **The problem:** Task 1's `deploy-vercel.ts` passes `--token <token>` on the command line, through `spawnSync(…, { shell: true })`. The process list and a shell echo could expose it.
- **The fix:** this task passes `VERCEL_TOKEN` in the child process's environment only. The checked-in `vercel@65.3.1` bundle reads `process.env.VERCEL_TOKEN` when no `--token` flag is given (its code records `tokenSource = "env"`).
- **The guard:** a test pins that the arguments never carry the token, and the script refuses to run if they ever do.

- [ ] **Step 1: Write the failing test**

`packages/ship/test/vercel.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/ship -- test/vercel.test.ts`
Expected: FAIL — `Cannot find module '../src/vercel'`.

- [ ] **Step 3: Write the invocation helper**

`packages/ship/src/vercel.ts`:
```ts
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
```

- [ ] **Step 4: Use it in the deploy script**

Replace `packages/ship/src/deploy-vercel.ts` with:
```ts
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
```

- [ ] **Step 5: Type-check (Task 6 runs the deploy)**
Run: `npm run typecheck -w @basanos/ship`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 6: Run the test (the gate)**
Run: `npm test -w @basanos/ship -- test/vercel.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `fix(ship): Vercel token only in the child environment, never on the command line`

---

### Task 9: Certificates' base URL — `setBaseUrl` reads `baseUrl()` back; the deploy check verifies it

**Files:**
- Create: `packages/ship/src/base-url.ts`
- Modify: `packages/ship/src/set-base-url.ts`
- Modify: `packages/ship/src/check-deploy.ts`
- Test: `packages/ship/test/base-url.test.ts`

**Depends on:** Task 1, contracts:Task 8, spike:Task 3, spike:Task 1, referee:Task 6
**Effort:** low
**Model tier:** top
**Provides:** `PLACEHOLDER_BASE_URL = "https://basanos.vercel.app/app/#/cert/"`, `certBaseUrl(siteUrl: string): string`, `baseUrlProblem(expected: string, onChain: string): string | null`, `CLI: npx tsx packages/ship/src/set-base-url.ts -> registry.setBaseUrl(<site>/app/#/cert/) as the owner, reads baseUrl() back (FAIL unless equal), records it in deployments/site.json and deployments/hideki.json`, `CLI: npx tsx packages/ship/src/check-deploy.ts -> PASS deploy (the site answers at / and /app/, and the registry's baseUrl() is the live certificate route)`
**Requires:** `basanosRegistryAbi (as const, generated from the forge artifact)`, `loadDotEnv(path?: string): boolean`, `repoPath(rel: string): string`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `makePublicClient(url: string): PublicClient`, `makeRefereeWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`

Why (guide, 2026-11-11): `deployments/hideki.json` and the live registry still hold the constructor's placeholder base URL. A read-only check on the registry `0xf5D8…9370` returned `baseUrl()` = `https://basanos.vercel.app/app/#/cert/`.
- **The gap:** Task 1's `set-base-url.ts` sends `setBaseUrl` but never reads it back, and `check-deploy.ts` does not look at it.
- **What changes:** `set-base-url.ts` sets `<deployed site>/app/#/cert/`, reads `baseUrl()` back, and fails unless the two are equal. On success it writes the real value into `deployments/site.json` and `deployments/hideki.json`.
- **The gate (Task 6 Step 4):** `check-deploy.ts` also fails unless the registry's `baseUrl()` is the live certificate route.

- [ ] **Step 1: Write the failing test**

`packages/ship/test/base-url.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { PLACEHOLDER_BASE_URL, baseUrlProblem, certBaseUrl } from "../src/base-url";

describe("certificate base URL", () => {
  it("points at the deployed site's certificate route", () => {
    expect(certBaseUrl("https://basanos-k3x9.vercel.app")).toBe("https://basanos-k3x9.vercel.app/app/#/cert/");
    expect(certBaseUrl("https://basanos-k3x9.vercel.app/")).toBe("https://basanos-k3x9.vercel.app/app/#/cert/");
    expect(() => certBaseUrl("http://basanos-k3x9.vercel.app")).toThrow(/https/);
  });
  it("accepts only an on-chain value equal to the deployed route, and names the placeholder", () => {
    const route = "https://basanos-k3x9.vercel.app/app/#/cert/";
    expect(baseUrlProblem(route, route)).toBeNull();
    expect(baseUrlProblem(route, PLACEHOLDER_BASE_URL)).toMatch(/placeholder/);
    expect(baseUrlProblem(route, "https://other.vercel.app/app/#/cert/")).toMatch(/expected/);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/ship -- test/base-url.test.ts`
Expected: FAIL — `Cannot find module '../src/base-url'`.

- [ ] **Step 3: Write the helper**

`packages/ship/src/base-url.ts`:
```ts
// The certificates' base URL: the live site's certificate route. deployments/hideki.json starts with the
// constructor's placeholder; ship:6 sets the real one with setBaseUrl and reads baseUrl() back.
export const PLACEHOLDER_BASE_URL = "https://basanos.vercel.app/app/#/cert/";

/** The certificate route on the deployed site (https only; any path on the site URL is dropped). */
export function certBaseUrl(siteUrl: string): string {
  const u = new URL(siteUrl);
  if (u.protocol !== "https:") throw new Error(`the site URL must be https: ${siteUrl}`);
  return `${u.origin}/app/#/cert/`;
}

/** null when the registry's baseUrl() equals the deployed route; otherwise what is wrong. */
export function baseUrlProblem(expected: string, onChain: string): string | null {
  if (onChain === expected) return null;
  const why = onChain === PLACEHOLDER_BASE_URL ? " (still the constructor's placeholder)" : "";
  return `registry baseUrl() is ${onChain}${why}; expected ${expected}`;
}
```

- [ ] **Step 4: Read the base URL back after setting it**

Replace `packages/ship/src/set-base-url.ts` with:
```ts
// Owner-only (REFEREE_PK): points the certificates' external_url at the live site from deployments/site.json, then
// reads baseUrl() back and refuses to finish unless it equals that route. On success deployments/hideki.json's
// baseUrl (the constructor's placeholder) is replaced by the real value.
import { readFileSync, writeFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, makeRefereeWallet } from "@basanos/referee";
import { baseUrlProblem, certBaseUrl } from "./base-url";

loadDotEnv();
const sitePath = repoPath("deployments/site.json");
const depPath = repoPath("deployments/hideki.json");
const site = JSON.parse(readFileSync(sitePath, "utf8")) as { url: string; deployedAt: string; baseUrlTx: string | null; baseUrl?: string };
const dep = JSON.parse(readFileSync(depPath, "utf8")) as Record<string, unknown> & { registry: Address; baseUrl?: string };
const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
const client = makePublicClient(rpcHttp());
const url = certBaseUrl(site.url);
const hash = await wallet.writeContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "setBaseUrl", args: [url] });
const receipt = await client.waitForTransactionReceipt({ hash });
const onChain = String(await client.readContract({ address: dep.registry, abi: basanosRegistryAbi, functionName: "baseUrl" }));
const problem = receipt.status === "success" ? baseUrlProblem(url, onChain) : `setBaseUrl reverted (${hash})`;
site.baseUrlTx = hash;
site.baseUrl = onChain;
writeFileSync(sitePath, `${JSON.stringify(site, null, 2)}\n`);
if (!problem) {
  dep.baseUrl = onChain;
  writeFileSync(depPath, `${JSON.stringify(dep, null, 2)}\n`);
}
console.log(`setBaseUrl ${receipt.status} ${hash} -> ${url}`);
console.log(`baseUrl() read back: ${onChain}`);
if (problem) console.log(`FAIL ${problem}`);
process.exit(problem ? 1 : 0);
```

Replace `packages/ship/src/check-deploy.ts` with:
```ts
// The live site answers at / and /app/, and the registry's baseUrl() points the certificates at this site.
import { readFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { baseUrlProblem, certBaseUrl } from "./base-url";

loadDotEnv();
const { url } = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string };
const { registry } = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const problems: string[] = [];
for (const path of ["/", "/app/"]) {
  const res = await fetch(`${url}${path}`);
  const body = await res.text();
  if (res.status !== 200) problems.push(`${path} returned ${res.status}`);
  if (!body.includes("Basanos")) problems.push(`${path} does not mention Basanos`);
}
const onChain = String(await makePublicClient(rpcHttp()).readContract({ address: registry, abi: basanosRegistryAbi, functionName: "baseUrl" }));
const wrong = baseUrlProblem(certBaseUrl(url), onChain);
if (wrong) problems.push(wrong);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? `PASS deploy (${url})` : "FAIL deploy");
process.exit(problems.length === 0 ? 0 : 1);
```

- [ ] **Step 5: Type-check (Task 6 runs both scripts)**
Run: `npm run typecheck -w @basanos/ship`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 6: Run the test (the gate)**
Run: `npm test -w @basanos/ship -- test/base-url.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `fix(ship): setBaseUrl reads baseUrl() back; the deploy check verifies the certificates' base URL`

---

### Task 10: The deploy check refuses a built output that carries the landing's sample-fixture marker

**Files:**
- Create: `packages/ship/src/sample.ts`
- Modify: `packages/ship/src/check-deploy.ts`
- Test: `packages/ship/test/sample.test.ts`

**Depends on:** Task 1, Task 9, contracts:Task 8, spike:Task 3, spike:Task 1, referee:Task 6
**Effort:** low
**Provides:** `SAMPLE_MARKER = "BASANOS-SAMPLE-FIXTURE"`, `sampleInBuild(pages: Record<string, string>): string[]`, `CLI: npx tsx packages/ship/src/check-deploy.ts -> PASS deploy (the site answers at / and /app/, the registry's baseUrl() is the live certificate route, and no live page or assembled site/basanos file carries the sample marker)`
**Requires:** `basanosRegistryAbi (as const, generated from the forge artifact)`, `loadDotEnv(path?: string): boolean`, `repoPath(rel: string): string`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `makePublicClient(url: string): PublicClient`, `baseUrlProblem(expected: string, onChain: string): string | null`, `certBaseUrl(siteUrl: string): string`

Why (guide GO, 2026-11-12): landing:3 now runs before the real verdict, on a labelled test fixture. That fixture's visible text carries `BASANOS-SAMPLE-FIXTURE`, so a page built from it would show the marker.
- **What this adds:** `check-deploy.ts`, ship:6's gate, also fails if a live page (`/`, `/app/`) or the assembled `site/basanos/index.html` / `site/basanos/app/index.html` carries the marker.
- **Earlier guards:** `build.ts` and landing:5 already refuse a sample (landing:3); this is the last check before the site is called live.
- **The marker literal** is pinned in both this test and landing:3's.

- [ ] **Step 1: Write the failing test**

`packages/ship/test/sample.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SAMPLE_MARKER, sampleInBuild } from "../src/sample";

describe("the deploy carries no sample fixture", () => {
  it("pins the marker landing:3 uses and finds it in any built or served page", () => {
    expect(SAMPLE_MARKER).toBe("BASANOS-SAMPLE-FIXTURE");
    expect(sampleInBuild({ "https://x.vercel.app/": "<h1>Run 3: PASSED</h1>", "https://x.vercel.app/app/": '<div id="root"></div>' })).toEqual([]);
    expect(sampleInBuild({ "site/basanos/index.html": "<small>Tokyo Sprint · Demo (BASANOS-SAMPLE-FIXTURE)</small>" })).toEqual([
      "site/basanos/index.html carries the sample marker BASANOS-SAMPLE-FIXTURE (a test fixture, not a real verdict)",
    ]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/ship -- test/sample.test.ts`
Expected: FAIL — `Cannot find module '../src/sample'`.

- [ ] **Step 3: Write the marker check**

`packages/ship/src/sample.ts`:
```ts
// The deploy must never carry a test fixture. landing:3's labelled sample (apps/landing/test/fixtures/
// featured-sample.json) shows this marker in its visible text, so any page built from it would contain it. The same
// literal is pinned in landing:3's sample-guard test.
export const SAMPLE_MARKER = "BASANOS-SAMPLE-FIXTURE";

/** One problem per built or served page that carries the sample marker; [] when none does. */
export function sampleInBuild(pages: Record<string, string>): string[] {
  return Object.entries(pages)
    .filter(([, body]) => body.includes(SAMPLE_MARKER))
    .map(([where]) => `${where} carries the sample marker ${SAMPLE_MARKER} (a test fixture, not a real verdict)`);
}
```

- [ ] **Step 4: Add it to the deploy check**

Replace `packages/ship/src/check-deploy.ts` with:
```ts
// The live site answers at / and /app/, the registry's baseUrl() points the certificates at this site, and neither the
// live pages nor the assembled site/basanos output carries the landing's sample-fixture marker (ship:10).
import { existsSync, readFileSync } from "node:fs";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { baseUrlProblem, certBaseUrl } from "./base-url";
import { sampleInBuild } from "./sample";

loadDotEnv();
const { url } = JSON.parse(readFileSync(repoPath("deployments/site.json"), "utf8")) as { url: string };
const { registry } = JSON.parse(readFileSync(repoPath("deployments/hideki.json"), "utf8")) as { registry: Address };
const problems: string[] = [];
const bodies: Record<string, string> = {};
for (const path of ["/", "/app/"]) {
  const res = await fetch(`${url}${path}`);
  const body = await res.text();
  bodies[`${url}${path}`] = body;
  if (res.status !== 200) problems.push(`${path} returned ${res.status}`);
  if (!body.includes("Basanos")) problems.push(`${path} does not mention Basanos`);
}
for (const rel of ["site/basanos/index.html", "site/basanos/app/index.html"]) {
  const p = repoPath(rel);
  if (existsSync(p)) bodies[rel] = readFileSync(p, "utf8");
}
problems.push(...sampleInBuild(bodies));
const onChain = String(await makePublicClient(rpcHttp()).readContract({ address: registry, abi: basanosRegistryAbi, functionName: "baseUrl" }));
const wrong = baseUrlProblem(certBaseUrl(url), onChain);
if (wrong) problems.push(wrong);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? `PASS deploy (${url})` : "FAIL deploy");
process.exit(problems.length === 0 ? 0 : 1);
```

- [ ] **Step 5: Type-check (ship:6 runs the check)**
Run: `npm run typecheck -w @basanos/ship`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 6: Run the test (the gate)**
Run: `npm test -w @basanos/ship -- test/sample.test.ts`
Expected: PASS — `1 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `fix(ship): the deploy check refuses the landing's sample-fixture marker`

---

### Task 11: README — the referee judges closeable equity; the demo runs at 5× (P5)

**Files:**
- Modify: `README.md`

**Depends on:** Task 5, referee:Task 14, referee:Task 15, web:Task 11, web:Task 12
**Effort:** low
**Model tier:** standard
**Provides:** `README.md (closeable equity in How it works and Roadmap; the 5x demo in Quickstart)`
**Requires:** `README.md (R1-web-app v1 + event-overlay; TBD-post-build lines for live facts)`

Why (architect ruling P5, 2026-11-12): the README is ship:5's output. It says the demo opens opposite 12x positions, and it does not say what equity the rules judge. After referee:13 to referee:15 and web:11 and web:12, the rules judge closeable equity and the demo runs at 5×. These are five exact text replacements. Every heading stays, so `check-readme` still passes; each "old" text occurs exactly once in `README.md`.

- [ ] **Step 1: Replace text 1 of 5 in README.md**

Old (exactly once in `README.md`):
```text
npx tsx packages/bot/src/demo.ts            # terminal 2: two accounts, opposite 12x positions, one PASS and one FAIL
```
New:
```text
npx tsx packages/bot/src/demo.ts            # terminal 2: two accounts, opposite 5x positions, one PASS and one FAIL
```

- [ ] **Step 2: Replace text 2 of 5 in README.md**

Old (exactly once in `README.md`):
```text
A watch gap pauses judging; the referee re-reads at head before it resumes. Money flows void a run; liquidations fail it.
```
New:
```text
A watch gap pauses judging; the referee re-reads at head before it resumes. Money flows void a run; liquidations fail it.
- **Closeable equity.** Every rule judges the equity a close would leave: the MarginBank equity revalued from the mark to the book levels that would fill the close (bids for a long, asks for a short), read in the same block, since the price watch carries the book with each snapshot. On BTC-PERP the book trades about 19 bps above the mark, so equity at the mark alone would show a fresh long an instant loss and a fresh short a phantom gain; closeable equity charges only the spread actually crossed. A position the book cannot price pauses judging.
```

- [ ] **Step 3: Replace text 3 of 5 in README.md**

Old (exactly once in `README.md`):
```text
an evidence hash of the bundle in `docs/evidence/runs.json`. PASS is checked
```
New:
```text
an evidence hash of the bundle in `docs/evidence/runs.json`; a FAIL's bundle also carries the closeable equity it was judged on and the book it was revalued at. PASS is checked
```

- [ ] **Step 4: Replace text 4 of 5 in README.md**

Old (exactly once in `README.md`):
```text
- **Replay.** The verdict page re-runs every stored read at its block; past the public RPC's history it shows the values stored on-chain.
```
New:
```text
- **Replay.** The verdict page re-runs every stored read at its block, and for a FAIL re-reads the book at the breach block to show the closeable equity the rule judged; past the public RPC's history it shows the values stored on-chain.
```

- [ ] **Step 5: Replace text 5 of 5 in README.md**

Old (exactly once in `README.md`):
```text
is not seen (gaps are logged in the evidence);
```
New:
```text
is not seen (gaps are logged in the evidence); a position the book read cannot price (an empty side, or a size beyond the 20 levels read) pauses judging for that snapshot;
```

- [ ] **Step 6: Check the schema (the gate)**
Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-readme.ps1`
Expected: PASS — `PASS`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `docs(readme): the referee judges closeable equity; the demo runs at 5x (P5)`

---

### Task 12: README — demo v2 from the replay, the one-round-trip closer, the close-gap and oracle limitations (P7)

**Files:**
- Modify: `README.md`

**Depends on:** Task 5, Task 11, referee:Task 18, referee:Task 19, referee:Task 20, referee:Task 21
**Effort:** low
**Model tier:** standard
**Provides:** `README.md (demo v2 chosen by the replay; the one-round-trip closer and the PASS lock buffer; the close-gap and Price Oracle limitations)`
**Requires:** `README.md (closeable equity in How it works and Roadmap; the 5x demo in Quickstart)`

Why (architect P7, 2026-11-12): referee:18 to referee:21 change what the README says the demo is and how the referee closes.
- **The edits:** five exact text replacements. Every heading stays, so `check-readme` still passes, and each "old" text occurs exactly once in `README.md`.
- **The limitations, stated honestly:**
  - the close gap: a FAIL can realize more than its limit, by the move between the verdict and the close;
  - the Price Oracle's Majority consensus: most verdicts carry no reading.

- [ ] **Step 1: Replace text 1 of 5 in README.md**

Old (exactly once in `README.md`):
```text
npx tsx packages/bot/src/demo.ts            # terminal 2: two accounts, opposite 5x positions, one PASS and one FAIL
```
New:
```text
npx tsx packages/bot/src/demo.ts            # terminal 2: two accounts, opposite 10x positions opened together, one PASS and one FAIL
```

- [ ] **Step 2: Replace text 2 of 5 in README.md**

Old (exactly once in `README.md`):
```text
- **Rulebook.** `rulebooks/tokyo-sprint.json` and `rulebooks/tokyo-sprint-demo.json` (the demo parameter set, labelled "Tokyo Sprint · Demo" everywhere it appears). The registry stores each rulebook's id (keccak256 of its canonical JSON) and the contract-checked fields.
```
New:
```text
- **Rulebook.** `rulebooks/tokyo-sprint.json` and `rulebooks/tokyo-sprint-demo.json` (the demo parameter set, labelled "Tokyo Sprint · Demo" everywhere it appears). The registry stores each rulebook's id (keccak256 of its canonical JSON) and the contract-checked fields. The demo's numbers come from data, not guesswork.
  - **The numbers:** a +0.50% target after 60 s, a 1.5% daily-loss floor, a 2% trailing floor and a 20-minute limit, traded at 10×.
  - **How they were chosen:** by replaying 12 hours of on-chain mark and book history through the evaluator (`packages/bot/src/demo-replay.ts`, `docs/evidence/demo-replay.json`). An opposite pair opened in the same block saw at least one PASS in 95.6% of 700 windows, against 64.7% for the first demo rulebook (`rulebooks/tokyo-sprint-demo-v1.json`, kept so its runs still resolve).
```

- [ ] **Step 3: Replace text 3 of 5 in README.md**

Old (exactly once in `README.md`):
```text
- **Close protocol.** Cancel resting orders, read the position fresh, close with an opposite-side IOC `placeOrderFor`, read back, retry at most three times, sweep. Every transaction is recorded.
```
New:
```text
- **Close protocol.** Close at once with an opposite-side IOC `placeOrderFor`, then cancel resting orders, read back, retry from fresh reads at most twice more, and sweep. Every transaction is recorded.
  - **The first close** is planned from the breach block's own position and book: capped at the best ask + 20 bps to buy or the best bid − 20 bps to sell, with the mark ladder as the fallback.
  - **It costs one round trip:** the transaction is signed locally with a tracked nonce.
  - **A PASS locks** only once closeable equity clears the target by 10 bps, so the close cannot slip back under it before the registry checks.
```

- [ ] **Step 4: Replace text 4 of 5 in README.md**

Old (exactly once in `README.md`):
```text
| `ORACLE_ENABLED` | `true` (this build): sends 0.0309 STT per PASS or FAIL verdict for a Price Oracle reading; most of it is rebated |
```
New:
```text
| `ORACLE_ENABLED` | `true` (this build): sends 0.0309 STT per PASS or FAIL verdict for a Price Oracle reading, about 98% of it rebated to the registry; best effort (see the limitations) |
```

- [ ] **Step 5: Replace text 5 of 5 in README.md**

Old (exactly once in `README.md`):
```text
replay depends on the public RPC's history, after which the page shows the stored reads.
```
New:
```text
replay depends on the public RPC's history, after which the page shows the stored reads; a FAIL's realized loss can exceed the rule's limit by the price move between the verdict and the close (in the first rehearsal, with a 7 s gap, 5 to 11 bps of equity; the closer now sends within about a second of the price push); the registry asks the Price Oracle with Majority consensus, which needs byte-identical answers, and 3 of 4 requests so far finalized Failed because the validators' answers differ in their source counts and timestamps, so most verdicts carry no oracle reading (`feedback/`).
```

- [ ] **Step 6: Check the schema (the gate)**
Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/check-readme.ps1`
Expected: PASS — `PASS`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `docs(readme): demo v2 from the replay, the one-round-trip closer, the close-gap and oracle limitations (P7)`
