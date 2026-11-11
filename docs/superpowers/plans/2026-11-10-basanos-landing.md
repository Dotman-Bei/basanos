# Basanos Landing Page Implementation Plan

**Goal:** Ship the required Basanos marketing landing page at `/` (user directive, 2026-11-10). It leads with the verdict and the certificate, renders every figure from a real run, and passes the frontend kit's own checkers.
**Architecture:**
- **Package:** `@basanos/landing` is a static page. A small build script renders `src/page.html` from `src/featured-verdict.json`, which is a copy of `docs/evidence/featured-run.json` (the Nov 12 rehearsal's first real verdict; after the money shot only `FEATURED_RUN_ID` changes).
- **Assets:** the build copies the shared design files (`@basanos/design`) and four landing-only kit files into `dist/`.
- **Truth check:** every `0x…` hash, money figure, block number and run id in the built page must exist in the snapshot.
- **Gate:** the kit's `consistency.mjs`, `check.mjs`, `perf.mjs` and `shoot.mjs`, run in place from the kit path.
**Tech Stack:** Node 22, TypeScript 6.0.3 (tsx 4.23.15), vitest 4.1.12, the frontend kit (tasteskill 2.5.0) with Chrome for its checkers (tollgate S9–S12), `@basanos/design` (tokens, `system.css`, motion).
**Source spec:** docs/superpowers/specs/2026-11-10-basanos-design.md

**Boot notes for the orchestrator:**
- **Kit access:** start the Step 2 session with
  `claude --add-dir "C:\Users\bamig\Documents\VIBE CODE\Hackathons\.claude\skills\design-taste-frontend"`
  (or `/add-dir` with that path inside the session). Tollgate S12 proves a dispatched subagent can read under it; S11 proves the checkers run from that spaced path. Task 1 copies exactly four kit files into `apps/landing/vendor/`; never copy the kit wholesale (38 MB, no licence file).
- **Files:** they stay under `apps/landing/`, except Task 6, which edits `docs/gates/submission-draft.md` (the third-party list).
- **Design (dealt by the architect; do not re-deal):**
  - Kind: software (`<html data-type="software">`, `<meta name="page-type" content="software">`, `<meta name="site-kind" content="software">`).
  - Tokens: shared with the app (`@basanos/design/tokens.css`: putty-black-teal, IBM Plex, `data-radius="sharp"`, `data-buttons="solid"`).
  - Hero: **collage** from `node <kit>/assets/layout/deal.mjs --type software --has ui`. Text on the left (span 5); the product's real window, the verdict card, on a lit ground on the right (span 6, start 7), cut by the frame's right and bottom edges; one small card over its lower-left corner.
  - Grounds dealt: topglow / dots / ruled. Moment: cursor-spotlight.
- **Rules from `docs/design/frontend.md`:**
  - The hero is alone on the first screen; one section per screen (`main > section`, one `.wrap`, the h2 first, `--h: 1`); equal edges.
  - Real product UI only: no caption under a visual, no testimonials, logos, "trusted by", usage stats, prices or customer photos, and never violet.
- **Cut order** (spec §1, amended): landing scenes and shader moments go first. Never cut, once built: the hero, its two CTAs, the three steps, and the link to a real verdict.
- **Required copy:**
  - the trust line verbatim, "Every certificate is chain-checked at mint; every verdict is replayable." (never "the contract verifies every verdict");
  - the testnet notice: Somnia Tokyo testnet, paper USDso, no real funds, no payouts, not a financial service;
  - the demo disclosure: both demo accounts operated by the builder, one human-driven, one scripted.
- **Dependencies:** no build task here depends on a human gate or on the deploy. Tasks 2, 4 and 5 read the real featured run produced by `ship:2` (the featured-run task).

---

### Task 1: Landing package, the four landing kit files, render and truth libraries

**Files:**
- Create: `apps/landing/package.json`
- Create: `apps/landing/tsconfig.json`
- Create: `apps/landing/vitest.config.ts`
- Create: `apps/landing/scripts/sync-kit.mjs`
- Create: `apps/landing/scripts/render.ts`
- Create: `apps/landing/scripts/truth.ts`
- Create: `apps/landing/vendor/system.js`
- Create: `apps/landing/vendor/layout/layout.css`
- Create: `apps/landing/vendor/layout/layout.js`
- Create: `apps/landing/vendor/layout/demo.css`
- Create: `apps/landing/vendor/manifest.json`
- Test: `apps/landing/test/render.test.ts`

**Depends on:** web:Task 1, spike:Task 1, spike:Task 3
**Effort:** medium
**Provides:** `@basanos/landing package`, `apps/landing/vendor/manifest.json (four landing kit files with sha256)`, `interface FeaturedLike { runId: string; status: string; rule: string | null; rulebook: { label: string; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number }; start: { block: string; equity: string }; end: { block: string; equity: string }; breach: { block: string; equity: string } | null; closeTxs: { hash: string; url: string }[]; verdictTx: { hash: string; url: string } | null; oracle: { price: string; sources: number } | null; links: { verdict: string; certificate: string | null }; account: string; registry: string; trustLine: string; demoDisclosure: string; testnetNotice: string }`, `pageVars(f: FeaturedLike): Record<string, string>`, `renderPage(template: string, f: FeaturedLike): string`, `findUnbacked(html: string, f: FeaturedLike): string[]`
**Requires:** `@basanos/design package (exports "./tokens.css", "./system.css", "./motion.css", "./motion.js")`, `repoPath(rel: string): string`

Applies `docs/design/frontend.md` (§4 step 5, the build: copy only the kit files the page uses). Rendering refuses an unreplaced `{{…}}`, so no template slot ever reaches the page. The truth check is what makes the landing's claims match the X posts (spec §11).

- [ ] **Step 1: Write the package files and the kit sync**

`apps/landing/package.json`:
```json
{
  "name": "@basanos/landing",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "snapshot": "tsx scripts/featured-snapshot.ts",
    "build": "tsx scripts/build.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@basanos/core": "*",
    "@basanos/design": "*"
  }
}
```

`apps/landing/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["scripts", "test"]
}
```

`apps/landing/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
```

`apps/landing/scripts/sync-kit.mjs`:
```js
// Copies exactly the four landing-only kit files and records their sha256 (the kit ships no licence file).
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = "C:\\Users\\bamig\\Documents\\VIBE CODE\\Hackathons\\.claude\\skills\\design-taste-frontend";
const FILES = [
  { from: "assets/system.js", to: "vendor/system.js" },
  { from: "assets/layout/layout.css", to: "vendor/layout/layout.css" },
  { from: "assets/layout/layout.js", to: "vendor/layout/layout.js" },
  { from: "assets/layout/demo.css", to: "vendor/layout/demo.css" },
];
const pkg = fileURLToPath(new URL("..", import.meta.url));
const files = FILES.map(({ from, to }) => {
  const dst = join(pkg, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(KIT, from), dst);
  return { from, to, sha256: createHash("sha256").update(readFileSync(dst)).digest("hex") };
});
writeFileSync(
  join(pkg, "vendor", "manifest.json"),
  `${JSON.stringify({ kit: KIT, version: "tasteskill 2.5.0", licence: "none shipped with the kit; review before the public flip", hero: "collage (assets/layout/hero-collage.html structure)", files }, null, 2)}\n`,
);
console.log(`synced ${files.length} landing kit files`);
```

- [ ] **Step 2: Copy the four kit files**
Run: `node apps/landing/scripts/sync-kit.mjs`
Expected: `synced 4 landing kit files`. An `ENOENT` on the kit path means the session lacks `--add-dir` access (tollgate S12): stop and report.

- [ ] **Step 3: Write the failing test**

`apps/landing/test/render.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { pageVars, renderPage, type FeaturedLike } from "../scripts/render";
import { findUnbacked } from "../scripts/truth";

const H = (c: string) => `0x${c.repeat(64)}`;
const f: FeaturedLike = {
  runId: "3",
  status: "Passed",
  rule: null,
  rulebook: { label: "Tokyo Sprint · Demo", profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 },
  start: { block: "46900100", equity: "1,000.00" },
  end: { block: "46900950", equity: "1,006.00" },
  breach: null,
  closeTxs: [{ hash: H("a"), url: `https://explorer.testnet.somnia.network/tokyo/tx/${H("a")}` }],
  verdictTx: { hash: H("b"), url: `https://explorer.testnet.somnia.network/tokyo/tx/${H("b")}` },
  oracle: { price: "74,510.00", sources: 3 },
  links: { verdict: "/app/#/run/3", certificate: "/app/#/cert/3" },
  account: "0x00000000000000000000000000000000000000a1",
  registry: "0x00000000000000000000000000000000000000f0",
  trustLine: "Every certificate is chain-checked at mint; every verdict is replayable.",
  demoDisclosure: "Both demo accounts are burners operated by the builder: one human-driven, one scripted.",
  testnetNotice: "Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.",
};

describe("pageVars", () => {
  it("derives every page value from the snapshot", () => {
    const v = pageVars(f);
    expect(v.runId).toBe("3");
    expect(v.headline).toBe("PASSED");
    expect(v.targetPct).toBe("+0.50%");
    expect(v.dailyPct).toBe("-0.50%");
    expect(v.trailingPct).toBe("-0.75%");
    expect(v.verdictHref).toBe("/app/#/run/3");
    expect(v.closeTxShort).toBe("0xaaaa…aaaa");
    expect(v.timeLimitMin).toBe("15");
  });
});

describe("renderPage", () => {
  it("replaces every slot and refuses an unknown one", () => {
    expect(renderPage("<h1>Run {{runId}}: {{headline}}</h1>", f)).toBe("<h1>Run 3: PASSED</h1>");
    expect(() => renderPage("<p>{{nope}}</p>", f)).toThrow(/nope/);
  });
});

describe("findUnbacked", () => {
  it("accepts hashes, figures, blocks and the run id from the snapshot", () => {
    const html = renderPage("<p>Run {{runId}} {{endEquity}} block {{endBlock}} <a href='{{closeTxUrl}}'>{{closeTxShort}}</a></p>", f);
    expect(findUnbacked(html, f)).toEqual([]);
  });
  it("flags anything the snapshot does not hold", () => {
    expect(findUnbacked(`<p>${H("c")} 2,000.00 block 47000001 Run 9</p>`, f)).toEqual([
      `hash ${H("c")}`,
      "figure 2,000.00",
      "block 47000001",
      "run 9",
    ]);
  });
});
```

- [ ] **Step 4: Run to confirm it fails**
Run: `npm install`
Expected: exits 0 (links the new workspace).
Run: `npm test -w @basanos/landing`
Expected: FAIL — `Failed to resolve import "../scripts/render"`.

- [ ] **Step 5: Write the render and truth libraries**

`apps/landing/scripts/render.ts`:
```ts
export interface FeaturedLike {
  runId: string;
  status: string;
  rule: string | null;
  rulebook: { label: string; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number };
  start: { block: string; equity: string };
  end: { block: string; equity: string };
  breach: { block: string; equity: string } | null;
  closeTxs: { hash: string; url: string }[];
  verdictTx: { hash: string; url: string } | null;
  oracle: { price: string; sources: number } | null;
  links: { verdict: string; certificate: string | null };
  account: string;
  registry: string;
  trustLine: string;
  demoDisclosure: string;
  testnetNotice: string;
}

const pct = (bps: number, sign: "+" | "-") => `${sign}${(bps / 100).toFixed(2)}%`;
const short = (h: string) => (h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

/** Every value the page shows, derived from the featured snapshot only. */
export function pageVars(f: FeaturedLike): Record<string, string> {
  const failed = f.status === "Failed";
  const close = f.closeTxs[0];
  return {
    runId: f.runId,
    label: f.rulebook.label,
    headline: failed ? `FAILED — ${f.rule ?? "rule"}` : f.status.toUpperCase(),
    statusWord: f.status.toLowerCase(),
    startEquity: f.start.equity,
    endEquity: f.end.equity,
    startBlock: f.start.block,
    endBlock: f.end.block,
    targetPct: pct(f.rulebook.profitTargetBps, "+"),
    dailyPct: pct(f.rulebook.dailyLossBps, "-"),
    trailingPct: pct(f.rulebook.trailingDrawdownBps, "-"),
    exposureX: String(f.rulebook.maxExposureX),
    minDurationSec: String(f.rulebook.minDurationSec),
    timeLimitMin: String(Math.round(f.rulebook.timeLimitSec / 60)),
    closeCount: String(f.closeTxs.length),
    closeTxShort: close ? short(close.hash) : "none",
    closeTxUrl: close ? close.url : f.links.verdict,
    verdictTxShort: f.verdictTx ? short(f.verdictTx.hash) : "pending",
    verdictTxUrl: f.verdictTx ? f.verdictTx.url : f.links.verdict,
    oracleLine: f.oracle ? `${f.oracle.price} (${f.oracle.sources} sources)` : "no reading recorded",
    resultLine: failed ? `Referee closed the position in ${f.closeTxs.length} transaction(s)` : f.links.certificate ? "Certificate minted to the account" : "Verdict recorded",
    verdictHref: f.links.verdict,
    certHref: f.links.certificate ?? f.links.verdict,
    accountShort: short(f.account),
    registryShort: short(f.registry),
    trustLine: f.trustLine,
    demoDisclosure: f.demoDisclosure,
    testnetNotice: f.testnetNotice,
  };
}

export function renderPage(template: string, f: FeaturedLike): string {
  const vars = pageVars(f);
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`unknown template slot {{${key}}}`);
    return v;
  });
}
```

`apps/landing/scripts/truth.ts`:
```ts
import type { FeaturedLike } from "./render";

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v.toLowerCase());
  else if (typeof v === "number") out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** Every hash, money figure, block number and run id in the page must come from the featured snapshot. */
export function findUnbacked(html: string, f: FeaturedLike): string[] {
  const allowed = strings(f);
  const has = (s: string) => allowed.some((a) => a.includes(s.toLowerCase()));
  const problems: string[] = [];
  for (const m of html.matchAll(/0x[0-9a-fA-F]{4,}/g)) if (!has(m[0])) problems.push(`hash ${m[0]}`);
  for (const m of html.matchAll(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b(?!%)/g)) if (!has(m[0])) problems.push(`figure ${m[0]}`);
  for (const m of html.matchAll(/\b\d{7,}\b/g)) if (!has(m[0])) problems.push(`block ${m[0]}`);
  for (const m of html.matchAll(/\bRun (\d+)\b/g)) if (m[1] !== f.runId) problems.push(`run ${m[1]}`);
  return [...new Set(problems)];
}
```

- [ ] **Step 6: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/landing`
Expected: PASS — `4 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `feat(landing): package, four kit files, render and truth libraries`

---

### Task 2: Featured snapshot for the landing (the first real verdict run)

**Files:**
- Create: `apps/landing/scripts/featured-snapshot.ts`
- Create: `apps/landing/src/featured-verdict.json`

**Depends on:** Task 1, ship:Task 2, spike:Task 1
**Effort:** low
**Provides:** `CLI: npx tsx apps/landing/scripts/featured-snapshot.ts -> writes apps/landing/src/featured-verdict.json from docs/evidence/featured-run.json`, `apps/landing/src/featured-verdict.json (the page's only data source)`
**Requires:** `docs/evidence/featured-run.json (featured run: the first real verdict from the Nov 12 rehearsal; schema basanos.featured/1)`, `interface FeaturedLike { runId: string; status: string; rule: string | null; rulebook: { label: string; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number }; start: { block: string; equity: string }; end: { block: string; equity: string }; breach: { block: string; equity: string } | null; closeTxs: { hash: string; url: string }[]; verdictTx: { hash: string; url: string } | null; oracle: { price: string; sources: number } | null; links: { verdict: string; certificate: string | null }; account: string; registry: string; trustLine: string; demoDisclosure: string; testnetNotice: string }`, `repoPath(rel: string): string`

The landing builds against the first real verdict (the Nov 12 rehearsal). After the money shot, `ship:3` re-runs this script, and the page changes with it.

- [ ] **Step 1: Write the snapshot script**

`apps/landing/scripts/featured-snapshot.ts`:
```ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { repoPath } from "@basanos/core/node";
import type { FeaturedLike } from "./render";

const f = JSON.parse(readFileSync(repoPath("docs/evidence/featured-run.json"), "utf8")) as FeaturedLike & { schema: string };
if (f.schema !== "basanos.featured/1") throw new Error("docs/evidence/featured-run.json is not a basanos.featured/1 snapshot");
const out = repoPath("apps/landing/src/featured-verdict.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(f, null, 2)}\n`);
console.log(`wrote apps/landing/src/featured-verdict.json (run ${f.runId})`);
```

- [ ] **Step 2: Copy the featured run (the gate)**
Run: `npx tsx apps/landing/scripts/featured-snapshot.ts`
Expected: PASS — `wrote apps/landing/src/featured-verdict.json (run <id>)`.

- [ ] **Step 3: Commit (kernel-performed — no agent runs this)**
Message: `feat(landing): featured snapshot from the first real verdict run`

---

### Task 3: The page — hero, three steps, real verdict, replay, testnet notice, the name

**Files:**
- Create: `apps/landing/src/page.html`
- Create: `apps/landing/src/landing.css`
- Create: `apps/landing/scripts/build.ts`
- Create: `apps/landing/scripts/oracle-row.ts`
- Test: `apps/landing/test/page.test.ts`

**Depends on:** Task 1, Task 2, web:Task 1, spike:Task 1
**Effort:** high
**Provides:** `apps/landing/src/page.html (the template)`, `CLI: npm run build -w @basanos/landing (render from the featured snapshot, then the truth check)`, `apps/landing/dist/index.html (+ assets/ and img/)`, `withOracleRow(template: string, f: FeaturedLike): string (the Price Oracle row only with a real reading)`
**Requires:** `renderPage(template: string, f: FeaturedLike): string`, `findUnbacked(html: string, f: FeaturedLike): string[]`, `apps/landing/src/featured-verdict.json (the page's only data source)`, `@basanos/design package (exports "./tokens.css", "./system.css", "./motion.css", "./motion.js")`, `apps/landing/vendor/manifest.json (four landing kit files with sha256)`, `repoPath(rel: string): string`

Applies `docs/design/frontend.md` (§1 kind = software; §2 tech plan; house rules 1–9; checklist §5):
- **Hero:** the dealt collage, from the kit's `assets/layout/hero-collage.html` structure (`hero hero--collage`, `hero__text span-5`, `hero__art span-6 start-7`, `ly-piece--main d-win`, `ly-piece--note d-card`). Its window shows the real verdict as live HTML.
- **Copy (`copy.md`):** the h1 names the category and the buyer; the proof line is a hard fact from the run; every heading has a noun; buttons are a verb plus an object.
- **Buttons:** one `.btn--primary` per screen; `.btn--xl` once, in the type close.
- **Imagery:** no caption under any image; the only picture besides the live window is the real verdict page screenshot from Task 4.

- [ ] **Step 1: Write the failing test**

`apps/landing/test/page.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withOracleRow } from "../scripts/oracle-row";
import { renderPage, type FeaturedLike } from "../scripts/render";
import { findUnbacked } from "../scripts/truth";

const template = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const f = JSON.parse(readFileSync(new URL("../src/featured-verdict.json", import.meta.url), "utf8")) as FeaturedLike;
const html = renderPage(withOracleRow(template, f), f);

describe("landing page", () => {
  it("declares the software kind and the dealt design", () => {
    expect(html).toContain('<html lang="en" data-type="software" data-radius="sharp" data-buttons="solid"');
    expect(html).toContain('<meta name="page-type" content="software">');
    expect(html).toContain('<meta name="site-kind" content="software">');
    expect(html).toContain('class="hero hero--collage"');
  });
  it("leads with the category, the two CTAs and a real verdict", () => {
    expect(html).toContain("<h1 id=\"hero-h\">Prop-firm challenges for dreamDEX perps traders</h1>");
    expect(html).toContain('href="/app/#/challenge"');
    expect(html).toContain(`href="${f.links.verdict}"`);
    expect(html).toContain(`Run ${f.runId}`);
  });
  it("has the three steps, replay, the testnet notice, the disclosure and the trust line", () => {
    for (const h of ["Rulebook, referee, verdict", "A real verdict from Somnia Tokyo testnet", "Replay any verdict", "Testnet only, paper USDso", "Basanos, the touchstone"]) {
      expect(html).toContain(h);
    }
    expect(html).toContain("Every certificate is chain-checked at mint; every verdict is replayable.");
    expect(html).toContain(f.testnetNotice);
    expect(html).toContain(f.demoDisclosure);
    expect(html.toLowerCase()).not.toContain("verifies every verdict");
    expect(html.toLowerCase()).not.toContain("trusted by");
    // The Price Oracle row appears only when the featured snapshot holds a real reading (truth by construction).
    const none = { ...f, oracle: null };
    expect(renderPage(withOracleRow(template, none), none)).not.toMatch(/Somnia Agents|Price Oracle/);
    const reading = { ...f, oracle: { price: "73,735.85", sources: 6 } };
    expect(renderPage(withOracleRow(template, reading), reading)).toContain("73,735.85 (6 sources)");
  });
  it("shows nothing the snapshot does not hold", () => {
    expect(findUnbacked(html, f)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/landing -- test/page.test.ts`
Expected: FAIL — `ENOENT … src/page.html`.

- [ ] **Step 3: Write the template**

`apps/landing/src/page.html`:
```html
<!doctype html>
<html lang="en" data-type="software" data-radius="sharp" data-buttons="solid" data-ground="sand" data-motion>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="page-type" content="software">
<meta name="site-kind" content="software">
<title>Basanos — prop-firm challenges for dreamDEX perps</title>
<meta name="description" content="A published rulebook, a referee that closes on a breach, and a verdict anyone can replay. Somnia Tokyo testnet, paper USDso.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wdth,wght@85..100,400..700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/system.css">
<link rel="stylesheet" href="assets/motion/motion.css">
<link rel="stylesheet" href="assets/layout/layout.css">
<link rel="stylesheet" href="assets/layout/demo.css">
<link rel="stylesheet" href="assets/tokens.css">
<link rel="stylesheet" href="assets/landing.css">
<script>document.documentElement.classList.add('mo-js');setTimeout(()=>document.documentElement.classList.add('mo-safe'),2500)</script>
</head>
<body>
<header class="nav">
  <div class="wrap">
    <a class="nav__logo" href="#top"><span class="mark" data-mark="ring" aria-hidden="true"></span>Basanos</a>
    <nav class="nav__links" aria-label="Main">
      <div class="nav__item"><a class="nav__link" href="#steps">Rulebook</a></div>
      <div class="nav__item"><a class="nav__link" href="#verdict">Verdict</a></div>
      <div class="nav__item"><a class="nav__link" href="#replay">Replay</a></div>
      <div class="nav__item"><a class="nav__link" href="#testnet">Testnet</a></div>
    </nav>
    <div class="nav__actions">
      <a class="btn btn--primary" href="/app/#/challenge">Take a challenge</a>
    </div>
  </div>
</header>
<main id="top">
  <section class="hero hero--collage" aria-labelledby="hero-h">
    <div class="wrap"><div class="hero-text grid hero__grid">
      <div class="hero__text span-5">
        <h1 id="hero-h">Prop-firm challenges for dreamDEX perps traders</h1>
        <p class="hero__lead">Take a published rulebook on your perps account. A referee closes it on a breach, and the verdict lands on-chain, with a certificate on a pass. {{trustLine}}</p>
        <div class="btn-row"><a class="btn btn--primary" href="/app/#/challenge">Take a challenge</a><a class="btn btn--secondary" href="{{verdictHref}}">Replay a real verdict</a></div>
        <p class="hero__proof">Run {{runId}} on {{label}}: {{headline}} at block {{endBlock}}, Somnia Tokyo testnet.</p>
      </div>
      <div class="hero__art span-6 start-7" role="img" aria-label="The Basanos verdict for run {{runId}}: {{headline}}, start equity {{startEquity}} and end equity {{endEquity}} paper USDso">
        <div class="ly-piece ly-piece--main d-win" aria-hidden="true">
          <div class="d-win__bar"><span class="d-win__dots"><i></i><i></i><i></i></span><span>Basanos · Run {{runId}} · {{label}}</span></div>
          <div class="d-win__body">
            <div class="d-side">
              <span><i></i>Terminal</span><span class="is-on"><i></i>Verdict</span><span><i></i>Certificate</span>
              <span class="d-side__label">Rulebook</span><span><i></i>{{label}}</span>
            </div>
            <div class="d-main">
              <div class="d-main__head"><h4>{{headline}}</h4><span class="d-btn">Replay</span></div>
              <div class="d-tabs"><span class="is-on">Reads</span><span>Rules</span><span>Transactions</span></div>
              <div class="d-rows">
                <div class="d-row"><span class="d-thumb"></span><div><b>Start equity</b><small>read by the registry · block {{startBlock}}</small></div><span class="num">{{startEquity}}</span><span class="d-chip">Chain-checked</span></div>
                <div class="d-row"><span class="d-thumb"></span><div><b>End equity</b><small>read by the registry · block {{endBlock}}</small></div><span class="num">{{endEquity}}</span><span class="d-chip">Chain-checked</span></div>
                <div class="d-row"><span class="d-thumb"></span><div><b>Profit target</b><small>contract-checked at mint</small></div><span class="num">{{targetPct}}</span><span class="d-chip">Rule</span></div>
                <div class="d-row"><span class="d-thumb"></span><div><b>Daily-loss floor</b><small>referee-enforced, replayable</small></div><span class="num">{{dailyPct}}</span><span class="d-chip">Rule</span></div>
                <!-- oracle-row --><div class="d-row"><span class="d-thumb"></span><div><b>Price Oracle at the verdict</b><small>Somnia Agents · recorded on-chain</small></div><span class="num">{{oracleLine}}</span><span class="d-chip">Cross-check</span></div><!-- /oracle-row -->
              </div>
            </div>
          </div>
        </div>
        <div class="ly-piece ly-piece--note d-card" aria-hidden="true">
          <div class="d-card__row"><h5>Run {{runId}}</h5><span class="d-chip">{{headline}}</span></div>
          <div class="d-note__line"><i>✓</i><span><b>{{resultLine}}</b></span></div>
          <div class="d-note__line"><i>✓</i><span>Verdict tx <b>{{verdictTxShort}}</b></span></div>
        </div>
      </div>
    </div></div>
  </section>

  <section id="steps" style="--h: 1" aria-labelledby="steps-h">
    <div class="wrap">
      <h2 id="steps-h">Rulebook, referee, verdict</h2>
      <div class="grid landing-cards">
        <article class="card span-4">
          <h3>A published rulebook</h3>
          <p>{{label}}: a {{targetPct}} target after {{minDurationSec}} s, a {{dailyPct}} daily floor, a {{trailingPct}} trailing floor and exposure under {{exposureX}}x equity, within {{timeLimitMin}} minutes. Its id is the hash of its JSON.</p>
        </article>
        <article class="card span-4">
          <h3>A referee that can only close</h3>
          <p>The account grants the referee place and cancel on BTC-PERP, never withdraw. It watches every price write with Somnia Reactivity and closes the position with real perps orders on a breach.</p>
        </article>
        <article class="card span-4">
          <h3>A verdict and a certificate</h3>
          <p>The registry reads the start and end equity itself. A pass mints a non-transferable certificate only after the chain shows the target was met. {{trustLine}}</p>
        </article>
      </div>
    </div>
  </section>

  <section id="verdict" style="--h: 1" aria-labelledby="verdict-h">
    <div class="wrap">
      <h2 id="verdict-h">A real verdict from Somnia Tokyo testnet</h2>
      <div class="grid">
        <div class="span-7"><div class="frame landing-shot"><img src="img/verdict.png" alt="The Basanos verdict page for run {{runId}}" width="1440" height="900"></div></div>
        <div class="span-5">
          <dl class="rows">
            <div><dt>Run</dt><dd>Run {{runId}} on {{label}}</dd></div>
            <div><dt>Result</dt><dd>{{headline}}</dd></div>
            <div><dt>Equity</dt><dd>{{startEquity}} to {{endEquity}} paper USDso</dd></div>
            <div><dt>Referee closes</dt><dd>{{closeCount}}, first <a class="link" href="{{closeTxUrl}}">{{closeTxShort}}</a></dd></div>
            <div><dt>Verdict transaction</dt><dd><a class="link" href="{{verdictTxUrl}}">{{verdictTxShort}}</a></dd></div>
          </dl>
          <div class="btn-row"><a class="btn btn--primary" href="{{verdictHref}}">Open the verdict</a></div>
        </div>
      </div>
    </div>
  </section>

  <section id="replay" style="--h: 1" aria-labelledby="replay-h">
    <div class="wrap">
      <h2 id="replay-h">Replay any verdict</h2>
      <p class="measure">Every stored read names its block. The verdict page re-runs the same calls at that block on the public Somnia RPC and shows whether the chain still agrees; once the RPC no longer serves that block, it shows the values stored on-chain.</p>
      <dl class="rows">
        <div><dt>MarginBank.tryGetAccountEquity(account)</dt><dd>equity</dd></div>
        <div><dt>MarginBank.getAccountState(account)</dt><dd>locked collateral</dd></div>
        <div><dt>MarginBank.getPosition(account, pool)</dt><dd>position size</dd></div>
        <div><dt>PerpPool.tryGetMarkPrice()</dt><dd>mark price</dd></div>
      </dl>
      <div class="btn-row"><a class="btn btn--primary" href="{{verdictHref}}">Replay run {{runId}}</a></div>
    </div>
  </section>

  <section id="testnet" style="--h: 1" aria-labelledby="testnet-h">
    <div class="wrap">
      <h2 id="testnet-h">Testnet only, paper USDso</h2>
      <p class="measure">{{testnetNotice}}</p>
      <p class="measure">{{demoDisclosure}}</p>
      <p class="measure">Path rules are enforced by the referee and shown by replay; they are not checked by the contract. A pause in the referee's watch pauses judging. The known limits are listed in the README.</p>
    </div>
  </section>

  <section id="name" style="--h: 1" aria-labelledby="name-h">
    <div class="wrap">
      <h2 id="name-h">Basanos, the touchstone</h2>
      <p class="measure">Basanos is the Greek word for the touchstone, the dark stone a metal was rubbed on to test its purity against a known standard. A Basanos challenge works the same way: a fixed, published standard, an impartial judge, and a result anyone can test again.</p>
    </div>
  </section>
</main>
<footer class="closing">
  <div class="wrap">
    <h2 class="closing__title">Take the Tokyo Sprint</h2>
    <div class="btn-row"><a class="btn btn--primary btn--xl" href="/app/#/challenge">Take a challenge</a></div>
    <p class="legal">Basanos · 2026 · Somnia Tokyo testnet · <a class="link" href="https://github.com/Dotman-Bei/basanos">Source on GitHub</a></p>
  </div>
</footer>
<script type="module" src="assets/system.js"></script>
<script type="module" src="assets/layout/layout.js"></script>
<script type="module" src="assets/motion/motion.js"></script>
</body>
</html>
```

`apps/landing/src/landing.css`:
```css
/* Page CSS only where the kit allows it (docs/design/frontend.md §4 step 5): the screenshot frame and card spacing. */
.landing-cards { margin-top: var(--s-7, 48px); }
.landing-shot { overflow: hidden; border: 1px solid color-mix(in srgb, var(--p-ink) 13%, transparent); border-radius: var(--r-lg, 8px); }
.landing-shot img { display: block; width: 100%; height: auto; }
.rows dt { font-size: 13px; font-weight: 500; color: var(--p-muted); }
.rows dd { margin: 0 0 var(--s-3, 12px); font-size: 16px; overflow-wrap: anywhere; }
.legal { font-size: 13px; color: var(--p-muted); margin-top: var(--s-6, 32px); }
```

- [ ] **Step 4: Write the build script**

`apps/landing/scripts/oracle-row.ts`:
```ts
// The Price Oracle row shows only when the featured-run snapshot holds a real reading (truth by construction).
import type { FeaturedLike } from "./render";

const ROW = /[ \t]*<!-- oracle-row -->[\s\S]*?<!-- \/oracle-row -->\n?/;

export function withOracleRow(template: string, f: FeaturedLike): string {
  return f.oracle ? template.replace(/<!-- \/?oracle-row -->/g, "") : template.replace(ROW, "");
}
```

`apps/landing/scripts/build.ts`:
```ts
// Renders dist/index.html from the template and the featured snapshot, copies the design and kit files,
// then refuses to finish if the page shows anything the snapshot does not hold.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoPath } from "@basanos/core/node";
import { withOracleRow } from "./oracle-row";
import { renderPage, type FeaturedLike } from "./render";
import { findUnbacked } from "./truth";

const app = repoPath("apps/landing");
const dist = join(app, "dist");
const f = JSON.parse(readFileSync(join(app, "src", "featured-verdict.json"), "utf8")) as FeaturedLike;
const html = renderPage(withOracleRow(readFileSync(join(app, "src", "page.html"), "utf8"), f), f);
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
```

- [ ] **Step 5: Run the page tests (the gate)**
Run: `npm test -w @basanos/landing -- test/page.test.ts`
Expected: PASS — `4 passed`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(landing): collage hero, three steps, real verdict, replay, testnet notice and the name`

---

### Task 4: Screenshot of the real verdict page for the featured run

**Files:**
- Create: `apps/landing/scripts/shoot-verdict.mjs`
- Create: `apps/landing/src/img/verdict.png`

**Depends on:** Task 2, Task 3, web:Task 2, web:Task 7, web:Task 8, web:Task 9
**Effort:** medium
**Provides:** `apps/landing/src/img/verdict.png (1440x900 shoot.mjs screenshot of /app/#/run/<featured id>, real product UI)`, `CLI: node apps/landing/scripts/shoot-verdict.mjs <runId> <registry> <referee>`
**Requires:** `apps/landing/src/featured-verdict.json (the page's only data source)`, `CLI: npm run build -w @basanos/web (check-env, then vite build)`, `apps/web/dist (static build served at /app/)`

This is real product UI: the app's own verdict page for the featured run, read live from Hideki and shot by the kit's `shoot.mjs`. Every figure in the image belongs to that run (spec §11). Taking a screenshot of the terminal itself would need the account's key in the browser, so the landing uses the verdict page. It shows the same run's numbers and is the page the X posts link to.

- [ ] **Step 1: Write the screenshot script**

`apps/landing/scripts/shoot-verdict.mjs`:
```js
// Builds the app for the featured run's registry, serves it with vite preview, and shoots /app/#/run/<id> with the kit's shoot.mjs.
// Usage: node apps/landing/scripts/shoot-verdict.mjs <runId> <registryAddress> <refereeAddress>
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [runId, registry, referee] = process.argv.slice(2);
if (!runId || !registry || !referee) {
  console.error("usage: shoot-verdict.mjs <runId> <registry> <referee>");
  process.exit(2);
}
const KIT = "C:\\Users\\bamig\\Documents\\VIBE CODE\\Hackathons\\.claude\\skills\\design-taste-frontend";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = fileURLToPath(new URL("../src/img/verdict.png", import.meta.url));
const env = { ...process.env, VITE_REGISTRY_ADDRESS: registry, VITE_REFEREE_ADDRESS: referee };
const build = spawnSync("npm", ["run", "build", "-w", "@basanos/web"], { cwd: root, env, stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const preview = spawn("npx", ["vite", "preview", "--port", "4317", "--strictPort"], { cwd: `${root}apps/web`, env, shell: true });
await new Promise((r) => setTimeout(r, 4_000));
const shot = spawnSync(
  "node",
  [`${KIT}\\scripts\\shoot.mjs`, "--url", `http://127.0.0.1:4317/app/#/run/${runId}`, "--w", "1440", "--h", "900", "--wait", "6000", "--out", out, "--no-tiles"],
  { stdio: "inherit" },
);
preview.kill();
spawnSync("taskkill", ["/pid", String(preview.pid), "/t", "/f"], { stdio: "ignore" });
console.log(shot.status === 0 ? `saved ${out}` : "shoot failed");
process.exit(shot.status ?? 1);
```

- [ ] **Step 2: Shoot the featured run's verdict page (the gate)**
Read the run id from `apps/landing/src/featured-verdict.json` (`runId`), the registry from `deployments/hideki.json` (`registry`), and the referee address from `.env` (`REFEREE_ADDRESS`).
Run: `node apps/landing/scripts/shoot-verdict.mjs <runId> <registry> <referee>`
Expected: PASS — the kit prints `saved …apps\landing\src\img\verdict.png (1440x900, …)` and the script ends with `saved …verdict.png`. Open the image and confirm it shows run `<runId>` with its real figures. A "Reading run …" placeholder means the page had no time to load: re-run with a longer `--wait` (edit the 6000).

- [ ] **Step 3: Commit (kernel-performed — no agent runs this)**
Message: `feat(landing): real verdict page screenshot for the featured run`

---

### Task 5: The kit's checkers pass on the built landing (the gate)

**Files:**
- Create: `apps/landing/scripts/run-checkers.mjs`
- Modify: `apps/landing/src/page.html`
- Modify: `apps/landing/src/landing.css`

**Depends on:** Task 3, Task 4
**Effort:** high
**Provides:** `landing checkers PASS (consistency, check, perf, shoot at 1440/1024/820/768/390)`, `CLI: node apps/landing/scripts/run-checkers.mjs`
**Requires:** `CLI: npm run build -w @basanos/landing (render from the featured snapshot, then the truth check)`, `apps/landing/src/img/verdict.png (1440x900 shoot.mjs screenshot of /app/#/run/<featured id>, real product UI)`, `apps/landing/src/page.html (the template)`

Applies `docs/design/frontend.md` §4 step 6 and the §5 checklist. The kit's checkers are the gate, and every `check.mjs` finding fails the page.
- **Fixing findings:** only `page.html` and `landing.css` may change. Never edit kit files to clear a check; a check that flags a kit file is reported instead.
- **Truth:** a fix must keep the truth check passing, so every figure still comes from the snapshot.
- **Timebox: 3 hours.** If the gate still fails after that, apply the cut order: remove the hero's `data-ground` lit ground and any moment markup first, re-run, and report every remaining FAIL with its reason. Never cut the hero, its two CTAs, the three steps or the link to a real verdict.

- [ ] **Step 1: Write the checker runner**

`apps/landing/scripts/run-checkers.mjs`:
```js
// Runs the frontend kit's checkers in place (the kit path contains a space; arguments are passed as arrays).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT = "C:\\Users\\bamig\\Documents\\VIBE CODE\\Hackathons\\.claude\\skills\\design-taste-frontend";
const page = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const shots = fileURLToPath(new URL("../shots/", import.meta.url));
const runs = [
  ["consistency", [`${KIT}\\scripts\\consistency.mjs`, page, "--widths", "1440,1024,820,768,390", "--rhythm-widths", "1440,820,768,390", "--page", "software", "--category", "Prop-firm challenges for dreamDEX perps", "--primary", "Take a challenge"]],
  ["layout check", [`${KIT}\\assets\\layout\\check.mjs`, "--url", page, "--sizes", "1440x900,1024x768,820x1180,768x1024,390x844", "--shots", `${shots}layout`]],
  ["perf", [`${KIT}\\scripts\\perf.mjs`, page]],
  ["shoot 1440", [`${KIT}\\scripts\\shoot.mjs`, "--url", page, "--w", "1440", "--out", `${shots}1440.png`]],
  ["shoot 390", [`${KIT}\\scripts\\shoot.mjs`, "--url", page, "--w", "390", "--out", `${shots}390.png`]],
];
const failed = [];
for (const [name, args] of runs) {
  console.log(`--- ${name}`);
  const r = spawnSync("node", args, { stdio: "inherit" });
  if (r.status !== 0) failed.push(name);
}
console.log(failed.length === 0 ? "PASS landing checkers" : `FAIL landing checkers: ${failed.join(", ")}`);
process.exit(failed.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Build the page**
Run: `npm run build -w @basanos/landing`
Expected: `PASS truth (run <id>); built apps/landing/dist`.

- [ ] **Step 3: Run the checkers and fix every FAIL in `page.html` / `landing.css`**
Run: `node apps/landing/scripts/run-checkers.mjs`
For every FAIL row: fix the template or the page CSS (section heights `--h`, equal edges, heading scale, button count, contrast), rebuild with `npm run build -w @basanos/landing`, and re-run. Read the shots in `apps/landing/shots/` against the frontend.md checklist.

- [ ] **Step 4: Final run (the gate)**
Run: `node apps/landing/scripts/run-checkers.mjs`
Expected: PASS — `PASS landing checkers`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(landing): the kit's consistency, layout, perf and screenshot checks pass`

---

### Task 6: List the third-party kit files in the submission draft

**Files:**
- Modify: `docs/gates/submission-draft.md`

**Depends on:** Task 1, web:Task 1
**Effort:** low
**Provides:** `docs/gates/submission-draft.md third-party assets list (seven kit files with paths and sha256, plus docs/design/frontend.md)`
**Requires:** `apps/landing/vendor/manifest.json (four landing kit files with sha256)`, `packages/design/vendor/manifest.json (kit path, tasteskill version, sha256 per vendored file)`

The directive says to list every copied kit file under third-party assets. This replaces the draft's `TBD-post-build:landing-third-party-asset-list` line.

- [ ] **Step 1: Replace the TBD line with the list**
In `docs/gates/submission-draft.md`, under `## Third-party assets`, replace the single line `TBD-post-build:landing-third-party-asset-list` with:
```markdown
| Repo path | Kit source (tasteskill 2.5.0) | Used by |
|---|---|---|
| `packages/design/vendor/system.css` | `assets/system.css` | app + landing |
| `packages/design/vendor/motion/motion.css` | `assets/motion/motion.css` | app + landing |
| `packages/design/vendor/motion/motion.js` | `assets/motion/motion.js` | app + landing |
| `apps/landing/vendor/system.js` | `assets/system.js` | landing |
| `apps/landing/vendor/layout/layout.css` | `assets/layout/layout.css` | landing (collage hero) |
| `apps/landing/vendor/layout/layout.js` | `assets/layout/layout.js` | landing |
| `apps/landing/vendor/layout/demo.css` | `assets/layout/demo.css` | landing (window UI) |
| `docs/design/frontend.md` | `SKILL.md` (the skill's own instructions, copied verbatim) | the design rules every UI task cites |

The landing's hero markup follows the kit's `assets/layout/hero-collage.html` structure. sha256 of each copy: `packages/design/vendor/manifest.json` and `apps/landing/vendor/manifest.json`. The kit ships no licence file: review before the public flip.
```

- [ ] **Step 2: Check the list (the gate)**
Run: `node -e "const t=require('fs').readFileSync('docs/gates/submission-draft.md','utf8'); const need=['packages/design/vendor/system.css','apps/landing/vendor/layout/demo.css','hero-collage.html','docs/design/frontend.md']; const miss=need.filter(n=>!t.includes(n)); if(miss.length||t.includes('TBD-post-build:landing-third-party-asset-list')){console.log('FAIL', miss); process.exit(1)} console.log('PASS third-party list')"`
Expected: PASS — `PASS third-party list`.

- [ ] **Step 3: Commit (kernel-performed — no agent runs this)**
Message: `docs(gates): list the third-party frontend-kit files in the submission draft`
