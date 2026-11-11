# Basanos Web App Implementation Plan

**Goal:** Build the Basanos web app at `/app/`: the challenge terminal (`#/challenge`), the public verdict page with replay (`#/run/:id`), the certificate page (`#/cert/:id`), and a recent-verdicts home (`#/`). All UI follows `docs/design/frontend.md`.
**Architecture:**
- **Design package:** `@basanos/design` vendors the three frontend-kit files the app and landing actually use, plus the dealt `:root` tokens, so both apps share one token set.
- **App:** `@basanos/web` is React 19 + Vite. A tiny hash router keeps it a static site.
- **Signing:** writes are signed in the browser by the in-browser challenge wallet (a testnet burner key in `sessionStorage`), with viem calls built from pure call descriptors.
- **Reads:** they use the same Multicall3 snapshot as the referee.
- **Replay:** it re-runs a verdict's stored calls at their pinned blocks.

No build task depends on a human gate or on the deploy.
**Tech Stack:** React 19.1.10, react-dom 19.1.10, Vite 8.3.5, @vitejs/plugin-react 6.1.2, vitest 4.1.12 + jsdom 30.1.3 + @testing-library/react 16.3.3 + @testing-library/dom 10.4.2, @types/react 19.3.0, @types/react-dom 19.3.0, viem 2.57.12, TypeScript 6.0.3. Fonts: IBM Plex Sans + IBM Plex Mono (Google Fonts).
**Source spec:** docs/superpowers/specs/2026-11-10-basanos-design.md

**Boot notes for the orchestrator:**
- **Frontend kit access:** the kit lives outside the repo, at `C:\Users\bamig\Documents\VIBE CODE\Hackathons\.claude\skills\design-taste-frontend` (the path contains a space). Start the Step 2 session with
  `claude --add-dir "C:\Users\bamig\Documents\VIBE CODE\Hackathons\.claude\skills\design-taste-frontend"`
  (or `/add-dir` with that path inside the session). Tollgate row S12 proves a dispatched subagent can read under it. Task 1 is the only task that reads the kit: it copies exactly three files (`assets/system.css`, `assets/motion/motion.css`, `assets/motion/motion.js`) into `packages/design/vendor/`. Never copy the kit wholesale (38 MB, no licence file).
- **Design deal (done by the architect; do not re-deal):** `node <kit>/scripts/start.mjs css --page software --palette putty-black-teal --type plex --radius sharp`. Palette: putty and black with a teal accent `#256f82`, no violet. Type: IBM Plex Sans + IBM Plex Mono. Radius: `sharp` (the skill's rule for fintech and developer tools). Buttons: `data-buttons="solid"`. Task 1 writes the printed `:root` block verbatim into `packages/design/tokens.css`.
- **App rules from `frontend.md` / `system.md`:**
  - **Kind:** software (an app, so tokens, type, layout and components only: no hero scenes or effects).
  - **Buttons and links:** one filled `.btn.btn--primary` per view; secondaries `.btn.btn--secondary`; text links `.link`.
  - **Text:** body 16px; labels 13px at weight 500; sentence case.
  - **Colour:** 90–95% neutral, with the accent only on the primary button, links, focus and state marks.
  - **Edges and copy:** equal left and right edges via `.wrap`; no caption under a visual.
- **Shared with the referee:** the trust line appears verbatim on the verdict page: "Every certificate is chain-checked at mint; every verdict is replayable." Never write "the contract verifies every verdict".
- The web build never contains a key. `scripts/check-env.mjs` fails the build if any `VITE_*` name ends in `_PK`.

---

### Task 1: `@basanos/design` — vendored kit files and the dealt tokens

**Files:**
- Create: `packages/design/package.json`
- Create: `packages/design/tokens.css`
- Create: `packages/design/scripts/sync-kit.mjs`
- Create: `packages/design/scripts/check-kit.mjs`
- Create: `packages/design/vendor/system.css`
- Create: `packages/design/vendor/motion/motion.css`
- Create: `packages/design/vendor/motion/motion.js`
- Create: `packages/design/vendor/manifest.json`

**Depends on:** spike:Task 1
**Effort:** low
**Provides:** `@basanos/design package (exports "./tokens.css", "./system.css", "./motion.css", "./motion.js")`, `packages/design/vendor/manifest.json (kit path, tasteskill version, sha256 per vendored file)`, `dealt tokens: --p-bg #dedad3, --p-surface #d3cec6, --p-ink #0a0a0a, --p-muted #55514c, --p-accent #256f82, IBM Plex Sans / IBM Plex Mono, data-radius="sharp", data-buttons="solid"`
**Requires:** `npm workspaces root (packages/*, apps/*)`

Applies `docs/design/frontend.md` (§3 "Tokens, grid, buttons, nav, footer, colour" → `system.css`; §4 step 4, the deal). This task reads the kit through the `--add-dir` path.

- [ ] **Step 1: Write the package, the tokens and the scripts**

`packages/design/package.json`:
```json
{
  "name": "@basanos/design",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tokens.css": "./tokens.css",
    "./system.css": "./vendor/system.css",
    "./motion.css": "./vendor/motion/motion.css",
    "./motion.js": "./vendor/motion/motion.js"
  },
  "scripts": {
    "sync": "node scripts/sync-kit.mjs",
    "test": "node scripts/check-kit.mjs"
  }
}
```

`packages/design/tokens.css`:
```css
/* Dealt by the frontend kit (tasteskill 2.5.0), docs/design/frontend.md §4 step 4:
   node <kit>/scripts/start.mjs css --page software --palette putty-black-teal --type plex --radius sharp
   Use with <html lang="en" data-radius="sharp" data-buttons="solid"> and the IBM Plex Google Fonts link. */
:root {
  --p-bg: #dedad3; --p-surface: #d3cec6; --p-ink: #0a0a0a; --p-muted: #55514c;
  --p-accent: #256f82; --p-accent-ink: #ffffff; --p-action: #256f82; --p-action-ink: #ffffff;
  --p-inv-bg: #0a0a0a; --p-inv-surface: #151515; --p-inv-ink: #dedad3; --p-inv-muted: #84827e;
  --p-inv-accent: #256f82; --p-inv-accent-ink: #ffffff; --p-inv-action: #256f82; --p-inv-action-ink: #ffffff;
  --font-display: "IBM Plex Sans", system-ui, sans-serif;
  --font-text: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  --display-weight: 500;
  --display-tracking: -0.025em;
  --display-tracking-xl: -0.035em;
  --ly-scale: 0.98;
}
```

`packages/design/scripts/sync-kit.mjs`:
```js
// Copies exactly the kit files Basanos uses into packages/design/vendor and records their sha256.
// The kit is outside the repo and has no licence file: never copy more than this list.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const KIT = "C:\\Users\\bamig\\Documents\\VIBE CODE\\Hackathons\\.claude\\skills\\design-taste-frontend";
export const FILES = [
  { from: "assets/system.css", to: "vendor/system.css" },
  { from: "assets/motion/motion.css", to: "vendor/motion/motion.css" },
  { from: "assets/motion/motion.js", to: "vendor/motion/motion.js" },
];
const pkg = fileURLToPath(new URL("..", import.meta.url));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const files = FILES.map(({ from, to }) => {
  const src = join(KIT, from);
  const dst = join(pkg, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  return { from, to, sha256: sha(dst) };
});
writeFileSync(
  join(pkg, "vendor", "manifest.json"),
  `${JSON.stringify({ kit: KIT, version: "tasteskill 2.5.0", licence: "none shipped with the kit; review before the public flip", files }, null, 2)}\n`,
);
console.log(`synced ${files.length} kit files`);
```

`packages/design/scripts/check-kit.mjs`:
```js
// The vendored files must match the sha256 recorded at sync time, and tokens.css must carry the dealt palette.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
const manifestPath = join(pkg, "vendor", "manifest.json");
if (!existsSync(manifestPath)) problems.push("vendor/manifest.json is missing (run npm run sync -w @basanos/design)");
else {
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (m.files.length !== 3) problems.push(`expected 3 vendored files, found ${m.files.length}`);
  for (const f of m.files) {
    const p = join(pkg, f.to);
    if (!existsSync(p)) problems.push(`${f.to} is missing`);
    else if (createHash("sha256").update(readFileSync(p)).digest("hex") !== f.sha256) problems.push(`${f.to} differs from the synced copy`);
  }
}
const tokens = readFileSync(join(pkg, "tokens.css"), "utf8");
for (const t of ["--p-accent: #256f82", "--p-bg: #dedad3", '"IBM Plex Sans"', '"IBM Plex Mono"']) {
  if (!tokens.includes(t)) problems.push(`tokens.css lacks ${t}`);
}
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? "PASS design kit" : "FAIL design kit");
process.exit(problems.length === 0 ? 0 : 1);
```

- [ ] **Step 2: Copy the three kit files**
Run: `node packages/design/scripts/sync-kit.mjs`
Expected: `synced 3 kit files`; it creates `packages/design/vendor/system.css`, `vendor/motion/motion.css`, `vendor/motion/motion.js` and `vendor/manifest.json`. If it fails with `ENOENT` on the kit path, the session lacks `--add-dir` access (tollgate S12): stop and report; don't copy kit files by any other route.

- [ ] **Step 3: Check the vendored files and tokens (the gate)**
Run: `npm test -w @basanos/design`
Expected: PASS — `PASS design kit`.

- [ ] **Step 4: Commit (kernel-performed — no agent runs this)**
Message: `feat(design): vendor three frontend-kit files and the dealt Basanos tokens`

---

### Task 2: Web app scaffold — Vite, router, env guard, shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/scripts/check-env.mjs`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/app.css`
- Create: `apps/web/src/routes.ts`
- Create: `apps/web/src/config.ts`
- Create: `apps/web/src/vite-env.d.ts`
- Test: `apps/web/test/routes.test.ts`
- Test: `apps/web/test/check-env.test.ts`

**Depends on:** Task 1, spike:Task 2
**Effort:** medium
**Model tier:** top
**Provides:** `@basanos/web package (Vite base "/app/", hash routes)`, `type Route = { name: "home" } | { name: "challenge" } | { name: "run"; runId: bigint } | { name: "cert"; runId: bigint }`, `parseRoute(hash: string): Route`, `routeHref(r: Route): string`, `useRoute(): Route`, `REGISTRY: Address | null`, `REFEREE: Address | null`, `findSecretVars(env: Record<string, string | undefined>, envFileText: string): string[]`, `apps/web/src/app.css (app layout on the dealt tokens)`, `CLI: npm run build -w @basanos/web (check-env, then vite build)`
**Requires:** `@basanos/design package (exports "./tokens.css", "./system.css", "./motion.css", "./motion.js")`, `CHAIN (hidekiTestnet, id 50383)`

Applies `docs/design/frontend.md` through the system classes:
- `header.nav` with a `.wrap`, a fixed `--nav` height and a 1px hairline;
- the mark plus the name in the display face;
- one-word nouns;
- the `.btn.btn--primary` main action on the right edge.

The `App.tsx` shell here renders the header and the route name. Task 7 replaces it with the full router once the pages exist.

- [ ] **Step 1: Write the package and config files**

`apps/web/package.json`:
```json
{
  "name": "@basanos/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "build": "node scripts/check-env.mjs && vite build"
  },
  "dependencies": {
    "@basanos/core": "*",
    "@basanos/design": "*",
    "react": "19.1.10",
    "react-dom": "19.1.10",
    "viem": "2.57.12"
  },
  "devDependencies": {
    "@testing-library/dom": "10.4.2",
    "@testing-library/react": "16.3.3",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.1.2",
    "jsdom": "30.1.3",
    "vite": "8.3.5"
  }
}
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/app/",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.{ts,tsx}"],
    testTimeout: 20_000,
  },
});
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en" data-radius="sharp" data-buttons="solid">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="page-type" content="software" />
    <meta name="site-kind" content="software" />
    <title>Basanos — prop challenges on dreamDEX perps</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wdth,wght@85..100,400..700&family=IBM+Plex+Mono:wght@400;500&display=swap"
      rel="stylesheet"
    />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_REGISTRY_ADDRESS?: string;
  readonly VITE_REFEREE_ADDRESS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

`apps/web/scripts/check-env.mjs`:
```js
// Fails the build if any VITE_* variable name ends in _PK: Vite inlines VITE_* values into the public bundle.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function findSecretVars(env, envFileText) {
  const names = new Set(Object.keys(env).filter((k) => /^VITE_.*_PK$/.test(k)));
  for (const line of envFileText.split(/\r?\n/)) {
    const m = line.match(/^\s*(VITE_[A-Z0-9_]*_PK)\s*=/);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dir = fileURLToPath(new URL("..", import.meta.url));
  const text = [".env", ".env.local", ".env.production"]
    .map((f) => `${dir}${f}`)
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  const bad = findSecretVars(process.env, text);
  if (bad.length > 0) {
    console.error(`refusing to build: ${bad.join(", ")} would be inlined into the public bundle`);
    process.exit(1);
  }
  console.log("check-env: no VITE_*_PK variables");
}
```

- [ ] **Step 2: Write the failing tests**

`apps/web/test/routes.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseRoute, routeHref } from "../src/routes";

describe("hash routes", () => {
  it("parses the four routes", () => {
    expect(parseRoute("")).toEqual({ name: "home" });
    expect(parseRoute("#/")).toEqual({ name: "home" });
    expect(parseRoute("#/challenge")).toEqual({ name: "challenge" });
    expect(parseRoute("#/run/12")).toEqual({ name: "run", runId: 12n });
    expect(parseRoute("#/cert/7")).toEqual({ name: "cert", runId: 7n });
  });
  it("falls back to home on anything else", () => {
    expect(parseRoute("#/run/abc")).toEqual({ name: "home" });
    expect(parseRoute("#/nope")).toEqual({ name: "home" });
  });
  it("builds hrefs that parse back", () => {
    for (const r of [{ name: "home" }, { name: "challenge" }, { name: "run", runId: 3n }, { name: "cert", runId: 4n }] as const) {
      expect(parseRoute(routeHref(r))).toEqual(r);
    }
  });
});
```

`apps/web/test/check-env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
// @ts-expect-error -- plain JS module without types
import { findSecretVars } from "../scripts/check-env.mjs";

describe("findSecretVars", () => {
  it("flags VITE_*_PK names from the environment and from .env text", () => {
    expect(findSecretVars({ VITE_REFEREE_PK: "x", VITE_REGISTRY_ADDRESS: "0x1", REFEREE_PK: "y" }, "VITE_ACCOUNT_A_PK=0xabc\nVITE_OK=1")).toEqual([
      "VITE_ACCOUNT_A_PK",
      "VITE_REFEREE_PK",
    ]);
    expect(findSecretVars({ VITE_REGISTRY_ADDRESS: "0x1" }, "")).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to confirm they fail**
Run: `npm install`
Expected: exits 0 (installs React, Vite and the test stack; links the new workspaces).
Run: `npm test -w @basanos/web`
Expected: FAIL — `Failed to resolve import "../src/routes"`.

- [ ] **Step 4: Write the implementation**

`apps/web/src/routes.ts`:
```ts
import { useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "challenge" } | { name: "run"; runId: bigint } | { name: "cert"; runId: bigint };

export function parseRoute(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, "").split("/");
  if (first === "challenge") return { name: "challenge" };
  if ((first === "run" || first === "cert") && second && /^\d+$/.test(second)) return { name: first, runId: BigInt(second) };
  return { name: "home" };
}

export function routeHref(r: Route): string {
  if (r.name === "home") return "#/";
  if (r.name === "challenge") return "#/challenge";
  return `#/${r.name}/${r.runId}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
```

`apps/web/src/config.ts`:
```ts
import { isAddress, type Address } from "viem";

const addr = (v: string | undefined): Address | null => (v && isAddress(v, { strict: false }) ? (v as Address) : null);

/** Public build values (never secrets): set VITE_REGISTRY_ADDRESS and VITE_REFEREE_ADDRESS at build time. */
export const REGISTRY: Address | null = addr(import.meta.env.VITE_REGISTRY_ADDRESS);
export const REFEREE: Address | null = addr(import.meta.env.VITE_REFEREE_ADDRESS);
```

`apps/web/src/app.css`:
```css
/* App layout on the dealt tokens (docs/design/frontend.md; system.md: spacing --s-1..--s-10, labels 13px/500). */
.app-main { padding: calc(var(--nav, 72px) + var(--s-6, 24px)) 0 var(--s-8, 64px); background: var(--p-bg); color: var(--p-ink); min-height: 100vh; }
.app-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: var(--s-5, 24px); }
.app-col-4 { grid-column: span 4; }
.app-col-8 { grid-column: span 8; }
.app-col-12 { grid-column: span 12; }
@media (max-width: 899px) { .app-col-4, .app-col-8 { grid-column: span 12; } }
.panel { background: var(--p-surface); border: 1px solid color-mix(in srgb, var(--p-ink) 13%, transparent); border-radius: var(--r-lg, 8px); padding: var(--s-5, 24px); }
.panel + .panel { margin-top: var(--s-5, 24px); }
.label { font-size: 13px; font-weight: 500; color: var(--p-muted); }
.mono { font-family: var(--font-mono); font-size: 14px; overflow-wrap: anywhere; }
.figure { font-family: var(--font-display); font-weight: var(--display-weight); font-size: 28px; letter-spacing: var(--display-tracking); }
.state { display: inline-block; font-size: 13px; font-weight: 500; padding: 2px 10px; border: 1px solid var(--p-ink); border-radius: var(--r-sm, 4px); }
.state--passed { background: var(--p-accent); color: var(--p-accent-ink); border-color: var(--p-accent); }
.state--failed { background: var(--p-ink); color: var(--p-bg); }
.kv { display: grid; grid-template-columns: max-content 1fr; gap: var(--s-2, 8px) var(--s-4, 16px); margin: 0; }
.kv dt { font-size: 13px; font-weight: 500; color: var(--p-muted); }
.kv dd { margin: 0; }
.field input, .field select { height: 48px; width: 100%; font: inherit; font-size: 16px; padding: 0 var(--s-3, 12px); border: 1px solid color-mix(in srgb, var(--p-ink) 25%, transparent); border-radius: var(--r-sm, 4px); background: var(--p-bg); color: var(--p-ink); }
.field label { display: block; font-size: 13px; font-weight: 500; margin-bottom: var(--s-1, 4px); }
.log { list-style: none; margin: 0; padding: 0; }
.log li { padding: var(--s-2, 8px) 0; border-bottom: 1px solid color-mix(in srgb, var(--p-ink) 13%, transparent); }
.error { color: var(--p-ink); border-left: 2px solid var(--p-ink); padding-left: var(--s-3, 12px); }
.rails svg { width: 100%; height: auto; display: block; }
```

`apps/web/src/App.tsx`:
```tsx
import { routeHref, useRoute } from "./routes";

export function Header() {
  return (
    <header className="nav">
      <div className="wrap">
        <a className="link" href={routeHref({ name: "home" })} aria-label="Basanos home">
          <span className="mark" data-mark="ring" aria-hidden="true" /> Basanos
        </a>
        <nav aria-label="Main">
          <a className="link" href={routeHref({ name: "home" })}>
            Verdicts
          </a>
        </nav>
        <a className="btn btn--secondary" href={routeHref({ name: "challenge" })}>
          Take a challenge
        </a>
      </div>
    </header>
  );
}

export function App() {
  const route = useRoute();
  return (
    <>
      <Header />
      <main className="app-main">
        <div className="wrap">
          <p className="label">Route: {route.name}</p>
        </div>
      </main>
    </>
  );
}
```

`apps/web/src/main.tsx`:
```tsx
import "@basanos/design/system.css";
import "@basanos/design/motion.css";
import "@basanos/design/tokens.css";
import "./app.css";
import "@basanos/design/motion.js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("no #root element");
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 5: Run to confirm they pass (the gate)**
Run: `npm test -w @basanos/web`
Expected: PASS — `4 passed`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(web): Vite + React scaffold, hash router and env guard`

---

### Task 3: Challenge wallet and browser call builders

**Files:**
- Create: `apps/web/src/wallet/challengeWallet.ts`
- Create: `apps/web/src/chain/calls.ts`
- Create: `apps/web/src/chain/client.ts`
- Test: `apps/web/test/wallet.test.ts`
- Test: `apps/web/test/calls.test.ts`

**Depends on:** Task 2, spike:Task 2, spike:Task 6, contracts:Task 8
**Effort:** high
**Model tier:** top
**Provides:** `WALLET_KEY = "basanos.challengeWallet"`, `interface KeyStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }`, `loadKey(store: KeyStore): Hex | null`, `createKey(store: KeyStore, gen?: () => Hex): Hex`, `importKey(store: KeyStore, raw: string): Hex`, `forgetKey(store: KeyStore): void`, `addressOf(key: Hex): Address`, `interface ContractCall { address: Address; abi: Abi; functionName: string; args: readonly unknown[]; gas?: bigint }`, `voucherAbi`, `ownerPoolAbi`, `claimVoucherCall(): ContractCall`, `grantRefereeCall(referee: Address): ContractCall`, `startRunCall(registry: Address, account: Address, rulebookId: Hex): ContractCall`, `placeOrderCall(isBid: boolean, price: bigint, quantity: bigint, orderType: number): ContractCall`, `browserClient(): PublicClient`, `sendCall(key: Hex, call: ContractCall): Promise<{ hash: Hex; status: "success" | "reverted" }>`
**Requires:** `@basanos/web package (Vite base "/app/", hash routes)`, `CHAIN (hidekiTestnet, id 50383)`, `RPC_HTTP_DEFAULT`, `BTC_POOL`, `OPERATOR_REGISTRY`, `VOUCHER_DISTRIBUTOR`, `PLACE_ORDER_FOR_SELECTOR`, `CANCEL_ORDER_FOR_SELECTOR`, `ORDER_GAS = 10_000_000n`, `farFutureNs(nowMs?: number): bigint`, `operatorRegistryAbi`, `basanosRegistryAbi (as const, generated from the forge artifact)`

Key safety (spec §10):
- The challenge wallet is a testnet burner held only in `sessionStorage`. It is generated in the browser or pasted in, and it can be exported.
- It is never written to the build, the repo or a log, and never sent anywhere.
- Every write is signed locally.
- The voucher claim is the product's only claim path. It fires only on an explicit user click, and these tests never send it.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/wallet.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { WALLET_KEY, addressOf, createKey, forgetKey, importKey, loadKey, type KeyStore } from "../src/wallet/challengeWallet";

function memory(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const KEY = `0x${"11".repeat(32)}` as const;

describe("challenge wallet", () => {
  it("creates, loads and forgets a key in the given store only", () => {
    const s = memory();
    expect(loadKey(s)).toBeNull();
    const k = createKey(s, () => KEY);
    expect(k).toBe(KEY);
    expect(s.data.get(WALLET_KEY)).toBe(KEY);
    expect(loadKey(s)).toBe(KEY);
    forgetKey(s);
    expect(loadKey(s)).toBeNull();
  });
  it("imports a pasted key and rejects anything else", () => {
    const s = memory();
    expect(importKey(s, `  ${KEY}\n`)).toBe(KEY);
    expect(() => importKey(s, "0x1234")).toThrow(/32-byte/);
  });
  it("ignores a corrupted stored value and derives the address", () => {
    const s = memory();
    s.setItem(WALLET_KEY, "garbage");
    expect(loadKey(s)).toBeNull();
    expect(addressOf(KEY)).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });
});
```

`apps/web/test/calls.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { encodeFunctionData, toFunctionSelector } from "viem";
import { BTC_POOL, OPERATOR_REGISTRY, VOUCHER_DISTRIBUTOR } from "@basanos/core";
import { claimVoucherCall, grantRefereeCall, placeOrderCall, startRunCall } from "../src/chain/calls";

const REF = "0x00000000000000000000000000000000000000f1";
const REG = "0x00000000000000000000000000000000000000f2";

describe("call builders", () => {
  it("claims the voucher with claim() on the distributor", () => {
    const c = claimVoucherCall();
    expect(c.address).toBe(VOUCHER_DISTRIBUTOR);
    expect(encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args })).toBe(toFunctionSelector("function claim()"));
  });
  it("grants the referee place + cancel on the BTC pool only", () => {
    const c = grantRefereeCall(REF);
    expect(c.address).toBe(OPERATOR_REGISTRY);
    expect(c.functionName).toBe("setOperatorApprovalForPool");
    expect(c.args).toEqual([BTC_POOL, REF, ["0x80054449", "0xe37b444b"], true]);
  });
  it("starts a run as the account itself", () => {
    const c = startRunCall(REG, "0x00000000000000000000000000000000000000a1", `0x${"22".repeat(32)}`);
    expect(c.address).toBe(REG);
    expect(c.args).toEqual(["0x00000000000000000000000000000000000000a1", `0x${"22".repeat(32)}`]);
  });
  it("places an owner order on the BTC pool with 10M gas", () => {
    const c = placeOrderCall(true, 74_649n * 10n ** 18n, 16_107_000n, 2);
    expect(c.address).toBe(BTC_POOL);
    expect(c.gas).toBe(10_000_000n);
    expect(c.functionName).toBe("placeOrder");
    expect(c.args.slice(0, 4)).toEqual([true, 0n, 74_649n * 10n ** 18n, 16_107_000n]);
    expect(c.args.slice(5)).toEqual([2, 0, "0x0000000000000000000000000000000000000000", 0n]);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**
Run: `npm test -w @basanos/web -- test/wallet.test.ts test/calls.test.ts`
Expected: FAIL — `Failed to resolve import "../src/wallet/challengeWallet"`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/wallet/challengeWallet.ts`:
```ts
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";

/** sessionStorage key for the testnet challenge wallet (never the build, never the repo, never a log). */
export const WALLET_KEY = "basanos.challengeWallet";

export interface KeyStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

const isKey = (v: string): v is Hex => /^0x[0-9a-fA-F]{64}$/.test(v);

export function loadKey(store: KeyStore): Hex | null {
  const v = store.getItem(WALLET_KEY);
  return v && isKey(v) ? v : null;
}

export function createKey(store: KeyStore, gen: () => Hex = generatePrivateKey): Hex {
  const k = gen();
  store.setItem(WALLET_KEY, k);
  return k;
}

export function importKey(store: KeyStore, raw: string): Hex {
  const k = raw.trim();
  if (!isKey(k)) throw new Error("not a 0x-prefixed 32-byte hex key");
  store.setItem(WALLET_KEY, k);
  return k;
}

export function forgetKey(store: KeyStore): void {
  store.removeItem(WALLET_KEY);
}

export function addressOf(key: Hex): Address {
  return privateKeyToAccount(key).address;
}
```

`apps/web/src/chain/calls.ts`:
```ts
import { parseAbi, zeroAddress, type Abi, type Address, type Hex } from "viem";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  PLACE_ORDER_FOR_SELECTOR,
  VOUCHER_DISTRIBUTOR,
  basanosRegistryAbi,
  farFutureNs,
  operatorRegistryAbi,
} from "@basanos/core";

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  gas?: bigint;
}

/** The SDK's voucherDistributorWriteAbi and the isClaimed read (SDK 0.33.0 readsAbi). */
export const voucherAbi = parseAbi(["function claim()", "function isClaimed(address account) view returns (bool)"]);

/** Owner-side PerpPool order (SDK 0.33.0 perpPoolWriteAbi). */
export const ownerPoolAbi = parseAbi([
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
]);

export function claimVoucherCall(): ContractCall {
  return { address: VOUCHER_DISTRIBUTOR, abi: voucherAbi, functionName: "claim", args: [] };
}

export function grantRefereeCall(referee: Address): ContractCall {
  return {
    address: OPERATOR_REGISTRY,
    abi: operatorRegistryAbi,
    functionName: "setOperatorApprovalForPool",
    args: [BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR], true],
  };
}

export function startRunCall(registry: Address, account: Address, rulebookId: Hex): ContractCall {
  return { address: registry, abi: basanosRegistryAbi as unknown as Abi, functionName: "startRun", args: [account, rulebookId] };
}

export function placeOrderCall(isBid: boolean, price: bigint, quantity: bigint, orderType: number): ContractCall {
  return {
    address: BTC_POOL,
    abi: ownerPoolAbi,
    functionName: "placeOrder",
    args: [isBid, 0n, price, quantity, farFutureNs(), orderType, 0, zeroAddress, 0n],
    gas: ORDER_GAS,
  };
}
```

`apps/web/src/chain/client.ts`:
```ts
import { createPublicClient, createWalletClient, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, RPC_HTTP_DEFAULT } from "@basanos/core";
import type { ContractCall } from "./calls";

let shared: PublicClient | null = null;

export function browserClient(): PublicClient {
  shared ??= createPublicClient({ chain: CHAIN, transport: http(RPC_HTTP_DEFAULT) }) as unknown as PublicClient;
  return shared;
}

/** Signs locally with the challenge wallet and waits for the receipt. */
export async function sendCall(key: Hex, call: ContractCall): Promise<{ hash: Hex; status: "success" | "reverted" }> {
  const wallet = createWalletClient({ account: privateKeyToAccount(key), chain: CHAIN, transport: http(RPC_HTTP_DEFAULT) });
  const hash = await wallet.writeContract({
    address: call.address,
    abi: call.abi,
    functionName: call.functionName,
    args: call.args,
    ...(call.gas ? { gas: call.gas } : {}),
  });
  const receipt = await browserClient().waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}
```

- [ ] **Step 4: Run to confirm they pass (the gate)**
Run: `npm test -w @basanos/web -- test/wallet.test.ts test/calls.test.ts`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(web): in-browser challenge wallet and call builders`

---

### Task 4: Formatting, rails and replay libraries

**Files:**
- Create: `apps/web/src/lib/format.ts`
- Create: `apps/web/src/lib/rails.ts`
- Create: `apps/web/src/lib/replay.ts`
- Create: `apps/web/src/lib/rulebooks.ts`
- Test: `apps/web/test/format.test.ts`
- Test: `apps/web/test/rails.test.ts`
- Test: `apps/web/test/replay.test.ts`

**Depends on:** Task 2, spike:Task 3, spike:Task 4, referee:Task 1
**Effort:** medium
**Provides:** `formatUsdso(raw: bigint, decimals?: number): string`, `formatBps(bps: number): string`, `shortHash(h: string): string`, `interface Rails { start: bigint; target: bigint; dailyFloor: bigint; trailingFloor: bigint }`, `computeRails(rb: Rulebook, state: RunState): Rails`, `railPercent(value: bigint, start: bigint): number`, `interface StoredRead { blockNumber: bigint; equityOk: boolean; equity: bigint; lockedCollateral: bigint; positionSize: bigint; markOk: boolean; markPrice: bigint }`, `interface ReplayRow { field: "equity" | "lockedCollateral" | "positionSize" | "markPrice"; call: string; stored: bigint; chain: bigint | null; match: "exact" | "within-tolerance" | "differs" | "not-served" }`, `compareReads(stored: StoredRead, chain: StoredRead | null): ReplayRow[]`, `replayRead(client: PublicClient, account: Address, pool: Address, stored: StoredRead): Promise<ReplayRow[]>`, `RULEBOOKS: readonly Rulebook[]`, `rulebookById(id: Hex): Rulebook | null`
**Requires:** `@basanos/web package (Vite base "/app/", hash routes)`, `interface Rulebook`, `rulebookId(rb: Rulebook): Hex`, `parseRulebook(raw: unknown): Rulebook`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `interface RunState { startTime: bigint; startEquity: bigint; hwm: bigint; dayStart: bigint; day: bigint }`, `initRunState(startTime: bigint, startEquity: bigint): RunState`

How replay compares (spec §2, R2):
- The registry's reads ran *inside* the verdict transaction, while an `eth_call` at block N sees the end of block N. A price write later in the same block can therefore move equity and mark slightly.
- So equity and mark compare within 10 bps and are labelled "within tolerance". Size and locked collateral compare exactly.
- If the RPC no longer serves the block, each row shows "not served", and the page shows the value stored on-chain.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/format.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { formatBps, formatUsdso, shortHash } from "../src/lib/format";

describe("format", () => {
  it("formats 18-decimal USDso with two decimals and separators", () => {
    expect(formatUsdso(1_005_123_456_789_000_000_000n)).toBe("1,005.12");
    expect(formatUsdso(-994_500_000_000_000_000_000n)).toBe("-994.50");
    expect(formatUsdso(0n)).toBe("0.00");
  });
  it("formats bps as a signed percentage", () => {
    expect(formatBps(50)).toBe("+0.50%");
    expect(formatBps(-75)).toBe("-0.75%");
  });
  it("shortens hashes", () => {
    expect(shortHash(`0x${"ab".repeat(32)}`)).toBe("0xabab…abab");
  });
});
```

`apps/web/test/rails.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { initRunState } from "@basanos/core/evaluate";
import { computeRails, railPercent } from "../src/lib/rails";
import { RULEBOOKS, rulebookById } from "../src/lib/rulebooks";
import { rulebookId } from "@basanos/core";

const E18 = 10n ** 18n;

describe("rulebooks", () => {
  it("ships the two Tokyo Sprint variants and finds them by on-chain id", () => {
    expect(RULEBOOKS.map((r) => r.label)).toEqual(["Tokyo Sprint", "Tokyo Sprint · Demo"]);
    const demo = RULEBOOKS[1];
    if (!demo) throw new Error("demo rulebook missing");
    expect(rulebookById(rulebookId(demo))?.variant).toBe("demo");
    expect(rulebookById(`0x${"00".repeat(32)}`)).toBeNull();
  });
});

describe("computeRails", () => {
  it("places the target, daily floor and trailing floor for the demo rulebook", () => {
    const loaded = RULEBOOKS[1];
    if (!loaded) throw new Error("demo rulebook missing");
    // thresholds pinned, so a raised demo target (referee Task 10 Step 1) never turns this test red
    const demo = { ...loaded, profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75 };
    const state = { ...initRunState(0n, 1_000n * E18), hwm: 1_004n * E18 };
    expect(computeRails(demo, state)).toEqual({
      start: 1_000n * E18,
      target: 1_005n * E18,
      dailyFloor: 995n * E18,
      trailingFloor: (1_004n * E18 * 9_925n) / 10_000n,
    });
    expect(railPercent(1_005n * E18, 1_000n * E18)).toBe(0.5);
  });
});
```

`apps/web/test/replay.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { compareReads, type StoredRead } from "../src/lib/replay";

const E18 = 10n ** 18n;
const stored: StoredRead = {
  blockNumber: 100n,
  equityOk: true,
  equity: 1_000n * E18,
  lockedCollateral: 0n,
  positionSize: -16_107_000n,
  markOk: true,
  markPrice: 74_500n * E18,
};

describe("compareReads", () => {
  it("marks exact and within-tolerance matches", () => {
    const rows = compareReads(stored, { ...stored, equity: 1_000n * E18 + 5n * 10n ** 17n });
    expect(rows.map((r) => [r.field, r.match])).toEqual([
      ["equity", "within-tolerance"],
      ["lockedCollateral", "exact"],
      ["positionSize", "exact"],
      ["markPrice", "exact"],
    ]);
  });
  it("flags a real difference and an unserved block", () => {
    expect(compareReads(stored, { ...stored, positionSize: 0n })[2]?.match).toBe("differs");
    expect(compareReads(stored, { ...stored, equity: 900n * E18 })[0]?.match).toBe("differs");
    expect(compareReads(stored, null).every((r) => r.match === "not-served" && r.chain === null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**
Run: `npm test -w @basanos/web -- test/format.test.ts test/rails.test.ts test/replay.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib/format"`.

- [ ] **Step 3: Write the implementation**

`apps/web/src/lib/format.ts`:
```ts
export function formatUsdso(raw: bigint, decimals = 18): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const cents = (abs * 100n) / 10n ** BigInt(decimals);
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function formatBps(bps: number): string {
  return `${bps >= 0 ? "+" : "-"}${(Math.abs(bps) / 100).toFixed(2)}%`;
}

export function shortHash(h: string): string {
  return h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}
```

`apps/web/src/lib/rulebooks.ts`:
```ts
import type { Hex } from "viem";
import { parseRulebook, rulebookId, type Rulebook } from "@basanos/core";
import standard from "../../../../rulebooks/tokyo-sprint.json";
import demo from "../../../../rulebooks/tokyo-sprint-demo.json";

export const RULEBOOKS: readonly Rulebook[] = [parseRulebook(standard), parseRulebook(demo)];

export function rulebookById(id: Hex): Rulebook | null {
  return RULEBOOKS.find((rb) => rulebookId(rb).toLowerCase() === id.toLowerCase()) ?? null;
}
```

`apps/web/src/lib/rails.ts`:
```ts
import type { Rulebook } from "@basanos/core";
import type { RunState } from "@basanos/core/evaluate";

export interface Rails {
  start: bigint;
  target: bigint;
  dailyFloor: bigint;
  trailingFloor: bigint;
}

export function computeRails(rb: Rulebook, state: RunState): Rails {
  return {
    start: state.startEquity,
    target: (state.startEquity * BigInt(10_000 + rb.profitTargetBps)) / 10_000n,
    dailyFloor: (state.dayStart * BigInt(10_000 - rb.dailyLossBps)) / 10_000n,
    trailingFloor: (state.hwm * BigInt(10_000 - rb.trailingDrawdownBps)) / 10_000n,
  };
}

/** Percentage change from start, two decimals. */
export function railPercent(value: bigint, start: bigint): number {
  if (start === 0n) return 0;
  return Number(((value - start) * 10_000n) / start) / 100;
}
```

`apps/web/src/lib/replay.ts`:
```ts
import type { Address, PublicClient } from "viem";
import { readSnapshot } from "@basanos/core";

export interface StoredRead {
  blockNumber: bigint;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  positionSize: bigint;
  markOk: boolean;
  markPrice: bigint;
}

export interface ReplayRow {
  field: "equity" | "lockedCollateral" | "positionSize" | "markPrice";
  call: string;
  stored: bigint;
  chain: bigint | null;
  match: "exact" | "within-tolerance" | "differs" | "not-served";
}

const CALLS: Record<ReplayRow["field"], string> = {
  equity: "MarginBank.tryGetAccountEquity(account)",
  lockedCollateral: "MarginBank.getAccountState(account).lockedCollateral",
  positionSize: "MarginBank.getPosition(account, pool).size",
  markPrice: "PerpPool.tryGetMarkPrice()",
};
const TOLERANT: ReadonlySet<ReplayRow["field"]> = new Set(["equity", "markPrice"]);
const TOLERANCE_BPS = 10n;

function judge(field: ReplayRow["field"], stored: bigint, chain: bigint): ReplayRow["match"] {
  if (stored === chain) return "exact";
  if (!TOLERANT.has(field)) return "differs";
  const diff = stored > chain ? stored - chain : chain - stored;
  const base = stored < 0n ? -stored : stored;
  return base > 0n && diff * 10_000n <= base * TOLERANCE_BPS ? "within-tolerance" : "differs";
}

export function compareReads(stored: StoredRead, chain: StoredRead | null): ReplayRow[] {
  return (["equity", "lockedCollateral", "positionSize", "markPrice"] as const).map((field) => ({
    field,
    call: CALLS[field],
    stored: stored[field],
    chain: chain ? chain[field] : null,
    match: chain ? judge(field, stored[field], chain[field]) : "not-served",
  }));
}

/** Re-runs the stored read's calls at its block (one Multicall3 call); "not served" past the RPC's history. */
export async function replayRead(client: PublicClient, account: Address, pool: Address, stored: StoredRead): Promise<ReplayRow[]> {
  try {
    const snap = await readSnapshot(client, [account], pool, stored.blockNumber);
    const a = snap.accounts[0];
    if (!a) return compareReads(stored, null);
    return compareReads(stored, {
      blockNumber: snap.blockNumber,
      equityOk: a.equityOk,
      equity: a.equity,
      lockedCollateral: a.lockedCollateral,
      positionSize: a.size,
      markOk: snap.markOk,
      markPrice: snap.markPrice,
    });
  } catch {
    return compareReads(stored, null);
  }
}
```

- [ ] **Step 4: Run to confirm they pass (the gate)**
Run: `npm test -w @basanos/web -- test/format.test.ts test/rails.test.ts test/replay.test.ts`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(web): formatting, equity rails and verdict replay libraries`

---

### Task 5: The challenge terminal

**Files:**
- Create: `apps/web/src/hooks/useChain.ts`
- Create: `apps/web/src/components/WalletPanel.tsx`
- Create: `apps/web/src/components/StartFlow.tsx`
- Create: `apps/web/src/components/Ticket.tsx`
- Create: `apps/web/src/components/RailsChart.tsx`
- Create: `apps/web/src/pages/Terminal.tsx`
- Test: `apps/web/test/terminal.test.tsx`

**Depends on:** Task 2, Task 3, Task 4, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6, referee:Task 1, contracts:Task 8
**Effort:** high
**Model tier:** top
**Provides:** `useAccountSnapshot(address: Address | null): Snapshot | null`, `useActiveRun(account: Address | null): { runId: bigint; run: RegistryRun } | null`, `WalletPanel(props: { store: KeyStore; onChange: (key: Hex | null) => void })`, `StartFlow(props: { claimed: boolean; granted: boolean; running: boolean; busy: boolean; onClaim: () => void; onGrant: () => void; onStart: (rulebookId: Hex) => void })`, `Ticket(props: { equity: bigint; mark: bigint; busy: boolean; onOrder: (isBid: boolean, quantity: bigint) => void })`, `RailsChart(props: { rails: Rails; points: readonly bigint[] })`, `Terminal()`
**Requires:** `interface KeyStore { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }`, `loadKey(store: KeyStore): Hex | null`, `createKey(store: KeyStore, gen?: () => Hex): Hex`, `importKey(store: KeyStore, raw: string): Hex`, `forgetKey(store: KeyStore): void`, `addressOf(key: Hex): Address`, `voucherAbi`, `claimVoucherCall(): ContractCall`, `grantRefereeCall(referee: Address): ContractCall`, `startRunCall(registry: Address, account: Address, rulebookId: Hex): ContractCall`, `placeOrderCall(isBid: boolean, price: bigint, quantity: bigint, orderType: number): ContractCall`, `browserClient(): PublicClient`, `sendCall(key: Hex, call: ContractCall): Promise<{ hash: Hex; status: "success" | "reverted" }>`, `formatUsdso(raw: bigint, decimals?: number): string`, `shortHash(h: string): string`, `interface Rails { start: bigint; target: bigint; dailyFloor: bigint; trailingFloor: bigint }`, `computeRails(rb: Rulebook, state: RunState): Rails`, `RULEBOOKS: readonly Rulebook[]`, `rulebookById(id: Hex): Rulebook | null`, `REGISTRY: Address | null`, `REFEREE: Address | null`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `iocPrice(isBid: boolean, mark: bigint, tickSize: bigint, slippageBps: number): bigint`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `BTC_POOL`, `VOUCHER_DISTRIBUTOR`, `PLACE_ORDER_FOR_SELECTOR`, `CANCEL_ORDER_FOR_SELECTOR`, `ORDER_TYPE_IOC = 2`, `explorerTx(hash: Hex): string`, `perpPoolAbi`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `rulebookId(rb: Rulebook): Hex`, `interface Snapshot { blockNumber: bigint; timestamp: bigint; pool: Address; markOk: boolean; markPrice: bigint; accounts: AccountSnapshot[] }`, `initRunState(startTime: bigint, startEquity: bigint): RunState`, `routeHref(r: Route): string`

Applies `docs/design/frontend.md`, software kind, app view:
- **Grid and type:** the 12-column grid (`.app-grid`); panels on `--p-surface` with a 1px line; labels 13px/500; figures in the display face.
- **Buttons:** one filled `.btn--primary` per view, namely the next step of the start flow or "Buy / long". The header's "Take a challenge" is a `.btn--secondary`, so a page's own primary stays the only filled button.
- **Cut from the spec §10 terminal list (cut order, stated here):** the limit-order ticket and the exposure rail.
- **Wallet and claim:** the wallet panel always shows the fixed label "Testnet challenge wallet". The claim button fires only on a click.

- [ ] **Step 1: Write the failing test**

`apps/web/test/terminal.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RailsChart } from "../src/components/RailsChart";
import { StartFlow } from "../src/components/StartFlow";
import { Ticket } from "../src/components/Ticket";
import { WalletPanel } from "../src/components/WalletPanel";
import type { KeyStore } from "../src/wallet/challengeWallet";

const E18 = 10n ** 18n;
function memory(): KeyStore {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("WalletPanel", () => {
  it("labels the wallet as testnet and creates or imports a key", () => {
    const onChange = vi.fn();
    render(<WalletPanel store={memory()} onChange={onChange} />);
    expect(screen.getByText("Testnet challenge wallet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Create wallet" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
  it("rejects a malformed pasted key", () => {
    render(<WalletPanel store={memory()} onChange={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Paste a burner key"), { target: { value: "0x12" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByRole("alert").textContent).toMatch(/32-byte/);
  });
});

describe("StartFlow", () => {
  it("offers exactly one primary step at a time, and claims only on click", () => {
    const onClaim = vi.fn();
    const { rerender } = render(
      <StartFlow claimed={false} granted={false} running={false} busy={false} onClaim={onClaim} onGrant={vi.fn()} onStart={vi.fn()} />,
    );
    expect(onClaim).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Claim paper USDso" }));
    expect(onClaim).toHaveBeenCalledTimes(1);
    rerender(<StartFlow claimed granted={false} running={false} busy={false} onClaim={onClaim} onGrant={vi.fn()} onStart={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Grant the referee" }).className).toContain("btn--primary");
    expect(screen.queryByRole("button", { name: "Claim paper USDso" })).toBeNull();
  });
});

describe("Ticket", () => {
  it("sizes the order from leverage and sends the side", () => {
    const onOrder = vi.fn();
    render(<Ticket equity={1_000n * E18} mark={74_500n * E18} busy={false} onOrder={onOrder} />);
    fireEvent.click(screen.getByRole("button", { name: "Buy / long" }));
    expect(onOrder).toHaveBeenCalledWith(true, 16_107_000n);
  });
});

describe("RailsChart", () => {
  it("draws the target and both floors", () => {
    render(<RailsChart rails={{ start: 1_000n * E18, target: 1_005n * E18, dailyFloor: 995n * E18, trailingFloor: 9_925n * 10n ** 17n }} points={[1_000n * E18, 1_002n * E18]} />);
    expect(screen.getByText("Target +0.50%")).toBeTruthy();
    expect(screen.getByText("Daily floor -0.50%")).toBeTruthy();
    expect(screen.getByText("Trailing floor -0.75%")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/web -- test/terminal.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/components/RailsChart"`.

- [ ] **Step 3: Write the hooks and components**

`apps/web/src/hooks/useChain.ts`:
```ts
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { BTC_POOL, basanosRegistryAbi, readSnapshot, type Snapshot } from "@basanos/core";
import { browserClient } from "../chain/client";
import { REGISTRY } from "../config";

export function useAccountSnapshot(address: Address | null): Snapshot | null {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!address) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await readSnapshot(browserClient(), [address], BTC_POOL);
        if (live) setSnap(s);
      } catch {
        // keep the last snapshot; the next tick retries
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1_500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address]);
  return snap;
}

export type RegistryRun = Awaited<ReturnType<typeof readRun>>;

export async function readRun(runId: bigint) {
  if (!REGISTRY) throw new Error("VITE_REGISTRY_ADDRESS is not set at build time");
  return browserClient().readContract({ address: REGISTRY, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
}

export function useActiveRun(account: Address | null): { runId: bigint; run: RegistryRun } | null {
  const [state, setState] = useState<{ runId: bigint; run: RegistryRun } | null>(null);
  useEffect(() => {
    if (!account || !REGISTRY) return;
    const registry = REGISTRY;
    let live = true;
    const tick = async () => {
      try {
        const runId = await browserClient().readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [account] });
        if (!live) return;
        if (runId === 0n) setState(null);
        else setState({ runId, run: await readRun(runId) });
      } catch {
        // retried on the next tick
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 3_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [account]);
  return state;
}
```

`apps/web/src/components/WalletPanel.tsx`:
```tsx
import { useState } from "react";
import type { Hex } from "viem";
import { addressOf, createKey, forgetKey, importKey, loadKey, type KeyStore } from "../wallet/challengeWallet";

export function WalletPanel(props: { store: KeyStore; onChange: (key: Hex | null) => void }) {
  const [key, setKey] = useState<Hex | null>(() => loadKey(props.store));
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const set = (k: Hex | null) => {
    setKey(k);
    props.onChange(k);
  };
  return (
    <section className="panel" aria-labelledby="wallet-h">
      <h2 id="wallet-h" className="label">
        Testnet challenge wallet
      </h2>
      {key ? (
        <>
          <p className="mono">{addressOf(key)}</p>
          <p className="label">Held only in this browser tab. Fund it with 1 STT from the Tokyo faucet.</p>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={() => setShown(!shown)}>
              {shown ? "Hide key" : "Export key"}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                forgetKey(props.store);
                set(null);
              }}
            >
              Forget wallet
            </button>
          </div>
          {shown ? <p className="mono">{key}</p> : null}
        </>
      ) : (
        <>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={() => set(createKey(props.store))}>
              Create wallet
            </button>
          </div>
          <div className="field">
            <label htmlFor="paste-key">Paste a burner key</label>
            <input id="paste-key" type="password" autoComplete="off" value={paste} onChange={(e) => setPaste(e.target.value)} />
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                try {
                  set(importKey(props.store, paste));
                  setPaste("");
                  setError(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Import
            </button>
          </div>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
```

`apps/web/src/components/StartFlow.tsx`:
```tsx
import { useState } from "react";
import type { Hex } from "viem";
import { rulebookId } from "@basanos/core";
import { RULEBOOKS } from "../lib/rulebooks";

export function StartFlow(props: {
  claimed: boolean;
  granted: boolean;
  running: boolean;
  busy: boolean;
  onClaim: () => void;
  onGrant: () => void;
  onStart: (rulebookId: Hex) => void;
}) {
  const [choice, setChoice] = useState(1);
  const rb = RULEBOOKS[choice] ?? RULEBOOKS[0];
  if (props.running) return null;
  return (
    <section className="panel" aria-labelledby="start-h">
      <h2 id="start-h" className="label">
        Start a challenge
      </h2>
      <ol className="log">
        <li>1. Paper USDso: {props.claimed ? "claimed" : "not claimed yet (one claim per address)"}</li>
        <li>2. Referee grant (place and cancel on BTC-PERP only, never withdraw): {props.granted ? "granted" : "not granted"}</li>
        <li>3. Enroll: the registry reads your start equity itself</li>
      </ol>
      {!props.claimed ? (
        <button type="button" className="btn btn--primary" disabled={props.busy} onClick={props.onClaim}>
          Claim paper USDso
        </button>
      ) : !props.granted ? (
        <button type="button" className="btn btn--primary" disabled={props.busy} onClick={props.onGrant}>
          Grant the referee
        </button>
      ) : (
        <>
          <div className="field">
            <label htmlFor="rulebook">Rulebook</label>
            <select id="rulebook" value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
              {RULEBOOKS.map((r, i) => (
                <option key={r.label} value={i}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn--primary" disabled={props.busy || !rb} onClick={() => rb && props.onStart(rulebookId(rb))}>
            Start the run
          </button>
        </>
      )}
    </section>
  );
}
```

`apps/web/src/components/Ticket.tsx`:
```tsx
import { useState } from "react";
import { quantityForLeverage } from "@basanos/core";

const BOOK = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };

export function Ticket(props: { equity: bigint; mark: bigint; busy: boolean; onOrder: (isBid: boolean, quantity: bigint) => void }) {
  const [leverage, setLeverage] = useState(12);
  const qty = props.mark > 0n ? quantityForLeverage(props.equity, leverage, props.mark, 8, BOOK) : 0n;
  return (
    <section className="panel" aria-labelledby="ticket-h">
      <h2 id="ticket-h" className="label">
        BTC-PERP ticket (market, IOC)
      </h2>
      <div className="field">
        <label htmlFor="lev">Leverage (x equity)</label>
        <input id="lev" type="number" min={1} max={15} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} />
      </div>
      <p className="label">Size: {(Number(qty) / 1e8).toFixed(5)} BTC</p>
      <div className="btn-row">
        <button type="button" className="btn btn--primary" disabled={props.busy || qty === 0n} onClick={() => props.onOrder(true, qty)}>
          Buy / long
        </button>
        <button type="button" className="btn btn--secondary" disabled={props.busy || qty === 0n} onClick={() => props.onOrder(false, qty)}>
          Sell / short
        </button>
      </div>
    </section>
  );
}
```

`apps/web/src/components/RailsChart.tsx`:
```tsx
import type { Rails } from "../lib/rails";
import { railPercent } from "../lib/rails";

const W = 600;
const H = 220;

export function RailsChart(props: { rails: Rails; points: readonly bigint[] }) {
  const { rails } = props;
  const lo = rails.dailyFloor < rails.trailingFloor ? rails.dailyFloor : rails.trailingFloor;
  const span = rails.target - lo > 0n ? rails.target - lo : 1n;
  const y = (v: bigint) => H - 20 - Number(((v - lo) * BigInt(H - 40)) / span);
  const line = (v: bigint, label: string) => (
    <g key={label}>
      <line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.4} strokeDasharray="4 4" />
      <text x={4} y={y(v) - 4} fontSize={13}>
        {label}
      </text>
    </g>
  );
  const path = props.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * W) / Math.max(props.points.length - 1, 1)},${y(p)}`)
    .join(" ");
  return (
    <figure className="panel rails" aria-label="Equity against the rulebook rails">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {line(rails.target, `Target +${railPercent(rails.target, rails.start).toFixed(2)}%`)}
        {line(rails.dailyFloor, `Daily floor ${railPercent(rails.dailyFloor, rails.start).toFixed(2)}%`)}
        {line(rails.trailingFloor, `Trailing floor ${railPercent(rails.trailingFloor, rails.start).toFixed(2)}%`)}
        {path ? <path d={path} fill="none" stroke="var(--p-accent)" strokeWidth={2} /> : null}
      </svg>
    </figure>
  );
}
```

- [ ] **Step 4: Write the terminal page**

`apps/web/src/pages/Terminal.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { BTC_POOL, CANCEL_ORDER_FOR_SELECTOR, ORDER_TYPE_IOC, PLACE_ORDER_FOR_SELECTOR, VOUCHER_DISTRIBUTOR, explorerTx, iocPrice, perpPoolAbi } from "@basanos/core";
import { initRunState } from "@basanos/core/evaluate";
import { claimVoucherCall, grantRefereeCall, placeOrderCall, startRunCall, voucherAbi } from "../chain/calls";
import { browserClient, sendCall } from "../chain/client";
import { RailsChart } from "../components/RailsChart";
import { StartFlow } from "../components/StartFlow";
import { Ticket } from "../components/Ticket";
import { WalletPanel } from "../components/WalletPanel";
import { REFEREE, REGISTRY } from "../config";
import { useAccountSnapshot, useActiveRun } from "../hooks/useChain";
import { formatUsdso, shortHash } from "../lib/format";
import { computeRails } from "../lib/rails";
import { rulebookById } from "../lib/rulebooks";
import { routeHref } from "../routes";
import { addressOf, loadKey } from "../wallet/challengeWallet";

const FAUCET = "https://explorer.testnet.somnia.network/tokyo/faucet";

export function Terminal() {
  const registry = REGISTRY;
  const referee = REFEREE;
  const [key, setKey] = useState<Hex | null>(() => loadKey(window.sessionStorage));
  const address: Address | null = key ? addressOf(key) : null;
  const snap = useAccountSnapshot(address);
  const active = useActiveRun(address);
  const [claimed, setClaimed] = useState(false);
  const [granted, setGranted] = useState(false);
  const [stt, setStt] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ label: string; hash: Hex; status: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<bigint[]>([]);
  const acct = snap?.accounts[0];

  useEffect(() => {
    if (!address || !referee) return;
    const c = browserClient();
    void Promise.all([
      c.readContract({ address: VOUCHER_DISTRIBUTOR, abi: voucherAbi, functionName: "isClaimed", args: [address] }),
      c.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [address, referee, PLACE_ORDER_FOR_SELECTOR] }),
      c.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [address, referee, CANCEL_ORDER_FOR_SELECTOR] }),
      c.getBalance({ address }),
    ])
      .then(([cl, p, x, bal]) => {
        setClaimed(cl);
        setGranted(p && x);
        setStt(bal);
      })
      .catch(() => undefined);
  }, [address, referee, log.length]);

  useEffect(() => {
    if (acct?.equityOk && active) setPoints((ps) => [...ps.slice(-299), acct.totalEquity]);
  }, [acct?.totalEquity, acct?.equityOk, active]);

  const run = async (label: string, fn: () => Promise<{ hash: Hex; status: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setLog((l) => [{ label, ...r }, ...l]);
    } catch (e) {
      setError((e as Error).message.slice(0, 240));
    } finally {
      setBusy(false);
    }
  };

  const rb = active ? rulebookById(active.run.rulebookId) : null;
  const rails =
    active && rb
      ? computeRails(rb, { ...initRunState(active.run.startTime, active.run.start.equity), hwm: points.reduce((m, p) => (p > m ? p : m), active.run.start.equity) })
      : null;

  return (
    <div className="wrap">
      <h1 className="figure">Challenge terminal</h1>
      {!registry || !referee ? <p className="error">This build has no registry or referee address set.</p> : null}
      <div className="app-grid">
        <div className="app-col-4">
          <WalletPanel store={window.sessionStorage} onChange={setKey} />
          {key && registry && referee && address ? (
            <StartFlow
              claimed={claimed}
              granted={granted}
              running={active !== null}
              busy={busy}
              onClaim={() => void run("claim paper USDso", () => sendCall(key, claimVoucherCall()))}
              onGrant={() => void run("grant the referee", () => sendCall(key, grantRefereeCall(referee)))}
              onStart={(id) => void run("start the run", () => sendCall(key, startRunCall(registry, address, id)))}
            />
          ) : null}
          {key && active && snap && acct ? (
            <Ticket
              equity={acct.totalEquity}
              mark={snap.markPrice}
              busy={busy}
              onOrder={(isBid, qty) =>
                void run(isBid ? "buy / long" : "sell / short", () => sendCall(key, placeOrderCall(isBid, iocPrice(isBid, snap.markPrice, 10n ** 17n, 20), qty, ORDER_TYPE_IOC)))
              }
            />
          ) : null}
        </div>
        <div className="app-col-8">
          <section className="panel" aria-labelledby="status-h">
            <h2 id="status-h" className="label">
              Account
            </h2>
            <dl className="kv">
              <dt>Equity</dt>
              <dd className="figure">{acct?.equityOk ? `${formatUsdso(acct.totalEquity)} USDso` : "—"}</dd>
              <dt>STT for gas</dt>
              <dd>
                {stt === null ? "—" : `${formatUsdso(stt)} STT`}{" "}
                <a className="link" href={FAUCET} target="_blank" rel="noreferrer">
                  Tokyo faucet
                </a>
              </dd>
              <dt>Paper USDso voucher</dt>
              <dd>{address ? (claimed ? "claimed" : "not claimed (one claim per address)") : "—"}</dd>
              <dt>Run</dt>
              <dd>
                {active ? (
                  <a className="link" href={routeHref({ name: "run", runId: active.runId })}>
                    Run {active.runId.toString()} on {rb?.label ?? "an unknown rulebook"}
                  </a>
                ) : (
                  "No active run"
                )}
              </dd>
            </dl>
          </section>
          {rails ? <RailsChart rails={rails} points={points} /> : null}
          <section className="panel" aria-labelledby="log-h">
            <h2 id="log-h" className="label">
              Transactions
            </h2>
            {error ? (
              <p role="alert" className="error">
                {error}
              </p>
            ) : null}
            <ul className="log">
              {log.map((t) => (
                <li key={t.hash}>
                  {t.label}: {t.status}{" "}
                  <a className="link mono" href={explorerTx(t.hash)} target="_blank" rel="noreferrer">
                    {shortHash(t.hash)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/web -- test/terminal.test.tsx`
Expected: PASS — `5 passed`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(web): challenge terminal — wallet, start flow, ticket and equity rails`

---

### Task 6: Verdict page with replay, and the certificate page

**Files:**
- Create: `apps/web/src/components/VerdictView.tsx`
- Create: `apps/web/src/components/CertificateView.tsx`
- Create: `apps/web/src/pages/Verdict.tsx`
- Create: `apps/web/src/pages/Certificate.tsx`
- Test: `apps/web/test/verdict.test.tsx`

**Depends on:** Task 2, Task 3, Task 4, Task 5, spike:Task 2, contracts:Task 8
**Effort:** medium
**Provides:** `TRUST_LINE = "Every certificate is chain-checked at mint; every verdict is replayable."`, `interface VerdictData { runId: bigint; account: Address; status: number; rule: number; voidReason: number; rulebookLabel: string; rulebookId: Hex; rulebookJson: string | null; start: StoredRead; breach: StoredRead; end: StoredRead; closeTxs: readonly Hex[]; oraclePrice: bigint; oracleSources: number; oracleDone: boolean }`, `VerdictView(props: { data: VerdictData; replay: Record<"start" | "breach" | "end", ReplayRow[] | null>; onReplay: () => void })`, `decodeTokenUri(uri: string): { name: string; description: string; external_url: string; attributes: { trait_type: string; value: string | number }[] } | null`, `CertificateView(props: { runId: bigint; holder: Address; uri: string })`, `VerdictPage(props: { runId: bigint })`, `CertificatePage(props: { runId: bigint })`
**Requires:** `interface StoredRead { blockNumber: bigint; equityOk: boolean; equity: bigint; lockedCollateral: bigint; positionSize: bigint; markOk: boolean; markPrice: bigint }`, `interface ReplayRow { field: "equity" | "lockedCollateral" | "positionSize" | "markPrice"; call: string; stored: bigint; chain: bigint | null; match: "exact" | "within-tolerance" | "differs" | "not-served" }`, `replayRead(client: PublicClient, account: Address, pool: Address, stored: StoredRead): Promise<ReplayRow[]>`, `formatUsdso(raw: bigint, decimals?: number): string`, `shortHash(h: string): string`, `rulebookById(id: Hex): Rulebook | null`, `browserClient(): PublicClient`, `REGISTRY: Address | null`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`, `VOID_REASONS = ["None", "Flow", "ForeignMarket", "GrantRevoked"]`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `explorerTx(hash: Hex): string`, `routeHref(r: Route): string`

The verdict page is public and shareable; the X posts link to it. It leads with the verdict and the certificate (G6), and it states the trust line verbatim. Rows the registry read itself are labelled "read by the registry in the transaction". The breach rows are labelled "attested by the referee". A row past the RPC's history shows the stored value as "stored on-chain; state no longer served by the public RPC" (R2).

- [ ] **Step 1: Write the failing test**

`apps/web/test/verdict.test.tsx`:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CertificateView, decodeTokenUri } from "../src/components/CertificateView";
import { TRUST_LINE, VerdictView, type VerdictData } from "../src/components/VerdictView";

const E18 = 10n ** 18n;
const read = (equity: bigint, block: bigint) => ({ blockNumber: block, equityOk: true, equity, lockedCollateral: 0n, positionSize: 0n, markOk: true, markPrice: 74_500n * E18 });
const data: VerdictData = {
  runId: 3n,
  account: "0x00000000000000000000000000000000000000a1",
  status: 3,
  rule: 1,
  voidReason: 0,
  rulebookLabel: "Tokyo Sprint · Demo",
  rulebookId: `0x${"11".repeat(32)}`,
  rulebookJson: null,
  start: read(1_000n * E18, 100n),
  breach: read(994n * E18, 160n),
  end: read(993n * E18, 165n),
  closeTxs: [`0x${"aa".repeat(32)}`],
  oraclePrice: 74_510n * E18,
  oracleSources: 3,
  oracleDone: true,
};

describe("VerdictView", () => {
  it("leads with the verdict and states the trust line verbatim", () => {
    render(<VerdictView data={data} replay={{ start: null, breach: null, end: null }} onReplay={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FAILED — DailyLoss");
    expect(screen.getByText(TRUST_LINE)).toBeTruthy();
    expect(TRUST_LINE).toBe("Every certificate is chain-checked at mint; every verdict is replayable.");
    expect(screen.getByText("Tokyo Sprint · Demo")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /0xaaaa/ })).toHaveLength(1);
  });
  it("runs replay on demand and labels who read what", () => {
    const onReplay = vi.fn();
    render(
      <VerdictView
        data={data}
        replay={{
          start: [{ field: "equity", call: "MarginBank.tryGetAccountEquity(account)", stored: 1_000n * E18, chain: 1_000n * E18, match: "exact" }],
          breach: [{ field: "equity", call: "MarginBank.tryGetAccountEquity(account)", stored: 994n * E18, chain: null, match: "not-served" }],
          end: null,
        }}
        onReplay={onReplay}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Replay at the pinned blocks" }));
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(/read by the registry in the transaction/).length).toBe(2);
    expect(screen.getByText(/attested by the referee/)).toBeTruthy();
    expect(screen.getByText(/state no longer served by the public RPC/)).toBeTruthy();
  });
});

describe("certificate", () => {
  it("decodes the base64 tokenURI and shows the certificate", () => {
    const json = { name: "Basanos Certificate #4", description: "Every certificate is chain-checked at mint; every verdict is replayable.", external_url: "https://x/app/#/cert/4", attributes: [{ trait_type: "startBlock", value: 100 }] };
    const uri = `data:application/json;base64,${btoa(JSON.stringify(json))}`;
    expect(decodeTokenUri(uri)?.name).toBe("Basanos Certificate #4");
    expect(decodeTokenUri("data:text/plain,hi")).toBeNull();
    render(<CertificateView runId={4n} holder="0x00000000000000000000000000000000000000a1" uri={uri} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Basanos Certificate #4");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/web -- test/verdict.test.tsx`
Expected: FAIL — `Failed to resolve import "../src/components/CertificateView"`.

- [ ] **Step 3: Write the components and pages**

`apps/web/src/components/VerdictView.tsx`:
```tsx
import type { Address, Hex } from "viem";
import { RULE_NAMES, RUN_STATUS, VOID_REASONS, explorerTx } from "@basanos/core";
import { formatUsdso, shortHash } from "../lib/format";
import type { ReplayRow, StoredRead } from "../lib/replay";
import { routeHref } from "../routes";

export const TRUST_LINE = "Every certificate is chain-checked at mint; every verdict is replayable.";

export interface VerdictData {
  runId: bigint;
  account: Address;
  status: number;
  rule: number;
  voidReason: number;
  rulebookLabel: string;
  rulebookId: Hex;
  rulebookJson: string | null;
  start: StoredRead;
  breach: StoredRead;
  end: StoredRead;
  closeTxs: readonly Hex[];
  oraclePrice: bigint;
  oracleSources: number;
  oracleDone: boolean;
}

const MATCH_TEXT: Record<ReplayRow["match"], string> = {
  exact: "matches",
  "within-tolerance": "matches within 10 bps (end of block vs inside the transaction)",
  differs: "differs",
  "not-served": "stored on-chain; state no longer served by the public RPC",
};

function heading(d: VerdictData): string {
  const status = RUN_STATUS[d.status] ?? "Unknown";
  if (status === "Failed") return `FAILED — ${RULE_NAMES[d.rule] ?? "rule"}`;
  if (status === "Voided") return `VOID — ${VOID_REASONS[d.voidReason] ?? "reason"}`;
  return status.toUpperCase();
}

function ReadBlock(props: { title: string; who: string; read: StoredRead; rows: ReplayRow[] | null }) {
  return (
    <section className="panel">
      <h2 className="label">
        {props.title} — block {props.read.blockNumber.toString()} ({props.who})
      </h2>
      <dl className="kv">
        <dt>Equity</dt>
        <dd className="mono">{props.read.equityOk ? `${formatUsdso(props.read.equity + props.read.lockedCollateral)} USDso` : "unpriceable"}</dd>
        <dt>Position size</dt>
        <dd className="mono">{props.read.positionSize.toString()}</dd>
        <dt>Mark</dt>
        <dd className="mono">{props.read.markOk ? formatUsdso(props.read.markPrice) : "no fresh mark"}</dd>
      </dl>
      {props.rows ? (
        <ul className="log">
          {props.rows.map((r) => (
            <li key={r.field}>
              <span className="mono">{r.call}</span>: {MATCH_TEXT[r.match]}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function VerdictView(props: { data: VerdictData; replay: Record<"start" | "breach" | "end", ReplayRow[] | null>; onReplay: () => void }) {
  const d = props.data;
  const passed = d.status === 2;
  const failed = d.status === 3;
  return (
    <div className="wrap">
      <p className="label">Run {d.runId.toString()}</p>
      <h1 className="figure">{heading(d)}</h1>
      <p>
        <span className={`state ${passed ? "state--passed" : failed ? "state--failed" : ""}`}>{d.rulebookLabel}</span>
      </p>
      <p>{TRUST_LINE}</p>
      {passed ? (
        <p>
          <a className="link" href={routeHref({ name: "cert", runId: d.runId })}>
            View the certificate
          </a>
        </p>
      ) : null}
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={props.onReplay}>
          Replay at the pinned blocks
        </button>
      </div>
      <div className="app-grid">
        <div className="app-col-8">
          <ReadBlock title="Start" who="read by the registry in the transaction" read={d.start} rows={props.replay.start} />
          {failed ? <ReadBlock title="Breach" who="attested by the referee" read={d.breach} rows={props.replay.breach} /> : null}
          <ReadBlock title="End" who="read by the registry in the transaction" read={d.end} rows={props.replay.end} />
        </div>
        <div className="app-col-4">
          <section className="panel">
            <h2 className="label">Account</h2>
            <p className="mono">{d.account}</p>
            <h2 className="label">Rulebook id</h2>
            <p className="mono">{d.rulebookId}</p>
            {d.rulebookJson ? (
              <details>
                <summary className="label">Rulebook JSON (its id is the keccak256 of this canonical JSON)</summary>
                <pre className="mono">{d.rulebookJson}</pre>
              </details>
            ) : null}
          </section>
          {d.closeTxs.length > 0 ? (
            <section className="panel">
              <h2 className="label">Referee close transactions</h2>
              <ul className="log">
                {d.closeTxs.map((h) => (
                  <li key={h}>
                    <a className="link mono" href={explorerTx(h)} target="_blank" rel="noreferrer">
                      {shortHash(h)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="panel">
            <h2 className="label">Somnia Price Oracle at the verdict</h2>
            <p className="mono">
              {d.oracleDone && d.oracleSources > 0 ? `${formatUsdso(d.oraclePrice)} (${d.oracleSources} sources) vs mark ${formatUsdso(d.end.markPrice)}` : "no reading recorded"}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
```

`apps/web/src/components/CertificateView.tsx`:
```tsx
import type { Address } from "viem";
import { routeHref } from "../routes";

export function decodeTokenUri(uri: string): {
  name: string;
  description: string;
  external_url: string;
  attributes: { trait_type: string; value: string | number }[];
} | null {
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return null;
  try {
    return JSON.parse(atob(uri.slice(prefix.length)));
  } catch {
    return null;
  }
}

export function CertificateView(props: { runId: bigint; holder: Address; uri: string }) {
  const meta = decodeTokenUri(props.uri);
  if (!meta) return <p className="error">This certificate's metadata could not be read.</p>;
  return (
    <div className="wrap">
      <p className="label">Soulbound certificate (ERC-721 + ERC-5192), held by</p>
      <p className="mono">{props.holder}</p>
      <h1 className="figure">{meta.name}</h1>
      <p>{meta.description}</p>
      <dl className="kv panel">
        {meta.attributes.map((a) => (
          <div key={a.trait_type} style={{ display: "contents" }}>
            <dt>{a.trait_type}</dt>
            <dd className="mono">{String(a.value)}</dd>
          </div>
        ))}
      </dl>
      <p>
        <a className="link" href={routeHref({ name: "run", runId: props.runId })}>
          See the verdict and replay it
        </a>
      </p>
    </div>
  );
}
```

`apps/web/src/pages/Verdict.tsx`:
```tsx
import { useEffect, useState } from "react";
import { basanosRegistryAbi } from "@basanos/core";
import { browserClient } from "../chain/client";
import { VerdictView, type VerdictData } from "../components/VerdictView";
import { REGISTRY } from "../config";
import { replayRead, type ReplayRow } from "../lib/replay";
import { rulebookById } from "../lib/rulebooks";

export function VerdictPage(props: { runId: bigint }) {
  const [data, setData] = useState<VerdictData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<`0x${string}` | null>(null);
  const [replay, setReplay] = useState<Record<"start" | "breach" | "end", ReplayRow[] | null>>({ start: null, breach: null, end: null });
  useEffect(() => {
    if (!REGISTRY) {
      setError("This build has no registry address set.");
      return;
    }
    const registry = REGISTRY;
    const c = browserClient();
    void (async () => {
      try {
        const run = await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [props.runId] });
        const closeTxs = await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getCloseTxs", args: [props.runId] });
        const params = await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRulebook", args: [run.rulebookId] });
        setPool(params.pool);
        setData({
          runId: props.runId,
          account: run.account,
          status: run.status,
          rule: run.rule,
          voidReason: run.voidReason,
          rulebookLabel: rulebookById(run.rulebookId)?.label ?? "Unpublished rulebook",
          rulebookId: run.rulebookId,
          rulebookJson: (() => {
            const rb = rulebookById(run.rulebookId);
            return rb ? JSON.stringify(rb, null, 2) : null;
          })(),
          start: run.start,
          breach: run.breach,
          end: run.end,
          closeTxs,
          oraclePrice: run.oraclePrice,
          oracleSources: run.oracleSources,
          oracleDone: run.oracleDone,
        });
      } catch (e) {
        setError((e as Error).message.slice(0, 200));
      }
    })();
  }, [props.runId]);
  if (error) return <p className="wrap error">{error}</p>;
  if (!data || !pool) return <p className="wrap label">Reading run {props.runId.toString()} from the registry…</p>;
  const onReplay = async () => {
    const c = browserClient();
    const [start, breach, end] = await Promise.all([
      replayRead(c, data.account, pool, data.start),
      data.status === 3 ? replayRead(c, data.account, pool, data.breach) : Promise.resolve(null),
      replayRead(c, data.account, pool, data.end),
    ]);
    setReplay({ start, breach, end });
  };
  return <VerdictView data={data} replay={replay} onReplay={() => void onReplay()} />;
}
```

`apps/web/src/pages/Certificate.tsx`:
```tsx
import { useEffect, useState } from "react";
import type { Address } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { browserClient } from "../chain/client";
import { CertificateView } from "../components/CertificateView";
import { REGISTRY } from "../config";

export function CertificatePage(props: { runId: bigint }) {
  const [state, setState] = useState<{ holder: Address; uri: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!REGISTRY) {
      setError("This build has no registry address set.");
      return;
    }
    const registry = REGISTRY;
    const c = browserClient();
    void (async () => {
      try {
        const [holder, uri] = await Promise.all([
          c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "ownerOf", args: [props.runId] }),
          c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "tokenURI", args: [props.runId] }),
        ]);
        setState({ holder, uri });
      } catch {
        setError(`Run ${props.runId.toString()} has no certificate: only a PASS mints one.`);
      }
    })();
  }, [props.runId]);
  if (error) return <p className="wrap error">{error}</p>;
  if (!state) return <p className="wrap label">Reading the certificate…</p>;
  return <CertificateView runId={props.runId} holder={state.holder} uri={state.uri} />;
}
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/web -- test/verdict.test.tsx`
Expected: PASS — `3 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(web): public verdict page with replay and the certificate page`

---

### Task 7: Recent-verdicts home, the full router, and the production build

**Files:**
- Create: `apps/web/src/pages/Home.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/test/app.test.tsx`

**Depends on:** Task 2, Task 3, Task 5, Task 6, contracts:Task 8
**Effort:** medium
**Provides:** `Home()`, `App() (routes #/ -> Home, #/challenge -> Terminal, #/run/:id -> VerdictPage, #/cert/:id -> CertificatePage)`, `apps/web/dist (static build served at /app/)`
**Requires:** `Terminal()`, `VerdictPage(props: { runId: bigint })`, `CertificatePage(props: { runId: bigint })`, `TRUST_LINE = "Every certificate is chain-checked at mint; every verdict is replayable."`, `useRoute(): Route`, `routeHref(r: Route): string`, `browserClient(): PublicClient`, `REGISTRY: Address | null`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `CLI: npm run build -w @basanos/web (check-env, then vite build)`

- [ ] **Step 1: Write the failing test**

`apps/web/test/app.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";

describe("App", () => {
  it("renders the shared header and the home view by default", () => {
    window.location.hash = "#/";
    render(<App />);
    expect(screen.getByRole("link", { name: "Take a challenge" }).getAttribute("href")).toBe("#/challenge");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Recent verdicts");
    expect(screen.getByText("Every certificate is chain-checked at mint; every verdict is replayable.")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/web -- test/app.test.tsx`
Expected: FAIL — the heading is missing (the scaffold shell renders `Route: home`, not `Recent verdicts`).

- [ ] **Step 3: Write the home page and the router**

`apps/web/src/pages/Home.tsx`:
```tsx
import { useEffect, useState } from "react";
import { RUN_STATUS, basanosRegistryAbi } from "@basanos/core";
import { browserClient } from "../chain/client";
import { TRUST_LINE } from "../components/VerdictView";
import { REGISTRY } from "../config";
import { routeHref } from "../routes";

export function Home() {
  const [runs, setRuns] = useState<{ runId: bigint; status: number }[]>([]);
  useEffect(() => {
    if (!REGISTRY) return;
    const registry = REGISTRY;
    const c = browserClient();
    void (async () => {
      try {
        const count = await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "runCount" });
        const ids: bigint[] = [];
        for (let id = count; id > 0n && ids.length < 12; id--) ids.push(id);
        const rows = await Promise.all(
          ids.map(async (runId) => ({ runId, status: (await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] })).status })),
        );
        setRuns(rows);
      } catch {
        setRuns([]);
      }
    })();
  }, []);
  return (
    <div className="wrap">
      <h1 className="figure">Recent verdicts</h1>
      <p>{TRUST_LINE}</p>
      <p className="label">Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.</p>
      <ul className="log">
        {runs.map((r) => (
          <li key={r.runId.toString()}>
            <a className="link" href={routeHref({ name: "run", runId: r.runId })}>
              Run {r.runId.toString()}: {RUN_STATUS[r.status] ?? "Unknown"}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Replace `apps/web/src/App.tsx` with:
```tsx
import { CertificatePage } from "./pages/Certificate";
import { Home } from "./pages/Home";
import { Terminal } from "./pages/Terminal";
import { VerdictPage } from "./pages/Verdict";
import { routeHref, useRoute } from "./routes";

export function Header() {
  return (
    <header className="nav">
      <div className="wrap">
        <a className="link" href={routeHref({ name: "home" })} aria-label="Basanos home">
          <span className="mark" data-mark="ring" aria-hidden="true" /> Basanos
        </a>
        <nav aria-label="Main">
          <a className="link" href={routeHref({ name: "home" })}>
            Verdicts
          </a>
        </nav>
        <a className="btn btn--secondary" href={routeHref({ name: "challenge" })}>
          Take a challenge
        </a>
      </div>
    </header>
  );
}

export function App() {
  const route = useRoute();
  return (
    <>
      <Header />
      <main className="app-main">
        {route.name === "challenge" ? (
          <Terminal />
        ) : route.name === "run" ? (
          <VerdictPage runId={route.runId} />
        ) : route.name === "cert" ? (
          <CertificatePage runId={route.runId} />
        ) : (
          <Home />
        )}
      </main>
    </>
  );
}
```

- [ ] **Step 4: Run the app test**
Run: `npm test -w @basanos/web -- test/app.test.tsx`
Expected: PASS — `1 passed`.

- [ ] **Step 5: Build the static app (the gate)**
Run: `npm run build -w @basanos/web`
Expected: PASS — `check-env: no VITE_*_PK variables`, then Vite's `✓ built in …` with `dist/index.html` written.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(web): recent-verdicts home, router and the static /app build`
