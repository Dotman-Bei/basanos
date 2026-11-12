# Basanos Spike and Foundation Implementation Plan

**Goal:** Stand up the npm-workspaces monorepo and the shared `@basanos/core` package, then answer the day-1 unknowns (G1 a–e, R1) with on-chain evidence and land the first real Hideki order (the Nov 11 tripwire).
**Architecture:** `@basanos/core` holds config, ABIs, the env loader, the rulebook schema and id, the Multicall3 snapshot, the raw `somnia_watch` client and close-plan math; it is browser-safe except `@basanos/core/node`. `@basanos/spike` holds evidence scripts: read-only ones run unattended, the two that sign transactions are human-gated. Every script writes a JSON evidence file under `docs/evidence/`, and a checker validates each file's shape.
**Tech Stack:** Node 22.23.4, npm 10.9.9 workspaces, TypeScript 6.0.3 (strict, ESM, bundler resolution, run with tsx 4.23.15), vitest 4.1.12, `@somnia-chain/markets-sdk` 0.33.0 (exact; fallback 0.32.1), viem 2.57.12 (exact), ws 8.22.0 + @types/ws 8.18.2 (test server only), @types/node 22.20.5.
**Source spec:** docs/superpowers/specs/2026-11-10-basanos-design.md

**Boot notes for the orchestrator:**
- Chain: Somnia Tokyo testnet (Hideki, 50383). Secrets only in the git-ignored `.env` under the names in spec §13; never print, log or commit a key.
- Tasks 11, 12, 18 and 19 are human-gated (`human_gate: true`). They sign real transactions with burner keys: the Step 3 preflight gave them STT, and the organizers sent USDso to the wallets.
  - **No task in this plan ever claims a voucher.** `claim()` reverts chain-wide (B14), and no account holds one.
  - The accounts are funded: Tasks 18 and 19 deposit each account's own wallet USDso into its own MarginBank balance.
- **Task 11 is stop-and-escalate:** if the referee's close does not land (evidence `ok: false`), stop the build and escalate to the user. The product depends on it.
- **SDK pin timebox:** if task 11 has not landed a real order on 0.33.0 within ~2 h of starting the skeleton, stop and route a plan fix to the architect: switch `@somnia-chain/markets-sdk` to `0.32.1` in `packages/core/package.json` and `packages/spike/package.json`.
- **Task 14 (added 2026-11-11, after Task 10 landed):** account A's own writes in `skeleton-close` (grant, open, rest) move off the SDK's send path, which returned `TransactionOutcomeUnknownError` in the Step 3 preflight, onto viem: signed locally, sent to the standard RPC with `ORDER_GAS` and an explicit nonce. It runs after Task 10 and before Task 11 (Task 11 depends on it). `--sdk-send` keeps the SDK path as an opt-in fallback; the evidence records `sendPath`.
- **Task 15 (added 2026-11-11, after Task 12's first run):** `oracle-probe` reads the outcome from SomniaAgents logs. SomniaAgents deletes a request once it finalizes, so `getRequest` reverts `RequestNotFound` and the first run recorded "Pending" for a request that finalized Failed. Task 15 also adds `--from-tx <hash>`, which rebuilds the evidence without a key or a send, and makes the `g1d-oracle` check strict. Task 12 depends on it and rebuilds its evidence from the request already sent.
- **Task 16 (added 2026-11-11, guide GO):** adds the oracle probes P1 (`--symbols BTC/USDC:PERP`: one symbol, the registry's exact 4-argument Majority path) and P2 (`--advanced`: Threshold 2 of 3) to `oracle-probe`. The task is code and unit tests only. The gate-concierge runs P1 on the user's GO, and P2 only if P1 fails and the guide approves it. contracts:10 waits for the result; see its hold note.
- **Tasks 17–19 (added 2026-11-12, B14/B15):** the voucher claim reverts chain-wide, so the organizers sent USDso to the wallets.
  - Task 17 is the code. Tasks 18 (account A) and 19 (account B) are human-gated runs: each account's own key deposits its own wallet USDso into its own MarginBank balance. Nothing moves between accounts.
  - Run each before any `startRun` on that account, because a deposit during a run voids it.
  - Task 11 depends on Task 18; referee:10 depends on both.
- The root `.npmrc` (`legacy-peer-deps=true`, Task 1) is required: without it `npm install` crashes in npm 10's resolver (`Cannot read properties of null (reading 'edgesOut')`) on Vite 8's optional peer graph, which vitest pulls in.
- Commands run from the repo root. **The repo path contains a space** (`C:\Users\bamig\Documents\VIBE CODE…`); a prior campaign lost hours to a Node tool that shells out unquoted. Task 1's gate (install + test) must pass from this path. Do not move the build to a no-space clone to make a gate pass; if install or test fails because of the space, stop and report it as an environment blocker.

---

### Task 1: Scaffold the monorepo and the core package

**Files:**
- Create: `package.json`
- Create: `.npmrc`
- Create: `tsconfig.base.json`
- Create: `.env.example`
- Modify: `.gitignore`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/node.ts`
- Test: `packages/core/test/smoke.test.ts`

**Effort:** low
**Model tier:** fast
**Provides:** `npm workspaces root (packages/*, apps/*)`, `@basanos/core package with exports "." -> src/index.ts and "./node" -> src/node.ts`, `BASANOS: "basanos"`, `repoPath(rel: string): string`
**Requires:** none

- [ ] **Step 1: Write the root files**

`package.json`:
```json
{
  "name": "basanos",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "npm test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "devDependencies": {
    "@types/node": "22.20.5",
    "tsx": "4.23.15",
    "typescript": "6.0.3",
    "vitest": "4.1.12"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

`.env.example`:
```bash
# Basanos — copy to .env (git-ignored). Names only; never commit values.
REFEREE_PK=
REFEREE_ADDRESS=
ACCOUNT_A_PK=
ACCOUNT_A_ADDRESS=
ACCOUNT_B_PK=
ACCOUNT_B_ADDRESS=
REGISTRY_ADDRESS=
HIDEKI_RPC_HTTP=https://api.hideki.infra.testnet.somnia.network
HIDEKI_RPC_WSS=wss://api.hideki.infra.testnet.somnia.network/ws
ORACLE_ENABLED=true
FEATURED_RUN_ID=
VERCEL_TOKEN=
CHROME_PATH=
```

`.npmrc`:
```ini
# Vite 8's optional @vitejs/devtools peer graph (pulled in by vitest) crashes npm 10's resolver
# ("Cannot read properties of null (reading 'edgesOut')"); skip optional-peer resolution.
legacy-peer-deps=true
```

Append these lines to the end of the existing `.gitignore` (keep every existing line):
```gitignore
dist/
contracts/out/
contracts/cache/
contracts/lib/
.vercel/
.taste-skill/
shots/
```

- [ ] **Step 2: Write the core package files**

`packages/core/package.json`:
```json
{
  "name": "@basanos/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./node": "./src/node.ts"
  },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@somnia-chain/markets-sdk": "0.33.0",
    "viem": "2.57.12"
  },
  "devDependencies": {
    "@types/ws": "8.18.2",
    "ws": "8.22.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
```

`packages/core/src/index.ts`:
```ts
export const BASANOS = "basanos" as const;
```

`packages/core/src/node.ts`:
```ts
import { fileURLToPath } from "node:url";

/** Absolute path of a repo-relative path (this file lives at packages/core/src/node.ts). */
export function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
}
```

- [ ] **Step 3: Write the smoke test**

`packages/core/test/smoke.test.ts`:
```ts
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASANOS } from "../src/index";
import { repoPath } from "../src/node";

describe("core scaffold", () => {
  it("exports the package marker", () => {
    expect(BASANOS).toBe("basanos");
  });
  it("resolves repo-relative paths to the repo root", () => {
    expect(existsSync(repoPath("package.json"))).toBe(true);
    expect(existsSync(repoPath("tsconfig.base.json"))).toBe(true);
  });
  it("keeps spaces in paths (the repo path itself contains one)", () => {
    expect(repoPath("dir with space/file.txt").endsWith(join("dir with space", "file.txt"))).toBe(true);
  });
});
```

- [ ] **Step 4: Install and run the gate**
Run: `npm install`
Expected: exits 0 and writes `package-lock.json`.
Run: `npm test -w @basanos/core`
Expected: PASS — `3 passed` (run from this repo path, which contains a space).

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `chore: scaffold npm workspaces and @basanos/core`

---

### Task 2: Core config and ABIs

**Files:**
- Create: `packages/core/src/config.ts`
- Create: `packages/core/src/abi.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/config.test.ts`

**Depends on:** Task 1
**Effort:** low
**Provides:** `CHAIN (hidekiTestnet, id 50383)`, `CHAIN_ID = 50383`, `RPC_HTTP_DEFAULT`, `RPC_WSS_DEFAULT`, `RPC_HTTP_FALLBACK`, `RPC_WSS_FALLBACK`, `INDEXER_URL`, `EXPLORER_URL`, `MARGIN_BANK`, `USDSO`, `OPERATOR_REGISTRY`, `VOUCHER_DISTRIBUTOR`, `SOMNIA_AGENTS`, `MULTICALL3`, `PRICE_FEED_SCHEDULER`, `BTC_POOL`, `BTC_BASE_DECIMALS = 8`, `QUOTE_DECIMALS = 18`, `HIDEKI_ADDRESSES`, `PLACE_ORDER_FOR_SELECTOR`, `CANCEL_ORDER_FOR_SELECTOR`, `REDUCE_ORDER_FOR_SELECTOR`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_LIMIT = 0`, `ORDER_TYPE_IOC = 2`, `ORACLE_AGENT_ID = 9911223344556677889n`, `ORACLE_DEPOSIT = 30_900_000_000_000_000n`, `STT_WRITE_HEADROOM = 600_000_000_000_000_000n`, `farFutureNs(nowMs?: number): bigint`, `explorerTx(hash: Hex): string`, `explorerAddress(address: Address): string`, `marginBankAbi`, `perpPoolAbi`, `operatorRegistryAbi`, `multicall3Abi`, `somniaAgentsAbi`, `priceOracleAbi`, `marginBankEventsAbi`
**Requires:** `@basanos/core package with exports "." -> src/index.ts and "./node" -> src/node.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/config.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { encodeFunctionData, toFunctionSelector, zeroAddress } from "viem";
import {
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  MARGIN_BANK,
  OPERATOR_REGISTRY,
  PLACE_ORDER_FOR_SELECTOR,
  REDUCE_ORDER_FOR_SELECTOR,
  explorerTx,
  farFutureNs,
} from "../src/config";
import { multicall3Abi, perpPoolAbi } from "../src/abi";

describe("config", () => {
  it("targets Hideki testnet", () => {
    expect(CHAIN.id).toBe(50383);
  });
  it("operator selectors match their function signatures", () => {
    expect(
      toFunctionSelector(
        "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
      ),
    ).toBe(PLACE_ORDER_FOR_SELECTOR);
    expect(toFunctionSelector("function cancelOrderFor(address owner, uint128 orderId)")).toBe(CANCEL_ORDER_FOR_SELECTOR);
    expect(toFunctionSelector("function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining)")).toBe(
      REDUCE_ORDER_FOR_SELECTOR,
    );
  });
  it("adds the operator registry the SDK constants omit", () => {
    expect(HIDEKI_ADDRESSES.operatorPermissionsRegistry).toBe(OPERATOR_REGISTRY);
    expect(HIDEKI_ADDRESSES.marginBank?.toLowerCase()).toBe(MARGIN_BANK.toLowerCase());
  });
  it("puts the far-future expiry fifty years out, in nanoseconds", () => {
    expect(farFutureNs(0)).toBe(50n * 365n * 86_400n * 1_000_000_000n);
  });
  it("builds Tokyo explorer links", () => {
    expect(explorerTx("0xabc")).toBe("https://explorer.testnet.somnia.network/tokyo/tx/0xabc");
  });
  it("encodes the ABIs it declares", () => {
    const cancel = encodeFunctionData({ abi: perpPoolAbi, functionName: "cancelOrderFor", args: [zeroAddress, 5n] });
    expect(cancel.slice(0, 10)).toBe(CANCEL_ORDER_FOR_SELECTOR);
    const block = encodeFunctionData({ abi: multicall3Abi, functionName: "getBlockNumber" });
    expect(block).toBe(toFunctionSelector("function getBlockNumber()"));
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/core -- test/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config'` (or `Failed to resolve import`).

- [ ] **Step 3: Write the implementation**

`packages/core/src/config.ts`:
```ts
import type { Address, Hex } from "viem";
import { SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";

export const CHAIN = hidekiTestnet;
export const CHAIN_ID = 50383;

export const RPC_HTTP_DEFAULT = "https://api.hideki.infra.testnet.somnia.network";
export const RPC_WSS_DEFAULT = "wss://api.hideki.infra.testnet.somnia.network/ws";
export const RPC_HTTP_FALLBACK = "https://api.hideki2.infra.testnet.somnia.network";
export const RPC_WSS_FALLBACK = "wss://api.hideki2.infra.testnet.somnia.network/ws";
export const INDEXER_URL = "https://hideki-dev.smk.somnia.host/v1/graphql";
export const EXPLORER_URL = "https://explorer.testnet.somnia.network/tokyo";

export const MARGIN_BANK: Address = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
export const USDSO: Address = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72";
export const OPERATOR_REGISTRY: Address = "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a";
export const VOUCHER_DISTRIBUTOR: Address = "0x2ACD9EFdA721450906bfE1bef3edE269636E42C4";
export const SOMNIA_AGENTS: Address = "0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3";
export const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
export const PRICE_FEED_SCHEDULER: Address = "0x1998C88D54a240b8C671493f27f58eC416b81D7F";
export const BTC_POOL: Address = "0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0"; // getAddress() checksum form: viem decodes addresses in this case
export const BTC_BASE_DECIMALS = 8;
export const QUOTE_DECIMALS = 18;

/** The SDK's Hideki constants omit the perps OperatorPermissionsRegistry; Basanos adds it. */
export const HIDEKI_ADDRESSES = {
  ...SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  operatorPermissionsRegistry: OPERATOR_REGISTRY,
};

export const PLACE_ORDER_FOR_SELECTOR: Hex = "0x80054449";
export const CANCEL_ORDER_FOR_SELECTOR: Hex = "0xe37b444b";
export const REDUCE_ORDER_FOR_SELECTOR: Hex = "0x364c2587";

export const ORDER_GAS = 10_000_000n;
export const ORDER_TYPE_LIMIT = 0;
export const ORDER_TYPE_IOC = 2;

export const ORACLE_AGENT_ID = 9911223344556677889n;
export const ORACLE_DEPOSIT = 30_900_000_000_000_000n;
export const STT_WRITE_HEADROOM = 600_000_000_000_000_000n;

/** Order expiry fifty years out, in nanoseconds (the bot kit's GTC convention). */
export function farFutureNs(nowMs: number = Date.now()): bigint {
  return (BigInt(Math.floor(nowMs / 1000)) + 50n * 365n * 86_400n) * 1_000_000_000n;
}

export function explorerTx(hash: Hex): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function explorerAddress(address: Address): string {
  return `${EXPLORER_URL}/address/${address}`;
}
```

`packages/core/src/abi.ts`:
```ts
import { parseAbi } from "viem";

export const marginBankAbi = parseAbi([
  "function getAccountState(address account) view returns ((int256 unlockedCollateralBalance, uint256 lockedCollateral, address[] activePerpPools))",
  "function getAccountEquity(address account) view returns (int256)",
  "function tryGetAccountEquity(address account) view returns (bool ok, int256 equity)",
  "function getPosition(address account, address perpPool) view returns ((int128 size, uint128 avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs))",
]);

export const perpPoolAbi = parseAbi([
  "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)",
  "function cancelOrderFor(address owner, uint128 orderId)",
  "function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)",
  "function getOwnOpenOrders() view returns (uint128[])",
  "function tryGetMarkPrice() view returns (bool ok, uint256 price)",
  "function getMarkPrice() view returns (uint256)",
  "function getOrderBookParameters() view returns ((uint256 tickSize, uint256 minQuantity, uint256 lotSize))",
  "function getBookLevels(bool isBid, uint64 numLevels) view returns ((uint256 price, uint256 quantity)[])",
]);

export const operatorRegistryAbi = parseAbi([
  "function setOperatorApprovalForPool(address pool, address operator, bytes4[] selectors, bool approved)",
  "function isApprovedForPool(address pool, address owner, address operator, bytes4 selector) view returns (bool)",
]);

export const multicall3Abi = parseAbi([
  "struct Call3 { address target; bool allowFailure; bytes callData; }",
  "struct Result { bool success; bytes returnData; }",
  "function aggregate3(Call3[] calls) payable returns (Result[] returnData)",
  "function getBlockNumber() view returns (uint256 blockNumber)",
  "function getCurrentBlockTimestamp() view returns (uint256 timestamp)",
]);

export const somniaAgentsAbi = parseAbi([
  "struct Response { address validator; bytes result; uint8 status; uint256 receipt; uint256 timestamp; uint256 executionCost; }",
  "struct Request { uint256 id; address requester; address callbackAddress; bytes4 callbackSelector; address[] subcommittee; Response[] responses; uint256 responseCount; uint256 failureCount; uint256 threshold; uint256 createdAt; uint256 deadline; uint8 status; uint8 consensusType; uint256 remainingBudget; uint256 perAgentBudget; }",
  "function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes payload) payable returns (uint256 requestId)",
  "function getRequest(uint256 requestId) view returns (Request)",
  "function getRequestDeposit() view returns (uint256)",
  "event RequestCreated(uint256 indexed requestId, uint256 indexed agentId, uint256 perAgentBudget, bytes payload, address[] subcommittee)",
  "event RequestFinalized(uint256 indexed requestId, uint8 status)",
]);

export const priceOracleAbi = parseAbi([
  "function getPrices(string[] symbols, uint8 decimals) returns (uint256[] prices, uint8[] numSources, uint64[] lastUpdated)",
]);

export const marginBankEventsAbi = parseAbi([
  "event PositionUpdated(address indexed account, address indexed perpPool, int128 newSize, uint128 avgEntryPrice, int256 realizedPnl, int256 entryFundingIndex)",
]);
```

Replace `packages/core/src/index.ts` with:
```ts
export const BASANOS = "basanos" as const;
export * from "./config";
export * from "./abi";
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/core -- test/config.test.ts`
Expected: PASS — `6 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): Hideki config, operator selectors and ABIs`

---

### Task 3: Env loader and rulebook schema

**Files:**
- Create: `packages/core/src/env.ts`
- Create: `packages/core/src/rulebook.ts`
- Modify: `packages/core/src/node.ts`
- Modify: `packages/core/src/index.ts`
- Create: `rulebooks/tokyo-sprint.json`
- Create: `rulebooks/tokyo-sprint-demo.json`
- Test: `packages/core/test/env.test.ts`
- Test: `packages/core/test/rulebook.test.ts`

**Depends on:** Task 1, Task 2
**Effort:** medium
**Provides:** `type SecretName = "REFEREE_PK" | "ACCOUNT_A_PK" | "ACCOUNT_B_PK"`, `type AddressName = "REFEREE_ADDRESS" | "ACCOUNT_A_ADDRESS" | "ACCOUNT_B_ADDRESS" | "REGISTRY_ADDRESS"`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `rpcWss(env?: NodeJS.ProcessEnv): string`, `flag(name: "ORACLE_ENABLED", env?: NodeJS.ProcessEnv): boolean`, `interface Rulebook`, `canonicalJson(value: unknown): string`, `rulebookId(rb: Rulebook): Hex`, `parseRulebook(raw: unknown): Rulebook`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string }`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`
**Requires:** `RPC_HTTP_DEFAULT`, `RPC_WSS_DEFAULT`, `repoPath(rel: string): string`

- [ ] **Step 1: Write the rulebook files**

`rulebooks/tokyo-sprint.json`:
```json
{
  "schema": "basanos.rulebook/1",
  "name": "Tokyo Sprint",
  "variant": "standard",
  "label": "Tokyo Sprint",
  "chainId": 50383,
  "market": { "symbol": "BTC-PERP", "pool": "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0", "baseDecimals": 8 },
  "profitTargetBps": 150,
  "dailyLossBps": 150,
  "trailingDrawdownBps": 200,
  "maxExposureX": 15,
  "minDurationSec": 120,
  "timeLimitSec": 1800,
  "oracleSymbol": "BTC/USDC:PERP",
  "voidOn": ["flow", "foreignMarket", "grantRevoked"]
}
```

`rulebooks/tokyo-sprint-demo.json`:
```json
{
  "schema": "basanos.rulebook/1",
  "name": "Tokyo Sprint",
  "variant": "demo",
  "label": "Tokyo Sprint · Demo",
  "chainId": 50383,
  "market": { "symbol": "BTC-PERP", "pool": "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0", "baseDecimals": 8 },
  "profitTargetBps": 50,
  "dailyLossBps": 50,
  "trailingDrawdownBps": 75,
  "maxExposureX": 15,
  "minDurationSec": 60,
  "timeLimitSec": 900,
  "oracleSymbol": "BTC/USDC:PERP",
  "voidOn": ["flow", "foreignMarket", "grantRevoked"]
}
```

- [ ] **Step 2: Write the failing tests**

`packages/core/test/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { flag, requireAddress, requirePrivateKey, rpcHttp, rpcWss } from "../src/env";

const KEY = `0x${"11".repeat(32)}`;

describe("env", () => {
  it("returns a well-formed private key", () => {
    expect(requirePrivateKey("REFEREE_PK", { REFEREE_PK: KEY })).toBe(KEY);
  });
  it("names the variable but never echoes the value", () => {
    const bad = "0xdeadbeef";
    let message = "";
    try {
      requirePrivateKey("ACCOUNT_A_PK", { ACCOUNT_A_PK: bad });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("ACCOUNT_A_PK");
    expect(message).not.toContain(bad);
    expect(() => requirePrivateKey("ACCOUNT_B_PK", {})).toThrow(/ACCOUNT_B_PK is not set/);
  });
  it("validates addresses", () => {
    expect(requireAddress("REGISTRY_ADDRESS", { REGISTRY_ADDRESS: "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" })).toBe(
      "0x478769E1177C0773c43A593DCCc4Ad15F15F1394",
    );
    expect(() => requireAddress("REGISTRY_ADDRESS", { REGISTRY_ADDRESS: "nope" })).toThrow(/REGISTRY_ADDRESS/);
  });
  it("defaults the RPC endpoints and reads flags", () => {
    expect(rpcHttp({})).toBe("https://api.hideki.infra.testnet.somnia.network");
    expect(rpcWss({ HIDEKI_RPC_WSS: "wss://x/ws" })).toBe("wss://x/ws");
    expect(flag("ORACLE_ENABLED", { ORACLE_ENABLED: "TRUE" })).toBe(true);
    expect(flag("ORACLE_ENABLED", {})).toBe(false);
  });
});
```

`packages/core/test/rulebook.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { canonicalJson, parseRulebook, rulebookId } from "../src/rulebook";
import { loadRulebook } from "../src/node";

describe("canonicalJson", () => {
  it("sorts keys recursively and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe('{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}');
  });
  it("writes bigints as decimal strings", () => {
    expect(canonicalJson({ x: 10n ** 20n })).toBe('{"x":"100000000000000000000"}');
  });
});

describe("rulebooks", () => {
  it("loads both Tokyo Sprint variants", () => {
    const standard = loadRulebook("tokyo-sprint");
    const demo = loadRulebook("tokyo-sprint-demo");
    expect(standard.variant).toBe("standard");
    expect(demo.variant).toBe("demo");
    expect(demo.label).toBe("Tokyo Sprint · Demo");
    expect(standard.profitTargetBps).toBe(150);
    expect(demo.profitTargetBps).toBe(50);
    expect(rulebookId(standard)).not.toBe(rulebookId(demo));
  });
  it("hashes the canonical JSON, independent of key order", () => {
    const rb = loadRulebook("tokyo-sprint");
    expect(rulebookId(rb)).toBe(keccak256(toBytes(canonicalJson(rb))));
    const reordered = parseRulebook(Object.fromEntries(Object.entries(rb).reverse()));
    expect(rulebookId(reordered)).toBe(rulebookId(rb));
  });
  it("rejects a rulebook with a missing field", () => {
    const rb = loadRulebook("tokyo-sprint") as unknown as Record<string, unknown>;
    const broken = { ...rb };
    delete broken.profitTargetBps;
    expect(() => parseRulebook(broken)).toThrow(/profitTargetBps/);
  });
});
```

- [ ] **Step 3: Run to confirm they fail**
Run: `npm test -w @basanos/core -- test/env.test.ts test/rulebook.test.ts`
Expected: FAIL — `Failed to resolve import "../src/env"`.

- [ ] **Step 4: Write the implementation**

`packages/core/src/env.ts`:
```ts
import { existsSync } from "node:fs";
import { isAddress, type Address, type Hex } from "viem";
import { RPC_HTTP_DEFAULT, RPC_WSS_DEFAULT } from "./config";

export type SecretName = "REFEREE_PK" | "ACCOUNT_A_PK" | "ACCOUNT_B_PK";
export type AddressName = "REFEREE_ADDRESS" | "ACCOUNT_A_ADDRESS" | "ACCOUNT_B_ADDRESS" | "REGISTRY_ADDRESS";

/** Loads KEY=VALUE pairs from the git-ignored .env into process.env (existing values win). */
export function loadDotEnv(path = ".env"): boolean {
  if (!existsSync(path)) return false;
  process.loadEnvFile(path);
  return true;
}

/** Never includes the value in an error: keys must not reach logs. */
export function requirePrivateKey(name: SecretName, env: NodeJS.ProcessEnv = process.env): Hex {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} is not a 0x-prefixed 32-byte hex key`);
  return value as Hex;
}

export function requireAddress(name: AddressName, env: NodeJS.ProcessEnv = process.env): Address {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  if (!isAddress(value, { strict: false })) throw new Error(`${name} is not an address`);
  return value as Address;
}

export function rpcHttp(env: NodeJS.ProcessEnv = process.env): string {
  return env.HIDEKI_RPC_HTTP && env.HIDEKI_RPC_HTTP.length > 0 ? env.HIDEKI_RPC_HTTP : RPC_HTTP_DEFAULT;
}

export function rpcWss(env: NodeJS.ProcessEnv = process.env): string {
  return env.HIDEKI_RPC_WSS && env.HIDEKI_RPC_WSS.length > 0 ? env.HIDEKI_RPC_WSS : RPC_WSS_DEFAULT;
}

export function flag(name: "ORACLE_ENABLED", env: NodeJS.ProcessEnv = process.env): boolean {
  return (env[name] ?? "").toLowerCase() === "true";
}
```

`packages/core/src/rulebook.ts`:
```ts
import { isAddress, keccak256, toBytes, type Address, type Hex } from "viem";

export interface Rulebook {
  schema: "basanos.rulebook/1";
  name: string;
  variant: "standard" | "demo";
  label: string;
  chainId: number;
  market: { symbol: string; pool: Address; baseDecimals: number };
  profitTargetBps: number;
  dailyLossBps: number;
  trailingDrawdownBps: number;
  maxExposureX: number;
  minDurationSec: number;
  timeLimitSec: number;
  oracleSymbol: string;
  voidOn: string[];
}

/** JSON with object keys sorted recursively, no whitespace, bigints as decimal strings. */
export function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function rulebookId(rb: Rulebook): Hex {
  return keccak256(toBytes(canonicalJson(rb)));
}

function need<T>(ok: boolean, field: string, value: T): T {
  if (!ok) throw new Error(`rulebook field ${field} is missing or invalid`);
  return value;
}

export function parseRulebook(raw: unknown): Rulebook {
  const r = raw as Record<string, unknown>;
  const m = (r.market ?? {}) as Record<string, unknown>;
  const int = (k: string): number => need(Number.isInteger(r[k]) && (r[k] as number) >= 0, k, r[k] as number);
  return {
    schema: need(r.schema === "basanos.rulebook/1", "schema", "basanos.rulebook/1"),
    name: need(typeof r.name === "string", "name", r.name as string),
    variant: need(r.variant === "standard" || r.variant === "demo", "variant", r.variant as "standard" | "demo"),
    label: need(typeof r.label === "string", "label", r.label as string),
    chainId: int("chainId"),
    market: {
      symbol: need(typeof m.symbol === "string", "market.symbol", m.symbol as string),
      pool: need(typeof m.pool === "string" && isAddress(m.pool, { strict: false }), "market.pool", m.pool as Address),
      baseDecimals: need(Number.isInteger(m.baseDecimals), "market.baseDecimals", m.baseDecimals as number),
    },
    profitTargetBps: int("profitTargetBps"),
    dailyLossBps: int("dailyLossBps"),
    trailingDrawdownBps: int("trailingDrawdownBps"),
    maxExposureX: int("maxExposureX"),
    minDurationSec: int("minDurationSec"),
    timeLimitSec: int("timeLimitSec"),
    oracleSymbol: need(typeof r.oracleSymbol === "string", "oracleSymbol", r.oracleSymbol as string),
    voidOn: need(Array.isArray(r.voidOn), "voidOn", r.voidOn as string[]),
  };
}
```

Replace `packages/core/src/node.ts` with:
```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseRulebook, type Rulebook } from "./rulebook";

export * from "./env";

/** Absolute path of a repo-relative path (this file lives at packages/core/src/node.ts). */
export function repoPath(rel: string): string {
  return fileURLToPath(new URL(`../../../${rel}`, import.meta.url));
}

export const RULEBOOK_FILES = {
  "tokyo-sprint": "rulebooks/tokyo-sprint.json",
  "tokyo-sprint-demo": "rulebooks/tokyo-sprint-demo.json",
} as const;

export function loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook {
  return parseRulebook(JSON.parse(readFileSync(repoPath(RULEBOOK_FILES[name]), "utf8")));
}
```

Replace `packages/core/src/index.ts` with:
```ts
export const BASANOS = "basanos" as const;
export * from "./config";
export * from "./abi";
export * from "./rulebook";
```

- [ ] **Step 5: Run to confirm they pass (the gate)**
Run: `npm test -w @basanos/core -- test/env.test.ts test/rulebook.test.ts`
Expected: PASS — `9 passed`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): env loader and Tokyo Sprint rulebooks with canonical ids`

---

### Task 4: Snapshot multicall (block, time, mark and per-account equity in one call)

**Files:**
- Create: `packages/core/src/snapshot.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/snapshot.test.ts`

**Depends on:** Task 2, Task 3
**Effort:** medium
**Provides:** `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`, `interface Snapshot { blockNumber: bigint; timestamp: bigint; pool: Address; markOk: boolean; markPrice: bigint; accounts: AccountSnapshot[] }`, `snapshotCall(accounts: readonly Address[], pool: Address): { to: Address; data: Hex }`, `decodeSnapshot(result: Hex, accounts: readonly Address[], pool: Address): Snapshot`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`
**Requires:** `MARGIN_BANK`, `MULTICALL3`, `marginBankAbi`, `perpPoolAbi`, `multicall3Abi`

- [ ] **Step 1: Write the failing test**

`packages/core/test/snapshot.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionResult, type Address, type Hex } from "viem";
import { marginBankAbi, multicall3Abi, perpPoolAbi } from "../src/abi";
import { BTC_POOL, MULTICALL3 } from "../src/config";
import { decodeSnapshot, snapshotCall } from "../src/snapshot";

const A: Address = "0x00000000000000000000000000000000000000a1";
const B: Address = "0x00000000000000000000000000000000000000b2";

function ok(data: Hex) {
  return { success: true, returnData: data };
}

describe("snapshot", () => {
  it("batches block, timestamp, mark and three reads per account", () => {
    const call = snapshotCall([A, B], BTC_POOL);
    expect(call.to).toBe(MULTICALL3);
    const decoded = decodeFunctionData({ abi: multicall3Abi, data: call.data });
    expect(decoded.functionName).toBe("aggregate3");
    expect((decoded.args[0] as readonly unknown[]).length).toBe(3 + 2 * 3);
  });

  it("decodes equity, locked collateral, pools and size; a failed sub-call marks the account unpriceable", () => {
    const rows = [
      ok(encodeFunctionResult({ abi: multicall3Abi, functionName: "getBlockNumber", result: 46_725_618n })),
      ok(encodeFunctionResult({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp", result: 1_794_326_598n })),
      ok(encodeFunctionResult({ abi: perpPoolAbi, functionName: "tryGetMarkPrice", result: [true, 74_500n * 10n ** 18n] })),
      ok(encodeFunctionResult({ abi: marginBankAbi, functionName: "tryGetAccountEquity", result: [true, 990n * 10n ** 18n] })),
      ok(
        encodeFunctionResult({
          abi: marginBankAbi,
          functionName: "getAccountState",
          result: { unlockedCollateralBalance: 980n * 10n ** 18n, lockedCollateral: 10n * 10n ** 18n, activePerpPools: [BTC_POOL] },
        }),
      ),
      ok(
        encodeFunctionResult({
          abi: marginBankAbi,
          functionName: "getPosition",
          result: { size: -13_000n, avgEntryPrice: 74_000n * 10n ** 18n, entryFundingIndex: 0n, lastUpdatedTimestampNs: 1n },
        }),
      ),
      { success: false, returnData: "0x" as Hex },
      ok(
        encodeFunctionResult({
          abi: marginBankAbi,
          functionName: "getAccountState",
          result: { unlockedCollateralBalance: 0n, lockedCollateral: 0n, activePerpPools: [] },
        }),
      ),
      ok(
        encodeFunctionResult({
          abi: marginBankAbi,
          functionName: "getPosition",
          result: { size: 0n, avgEntryPrice: 0n, entryFundingIndex: 0n, lastUpdatedTimestampNs: 0n },
        }),
      ),
    ];
    const result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: rows });
    const snap = decodeSnapshot(result, [A, B], BTC_POOL);
    expect(snap.blockNumber).toBe(46_725_618n);
    expect(snap.timestamp).toBe(1_794_326_598n);
    expect(snap.markOk).toBe(true);
    expect(snap.markPrice).toBe(74_500n * 10n ** 18n);
    const [a, b] = snap.accounts;
    expect(a?.equityOk).toBe(true);
    expect(a?.totalEquity).toBe(1000n * 10n ** 18n);
    expect(a?.lockedCollateral).toBe(10n * 10n ** 18n);
    expect(a?.activePools).toEqual([BTC_POOL]);
    expect(a?.size).toBe(-13_000n);
    expect(b?.equityOk).toBe(false);
    expect(b?.totalEquity).toBe(0n);
  });

  it("rejects a result with the wrong number of rows", () => {
    const result = encodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", result: [] });
    expect(() => decodeSnapshot(result, [A], BTC_POOL)).toThrow(/expected 6 rows/);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/core -- test/snapshot.test.ts`
Expected: FAIL — `Failed to resolve import "../src/snapshot"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/snapshot.ts`:
```ts
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { marginBankAbi, multicall3Abi, perpPoolAbi } from "./abi";
import { MARGIN_BANK, MULTICALL3 } from "./config";

export interface AccountSnapshot {
  account: Address;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  totalEquity: bigint;
  activePools: Address[];
  size: bigint;
}

export interface Snapshot {
  blockNumber: bigint;
  timestamp: bigint;
  pool: Address;
  markOk: boolean;
  markPrice: bigint;
  accounts: AccountSnapshot[];
}

interface Row {
  success: boolean;
  returnData: Hex;
}

function calls(accounts: readonly Address[], pool: Address) {
  const head = [
    { target: MULTICALL3, allowFailure: true, callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getBlockNumber" }) },
    {
      target: MULTICALL3,
      allowFailure: true,
      callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" }),
    },
    { target: pool, allowFailure: true, callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "tryGetMarkPrice" }) },
  ];
  const perAccount = accounts.flatMap((account) => [
    {
      target: MARGIN_BANK,
      allowFailure: true,
      callData: encodeFunctionData({ abi: marginBankAbi, functionName: "tryGetAccountEquity", args: [account] }),
    },
    {
      target: MARGIN_BANK,
      allowFailure: true,
      callData: encodeFunctionData({ abi: marginBankAbi, functionName: "getAccountState", args: [account] }),
    },
    {
      target: MARGIN_BANK,
      allowFailure: true,
      callData: encodeFunctionData({ abi: marginBankAbi, functionName: "getPosition", args: [account, pool] }),
    },
  ]);
  return [...head, ...perAccount];
}

/** One Multicall3 call: usable as a somnia_watch eth_call or as a head/historical read. */
export function snapshotCall(accounts: readonly Address[], pool: Address): { to: Address; data: Hex } {
  return { to: MULTICALL3, data: encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls(accounts, pool)] }) };
}

export function decodeSnapshot(result: Hex, accounts: readonly Address[], pool: Address): Snapshot {
  const rows = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: result }) as readonly Row[];
  const expected = 3 + accounts.length * 3;
  if (rows.length !== expected) throw new Error(`snapshot: expected ${expected} rows, got ${rows.length}`);
  const row = (i: number): Row => rows[i] as Row;
  const blockNumber = row(0).success
    ? (decodeFunctionResult({ abi: multicall3Abi, functionName: "getBlockNumber", data: row(0).returnData }) as bigint)
    : 0n;
  const timestamp = row(1).success
    ? (decodeFunctionResult({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp", data: row(1).returnData }) as bigint)
    : 0n;
  let markOk = false;
  let markPrice = 0n;
  if (row(2).success) {
    const [okMark, price] = decodeFunctionResult({ abi: perpPoolAbi, functionName: "tryGetMarkPrice", data: row(2).returnData });
    markOk = okMark;
    markPrice = price;
  }
  const out: AccountSnapshot[] = accounts.map((account, i) => {
    const base = 3 + i * 3;
    const eqRow = row(base);
    const stRow = row(base + 1);
    const posRow = row(base + 2);
    let equityOk = false;
    let equity = 0n;
    if (eqRow.success) {
      const [okEq, value] = decodeFunctionResult({ abi: marginBankAbi, functionName: "tryGetAccountEquity", data: eqRow.returnData });
      equityOk = okEq;
      equity = value;
    }
    let lockedCollateral = 0n;
    let activePools: Address[] = [];
    if (stRow.success) {
      const st = decodeFunctionResult({ abi: marginBankAbi, functionName: "getAccountState", data: stRow.returnData });
      lockedCollateral = st.lockedCollateral;
      activePools = [...st.activePerpPools];
    } else {
      equityOk = false;
    }
    let size = 0n;
    if (posRow.success) {
      const pos = decodeFunctionResult({ abi: marginBankAbi, functionName: "getPosition", data: posRow.returnData });
      size = pos.size;
    }
    return { account, equityOk, equity, lockedCollateral, totalEquity: equityOk ? equity + lockedCollateral : 0n, activePools, size };
  });
  return { blockNumber, timestamp, pool, markOk, markPrice, accounts: out };
}

export async function readSnapshot(
  client: PublicClient,
  accounts: readonly Address[],
  pool: Address,
  blockNumber?: bigint,
): Promise<Snapshot> {
  const call = snapshotCall(accounts, pool);
  const res = await client.call({ to: call.to, data: call.data, ...(blockNumber === undefined ? {} : { blockNumber }) });
  if (!res.data) throw new Error("snapshot: the multicall returned no data");
  return decodeSnapshot(res.data, accounts, pool);
}
```

Replace `packages/core/src/index.ts` with:
```ts
export const BASANOS = "basanos" as const;
export * from "./config";
export * from "./abi";
export * from "./rulebook";
export * from "./snapshot";
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/core -- test/snapshot.test.ts`
Expected: PASS — `3 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): snapshot multicall for block, time, mark and account equity`

---

### Task 5: Raw somnia_watch client with resubscribe and gap reporting

**Files:**
- Create: `packages/core/src/watch.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/watch.test.ts`

**Depends on:** Task 1, Task 4
**Effort:** high
**Provides:** `interface WatchFilter { address: Address | readonly Address[]; topics?: readonly (Hex | readonly Hex[] | null)[]; ethCalls: readonly { to: Address; data: Hex }[]; pushChangesOnly?: boolean }`, `interface WatchPush { address: Address; topics: Hex[]; data: Hex; simulationResults: Hex[] }`, `interface WatchHandlers { onPush: (push: WatchPush) => void; onConnected?: (info: { subscriptionId: string; reconnects: number }) => void; onGap?: (info: { atMs: number; reason: string }) => void }`, `interface WatchOptions { initialBackoffMs?: number; maxBackoffMs?: number; WebSocketImpl?: typeof WebSocket }`, `interface WatchHandle { close: () => void; readonly connected: boolean }`, `watchParams(filter: WatchFilter): Record<string, unknown>`, `startWatch(url: string, filter: WatchFilter, handlers: WatchHandlers, opts?: WatchOptions): WatchHandle`
**Requires:** `@basanos/core package with exports "." -> src/index.ts and "./node" -> src/node.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/watch.test.ts`:
```ts
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as ServerSocket } from "ws";
import { startWatch, watchParams, type WatchHandle, type WatchPush } from "../src/watch";

const FILTER = {
  address: "0x1998C88D54a240b8C671493f27f58eC416b81D7F" as const,
  ethCalls: [{ to: "0xcA11bde05977b3631167028862bE2a173976CA11" as const, data: "0x42cbb15c" as const }],
  pushChangesOnly: true,
};

let server: WebSocketServer | null = null;
let handle: WatchHandle | null = null;

afterEach(() => {
  handle?.close();
  handle = null;
  server?.close();
  server = null;
});

function serve(onSocket: (sock: ServerSocket, n: number, params: unknown) => void): Promise<string> {
  return new Promise((resolve) => {
    let n = 0;
    server = new WebSocketServer({ port: 0 }, () => {
      const { port } = server?.address() as AddressInfo;
      resolve(`ws://127.0.0.1:${port}`);
    });
    server.on("connection", (sock) => {
      n += 1;
      const mine = n;
      sock.on("message", (raw) => {
        const msg = JSON.parse(String(raw)) as { id: number; params: unknown[] };
        sock.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: `0xsub${mine}` }));
        onSocket(sock, mine, msg.params[1]);
      });
    });
  });
}

const PUSH: WatchPush = {
  address: "0x1998c88d54a240b8c671493f27f58ec416b81d7f",
  topics: ["0x01"],
  data: "0x",
  simulationResults: ["0xaa"],
};

describe("watchParams", () => {
  it("maps the filter to somnia_watch request fields", () => {
    expect(watchParams(FILTER)).toEqual({
      address: FILTER.address,
      eth_calls: FILTER.ethCalls,
      push_changes_only: true,
    });
  });
});

describe("startWatch", () => {
  it("subscribes with somnia_watch and delivers pushes", async () => {
    let seenParams: unknown = null;
    const url = await serve((sock, _n, params) => {
      seenParams = params;
      sock.send(JSON.stringify({ jsonrpc: "2.0", method: "eth_subscription", params: { subscription: "0xsub1", result: PUSH } }));
    });
    const push = await new Promise<WatchPush>((resolve) => {
      handle = startWatch(url, FILTER, { onPush: resolve });
    });
    expect(push.simulationResults).toEqual(["0xaa"]);
    expect(seenParams).toEqual(watchParams(FILTER));
  });

  it("reports one gap on disconnect, then resubscribes", async () => {
    const url = await serve((sock, n) => {
      if (n === 1) setTimeout(() => sock.terminate(), 20);
    });
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      handle = startWatch(
        url,
        FILTER,
        {
          onPush: () => undefined,
          onConnected: ({ reconnects }) => {
            events.push(`connected:${reconnects}`);
            if (reconnects === 1) resolve();
          },
          onGap: () => events.push("gap"),
        },
        { initialBackoffMs: 20, maxBackoffMs: 100 },
      );
    });
    expect(events).toEqual(["connected:0", "gap", "connected:1"]);
    expect(handle?.connected).toBe(true);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/core -- test/watch.test.ts`
Expected: FAIL — `Failed to resolve import "../src/watch"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/watch.ts`:
```ts
import type { Address, Hex } from "viem";

export interface WatchFilter {
  address: Address | readonly Address[];
  topics?: readonly (Hex | readonly Hex[] | null)[];
  ethCalls: readonly { to: Address; data: Hex }[];
  pushChangesOnly?: boolean;
}

export interface WatchPush {
  address: Address;
  topics: Hex[];
  data: Hex;
  simulationResults: Hex[];
}

export interface WatchHandlers {
  onPush: (push: WatchPush) => void;
  onConnected?: (info: { subscriptionId: string; reconnects: number }) => void;
  onGap?: (info: { atMs: number; reason: string }) => void;
}

export interface WatchOptions {
  initialBackoffMs?: number;
  maxBackoffMs?: number;
  WebSocketImpl?: typeof WebSocket;
}

export interface WatchHandle {
  close: () => void;
  readonly connected: boolean;
}

/** The somnia_watch request object (eth_getLogs-style filter plus eth_calls). */
export function watchParams(filter: WatchFilter): Record<string, unknown> {
  return {
    address: filter.address,
    ...(filter.topics ? { topics: filter.topics } : {}),
    eth_calls: filter.ethCalls,
    ...(filter.pushChangesOnly ? { push_changes_only: true } : {}),
  };
}

interface RpcMessage {
  id?: number;
  result?: unknown;
  error?: { message?: string };
  method?: string;
  params?: { result?: WatchPush };
}

/**
 * Subscribes with somnia_watch and keeps the subscription alive. The node does not buffer events across
 * a disconnect, so every outage is reported once through onGap; the caller must re-read state at head
 * before trusting pushes again (spec §8, R3). Reconnects back off from initialBackoffMs, doubling to
 * maxBackoffMs, and the backoff resets after a successful subscribe.
 */
export function startWatch(url: string, filter: WatchFilter, handlers: WatchHandlers, opts: WatchOptions = {}): WatchHandle {
  const Impl = opts.WebSocketImpl ?? globalThis.WebSocket;
  const initial = opts.initialBackoffMs ?? 500;
  const max = opts.maxBackoffMs ?? 30_000;
  let socket: WebSocket | null = null;
  let closedByUser = false;
  let connected = false;
  let reconnects = 0;
  let backoff = initial;
  let gapReported = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const detach = (): void => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {
      // the socket is already closed
    }
    socket = null;
  };

  const fail = (reason: string): void => {
    if (closedByUser) return;
    connected = false;
    if (!gapReported) {
      gapReported = true;
      handlers.onGap?.({ atMs: Date.now(), reason });
    }
    detach();
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      reconnects += 1;
      connect();
    }, backoff);
    backoff = Math.min(backoff * 2, max);
  };

  const connect = (): void => {
    const sock = new Impl(url);
    socket = sock;
    sock.onopen = () => {
      sock.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_subscribe", params: ["somnia_watch", watchParams(filter)] }));
    };
    sock.onmessage = (ev: MessageEvent) => {
      const msg = JSON.parse(String(ev.data)) as RpcMessage;
      if (msg.id === 1) {
        if (typeof msg.result === "string") {
          connected = true;
          gapReported = false;
          backoff = initial;
          handlers.onConnected?.({ subscriptionId: msg.result, reconnects });
        } else {
          fail(`subscribe rejected: ${msg.error?.message ?? "no result"}`);
        }
        return;
      }
      if (msg.method === "eth_subscription" && msg.params?.result) handlers.onPush(msg.params.result);
    };
    sock.onclose = () => fail("socket closed");
    sock.onerror = () => fail("socket error");
  };

  connect();

  return {
    close: () => {
      closedByUser = true;
      connected = false;
      if (timer) clearTimeout(timer);
      timer = null;
      detach();
    },
    get connected() {
      return connected;
    },
  };
}
```

Replace `packages/core/src/index.ts` with:
```ts
export const BASANOS = "basanos" as const;
export * from "./config";
export * from "./abi";
export * from "./rulebook";
export * from "./snapshot";
export * from "./watch";
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/core -- test/watch.test.ts`
Expected: PASS — `3 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): somnia_watch client with resubscribe and gap reporting`

---

### Task 6: Close-plan math (IOC price, lot alignment, leverage sizing)

**Files:**
- Create: `packages/core/src/close.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/close.test.ts`

**Depends on:** Task 1, Task 5
**Effort:** medium
**Provides:** `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `interface OrderPlan { isBid: boolean; quantity: bigint; price: bigint }`, `CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100]`, `alignDown(x: bigint, step: bigint): bigint`, `alignUp(x: bigint, step: bigint): bigint`, `iocPrice(isBid: boolean, mark: bigint, tickSize: bigint, slippageBps: number): bigint`, `planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null`, `planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`
**Requires:** `@basanos/core package with exports "." -> src/index.ts and "./node" -> src/node.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/close.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { alignDown, alignUp, iocPrice, planClose, planOpen, quantityForLeverage, type BookParams } from "../src/close";

const E18 = 10n ** 18n;
const MARK = 74_500n * E18;
const BOOK: BookParams = { tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n };

describe("alignment", () => {
  it("aligns down and up to a step", () => {
    expect(alignDown(12_500n, 1_000n)).toBe(12_000n);
    expect(alignUp(12_500n, 1_000n)).toBe(13_000n);
    expect(alignUp(13_000n, 1_000n)).toBe(13_000n);
    expect(() => alignDown(1n, 0n)).toThrow(/step/);
  });
});

describe("iocPrice", () => {
  it("prices a sell below the mark and a buy above, on the tick", () => {
    expect(iocPrice(false, MARK, BOOK.tickSize, 20)).toBe(74_351n * E18);
    expect(iocPrice(true, MARK, BOOK.tickSize, 20)).toBe(74_649n * E18);
  });
});

describe("planClose", () => {
  it("closes a long with a sell sized to the position", () => {
    expect(planClose(13_000n, MARK, BOOK, 20)).toEqual({ isBid: false, quantity: 13_000n, price: 74_351n * E18 });
  });
  it("closes a short with a buy, lot-aligned down", () => {
    expect(planClose(-12_500n, MARK, BOOK, 20)).toEqual({ isBid: true, quantity: 12_000n, price: 74_649n * E18 });
  });
  it("returns null when flat or below one lot", () => {
    expect(planClose(0n, MARK, BOOK, 20)).toBeNull();
    expect(planClose(500n, MARK, BOOK, 20)).toBeNull();
  });
});

describe("planOpen and sizing", () => {
  it("refuses a quantity below the market minimum", () => {
    expect(() => planOpen(true, 12_000n, MARK, BOOK, 20)).toThrow(/minQuantity/);
  });
  it("sizes 12x on 1,000 USDso at 74,500", () => {
    expect(quantityForLeverage(1_000n * E18, 12, MARK, 8, BOOK)).toBe(16_107_000n);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/core -- test/close.test.ts`
Expected: FAIL — `Failed to resolve import "../src/close"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/close.ts`:
```ts
export interface BookParams {
  tickSize: bigint;
  minQuantity: bigint;
  lotSize: bigint;
}

export interface OrderPlan {
  isBid: boolean;
  quantity: bigint;
  price: bigint;
}

/** The referee widens the IOC price band on each retry (spec §8). */
export const CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100] as const;

export function alignDown(x: bigint, step: bigint): bigint {
  if (step <= 0n) throw new Error("alignDown: step must be positive");
  return x - (x % step);
}

export function alignUp(x: bigint, step: bigint): bigint {
  if (step <= 0n) throw new Error("alignUp: step must be positive");
  const r = x % step;
  return r === 0n ? x : x + (step - r);
}

/** An IOC limit price "through the book with slippage room": above the mark to buy, below to sell. */
export function iocPrice(isBid: boolean, mark: bigint, tickSize: bigint, slippageBps: number): bigint {
  if (mark <= 0n) throw new Error("iocPrice: mark must be positive");
  const s = BigInt(slippageBps);
  return isBid ? alignUp((mark * (10_000n + s)) / 10_000n, tickSize) : alignDown((mark * (10_000n - s)) / 10_000n, tickSize);
}

/** The opposite-side IOC that closes `size` (signed, raw base units). There is no reduce-only flag. */
export function planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null {
  if (size === 0n) return null;
  const abs = size < 0n ? -size : size;
  const quantity = alignDown(abs, book.lotSize);
  if (quantity === 0n) return null;
  const isBid = size < 0n;
  return { isBid, quantity, price: iocPrice(isBid, mark, book.tickSize, slippageBps) };
}

export function planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan {
  const q = alignDown(quantity, book.lotSize);
  if (q < book.minQuantity) throw new Error(`planOpen: quantity ${q} is below minQuantity ${book.minQuantity}`);
  return { isBid, quantity: q, price: iocPrice(isBid, mark, book.tickSize, slippageBps) };
}

/** Base quantity whose notional is `leverageX` times `equity` (both 18-decimal quote units). */
export function quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint {
  if (mark <= 0n) throw new Error("quantityForLeverage: mark must be positive");
  const notional = equity * BigInt(leverageX);
  return alignDown((notional * 10n ** BigInt(baseDecimals)) / mark, book.lotSize);
}
```

Replace `packages/core/src/index.ts` with:
```ts
export const BASANOS = "basanos" as const;
export * from "./config";
export * from "./abi";
export * from "./rulebook";
export * from "./snapshot";
export * from "./watch";
export * from "./close";
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/core -- test/close.test.ts`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): close-plan math for IOC closes and leverage sizing`

---

### Task 7: Spike package — evidence writer, checker and RPC helpers

**Files:**
- Create: `packages/spike/package.json`
- Create: `packages/spike/tsconfig.json`
- Create: `packages/spike/vitest.config.ts`
- Create: `packages/spike/src/evidence.ts`
- Create: `packages/spike/src/check-evidence.ts`
- Create: `packages/spike/src/rpc.ts`
- Create: `packages/spike/src/find-active.ts`
- Test: `packages/spike/test/evidence.test.ts`

**Depends on:** Task 1, Task 2, Task 3
**Effort:** medium
**Provides:** `type EvidenceName = "g1a-close" | "g1b-watch" | "g1c-history" | "g1d-oracle" | "r1-indexer" | "tape"`, `evidencePath(name: EvidenceName): string`, `toJsonSafe(value: unknown): unknown`, `writeEvidence(name: EvidenceName, data: Record<string, unknown>): string`, `readEvidence(name: EvidenceName): Record<string, unknown> | null`, `checkEvidence(name: EvidenceName, data: Record<string, unknown> | null): string[]`, `publicClient(): PublicClient`, `walletFor(pk: Hex): viem WalletClient bound to CHAIN and the key's account`, `marketsFor(pk?: Hex): SomniaMarkets`, `pickMostFrequent(accounts: readonly Address[]): Address | null`, `findActiveAccount(client: PublicClient, windows?: number): Promise<Address>`, `CLI: npx tsx packages/spike/src/check-evidence.ts <name...> -> prints PASS or FAIL lines, exit 0 only when all PASS`
**Requires:** `CHAIN (hidekiTestnet, id 50383)`, `INDEXER_URL`, `HIDEKI_ADDRESSES`, `MARGIN_BANK`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `repoPath(rel: string): string`

- [ ] **Step 1: Write the package files**

`packages/spike/package.json`:
```json
{
  "name": "@basanos/spike",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@basanos/core": "*",
    "@somnia-chain/markets-sdk": "0.33.0",
    "viem": "2.57.12"
  }
}
```

`packages/spike/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/spike/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 2: Write the failing test**

`packages/spike/test/evidence.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { checkEvidence, toJsonSafe } from "../src/evidence";
import { pickMostFrequent } from "../src/find-active";

describe("toJsonSafe", () => {
  it("turns bigints into decimal strings, deeply", () => {
    expect(toJsonSafe({ a: 1n, b: [2n, { c: 3n }], d: "x" })).toEqual({ a: "1", b: ["2", { c: "3" }], d: "x" });
  });
});

describe("checkEvidence", () => {
  it("flags a missing file", () => {
    expect(checkEvidence("g1c-history", null)).toEqual(["g1c-history: evidence file is missing"]);
  });
  it("accepts a complete history file and rejects an empty one", () => {
    const good = { account: "0x1", depths: [{ back: 10, block: "1", ok: true }], maxServedBack: 10 };
    expect(checkEvidence("g1c-history", good)).toEqual([]);
    expect(checkEvidence("g1c-history", { account: "0x1", depths: [] })).not.toEqual([]);
  });
  it("requires ok: true and a flat end state for the referee close", () => {
    const base = {
      ok: true,
      txs: [
        { label: "grant", hash: "0x1", status: "success" },
        { label: "open", hash: "0x2", status: "success" },
        { label: "close", hash: "0x3", status: "success" },
      ],
      finalPositionSize: "0",
      leverage: { voucherLeverageCapX: 20 },
      entry: { costBps: 1.25 },
      costs: { totalWei: "1" },
    };
    expect(checkEvidence("g1a-close", base)).toEqual([]);
    expect(checkEvidence("g1a-close", { ...base, ok: false })).toContain("g1a-close: ok is not true (STOP and escalate)");
    expect(checkEvidence("g1a-close", { ...base, finalPositionSize: "13000" })).not.toEqual([]);
  });
  it("accepts an oracle file whatever the final status, as long as it was recorded", () => {
    expect(checkEvidence("g1d-oracle", { requestId: "7", finalStatus: "TimedOut", symbols: [] })).toEqual([]);
    expect(checkEvidence("g1d-oracle", { requestId: "7" })).not.toEqual([]);
  });
  it("needs three indexer reads, a watch with pushes and a tape with more than 100 points", () => {
    expect(checkEvidence("r1-indexer", { reads: [{}, {}, {}] })).toEqual([]);
    expect(checkEvidence("g1b-watch", { pushes: 3, blockNumbers: ["1"], timestampUnit: "seconds", equityDecoded: true })).toEqual([]);
    expect(checkEvidence("tape", { pool: "0x1", points: Array.from({ length: 101 }, (_, i) => ({ block: String(i + 1), ts: String(i + 2), mark: "3" })) })).toEqual([]);
    expect(checkEvidence("tape", { pool: "0x1", points: [] })).not.toEqual([]);
  });
});

describe("pickMostFrequent", () => {
  it("returns the address seen most often, or null", () => {
    expect(pickMostFrequent([])).toBeNull();
    expect(pickMostFrequent(["0xa", "0xb", "0xb"] as `0x${string}`[])).toBe("0xb");
  });
});
```

- [ ] **Step 3: Run to confirm it fails**
Run: `npm install`
Expected: exits 0 (links the new workspace).
Run: `npm test -w @basanos/spike`
Expected: FAIL — `Failed to resolve import "../src/evidence"`.

- [ ] **Step 4: Write the implementation**

`packages/spike/src/evidence.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { repoPath } from "@basanos/core/node";

export type EvidenceName = "g1a-close" | "g1b-watch" | "g1c-history" | "g1d-oracle" | "r1-indexer" | "tape";

export function evidencePath(name: EvidenceName): string {
  return name === "tape" ? repoPath("packages/core/test/fixtures/btc-tape.json") : repoPath(`docs/evidence/${name}.json`);
}

export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => toJsonSafe(v));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

export function writeEvidence(name: EvidenceName, data: Record<string, unknown>): string {
  const path = evidencePath(name);
  mkdirSync(dirname(path), { recursive: true });
  const body = { evidence: name, writtenAt: new Date().toISOString(), ...data };
  writeFileSync(path, `${JSON.stringify(toJsonSafe(body), null, 2)}\n`);
  return path;
}

export function readEvidence(name: EvidenceName): Record<string, unknown> | null {
  const path = evidencePath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

export function checkEvidence(name: EvidenceName, data: Record<string, unknown> | null): string[] {
  if (!data) return [`${name}: evidence file is missing`];
  const p: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) p.push(`${name}: ${msg}`);
  };
  switch (name) {
    case "g1a-close": {
      need(data.ok === true, "ok is not true (STOP and escalate)");
      const txs = isArr(data.txs) ? (data.txs as Record<string, unknown>[]) : [];
      need(txs.length >= 2, "fewer than 2 transactions (open and close) recorded");
      need(
        txs.every((t) => typeof t.hash === "string" && typeof t.label === "string"),
        "every tx needs a label and a hash",
      );
      need(
        txs.some((t) => t.label === "close" && t.status === "success"),
        "no successful referee close tx",
      );
      need(data.finalPositionSize === "0", "the account is not flat at the end");
      const lev = (data.leverage ?? {}) as Record<string, unknown>;
      need(typeof lev.voucherLeverageCapX === "number", "leverage.voucherLeverageCapX missing");
      const entry = (data.entry ?? null) as Record<string, unknown> | null;
      need(entry !== null && typeof entry.costBps === "number", "entry fill vs mark missing");
      need(typeof data.costs === "object" && data.costs !== null, "costs missing");
      break;
    }
    case "g1b-watch":
      need(typeof data.pushes === "number" && data.pushes > 0, "no pushes recorded");
      need(isArr(data.blockNumbers) && data.blockNumbers.length > 0, "no block numbers decoded");
      need(data.timestampUnit === "seconds" || data.timestampUnit === "milliseconds", "timestampUnit missing");
      need(data.equityDecoded === true, "the attached equity multicall was not decoded");
      break;
    case "g1c-history":
      need(typeof data.account === "string", "account missing");
      need(isArr(data.depths) && data.depths.length > 0, "no depths measured");
      need(typeof data.maxServedBack === "number", "maxServedBack missing");
      break;
    case "g1d-oracle":
      need(typeof data.requestId === "string", "requestId missing");
      need(typeof data.finalStatus === "string", "finalStatus missing");
      need(isArr(data.symbols), "symbols missing");
      break;
    case "r1-indexer":
      need(isArr(data.reads) && data.reads.length === 3, "expected exactly 3 indexer reads");
      break;
    case "tape":
      need(typeof data.pool === "string", "pool missing");
      need(isArr(data.points) && data.points.length > 100, "fewer than 101 tape points (the tape-proof test needs more than 100)");
      break;
  }
  return p;
}
```

`packages/spike/src/check-evidence.ts`:
```ts
import { checkEvidence, readEvidence, type EvidenceName } from "./evidence";

const NAMES: EvidenceName[] = ["g1a-close", "g1b-watch", "g1c-history", "g1d-oracle", "r1-indexer", "tape"];
const asked = process.argv.slice(2) as EvidenceName[];
if (asked.length === 0 || asked.some((n) => !NAMES.includes(n))) {
  console.error(`usage: check-evidence <${NAMES.join("|")}>...`);
  process.exit(2);
}
let failed = 0;
for (const name of asked) {
  const problems = checkEvidence(name, readEvidence(name));
  if (problems.length === 0) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    for (const p of problems) console.log(`FAIL ${p}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
```

`packages/spike/src/rpc.ts`:
```ts
import { createPublicClient, createWalletClient, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { CHAIN, HIDEKI_ADDRESSES, INDEXER_URL } from "@basanos/core";
import { rpcHttp } from "@basanos/core/node";

export function publicClient(): PublicClient {
  return createPublicClient({ chain: CHAIN, transport: http(rpcHttp()) }) as unknown as PublicClient;
}

/** Inferred return type: the wallet is bound to CHAIN and the key's account, so writes need neither. */
export function walletFor(pk: Hex) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(rpcHttp()) });
}

/** Read-only without a key; a trader-capable instance with one. */
export function marketsFor(pk?: Hex): SomniaMarkets {
  return new SomniaMarkets({
    chain: CHAIN,
    indexerUrl: INDEXER_URL,
    addresses: HIDEKI_ADDRESSES,
    ...(pk ? { privateKey: pk } : {}),
  });
}
```

`packages/spike/src/find-active.ts`:
```ts
import { getAddress, toEventSelector, type Address, type PublicClient } from "viem";
import { MARGIN_BANK } from "@basanos/core";

const POSITION_UPDATED = toEventSelector(
  "event PositionUpdated(address indexed account, address indexed perpPool, int128 newSize, uint128 avgEntryPrice, int256 realizedPnl, int256 entryFundingIndex)",
);

export function pickMostFrequent(accounts: readonly Address[]): Address | null {
  const counts = new Map<Address, number>();
  for (const a of accounts) counts.set(a, (counts.get(a) ?? 0) + 1);
  let best: Address | null = null;
  let bestN = 0;
  for (const [a, n] of counts) {
    if (n > bestN) {
      best = a;
      bestN = n;
    }
  }
  return best;
}

/** A recently trading account, from MarginBank PositionUpdated logs (eth_getLogs ranges are capped at 1,000 blocks). */
export async function findActiveAccount(client: PublicClient, windows = 20): Promise<Address> {
  const head = await client.getBlockNumber();
  const seen: Address[] = [];
  for (let w = 0; w < windows && seen.length === 0; w++) {
    const toBlock = head - BigInt(w) * 1_000n;
    const fromBlock = toBlock - 999n;
    const logs = await client.request({
      method: "eth_getLogs",
      params: [{ address: MARGIN_BANK, topics: [POSITION_UPDATED], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }],
    });
    for (const log of logs as { topics: string[] }[]) {
      const t = log.topics[1];
      if (t) seen.push(getAddress(`0x${t.slice(26)}`));
    }
  }
  const best = pickMostFrequent(seen);
  if (!best) throw new Error("findActiveAccount: no PositionUpdated logs in the scanned windows");
  return best;
}
```

- [ ] **Step 5: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/spike`
Expected: PASS — `7 passed`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(spike): evidence writer, checker and RPC helpers`

---

### Task 8: Read-only spike scripts — history depth + R1 reads, watch with equity, BTC mark tape

**Files:**
- Create: `packages/spike/src/lib.ts`
- Create: `packages/spike/src/history.ts`
- Create: `packages/spike/src/watch-equity.ts`
- Create: `packages/spike/src/tape.ts`
- Test: `packages/spike/test/lib.test.ts`

**Depends on:** Task 2, Task 3, Task 4, Task 5, Task 7
**Effort:** medium
**Provides:** `HISTORY_DEPTHS: readonly number[]`, `depthBlocks(head: bigint, depths: readonly number[]): { back: number; block: bigint }[]`, `maxServed(results: readonly { back: number; ok: boolean }[]): number`, `timestampUnit(chainTs: bigint, nowMs: number): "seconds" | "milliseconds"`, `interface TapePoint { block: bigint; ts: bigint; mark: bigint }`, `appendTapePoint(points: TapePoint[], p: TapePoint): TapePoint[]`, `CLI: npx tsx packages/spike/src/history.ts [account]`, `CLI: npx tsx packages/spike/src/watch-equity.ts [seconds]`, `CLI: npx tsx packages/spike/src/tape.ts [seconds]`
**Requires:** `BTC_POOL`, `MARGIN_BANK`, `PRICE_FEED_SCHEDULER`, `marginBankAbi`, `snapshotCall(accounts: readonly Address[], pool: Address): { to: Address; data: Hex }`, `decodeSnapshot(result: Hex, accounts: readonly Address[], pool: Address): Snapshot`, `startWatch(url: string, filter: WatchFilter, handlers: WatchHandlers, opts?: WatchOptions): WatchHandle`, `writeEvidence(name: EvidenceName, data: Record<string, unknown>): string`, `publicClient(): PublicClient`, `marketsFor(pk?: Hex): SomniaMarkets`, `findActiveAccount(client: PublicClient, windows?: number): Promise<Address>`, `loadDotEnv(path?: string): boolean`, `rpcWss(env?: NodeJS.ProcessEnv): string`

These scripts are read-only: no key, no transaction, no STT. The Somnia SDK and the RPC are untrusted network input; the scripts only record what they return.

- [ ] **Step 1: Write the failing test**

`packages/spike/test/lib.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { HISTORY_DEPTHS, appendTapePoint, depthBlocks, maxServed, timestampUnit } from "../src/lib";

describe("history depth helpers", () => {
  it("lists depths from 10 blocks to 20M", () => {
    expect(HISTORY_DEPTHS[0]).toBe(10);
    expect(HISTORY_DEPTHS.at(-1)).toBe(20_000_000);
  });
  it("skips depths that would go below block 0", () => {
    expect(depthBlocks(1_500n, [10, 1_000, 36_000])).toEqual([
      { back: 10, block: 1_490n },
      { back: 1_000, block: 500n },
    ]);
  });
  it("reports the deepest contiguous depth that was served", () => {
    expect(maxServed([{ back: 10, ok: true }, { back: 1_000, ok: true }, { back: 36_000, ok: false }, { back: 864_000, ok: true }])).toBe(1_000);
    expect(maxServed([{ back: 10, ok: false }])).toBe(0);
  });
});

describe("timestampUnit", () => {
  it("tells seconds from milliseconds against the wall clock", () => {
    expect(timestampUnit(1_794_326_598n, 1_794_326_600_000)).toBe("seconds");
    expect(timestampUnit(1_794_326_598_000n, 1_794_326_600_000)).toBe("milliseconds");
  });
});

describe("appendTapePoint", () => {
  it("keeps one point per block, in order", () => {
    let pts = appendTapePoint([], { block: 1n, ts: 10n, mark: 5n });
    pts = appendTapePoint(pts, { block: 1n, ts: 10n, mark: 6n });
    pts = appendTapePoint(pts, { block: 2n, ts: 11n, mark: 7n });
    pts = appendTapePoint(pts, { block: 1n, ts: 10n, mark: 8n });
    expect(pts).toEqual([
      { block: 1n, ts: 10n, mark: 5n },
      { block: 2n, ts: 11n, mark: 7n },
    ]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/spike -- test/lib.test.ts`
Expected: FAIL — `Failed to resolve import "../src/lib"`.

- [ ] **Step 3: Write the pure helpers**

`packages/spike/src/lib.ts`:
```ts
export const HISTORY_DEPTHS: readonly number[] = [10, 1_000, 36_000, 864_000, 3_000_000, 10_000_000, 20_000_000];

export function depthBlocks(head: bigint, depths: readonly number[]): { back: number; block: bigint }[] {
  return depths.filter((d) => BigInt(d) <= head).map((back) => ({ back, block: head - BigInt(back) }));
}

/** The deepest depth such that it and every shallower depth were served. */
export function maxServed(results: readonly { back: number; ok: boolean }[]): number {
  let deepest = 0;
  for (const r of results) {
    if (!r.ok) break;
    deepest = r.back;
  }
  return deepest;
}

export function timestampUnit(chainTs: bigint, nowMs: number): "seconds" | "milliseconds" {
  const asSeconds = Math.abs(Number(chainTs) - nowMs / 1000);
  const asMillis = Math.abs(Number(chainTs) - nowMs);
  return asSeconds <= asMillis ? "seconds" : "milliseconds";
}

export interface TapePoint {
  block: bigint;
  ts: bigint;
  mark: bigint;
}

export function appendTapePoint(points: TapePoint[], p: TapePoint): TapePoint[] {
  const last = points.at(-1);
  if (last && p.block <= last.block) return points;
  return [...points, p];
}
```

- [ ] **Step 4: Run to confirm the helpers pass**
Run: `npm test -w @basanos/spike -- test/lib.test.ts`
Expected: PASS — `5 passed`.

- [ ] **Step 5: Write the three scripts**

`packages/spike/src/history.ts` (G1(c) history depth with the equity view, and R1's three indexer reads):
```ts
import { getAddress, type Address } from "viem";
import { MARGIN_BANK, marginBankAbi } from "@basanos/core";
import { loadDotEnv } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { findActiveAccount } from "./find-active";
import { HISTORY_DEPTHS, depthBlocks, maxServed } from "./lib";
import { marketsFor, publicClient } from "./rpc";

loadDotEnv();
const client = publicClient();
const account: Address = process.argv[2] ? getAddress(process.argv[2]) : await findActiveAccount(client);
const head = await client.getBlockNumber();
console.log(`history: account ${account}, head ${head}`);

const depths: { back: number; block: bigint; ok: boolean; equityOk?: boolean; equity?: bigint; error?: string }[] = [];
for (const { back, block } of depthBlocks(head, HISTORY_DEPTHS)) {
  try {
    const [equityOk, equity] = await client.readContract({
      address: MARGIN_BANK,
      abi: marginBankAbi,
      functionName: "tryGetAccountEquity",
      args: [account],
      blockNumber: block,
    });
    depths.push({ back, block, ok: true, equityOk, equity });
    console.log(`  back ${back}: served (equityOk=${equityOk})`);
  } catch (e) {
    depths.push({ back, block, ok: false, error: (e as Error).message.slice(0, 300) });
    console.log(`  back ${back}: NOT served`);
  }
}
writeEvidence("g1c-history", { account, head, depths, maxServedBack: maxServed(depths), call: "MarginBank.tryGetAccountEquity(account)" });

const markets = marketsFor();
const reads: { name: string; ok: boolean; rows?: number; sample?: unknown; error?: string }[] = [];
async function attempt(name: string, fn: () => Promise<unknown[]>): Promise<void> {
  try {
    const rows = await fn();
    reads.push({ name, ok: true, rows: rows.length, sample: rows.slice(0, 2) });
    console.log(`  ${name}: ok, ${rows.length} rows`);
  } catch (e) {
    const err = e as Error;
    reads.push({ name, ok: false, error: `${err.name}: ${err.message}`.slice(0, 600) });
    console.log(`  ${name}: FAILED (${err.name})`);
  }
}
await attempt("getMarginEvents", () => markets.client.getMarginEvents(account));
await attempt("listPerpMarginPulls", () => markets.client.listPerpMarginPulls({ account, limit: 5 }));
await attempt("listPerpMainFundingEvents", () => markets.client.listPerpMainFundingEvents({ account, limit: 5 }));
writeEvidence("r1-indexer", { account, sdkVersion: "0.33.0", indexer: "https://hideki-dev.smk.somnia.host/v1/graphql", reads });
process.exit(0);
```

`packages/spike/src/watch-equity.ts` (G1(b): somnia_watch with the snapshot multicall attached):
```ts
import { pad, type Address, type Hex } from "viem";
import { BTC_POOL, MARGIN_BANK, PRICE_FEED_SCHEDULER, decodeSnapshot, snapshotCall, startWatch } from "@basanos/core";
import { loadDotEnv, rpcWss } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { findActiveAccount } from "./find-active";
import { timestampUnit } from "./lib";
import { publicClient } from "./rpc";

loadDotEnv();
const seconds = Number(process.argv[2] ?? "30");
const account: Address = await findActiveAccount(publicClient());
const call = snapshotCall([account], BTC_POOL);
const blockNumbers: bigint[] = [];
let pushes = 0;
let accountPushes = 0;
let equityDecoded = false;
let unit: "seconds" | "milliseconds" | null = null;
let first: unknown = null;
const gaps: { atMs: number; reason: string }[] = [];

function take(results: Hex[]): void {
  const raw = results[0];
  if (!raw) return;
  const snap = decodeSnapshot(raw, [account], BTC_POOL);
  equityDecoded = true;
  if (blockNumbers.length < 50) blockNumbers.push(snap.blockNumber);
  unit ??= timestampUnit(snap.timestamp, Date.now());
  first ??= snap;
}

const prices = startWatch(rpcWss(), { address: PRICE_FEED_SCHEDULER, ethCalls: [call], pushChangesOnly: true }, {
  onPush: (p) => {
    pushes += 1;
    take(p.simulationResults);
  },
  onGap: (g) => gaps.push(g),
});
const own = startWatch(rpcWss(), { address: MARGIN_BANK, topics: [null, pad(account)], ethCalls: [call] }, {
  onPush: (p) => {
    accountPushes += 1;
    take(p.simulationResults);
  },
  onGap: (g) => gaps.push(g),
});

await new Promise((r) => setTimeout(r, seconds * 1000));
prices.close();
own.close();
writeEvidence("g1b-watch", {
  account,
  seconds,
  pushes,
  accountPushes,
  blockNumbers,
  timestampUnit: unit,
  equityDecoded,
  firstSnapshot: first,
  gaps,
  watches: ["PriceFeedScheduler + snapshot multicall (push_changes_only)", "MarginBank topic1=account + snapshot multicall"],
});
console.log(`watch-equity: ${pushes} price pushes, ${accountPushes} account pushes, unit ${unit}`);
process.exit(0);
```

`packages/spike/src/tape.ts` (G4 evidence: a live BTC mark tape for the evaluator test):
```ts
import { BTC_POOL, PRICE_FEED_SCHEDULER, decodeSnapshot, snapshotCall, startWatch } from "@basanos/core";
import { loadDotEnv, rpcWss } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { appendTapePoint, type TapePoint } from "./lib";

loadDotEnv();
const seconds = Number(process.argv[2] ?? "540");
const call = snapshotCall([], BTC_POOL);
let points: TapePoint[] = [];
const gaps: { atMs: number; reason: string }[] = [];
const startedAt = new Date().toISOString();

const handle = startWatch(rpcWss(), { address: PRICE_FEED_SCHEDULER, ethCalls: [call], pushChangesOnly: true }, {
  onPush: (p) => {
    const raw = p.simulationResults[0];
    if (!raw) return;
    const snap = decodeSnapshot(raw, [], BTC_POOL);
    if (snap.markOk) points = appendTapePoint(points, { block: snap.blockNumber, ts: snap.timestamp, mark: snap.markPrice });
  },
  onGap: (g) => gaps.push(g),
});

await new Promise((r) => setTimeout(r, seconds * 1000));
handle.close();
writeEvidence("tape", { pool: BTC_POOL, market: "BTC-PERP", startedAt, seconds, gaps, points });
console.log(`tape: ${points.length} points over ${seconds}s`);
process.exit(0);
```

- [ ] **Step 6: Run the package tests (the gate)**
Run: `npm test -w @basanos/spike`
Expected: PASS — `12 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `feat(spike): read-only history, indexer, watch and tape scripts`

---

### Task 9: Run the read-only spike live (no key, no STT)

**Files:**
- Create: `docs/evidence/g1b-watch.json`
- Create: `docs/evidence/g1c-history.json`
- Create: `docs/evidence/r1-indexer.json`
- Create: `packages/core/test/fixtures/btc-tape.json`

**Depends on:** Task 7, Task 8
**Effort:** low
**Provides:** `docs/evidence/g1b-watch.json`, `docs/evidence/g1c-history.json`, `docs/evidence/r1-indexer.json`, `packages/core/test/fixtures/btc-tape.json (live BTC mark tape: { pool, points: [{ block, ts, mark }] })`
**Requires:** `CLI: npx tsx packages/spike/src/history.ts [account]`, `CLI: npx tsx packages/spike/src/watch-equity.ts [seconds]`, `CLI: npx tsx packages/spike/src/tape.ts [seconds]`, `CLI: npx tsx packages/spike/src/check-evidence.ts <name...> -> prints PASS or FAIL lines, exit 0 only when all PASS`

Read-only network calls against the public Hideki RPC and indexer. Nothing is signed. A failing indexer read is a valid result (R1): it is recorded, not retried into success, and later becomes a feedback item.

- [ ] **Step 1: Measure history depth and run the three R1 indexer reads**
Run: `npx tsx packages/spike/src/history.ts`
Expected: prints one line per depth and one per indexer read, then writes `docs/evidence/g1c-history.json` and `docs/evidence/r1-indexer.json`.

- [ ] **Step 2: Prove the watch with the equity multicall (30 s)**
Run: `npx tsx packages/spike/src/watch-equity.ts 30`
Expected: `watch-equity: <N> price pushes, <M> account pushes, unit seconds` with N > 0; writes `docs/evidence/g1b-watch.json`.

- [ ] **Step 3: Record a 9-minute (540 s) BTC mark tape**
Run: `npx tsx packages/spike/src/tape.ts 540`
Expected: `tape: <N> points over 540s` with N > 100; writes `packages/core/test/fixtures/btc-tape.json`. The run lasts 540 s, under a 600 s command limit; start it in the background if your runner caps foreground commands lower.

- [ ] **Step 4: Check the evidence (the gate)**
Run: `npx tsx packages/spike/src/check-evidence.ts g1b-watch g1c-history r1-indexer tape`
Expected: PASS — four lines `PASS g1b-watch`, `PASS g1c-history`, `PASS r1-indexer`, `PASS tape`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): read-only spike — history depth, indexer reads, watch, BTC tape`

---

### Task 10: Live spike scripts — referee close skeleton (G1 a, e) and Price Oracle probe (G1 d), with dry-run

**Files:**
- Create: `packages/spike/src/live-lib.ts`
- Create: `packages/spike/src/skeleton-close.ts`
- Create: `packages/spike/src/oracle-probe.ts`
- Test: `packages/spike/test/live-lib.test.ts`

**Depends on:** Task 2, Task 3, Task 4, Task 6, Task 7
**Effort:** high
**Model tier:** top
**Provides:** `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `sumCosts(txs: readonly TxRecord[]): bigint`, `isFlat(s: AccountSnapshot): boolean`, `ORACLE_STATUS: readonly ["None", "Pending", "Success", "Failed", "TimedOut"]`, `decodeOraclePrices(result: Hex, symbols: readonly string[]): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[]`, `CLI: npx tsx packages/spike/src/skeleton-close.ts [--dry-run]`, `CLI: npx tsx packages/spike/src/oracle-probe.ts [--dry-run]`
**Requires:** `BTC_POOL`, `MARGIN_BANK`, `OPERATOR_REGISTRY`, `SOMNIA_AGENTS`, `PLACE_ORDER_FOR_SELECTOR`, `CANCEL_ORDER_FOR_SELECTOR`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_LIMIT = 0`, `ORDER_TYPE_IOC = 2`, `ORACLE_AGENT_ID = 9911223344556677889n`, `ORACLE_DEPOSIT = 30_900_000_000_000_000n`, `STT_WRITE_HEADROOM = 600_000_000_000_000_000n`, `farFutureNs(nowMs?: number): bigint`, `explorerTx(hash: Hex): string`, `perpPoolAbi`, `somniaAgentsAbi`, `priceOracleAbi`, `marginBankAbi`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100]`, `alignUp(x: bigint, step: bigint): bigint`, `planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null`, `planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `writeEvidence(name: EvidenceName, data: Record<string, unknown>): string`, `publicClient(): PublicClient`, `walletFor(pk: Hex): viem WalletClient bound to CHAIN and the key's account`, `marketsFor(pk?: Hex): SomniaMarkets`

Key safety: the scripts read `ACCOUNT_A_PK` and `REFEREE_PK` only through `requirePrivateKey`, never print them, and write only addresses, hashes and numbers into evidence. This task only writes code and runs unit tests; it sends nothing. Tasks 11 and 12 run the scripts live under a human gate. Neither script claims a voucher: `skeleton-close` refuses to run unless account A already holds a claimed voucher.

- [ ] **Step 1: Write the failing test**

`packages/spike/test/live-lib.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { encodeFunctionResult } from "viem";
import { priceOracleAbi } from "@basanos/core";
import { ORACLE_STATUS, decodeOraclePrices, isFlat, sumCosts, txRecord } from "../src/live-lib";

describe("txRecord", () => {
  it("records cost as gasUsed x effectiveGasPrice with an explorer link", () => {
    const r = txRecord("close", { transactionHash: "0xab", status: "success", gasUsed: 3_000_000n, effectiveGasPrice: 6_000_000_000n });
    expect(r.costWei).toBe(18_000_000_000_000_000n);
    expect(r.explorer).toBe("https://explorer.testnet.somnia.network/tokyo/tx/0xab");
    expect(sumCosts([r, r])).toBe(36_000_000_000_000_000n);
  });
});

describe("isFlat", () => {
  it("needs no position, no locked collateral and no active pools", () => {
    const base = { account: "0x1" as const, equityOk: true, equity: 1n, lockedCollateral: 0n, totalEquity: 1n, activePools: [], size: 0n };
    expect(isFlat(base)).toBe(true);
    expect(isFlat({ ...base, size: 1n })).toBe(false);
    expect(isFlat({ ...base, lockedCollateral: 1n })).toBe(false);
    expect(isFlat({ ...base, activePools: ["0x2"] })).toBe(false);
  });
});

describe("oracle decoding", () => {
  it("names statuses in the SomniaAgents enum order", () => {
    expect(ORACLE_STATUS[2]).toBe("Success");
    expect(ORACLE_STATUS[4]).toBe("TimedOut");
  });
  it("pairs each symbol with its median, sources and update time", () => {
    const data = encodeFunctionResult({
      abi: priceOracleAbi,
      functionName: "getPrices",
      result: [[74_500n * 10n ** 18n, 0n], [3, 0], [1_794_326_598_000n, 0n]],
    });
    expect(decodeOraclePrices(data, ["BTC/USDC:PERP", "BTC/USDC"])).toEqual([
      { symbol: "BTC/USDC:PERP", price: 74_500n * 10n ** 18n, numSources: 3, lastUpdated: 1_794_326_598_000n },
      { symbol: "BTC/USDC", price: 0n, numSources: 0, lastUpdated: 0n },
    ]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/spike -- test/live-lib.test.ts`
Expected: FAIL — `Failed to resolve import "../src/live-lib"`.

- [ ] **Step 3: Write the helpers**

`packages/spike/src/live-lib.ts`:
```ts
import { decodeFunctionResult, type Hex } from "viem";
import { explorerTx, priceOracleAbi, type AccountSnapshot } from "@basanos/core";

export interface TxRecord {
  label: string;
  hash: Hex;
  status: "success" | "reverted";
  gasUsed: bigint;
  costWei: bigint;
  explorer: string;
}

export function txRecord(
  label: string,
  receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint },
): TxRecord {
  return {
    label,
    hash: receipt.transactionHash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    costWei: receipt.gasUsed * receipt.effectiveGasPrice,
    explorer: explorerTx(receipt.transactionHash),
  };
}

export function sumCosts(txs: readonly TxRecord[]): bigint {
  return txs.reduce((acc, t) => acc + t.costWei, 0n);
}

export function isFlat(s: AccountSnapshot): boolean {
  return s.size === 0n && s.lockedCollateral === 0n && s.activePools.length === 0;
}

/** SomniaAgents ResponseStatus, in declaration order. */
export const ORACLE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"] as const;

export function decodeOraclePrices(
  result: Hex,
  symbols: readonly string[],
): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[] {
  const [prices, numSources, lastUpdated] = decodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", data: result });
  return symbols.map((symbol, i) => ({
    symbol,
    price: prices[i] ?? 0n,
    numSources: numSources[i] ?? 0,
    lastUpdated: lastUpdated[i] ?? 0n,
  }));
}
```

- [ ] **Step 4: Run to confirm the helpers pass**
Run: `npm test -w @basanos/spike -- test/live-lib.test.ts`
Expected: PASS — `4 passed`.

- [ ] **Step 5: Write the referee close skeleton**

`packages/spike/src/skeleton-close.ts`:
```ts
// G1(a)+(e): account A grants the referee place+cancel on BTC-PERP, opens a minimum-size long and rests one
// far bid; the referee cancels the resting order, closes the long with an IOC placeOrderFor (no reduce-only
// flag exists), reads back flat. Follows the spec §8 close protocol: cancel first, fresh position read, IOC,
// read-back, at most 3 attempts with widening slippage, final cancel sweep. --dry-run only reads.
import { zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CLOSE_SLIPPAGE_STEPS_BPS,
  MARGIN_BANK,
  marginBankAbi,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_IOC,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  farFutureNs,
  perpPoolAbi,
  planClose,
  planOpen,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { loadDotEnv, requirePrivateKey } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { isFlat, sumCosts, txRecord, type TxRecord } from "./live-lib";
import { marketsFor, publicClient, walletFor } from "./rpc";

loadDotEnv();
const dryRun = process.argv.includes("--dry-run");
const ownerPk = requirePrivateKey("ACCOUNT_A_PK");
const refereePk = requirePrivateKey("REFEREE_PK");
const owner: Address = privateKeyToAccount(ownerPk).address;
const referee: Address = privateKeyToAccount(refereePk).address;
const client = publicClient();
const refWallet = walletFor(refereePk);
const ownerMarkets = marketsFor(ownerPk);
const txs: TxRecord[] = [];
const notes: string[] = [];

function stop(reason: string, extra: Record<string, unknown> = {}): never {
  console.error(`skeleton-close: STOP — ${reason}`);
  if (!dryRun) writeEvidence("g1a-close", { ok: false, reason, owner, referee, pool: BTC_POOL, txs, notes, ...extra });
  process.exit(1);
}

async function authorized(selector: Hex): Promise<boolean> {
  return client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
}

async function openOrderIds(): Promise<readonly bigint[]> {
  // The pool answers for msg.sender, so read as the owner via eth_call `from` (never through Multicall3).
  return client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOwnOpenOrders", account: owner });
}

async function refereeCancelAll(label: string): Promise<void> {
  try {
    for (const id of await openOrderIds()) {
      const hash = await refWallet.writeContract({
        address: BTC_POOL,
        abi: perpPoolAbi,
        functionName: "cancelOrderFor",
        args: [owner, id],
        gas: ORDER_GAS,
      });
      txs.push(txRecord(label, await client.waitForTransactionReceipt({ hash })));
    }
  } catch (e) {
    notes.push(`${label} failed: ${(e as Error).message.slice(0, 200)}`);
  }
}

// 1. Preflight (reads only).
const [ownerStt, refereeStt] = await Promise.all([client.getBalance({ address: owner }), client.getBalance({ address: referee })]);
if (ownerStt < STT_WRITE_HEADROOM || refereeStt < STT_WRITE_HEADROOM) {
  stop(`STT below the 0.6 write headroom (owner ${ownerStt}, referee ${refereeStt}); top up from the Tokyo faucet`);
}
const voucher = await ownerMarkets.client.getPerpVoucher(MARGIN_BANK, owner);
if (!voucher?.claimed) stop("account A has no claimed voucher; the Step 3 preflight claims it (this script never claims)");
const leverage = await ownerMarkets.client.getPerpLeverage({ marginBank: MARGIN_BANK, account: owner, pool: BTC_POOL });
const params = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
const book: BookParams = { tickSize: params.tickSize, minQuantity: params.minQuantity, lotSize: params.lotSize };
const markets = await ownerMarkets.client.listPerpMarkets();
const btcRow = markets.find((m) => m.baseSymbol === "BTC");
if (!btcRow || btcRow.poolAddress.toLowerCase() !== BTC_POOL.toLowerCase()) stop("the live BTC-PERP pool differs from BTC_POOL in config");
const start = await readSnapshot(client, [owner], BTC_POOL);
const startAccount = start.accounts[0];
if (!startAccount || !isFlat(startAccount)) stop("account A is not flat; flatten it in the dreamDEX app first");
if (!start.markOk) stop("BTC-PERP has no fresh mark price");
const openQty = alignUp(book.minQuantity, book.lotSize);
console.log(
  `preflight ok: owner ${owner}, referee ${referee}, voucher floor ${voucher?.floor}, voucher cap ${leverage.voucherLeverageCapX}x, ` +
    `mark ${start.markPrice}, open qty ${openQty}`,
);
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}

// 2. Owner grants the referee place + cancel on the BTC pool only (the SDK writes the per-pool grant on the registry).
if (!(await authorized(PLACE_ORDER_FOR_SELECTOR)) || !(await authorized(CANCEL_ORDER_FOR_SELECTOR))) {
  const grant = await ownerMarkets.trader.setOperatorApprovalForPool({
    pool: BTC_POOL,
    operator: referee,
    selectors: [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR],
    approved: true,
    operatorRegistry: OPERATOR_REGISTRY,
  });
  txs.push(txRecord("grant", grant.receipt));
}
if (!(await authorized(PLACE_ORDER_FOR_SELECTOR)) || !(await authorized(CANCEL_ORDER_FOR_SELECTOR))) stop("the grant did not take effect");

// 3. Owner opens the minimum long (IOC) and rests one far bid (GTC) for the referee to cancel.
const preOpen = await readSnapshot(client, [owner], BTC_POOL);
const open = planOpen(true, openQty, preOpen.markPrice, book, 20);
try {
  const opened = await ownerMarkets.trader.placePerpOrder({ pool: BTC_POOL, isBid: true, price: open.price, quantity: open.quantity, orderType: ORDER_TYPE_IOC });
  txs.push(txRecord("open", opened.receipt));
} catch (e) {
  stop(`the opening IOC failed before any position existed: ${(e as Error).message.slice(0, 200)}`);
}
// Real entry fill vs mark (the demo's +0.5% target is only trusted once this cost is known; spec §5).
const openedPos = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getPosition", args: [owner, BTC_POOL] });
const entry = {
  side: "long",
  quantity: open.quantity,
  limitPrice: open.price,
  markBefore: preOpen.markPrice,
  markBlock: preOpen.blockNumber,
  avgEntryPrice: openedPos.avgEntryPrice,
  costBps: Number(((openedPos.avgEntryPrice - preOpen.markPrice) * 1_000_000n) / preOpen.markPrice) / 100,
};
console.log(`entry: avg ${entry.avgEntryPrice} vs mark ${entry.markBefore} = ${entry.costBps} bps`);
const restPrice = (start.markPrice * 9_000n) / 10_000n - ((start.markPrice * 9_000n) / 10_000n) % book.tickSize;
try {
  const rested = await ownerMarkets.trader.placePerpOrder({ pool: BTC_POOL, isBid: true, price: restPrice, quantity: openQty, orderType: ORDER_TYPE_LIMIT });
  txs.push(txRecord("rest", rested.receipt));
} catch (e) {
  // A rejected resting order (e.g. outside the pool's price band) must not strand the open long: note it and close.
  notes.push(`resting order rejected: ${(e as Error).message.slice(0, 200)}; continuing to the referee close`);
}

// 4. Referee: cancel first, fresh read, IOC close, read back; at most 3 attempts.
await refereeCancelAll("cancel");
let attempts = 0;
for (const slippage of CLOSE_SLIPPAGE_STEPS_BPS) {
  const snap = await readSnapshot(client, [owner], BTC_POOL);
  const acct = snap.accounts[0];
  if (!acct || acct.size === 0n) break;
  const plan = planClose(acct.size, snap.markPrice, book, slippage);
  if (!plan) {
    notes.push(`residual ${acct.size} is below one lot`);
    break;
  }
  attempts += 1;
  try {
    const hash = await refWallet.writeContract({
      address: BTC_POOL,
      abi: perpPoolAbi,
      functionName: "placeOrderFor",
      args: [owner, plan.isBid, 0n, plan.price, plan.quantity, farFutureNs(), ORDER_TYPE_IOC, 0, zeroAddress, 0n],
      gas: ORDER_GAS,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    txs.push(txRecord("close", receipt));
    if (receipt.status === "reverted") notes.push(`close attempt ${attempts} at ${slippage} bps reverted (replay with eth_call at the parent block)`);
  } catch (e) {
    notes.push(`close attempt ${attempts} at ${slippage} bps failed to send: ${(e as Error).message.slice(0, 200)}`);
  }
}
await refereeCancelAll("sweep");

// 5. Read back and record.
const end = await readSnapshot(client, [owner], BTC_POOL);
const endAccount = end.accounts[0];
const flat = endAccount ? isFlat(endAccount) : false;
writeEvidence("g1a-close", {
  ok: flat && txs.some((t) => t.label === "close" && t.status === "success"),
  sdkVersion: "0.33.0",
  owner,
  referee,
  pool: BTC_POOL,
  operatorRegistry: OPERATOR_REGISTRY,
  leverage: {
    voucherLeverageCapX: leverage.voucherLeverageCapX,
    accountMaxLeverageX: leverage.accountMaxLeverageX,
    protocolMaxLeverageX: leverage.protocolMaxLeverageX,
    creditFloor: leverage.creditFloor,
  },
  book,
  entry,
  startSnapshot: start,
  endSnapshot: end,
  closeAttempts: attempts,
  finalPositionSize: endAccount?.size ?? -1n,
  finalLocked: endAccount?.lockedCollateral ?? -1n,
  txs,
  costs: { totalWei: sumCosts(txs), perTx: txs.map((t) => ({ label: t.label, gasUsed: t.gasUsed, costWei: t.costWei })) },
  notes,
});
console.log(`skeleton-close: ${flat ? "FLAT" : "NOT FLAT"} after ${attempts} close attempt(s); ${txs.length} txs`);
for (const t of txs) console.log(`  ${t.label} ${t.status} ${t.explorer}`);
process.exit(flat ? 0 : 1);
```

- [ ] **Step 6: Write the Price Oracle probe**

`packages/spike/src/oracle-probe.ts`:
```ts
// G1(d): one Price Oracle request on Tokyo testnet from the referee EOA (callback = the EOA itself),
// read back through getRequest. Sends 0.0309 STT, the practical deposit (never the bare floor).
import { decodeEventLog, encodeFunctionData, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ORACLE_AGENT_ID, ORACLE_DEPOSIT, SOMNIA_AGENTS, priceOracleAbi, somniaAgentsAbi } from "@basanos/core";
import { loadDotEnv, requirePrivateKey } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { ORACLE_STATUS, decodeOraclePrices, txRecord } from "./live-lib";
import { publicClient, walletFor } from "./rpc";

loadDotEnv();
const dryRun = process.argv.includes("--dry-run");
const refereePk = requirePrivateKey("REFEREE_PK");
const referee: Address = privateKeyToAccount(refereePk).address;
const client = publicClient();
const wallet = walletFor(refereePk);
const SYMBOLS = ["BTC/USDC:PERP", "BTC/USDC"] as const;
const payload = encodeFunctionData({ abi: priceOracleAbi, functionName: "getPrices", args: [[...SYMBOLS], 18] });
const floor = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequestDeposit" });
const value = floor >= ORACLE_DEPOSIT ? floor + 900_000_000_000_000n : ORACLE_DEPOSIT;
console.log(`oracle-probe: floor ${floor} wei, sending ${value} wei from ${referee}`);
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}
const hash = await wallet.writeContract({
  address: SOMNIA_AGENTS,
  abi: somniaAgentsAbi,
  functionName: "createRequest",
  args: [ORACLE_AGENT_ID, referee, "0x00000000", payload],
  value,
});
const receipt = await client.waitForTransactionReceipt({ hash });
let requestId: bigint | null = null;
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) continue;
  try {
    const ev = decodeEventLog({ abi: somniaAgentsAbi, data: log.data, topics: log.topics });
    if (ev.eventName === "RequestCreated") requestId = ev.args.requestId;
  } catch {
    // another SomniaAgents event
  }
}
if (requestId === null) {
  writeEvidence("g1d-oracle", { requestId: "none", finalStatus: "NoRequestCreated", symbols: [], tx: txRecord("createRequest", receipt) });
  process.exit(1);
}
let status = 1;
let symbols: ReturnType<typeof decodeOraclePrices> = [];
let responses = 0;
const deadline = Date.now() + 180_000;
let readError: string | null = null;
while (Date.now() < deadline) {
  try {
    const req = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequest", args: [requestId] });
    status = req.status;
    responses = req.responses.length;
    if (status >= 2) {
      const success = req.responses.find((r) => r.status === 2);
      if (success) symbols = decodeOraclePrices(success.result, SYMBOLS);
      break;
    }
  } catch (e) {
    readError = (e as Error).message.slice(0, 400);
  }
  await new Promise((r) => setTimeout(r, 3_000));
}
writeEvidence("g1d-oracle", {
  requestId,
  agentId: ORACLE_AGENT_ID,
  callback: "referee EOA",
  depositFloorWei: floor,
  sentWei: value,
  finalStatus: ORACLE_STATUS[status] ?? `status ${status}`,
  readError,
  responses,
  symbols,
  tx: txRecord("createRequest", receipt),
});
console.log(`oracle-probe: request ${requestId} -> ${ORACLE_STATUS[status] ?? status}`);
for (const s of symbols) console.log(`  ${s.symbol}: price ${s.price} (${s.numSources} sources)`);
process.exit(0);
```

- [ ] **Step 7: Run the package tests (the gate)**
Run: `npm test -w @basanos/spike`
Expected: PASS — `16 passed`.

- [ ] **Step 8: Commit (kernel-performed — no agent runs this)**
Message: `feat(spike): referee close skeleton and Price Oracle probe with dry-run`

---

### Task 11: LIVE — the referee closes a funded account (G1 a, e; the Nov 11 tripwire)

**Files:**
- Create: `docs/evidence/g1a-close.json`

**Depends on:** Task 7, Task 9, Task 10, Task 14, Task 18, Task 20
**Effort:** medium
**Model tier:** top
**Provides:** `docs/evidence/g1a-close.json (ok, txs with hashes, finalPositionSize, leverage { voucherLeverageCapX, capX, capSource }, funding { unlockedWei }, entry { markBefore, avgEntryPrice, costBps }, costs)`
**Requires:** `CLI: npx tsx packages/spike/src/skeleton-close.ts [--dry-run] [--sdk-send] (funded test: account A needs >= 1 USDso of unlocked MarginBank margin; records the leverage cap that applies)`, `CLI: npx tsx packages/spike/src/check-evidence.ts <name...> -> prints PASS or FAIL lines, exit 0 only when all PASS`

**Human-gated.** This signs real transactions with the account A and referee burners (`ACCOUNT_A_PK`, `REFEREE_PK` in `.env`). It needs:
- account A with ≥ 0.6 STT and **≥ 1 USDso of unlocked margin in its own MarginBank balance**. Task 18 deposits it from A's own wallet; there is no voucher, because `claim()` reverts chain-wide (B14);
- the referee with ≥ 0.6 STT;
- account A flat.

It never claims a voucher. The leverage cap that applies is the market's 40× (the voucher's 20× cap binds only a voucher account), and the evidence records it as `leverage.capX` / `capSource`. Expected spend: about 5–7 transactions. Account A's grant, open and resting order are signed by viem and sent to the standard RPC with `ORDER_GAS` and an explicit nonce (Task 14); run with `--sdk-send` only if the guide asks for the SDK's own send path, and the evidence records which path ran (`sendPath`).

- [ ] **Step 1: Dry-run the preflight**
Run: `npx tsx packages/spike/src/skeleton-close.ts --dry-run`
Expected: `preflight ok: owner 0x…, referee 0x…, unlocked margin <n> USDso, leverage cap 40x (market), voucher none, mark …, open qty …, send path viem` then `dry-run: no transaction sent`. A `STOP —` line means a prerequisite is missing: fix it (faucet, preflight) and re-run; do not continue.

- [ ] **Step 2: Run live**
Run: `npx tsx packages/spike/src/skeleton-close.ts`
Expected: an `entry: avg … vs mark … = <x> bps` line, then `skeleton-close: FLAT after 1 close attempt(s); <N> txs (owner writes via viem)`, then one explorer link per transaction (grant, open, rest, cancel, close; the rest and cancel lines are absent if the pool rejected the resting order, which the evidence notes).
**If the output says NOT FLAT, or no close succeeded: STOP the build and escalate to the user** with the evidence file and the explorer links. If the failure is a reproducible SDK, docs or contract defect, it also becomes a `feedback/` item later. If no real order has landed on SDK 0.33.0 within ~2 h of starting this task, stop and route a plan fix to the architect (switch to 0.32.1).

- [ ] **Step 3: Check the evidence (the gate)**
Run: `npx tsx packages/spike/src/check-evidence.ts g1a-close`
Expected: PASS — `PASS g1a-close`.

- [ ] **Step 4: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): G1(a) referee closes a voucher account on Hideki`

---

### Task 12: LIVE — one Price Oracle request on Tokyo testnet (G1 d)

**Files:**
- Create: `docs/evidence/g1d-oracle.json`

**Depends on:** Task 7, Task 10, Task 15
**Effort:** low
**Model tier:** top
**Provides:** `docs/evidence/g1d-oracle.json (requestId, finalStatus, symbols: BTC/USDC:PERP and BTC/USDC with price and numSources)`
**Requires:** `CLI: npx tsx packages/spike/src/oracle-probe.ts [--dry-run] [--from-tx <hash>]`, `CLI: npx tsx packages/spike/src/check-evidence.ts <name...> -> prints PASS or FAIL lines, exit 0 only when all PASS`

**Human-gated.** Spends about 0.0309 STT plus gas from the referee burner (`REFEREE_PK`). A `TimedOut`, `Failed` or zero-source result is a valid answer: it decides the cut order (spec §1: the Price Oracle cross-check is cut first) and whether the rulebooks switch `oracleSymbol` to `BTC/USDC` before deploy.

**The request was already sent on 2026-11-11** (request 7773100, createRequest tx `0xdf795f1f7938638ebd78a119d5de95c05930b6f1cd779d5f7ca402df0befa30d`, ledger `1d71274`). It finalized Failed one block later, in tx `0x851aaa04f95533ccabd87e11e3398b09eb85dfe9d709f393223126a3c9582301`.
- Do not send it again. Skip Steps 1–2 and run Step 3, which rebuilds the evidence from that transaction without a key or a send.
- Steps 1–2 apply only if a new request is ever authorised.
- Do not commit the `g1d-oracle.json` from the first run: it says "Pending", and the strict check (Task 15) rejects it.

- [ ] **Step 1: Dry-run**
Run: `npx tsx packages/spike/src/oracle-probe.ts --dry-run`
Expected: `oracle-probe: floor <wei> wei, sending <wei> wei from 0x…` then `dry-run: no transaction sent`.

- [ ] **Step 2: Run live (only for a new, authorised request)**
Run: `npx tsx packages/spike/src/oracle-probe.ts`
Expected: `oracle-probe: request <id> -> <Success | Failed | TimedOut> (<n> validator responses; finalized in 0x…)`.

- [ ] **Step 3: Rebuild the evidence from the request already sent (no key, no send)**
Run: `npx tsx packages/spike/src/oracle-probe.ts --from-tx 0xdf795f1f7938638ebd78a119d5de95c05930b6f1cd779d5f7ca402df0befa30d`
Expected: `oracle-probe: request 7773100 -> Failed (3 validator responses; finalized in 0x851aaa04f95533ccabd87e11e3398b09eb85dfe9d709f393223126a3c9582301)`. This writes `docs/evidence/g1d-oracle.json` with `mode: "from-tx"`, `finalStatus: "Failed"` and the three validators' costs.

- [ ] **Step 4: Check the evidence (the gate)**
Run: `npx tsx packages/spike/src/check-evidence.ts g1d-oracle`
Expected: PASS — `PASS g1d-oracle`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): G1(d) Price Oracle request on Tokyo testnet`

---

### Task 13: Write the spike answers into the spec (§2 horizon, §3a)

**Files:**
- Create: `packages/spike/src/spec-evidence.ts`
- Modify: `docs/superpowers/specs/2026-11-10-basanos-design.md`
- Test: `packages/spike/test/spec-evidence.test.ts`

**Depends on:** Task 1, Task 7, Task 9, Task 11, Task 12
**Effort:** low
**Provides:** `summarize(name: EvidenceName, data: Record<string, unknown> | null): string`, `fillSpec(spec: string, results: Record<EvidenceName, string>): string`, `CLI: npx tsx packages/spike/src/spec-evidence.ts [--write] -> rewrites spec §3a result cells and the §2 horizon line; exits 1 if any unfilled spike:13 cell remains`
**Requires:** `type EvidenceName = "g1a-close" | "g1b-watch" | "g1c-history" | "g1d-oracle" | "r1-indexer" | "tape"`, `readEvidence(name: EvidenceName): Record<string, unknown> | null`, `repoPath(rel: string): string`

- [ ] **Step 1: Write the failing test**

`packages/spike/test/spec-evidence.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { fillSpec, summarize } from "../src/spec-evidence";

const SPEC = [
  "served `USDso.totalSupply()` at **10,000,000 blocks back (2026-10-30, ≈ 11.6 days)**, with values that",
  "| G1(a) referee close on a voucher account | `docs/evidence/g1a-close.json` | written by `spike:13` |",
  "| G1(c) equity history depth | `docs/evidence/g1c-history.json` | written by `spike:13` |",
].join("\n");

describe("summarize", () => {
  it("summarises the close and the history depth", () => {
    expect(
      summarize("g1a-close", { ok: true, closeAttempts: 1, txs: [{}, {}, {}], leverage: { voucherLeverageCapX: 20 }, entry: { costBps: 1.25 } }),
    ).toBe("PASS — flat after 1 close attempt(s), 3 txs; voucher cap 20x; entry 1.25 bps vs mark");
    expect(
      summarize("g1a-close", { ok: true, closeAttempts: 1, txs: [{}, {}], leverage: { voucherLeverageCapX: 20, capX: 40, capSource: "market" }, entry: { costBps: 22.4 } }),
    ).toBe("PASS — flat after 1 close attempt(s), 2 txs; leverage cap 40x (market); entry 22.4 bps vs mark");
    expect(summarize("g1c-history", { maxServedBack: 10_000_000 })).toBe("equity view served 10,000,000 blocks back (≈ 11.6 days)");
    expect(summarize("g1d-oracle", null)).toBe("not run");
  });
});

describe("fillSpec", () => {
  it("replaces every result cell it has a result for and the horizon line", () => {
    const out = fillSpec(SPEC, {
      "g1a-close": "PASS — x",
      "g1b-watch": "w",
      "g1c-history": "equity view served 20,000,000 blocks back (≈ 23.1 days)",
      "g1d-oracle": "o",
      "r1-indexer": "r",
      tape: "t",
    });
    expect(out).toContain("| `docs/evidence/g1a-close.json` | PASS — x |");
    expect(out).toContain("| `docs/evidence/g1c-history.json` | equity view served 20,000,000 blocks back (≈ 23.1 days) |");
    expect(out).toContain("measured with the equity view: equity view served 20,000,000 blocks back (≈ 23.1 days)");
    expect(out).not.toContain("written by `spike:13`");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/spike -- test/spec-evidence.test.ts`
Expected: FAIL — `Failed to resolve import "../src/spec-evidence"`.

- [ ] **Step 3: Write the implementation**

`packages/spike/src/spec-evidence.ts`:
```ts
import { readFileSync, writeFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";
import { readEvidence, type EvidenceName } from "./evidence";

const SPEC_PATH = "docs/superpowers/specs/2026-11-10-basanos-design.md";
const FILES: Record<EvidenceName, string> = {
  "g1a-close": "`docs/evidence/g1a-close.json`",
  "g1b-watch": "`docs/evidence/g1b-watch.json`",
  "g1c-history": "`docs/evidence/g1c-history.json`",
  "g1d-oracle": "`docs/evidence/g1d-oracle.json`",
  "r1-indexer": "`docs/evidence/r1-indexer.json`",
  tape: "`packages/core/test/fixtures/btc-tape.json`",
};
const HORIZON_RE = /served `USDso\.totalSupply\(\)` at \*\*10,000,000 blocks back \(2026-10-30, ≈ 11\.6 days\)\*\*/;

const fmt = (n: number): string => n.toLocaleString("en-US");
const days = (blocks: number): string => (blocks / 10 / 86_400).toFixed(1);

export function summarize(name: EvidenceName, data: Record<string, unknown> | null): string {
  if (!data) return "not run";
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  switch (name) {
    case "g1a-close": {
      const lev = (data.leverage ?? {}) as Record<string, unknown>;
      const head = data.ok === true ? "PASS" : "FAIL (escalated)";
      const entry = (data.entry ?? {}) as Record<string, unknown>;
      // The cap that applies (spike:20): the market's for a non-voucher account, the voucher's only for a claimed voucher.
      const cap = typeof lev.capX === "number" ? `leverage cap ${String(lev.capX)}x (${String(lev.capSource ?? "market")})` : `voucher cap ${String(lev.voucherLeverageCapX)}x`;
      return `${head} — flat after ${String(data.closeAttempts)} close attempt(s), ${arr(data.txs).length} txs; ${cap}; entry ${String(entry.costBps)} bps vs mark`;
    }
    case "g1b-watch":
      return `${String(data.pushes)} price pushes and ${String(data.accountPushes ?? 0)} account pushes in ${String(data.seconds ?? "?")}s; equity decoded: ${String(data.equityDecoded)}; block timestamp unit: ${String(data.timestampUnit)}`;
    case "g1c-history": {
      const back = Number(data.maxServedBack ?? 0);
      return `equity view served ${fmt(back)} blocks back (≈ ${days(back)} days)`;
    }
    case "g1d-oracle": {
      const syms = arr(data.symbols) as { symbol?: string; numSources?: number }[];
      const parts = syms.map((s) => `${s.symbol}: ${s.numSources ?? 0} sources`).join(", ");
      return `${String(data.finalStatus)}${parts ? ` — ${parts}` : ""}`;
    }
    case "r1-indexer": {
      const reads = arr(data.reads) as { name?: string; ok?: boolean }[];
      return reads.map((r) => `${r.name}: ${r.ok ? "ok" : "FAILED (feedback candidate)"}`).join("; ");
    }
    case "tape":
      return `${arr(data.points).length} BTC mark points over ${String(data.seconds ?? "?")}s`;
  }
}

export function fillSpec(spec: string, results: Record<EvidenceName, string>): string {
  let out = spec;
  for (const name of Object.keys(FILES) as EvidenceName[]) {
    out = out.split(`| ${FILES[name]} | written by \`spike:13\` |`).join(`| ${FILES[name]} | ${results[name]} |`);
  }
  out = out.split("| `docs/evidence/g1a-close.json` (`leverage` field) | written by `spike:13` |").join(
    `| \`docs/evidence/g1a-close.json\` (\`leverage\` field) | ${results["g1a-close"]} |`,
  );
  out = out.split("| `docs/evidence/g1a-close.json` (`costs`) | written by `spike:13` |").join(
    `| \`docs/evidence/g1a-close.json\` (\`costs\`) | ${results["g1a-close"]} |`,
  );
  return out.replace(HORIZON_RE, (m) => `${m}; measured with the equity view: ${results["g1c-history"]}`);
}

const isMain = process.argv[1]?.endsWith("spec-evidence.ts") ?? false;
if (isMain) {
  const names = Object.keys(FILES) as EvidenceName[];
  const results = Object.fromEntries(names.map((n) => [n, summarize(n, readEvidence(n))])) as Record<EvidenceName, string>;
  const path = repoPath(SPEC_PATH);
  const filled = fillSpec(readFileSync(path, "utf8"), results);
  if (process.argv.includes("--write")) writeFileSync(path, filled);
  const left = filled.includes("written by `spike:13`");
  console.log(left ? "FAIL spec §3a still has unfilled cells" : "PASS spec §3a filled");
  process.exit(left ? 1 : 0);
}
```

- [ ] **Step 4: Run to confirm the helpers pass**
Run: `npm test -w @basanos/spike -- test/spec-evidence.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 5: Write the evidence into the spec**
Run: `npx tsx packages/spike/src/spec-evidence.ts --write`
Expected: `PASS spec §3a filled`.

- [ ] **Step 6: Re-check the spec (the gate)**
Run: `npx tsx packages/spike/src/spec-evidence.ts`
Expected: PASS — `PASS spec §3a filled`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `docs(spec): record day-1 spike evidence (G1 a-e, R1, replay horizon)`

---

### Task 14: Owner-side writes through viem — account A's grant, open and rest signed locally on the standard RPC (SDK send opt-in)

**Files:**
- Modify: `packages/spike/src/live-lib.ts`
- Modify: `packages/spike/src/skeleton-close.ts`
- Test: `packages/spike/test/live-lib.test.ts`

**Depends on:** Task 2, Task 3, Task 4, Task 6, Task 7, Task 10
**Effort:** high
**Model tier:** top
**Provides:** `type SendPath = "viem" | "sdk"`, `parseSendPath(argv: readonly string[]): SendPath`, `interface UnsignedCall { to: Address; data: Hex; value: bigint }`, `ownerPoolAbi (owner-side placeOrder, selector 0x4e978373)`, `ownerOrderCall(pool: Address, isBid: boolean, price: bigint, quantity: bigint, orderType: number, expireTimestampNs: bigint): UnsignedCall`, `grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall`, `ownerTx(call: UnsignedCall, nonce: number, gas: bigint): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }`, `CLI: npx tsx packages/spike/src/skeleton-close.ts [--dry-run] [--sdk-send]`
**Requires:** `BTC_POOL`, `MARGIN_BANK`, `OPERATOR_REGISTRY`, `PLACE_ORDER_FOR_SELECTOR`, `CANCEL_ORDER_FOR_SELECTOR`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_LIMIT = 0`, `ORDER_TYPE_IOC = 2`, `STT_WRITE_HEADROOM = 600_000_000_000_000_000n`, `farFutureNs(nowMs?: number): bigint`, `explorerTx(hash: Hex): string`, `perpPoolAbi`, `marginBankAbi`, `operatorRegistryAbi`, `priceOracleAbi`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100]`, `alignUp(x: bigint, step: bigint): bigint`, `planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null`, `planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan`, `writeEvidence(name: EvidenceName, data: Record<string, unknown>): string`, `publicClient(): PublicClient`, `walletFor(pk: Hex): viem WalletClient bound to CHAIN and the key's account`, `marketsFor(pk?: Hex): SomniaMarkets`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `sumCosts(txs: readonly TxRecord[]): bigint`, `isFlat(s: AccountSnapshot): boolean`, `ORACLE_STATUS: readonly ["None", "Pending", "Success", "Failed", "TimedOut"]`, `decodeOraclePrices(result: Hex, symbols: readonly string[]): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[]`

Why: the Step 3 preflight's voucher claim went through the SDK's send path (`eth_sendRawTransactionSync` on `send.hideki…`) and returned `TransactionOutcomeUnknownError` with nothing mined. The Task 11 tripwire must not depend on that path. Task 10 sends account A's grant, open and resting order through `ownerMarkets.trader`; this task moves them to viem:
- **Build:** a raw `placeOrder` on the pool and `setOperatorApprovalForPool` on the operator registry, encoded locally (`ownerOrderCall`, `grantCall`).
- **Sign and send:** viem signs with account A's key and sends `eth_sendRawTransaction` to the standard RPC (`rpcHttp()`, `api.hideki…`), with `ORDER_GAS` and an explicit `pending` nonce. The receipt is read back on the same RPC.
- **The SDK stays for reads** (`getPerpVoucher`, `getPerpLeverage`, `listPerpMarkets`). `--sdk-send` puts the three owner writes back on the SDK's own send as a fallback. The evidence records `sendPath` (`viem` or `sdk`).
- **Unchanged:** the referee's cancel and close already go through viem.

Verified read-only on Hideki on 2026-11-11 (`eth_call` and `eth_estimateGas`, nothing sent):
- The BTC pool is a beacon proxy. Its implementation `0x81F9EB88C95a52B4D3eA47A73ac394b8A547d443` carries `placeOrder` `0x4e978373` and `placeOrderFor` `0x80054449`.
- The SDK's `buildPlacePerpOrder` calldata equals the `ownerOrderCall` encoding byte for byte.
- A far resting bid at minimum size simulates OK from an active account, at about 2.74M gas (under `ORDER_GAS`). From account A it reverts with `ERC20: insufficient allowance`, because A has no voucher margin yet.
- Account A's `setOperatorApprovalForPool` for the referee simulates OK, at about 1.84M gas.

Key safety is unchanged from Task 10: keys are read only through `requirePrivateKey` and never printed. This task writes code and runs unit tests; it sends nothing.

- [ ] **Step 1: Write the failing tests**

Replace `packages/spike/test/live-lib.test.ts` with:
```ts
import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, zeroAddress } from "viem";
import { perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  operatorRegistryAbi,
  priceOracleAbi,
} from "@basanos/core";
import {
  ORACLE_STATUS,
  decodeOraclePrices,
  grantCall,
  isFlat,
  ownerOrderCall,
  ownerTx,
  parseSendPath,
  sumCosts,
  txRecord,
} from "../src/live-lib";

describe("txRecord", () => {
  it("records cost as gasUsed x effectiveGasPrice with an explorer link", () => {
    const r = txRecord("close", { transactionHash: "0xab", status: "success", gasUsed: 3_000_000n, effectiveGasPrice: 6_000_000_000n });
    expect(r.costWei).toBe(18_000_000_000_000_000n);
    expect(r.explorer).toBe("https://explorer.testnet.somnia.network/tokyo/tx/0xab");
    expect(sumCosts([r, r])).toBe(36_000_000_000_000_000n);
  });
});

describe("isFlat", () => {
  it("needs no position, no locked collateral and no active pools", () => {
    const base = { account: "0x1" as const, equityOk: true, equity: 1n, lockedCollateral: 0n, totalEquity: 1n, activePools: [], size: 0n };
    expect(isFlat(base)).toBe(true);
    expect(isFlat({ ...base, size: 1n })).toBe(false);
    expect(isFlat({ ...base, lockedCollateral: 1n })).toBe(false);
    expect(isFlat({ ...base, activePools: ["0x2"] })).toBe(false);
  });
});

describe("oracle decoding", () => {
  it("names statuses in the SomniaAgents enum order", () => {
    expect(ORACLE_STATUS[2]).toBe("Success");
    expect(ORACLE_STATUS[4]).toBe("TimedOut");
  });
  it("pairs each symbol with its median, sources and update time", () => {
    const data = encodeFunctionResult({
      abi: priceOracleAbi,
      functionName: "getPrices",
      result: [[74_500n * 10n ** 18n, 0n], [3, 0], [1_794_326_598_000n, 0n]],
    });
    expect(decodeOraclePrices(data, ["BTC/USDC:PERP", "BTC/USDC"])).toEqual([
      { symbol: "BTC/USDC:PERP", price: 74_500n * 10n ** 18n, numSources: 3, lastUpdated: 1_794_326_598_000n },
      { symbol: "BTC/USDC", price: 0n, numSources: 0, lastUpdated: 0n },
    ]);
  });
});

describe("owner-side writes on the viem path", () => {
  it("encodes the raw placeOrder exactly as the SDK's perpPoolWriteAbi does", () => {
    const price = 66_000n * 10n ** 18n;
    const expiry = 3_371_163_205_000_000_000n;
    const c = ownerOrderCall(BTC_POOL, true, price, 13_000n, ORDER_TYPE_LIMIT, expiry);
    expect(c.to).toBe(BTC_POOL);
    expect(c.value).toBe(0n);
    expect(c.data.slice(0, 10)).toBe("0x4e978373");
    expect(c.data).toBe(
      encodeFunctionData({
        abi: perpPoolWriteAbi,
        functionName: "placeOrder",
        args: [true, 0n, price, 13_000n, expiry, ORDER_TYPE_LIMIT, 0, zeroAddress, 0n],
      }),
    );
  });
  it("grants the referee place and cancel on one pool through the registry", () => {
    const referee = "0xE358D82209ea9360F411A041C0200adc385877eb";
    const c = grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR]);
    expect(c.to).toBe(OPERATOR_REGISTRY);
    expect(c.data.slice(0, 10)).toBe("0x7bbc67e6");
    const d = decodeFunctionData({ abi: operatorRegistryAbi, data: c.data });
    expect(d.functionName).toBe("setOperatorApprovalForPool");
    expect(d.args).toEqual([BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR], true]);
  });
  it("signs with ORDER_GAS and an explicit nonce, and keeps the SDK send opt-in", () => {
    expect(ownerTx({ to: BTC_POOL, data: "0x4e978373", value: 0n }, 7, ORDER_GAS)).toEqual({
      to: BTC_POOL,
      data: "0x4e978373",
      value: 0n,
      gas: 10_000_000n,
      nonce: 7,
    });
    expect(parseSendPath(["node", "skeleton-close.ts"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--dry-run"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--sdk-send"])).toBe("sdk");
  });
});
```

- [ ] **Step 2: Run to confirm the new tests fail**
Run: `npm test -w @basanos/spike -- test/live-lib.test.ts`
Expected: FAIL — `3 failed | 4 passed (7)`, with `TypeError: ownerOrderCall is not a function` (and the same for `grantCall` and `ownerTx`).

- [ ] **Step 3: Add the owner-side helpers**

Replace `packages/spike/src/live-lib.ts` with:
```ts
import { decodeFunctionResult, encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { explorerTx, operatorRegistryAbi, priceOracleAbi, type AccountSnapshot } from "@basanos/core";

export interface TxRecord {
  label: string;
  hash: Hex;
  status: "success" | "reverted";
  gasUsed: bigint;
  costWei: bigint;
  explorer: string;
}

export function txRecord(
  label: string,
  receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint },
): TxRecord {
  return {
    label,
    hash: receipt.transactionHash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    costWei: receipt.gasUsed * receipt.effectiveGasPrice,
    explorer: explorerTx(receipt.transactionHash),
  };
}

export function sumCosts(txs: readonly TxRecord[]): bigint {
  return txs.reduce((acc, t) => acc + t.costWei, 0n);
}

export function isFlat(s: AccountSnapshot): boolean {
  return s.size === 0n && s.lockedCollateral === 0n && s.activePools.length === 0;
}

/** SomniaAgents ResponseStatus, in declaration order. */
export const ORACLE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"] as const;

export function decodeOraclePrices(
  result: Hex,
  symbols: readonly string[],
): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[] {
  const [prices, numSources, lastUpdated] = decodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", data: result });
  return symbols.map((symbol, i) => ({
    symbol,
    price: prices[i] ?? 0n,
    numSources: numSources[i] ?? 0,
    lastUpdated: lastUpdated[i] ?? 0n,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Owner-side writes (account A). The default path signs locally with viem and sends eth_sendRawTransaction to the
// standard RPC (rpcHttp(), api.hideki…), with ORDER_GAS and an explicit nonce. The SDK's own send path
// (eth_sendRawTransactionSync on send.hideki…, which surfaced TransactionOutcomeUnknownError in the Step 3
// preflight) is an opt-in fallback behind --sdk-send. The SDK stays in use for reads.
// ---------------------------------------------------------------------------------------------------------------

/** How account A's own writes reach the chain; recorded in the evidence as `sendPath`. */
export type SendPath = "viem" | "sdk";

export function parseSendPath(argv: readonly string[]): SendPath {
  return argv.includes("--sdk-send") ? "sdk" : "viem";
}

/** An unsigned call: the same shape as the SDK's build verbs return (to, data, value). */
export interface UnsignedCall {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Owner-side PerpPool order: the SDK 0.33.0 perpPoolWriteAbi signature, selector 0x4e978373 (present in the BTC
 *  pool's beacon implementation; a far resting bid simulates OK from an active account). */
export const ownerPoolAbi = parseAbi([
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
]);

/** Raw placeOrder on the pool, with the arguments the SDK's placePerpOrder fills in (userData 0, no self-match option, no builder). */
export function ownerOrderCall(
  pool: Address,
  isBid: boolean,
  price: bigint,
  quantity: bigint,
  orderType: number,
  expireTimestampNs: bigint,
): UnsignedCall {
  return {
    to: pool,
    value: 0n,
    data: encodeFunctionData({
      abi: ownerPoolAbi,
      functionName: "placeOrder",
      args: [isBid, 0n, price, quantity, expireTimestampNs, orderType, 0, zeroAddress, 0n],
    }),
  };
}

/** The per-pool operator grant on the OperatorPermissionsRegistry (the SDK has no build verb for it). */
export function grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({
      abi: operatorRegistryAbi,
      functionName: "setOperatorApprovalForPool",
      args: [pool, operator, [...selectors], true],
    }),
  };
}

/** The exact transaction account A signs on the viem path: a fixed gas limit and an explicit nonce. */
export function ownerTx(
  call: UnsignedCall,
  nonce: number,
  gas: bigint,
): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number } {
  return { to: call.to, data: call.data, value: call.value, gas, nonce };
}
```

- [ ] **Step 4: Run to confirm the helpers pass**
Run: `npm test -w @basanos/spike -- test/live-lib.test.ts`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Send account A's writes through viem**

Replace `packages/spike/src/skeleton-close.ts` with:
```ts
// G1(a)+(e): account A grants the referee place+cancel on BTC-PERP, opens a minimum-size long and rests one
// far bid; the referee cancels the resting order, closes the long with an IOC placeOrderFor (no reduce-only
// flag exists), reads back flat. Follows the spec §8 close protocol: cancel first, fresh position read, IOC,
// read-back, at most 3 attempts with widening slippage, final cancel sweep. --dry-run only reads.
// Every write is signed locally by viem and sent to the standard RPC (rpcHttp()). Account A's grant, open and
// rest carry ORDER_GAS and an explicit pending nonce; --sdk-send routes those three through the SDK's own send
// path instead (fallback only). The evidence records which path ran as `sendPath`.
import { zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CLOSE_SLIPPAGE_STEPS_BPS,
  MARGIN_BANK,
  marginBankAbi,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_IOC,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  farFutureNs,
  perpPoolAbi,
  planClose,
  planOpen,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { loadDotEnv, requirePrivateKey } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import {
  grantCall,
  isFlat,
  ownerOrderCall,
  ownerTx,
  parseSendPath,
  sumCosts,
  txRecord,
  type SendPath,
  type TxRecord,
  type UnsignedCall,
} from "./live-lib";
import { marketsFor, publicClient, walletFor } from "./rpc";

loadDotEnv();
const dryRun = process.argv.includes("--dry-run");
const sendPath: SendPath = parseSendPath(process.argv);
const ownerPk = requirePrivateKey("ACCOUNT_A_PK");
const refereePk = requirePrivateKey("REFEREE_PK");
const owner: Address = privateKeyToAccount(ownerPk).address;
const referee: Address = privateKeyToAccount(refereePk).address;
const client = publicClient();
const refWallet = walletFor(refereePk);
const ownerWallet = walletFor(ownerPk);
const ownerMarkets = marketsFor(ownerPk);
const txs: TxRecord[] = [];
const notes: string[] = [];

function stop(reason: string, extra: Record<string, unknown> = {}): never {
  console.error(`skeleton-close: STOP — ${reason}`);
  if (!dryRun) writeEvidence("g1a-close", { ok: false, reason, sendPath, owner, referee, pool: BTC_POOL, txs, notes, ...extra });
  process.exit(1);
}

/** One of account A's own writes. viem path: sign `call` with ORDER_GAS and the pending nonce, send it to the
 *  standard RPC and wait for the receipt there. sdk path (--sdk-send): the SDK's own send, kept as a fallback. */
async function ownerWrite(
  label: string,
  call: UnsignedCall,
  viaSdk: () => Promise<{ receipt: Parameters<typeof txRecord>[1] }>,
): Promise<TxRecord> {
  let rec: TxRecord;
  if (sendPath === "sdk") {
    rec = txRecord(label, (await viaSdk()).receipt);
  } else {
    const nonce = await client.getTransactionCount({ address: owner, blockTag: "pending" });
    const hash = await ownerWallet.sendTransaction(ownerTx(call, nonce, ORDER_GAS));
    rec = txRecord(label, await client.waitForTransactionReceipt({ hash }));
  }
  txs.push(rec);
  return rec;
}

async function authorized(selector: Hex): Promise<boolean> {
  return client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
}

async function openOrderIds(): Promise<readonly bigint[]> {
  // The pool answers for msg.sender, so read as the owner via eth_call `from` (never through Multicall3).
  return client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOwnOpenOrders", account: owner });
}

async function refereeCancelAll(label: string): Promise<void> {
  try {
    for (const id of await openOrderIds()) {
      const hash = await refWallet.writeContract({
        address: BTC_POOL,
        abi: perpPoolAbi,
        functionName: "cancelOrderFor",
        args: [owner, id],
        gas: ORDER_GAS,
      });
      txs.push(txRecord(label, await client.waitForTransactionReceipt({ hash })));
    }
  } catch (e) {
    notes.push(`${label} failed: ${(e as Error).message.slice(0, 200)}`);
  }
}

// 1. Preflight (reads only).
const [ownerStt, refereeStt] = await Promise.all([client.getBalance({ address: owner }), client.getBalance({ address: referee })]);
if (ownerStt < STT_WRITE_HEADROOM || refereeStt < STT_WRITE_HEADROOM) {
  stop(`STT below the 0.6 write headroom (owner ${ownerStt}, referee ${refereeStt}); top up from the Tokyo faucet`);
}
const voucher = await ownerMarkets.client.getPerpVoucher(MARGIN_BANK, owner);
if (!voucher?.claimed) stop("account A has no claimed voucher; the Step 3 preflight claims it (this script never claims)");
const leverage = await ownerMarkets.client.getPerpLeverage({ marginBank: MARGIN_BANK, account: owner, pool: BTC_POOL });
const params = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
const book: BookParams = { tickSize: params.tickSize, minQuantity: params.minQuantity, lotSize: params.lotSize };
const markets = await ownerMarkets.client.listPerpMarkets();
const btcRow = markets.find((m) => m.baseSymbol === "BTC");
if (!btcRow || btcRow.poolAddress.toLowerCase() !== BTC_POOL.toLowerCase()) stop("the live BTC-PERP pool differs from BTC_POOL in config");
const start = await readSnapshot(client, [owner], BTC_POOL);
const startAccount = start.accounts[0];
if (!startAccount || !isFlat(startAccount)) stop("account A is not flat; flatten it in the dreamDEX app first");
if (!start.markOk) stop("BTC-PERP has no fresh mark price");
const openQty = alignUp(book.minQuantity, book.lotSize);
console.log(
  `preflight ok: owner ${owner}, referee ${referee}, voucher floor ${voucher?.floor}, voucher cap ${leverage.voucherLeverageCapX}x, ` +
    `mark ${start.markPrice}, open qty ${openQty}, send path ${sendPath}`,
);
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}

// 2. Owner grants the referee place + cancel on the BTC pool only (a per-pool grant on the operator registry).
const selectors: Hex[] = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR];
if (!(await authorized(PLACE_ORDER_FOR_SELECTOR)) || !(await authorized(CANCEL_ORDER_FOR_SELECTOR))) {
  try {
    await ownerWrite("grant", grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, selectors), () =>
      ownerMarkets.trader.setOperatorApprovalForPool({
        pool: BTC_POOL,
        operator: referee,
        selectors,
        approved: true,
        operatorRegistry: OPERATOR_REGISTRY,
      }),
    );
  } catch (e) {
    stop(`the grant send failed before any order existed: ${(e as Error).message.slice(0, 200)}`);
  }
}
if (!(await authorized(PLACE_ORDER_FOR_SELECTOR)) || !(await authorized(CANCEL_ORDER_FOR_SELECTOR))) stop("the grant did not take effect");

// 3. Owner opens the minimum long (IOC) and rests one far bid (GTC) for the referee to cancel.
const preOpen = await readSnapshot(client, [owner], BTC_POOL);
const open = planOpen(true, openQty, preOpen.markPrice, book, 20);
try {
  const opened = await ownerWrite(
    "open",
    ownerOrderCall(BTC_POOL, true, open.price, open.quantity, ORDER_TYPE_IOC, farFutureNs()),
    () => ownerMarkets.trader.placePerpOrder({ pool: BTC_POOL, isBid: true, price: open.price, quantity: open.quantity, orderType: ORDER_TYPE_IOC }),
  );
  if (opened.status === "reverted") stop("the opening IOC reverted, so no position was opened");
} catch (e) {
  stop(`the opening IOC failed before any position existed: ${(e as Error).message.slice(0, 200)}`);
}
// Real entry fill vs mark (the demo's +0.5% target is only trusted once this cost is known; spec §5).
const openedPos = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getPosition", args: [owner, BTC_POOL] });
const entry = {
  side: "long",
  quantity: open.quantity,
  limitPrice: open.price,
  markBefore: preOpen.markPrice,
  markBlock: preOpen.blockNumber,
  avgEntryPrice: openedPos.avgEntryPrice,
  costBps: Number(((openedPos.avgEntryPrice - preOpen.markPrice) * 1_000_000n) / preOpen.markPrice) / 100,
};
console.log(`entry: avg ${entry.avgEntryPrice} vs mark ${entry.markBefore} = ${entry.costBps} bps`);
const restPrice = (start.markPrice * 9_000n) / 10_000n - ((start.markPrice * 9_000n) / 10_000n) % book.tickSize;
try {
  await ownerWrite(
    "rest",
    ownerOrderCall(BTC_POOL, true, restPrice, openQty, ORDER_TYPE_LIMIT, farFutureNs()),
    () => ownerMarkets.trader.placePerpOrder({ pool: BTC_POOL, isBid: true, price: restPrice, quantity: openQty, orderType: ORDER_TYPE_LIMIT }),
  );
} catch (e) {
  // A rejected resting order (e.g. outside the pool's price band) must not strand the open long: note it and close.
  notes.push(`resting order rejected: ${(e as Error).message.slice(0, 200)}; continuing to the referee close`);
}

// 4. Referee: cancel first, fresh read, IOC close, read back; at most 3 attempts.
await refereeCancelAll("cancel");
let attempts = 0;
for (const slippage of CLOSE_SLIPPAGE_STEPS_BPS) {
  const snap = await readSnapshot(client, [owner], BTC_POOL);
  const acct = snap.accounts[0];
  if (!acct || acct.size === 0n) break;
  const plan = planClose(acct.size, snap.markPrice, book, slippage);
  if (!plan) {
    notes.push(`residual ${acct.size} is below one lot`);
    break;
  }
  attempts += 1;
  try {
    const hash = await refWallet.writeContract({
      address: BTC_POOL,
      abi: perpPoolAbi,
      functionName: "placeOrderFor",
      args: [owner, plan.isBid, 0n, plan.price, plan.quantity, farFutureNs(), ORDER_TYPE_IOC, 0, zeroAddress, 0n],
      gas: ORDER_GAS,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    txs.push(txRecord("close", receipt));
    if (receipt.status === "reverted") notes.push(`close attempt ${attempts} at ${slippage} bps reverted (replay with eth_call at the parent block)`);
  } catch (e) {
    notes.push(`close attempt ${attempts} at ${slippage} bps failed to send: ${(e as Error).message.slice(0, 200)}`);
  }
}
await refereeCancelAll("sweep");

// 5. Read back and record.
const end = await readSnapshot(client, [owner], BTC_POOL);
const endAccount = end.accounts[0];
const flat = endAccount ? isFlat(endAccount) : false;
writeEvidence("g1a-close", {
  ok: flat && txs.some((t) => t.label === "close" && t.status === "success"),
  sdkVersion: "0.33.0",
  sendPath,
  owner,
  referee,
  pool: BTC_POOL,
  operatorRegistry: OPERATOR_REGISTRY,
  leverage: {
    voucherLeverageCapX: leverage.voucherLeverageCapX,
    accountMaxLeverageX: leverage.accountMaxLeverageX,
    protocolMaxLeverageX: leverage.protocolMaxLeverageX,
    creditFloor: leverage.creditFloor,
  },
  book,
  entry,
  startSnapshot: start,
  endSnapshot: end,
  closeAttempts: attempts,
  finalPositionSize: endAccount?.size ?? -1n,
  finalLocked: endAccount?.lockedCollateral ?? -1n,
  txs,
  costs: { totalWei: sumCosts(txs), perTx: txs.map((t) => ({ label: t.label, gasUsed: t.gasUsed, costWei: t.costWei })) },
  notes,
});
console.log(`skeleton-close: ${flat ? "FLAT" : "NOT FLAT"} after ${attempts} close attempt(s); ${txs.length} txs (owner writes via ${sendPath})`);
for (const t of txs) console.log(`  ${t.label} ${t.status} ${t.explorer}`);
process.exit(flat ? 0 : 1);
```

- [ ] **Step 6: Type-check (the script first runs live in Task 11)**
Run: `npm run typecheck -w @basanos/spike`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 7: Run the package tests (the gate)**
Run: `npm test -w @basanos/spike`
Expected: PASS — `19 passed`.

- [ ] **Step 8: Commit (kernel-performed — no agent runs this)**
Message: `feat(spike): account A's grant and orders signed by viem on the standard RPC; SDK send opt-in`

---

### Task 15: Oracle probe reads the outcome from SomniaAgents logs, rebuilds from a tx, and the g1d check gets strict

**Files:**
- Modify: `packages/spike/src/oracle-probe.ts`
- Modify: `packages/spike/src/live-lib.ts`
- Modify: `packages/spike/src/evidence.ts`
- Test: `packages/spike/test/live-lib.test.ts`
- Test: `packages/spike/test/evidence.test.ts`

**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 7, Task 10, Task 14
**Effort:** high
**Model tier:** top
**Provides:** `REQUEST_FINALIZED_TOPIC: Hex`, `AGENT_RESPONSE_TOPIC: Hex (SomniaAgents per-validator response event, not in the published ABI)`, `interface AgentLog { topics: readonly Hex[]; data: Hex; transactionHash: Hex | null; blockNumber: bigint | null }`, `interface ValidatorResponse { validator: Address; executionCostWei: bigint; words: bigint[]; tx: Hex | null; block: bigint | null }`, `interface OracleOutcome { finalStatus: string; finalStatusCode: number | null; finalizeTx: Hex | null; finalizeBlock: bigint | null; validatorResponses: ValidatorResponse[] }`, `oracleOutcomeFromLogs(logs: readonly AgentLog[], requestId: bigint): OracleOutcome`, `checkEvidence g1d-oracle: finalStatus must be Success, Failed or TimedOut; Success needs a symbol with numSources > 0`, `CLI: npx tsx packages/spike/src/oracle-probe.ts [--dry-run] [--from-tx <hash>]`
**Requires:** `repoPath(rel: string): string`, `BTC_POOL`, `OPERATOR_REGISTRY`, `SOMNIA_AGENTS`, `PLACE_ORDER_FOR_SELECTOR`, `CANCEL_ORDER_FOR_SELECTOR`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_LIMIT = 0`, `ORACLE_AGENT_ID = 9911223344556677889n`, `ORACLE_DEPOSIT = 30_900_000_000_000_000n`, `explorerTx(hash: Hex): string`, `operatorRegistryAbi`, `somniaAgentsAbi`, `priceOracleAbi`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`, `type EvidenceName = "g1a-close" | "g1b-watch" | "g1c-history" | "g1d-oracle" | "r1-indexer" | "tape"`, `writeEvidence(name: EvidenceName, data: Record<string, unknown>): string`, `readEvidence(name: EvidenceName): Record<string, unknown> | null`, `checkEvidence(name: EvidenceName, data: Record<string, unknown> | null): string[]`, `pickMostFrequent(accounts: readonly Address[]): Address | null`, `publicClient(): PublicClient`, `walletFor(pk: Hex): viem WalletClient bound to CHAIN and the key's account`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `sumCosts(txs: readonly TxRecord[]): bigint`, `isFlat(s: AccountSnapshot): boolean`, `ORACLE_STATUS: readonly ["None", "Pending", "Success", "Failed", "TimedOut"]`, `decodeOraclePrices(result: Hex, symbols: readonly string[]): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[]`, `type SendPath = "viem" | "sdk"`, `parseSendPath(argv: readonly string[]): SendPath`, `interface UnsignedCall { to: Address; data: Hex; value: bigint }`, `ownerPoolAbi (owner-side placeOrder, selector 0x4e978373)`, `ownerOrderCall(pool: Address, isBid: boolean, price: bigint, quantity: bigint, orderType: number, expireTimestampNs: bigint): UnsignedCall`, `grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall`, `ownerTx(call: UnsignedCall, nonce: number, gas: bigint): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }`

Why: Task 12's first run (2026-11-11, ledger `1d71274`) sent request 7773100.
- **What happened on chain:** the request finalized **Failed** (`RequestFinalized` status 3, tx `0x851aaa04f95533ccabd87e11e3398b09eb85dfe9d709f393223126a3c9582301`) one block after creation. The response events carry no result bytes; the validators' answers reach only the callback. Decoded from the callback afterwards: all three validators answered Success with prices, and the default Majority consensus failed because their answers differed.
- **What the script recorded:** SomniaAgents deletes a request once it finalizes, so every `getRequest` poll reverted `RequestNotFound` (`0x4ec726c7`). The script kept its initial status and wrote `finalStatus: "Pending"`.
- **Why the gate passed anyway:** the `g1d-oracle` check only tested that the fields existed.

This task makes three changes:
- **Live mode reads the logs.** It polls SomniaAgents logs for `RequestFinalized` and the per-validator response events of its own request id, and never calls `getRequest`.
- **`--from-tx <hash>` rebuilds the evidence** from an earlier `createRequest` transaction. It loads no key and sends nothing.
- **The check gets strict.** `Pending` or a missing status fails. `Success` passes only with a symbol that has `numSources > 0`. The response events carry no result bytes, because prices reach only the callback. So a Success with no decoded prices fails the check, by design.

Verified read-only on Hideki on 2026-11-11:
- The rebuild of tx `0xdf795f1f7938638ebd78a119d5de95c05930b6f1cd779d5f7ca402df0befa30d` prints `oracle-probe: request 7773100 -> Failed (3 validator responses; finalized in 0x851aaa04f95533ccabd87e11e3398b09eb85dfe9d709f393223126a3c9582301)`.
- The validator costs are 166,037,878,800,000, 174,149,532,000,000 and 251,392,050,000,000 wei.
- The payload decodes to `getPrices(["BTC/USDC:PERP", "BTC/USDC"], 18)` (selector `0x1ca1d20c`).
- `check-evidence g1d-oracle` prints PASS for the rebuilt file and FAIL for the first run's "Pending" file.

Key safety is as in Task 10. This task writes code and runs unit tests; it sends nothing. Task 12 runs the rebuild.

- [ ] **Step 1: Write the failing tests**

Replace `packages/spike/test/live-lib.test.ts` with:
```ts
import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  pad,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import { perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  operatorRegistryAbi,
  priceOracleAbi,
  somniaAgentsAbi,
} from "@basanos/core";
import {
  AGENT_RESPONSE_TOPIC,
  ORACLE_STATUS,
  decodeOraclePrices,
  oracleOutcomeFromLogs,
  type AgentLog,
  grantCall,
  isFlat,
  ownerOrderCall,
  ownerTx,
  parseSendPath,
  sumCosts,
  txRecord,
} from "../src/live-lib";

describe("txRecord", () => {
  it("records cost as gasUsed x effectiveGasPrice with an explorer link", () => {
    const r = txRecord("close", { transactionHash: "0xab", status: "success", gasUsed: 3_000_000n, effectiveGasPrice: 6_000_000_000n });
    expect(r.costWei).toBe(18_000_000_000_000_000n);
    expect(r.explorer).toBe("https://explorer.testnet.somnia.network/tokyo/tx/0xab");
    expect(sumCosts([r, r])).toBe(36_000_000_000_000_000n);
  });
});

describe("isFlat", () => {
  it("needs no position, no locked collateral and no active pools", () => {
    const base = { account: "0x1" as const, equityOk: true, equity: 1n, lockedCollateral: 0n, totalEquity: 1n, activePools: [], size: 0n };
    expect(isFlat(base)).toBe(true);
    expect(isFlat({ ...base, size: 1n })).toBe(false);
    expect(isFlat({ ...base, lockedCollateral: 1n })).toBe(false);
    expect(isFlat({ ...base, activePools: ["0x2"] })).toBe(false);
  });
});

describe("oracle decoding", () => {
  it("names statuses in the SomniaAgents enum order", () => {
    expect(ORACLE_STATUS[2]).toBe("Success");
    expect(ORACLE_STATUS[4]).toBe("TimedOut");
  });
  it("pairs each symbol with its median, sources and update time", () => {
    const data = encodeFunctionResult({
      abi: priceOracleAbi,
      functionName: "getPrices",
      result: [[74_500n * 10n ** 18n, 0n], [3, 0], [1_794_326_598_000n, 0n]],
    });
    expect(decodeOraclePrices(data, ["BTC/USDC:PERP", "BTC/USDC"])).toEqual([
      { symbol: "BTC/USDC:PERP", price: 74_500n * 10n ** 18n, numSources: 3, lastUpdated: 1_794_326_598_000n },
      { symbol: "BTC/USDC", price: 0n, numSources: 0, lastUpdated: 0n },
    ]);
  });
});

describe("owner-side writes on the viem path", () => {
  it("encodes the raw placeOrder exactly as the SDK's perpPoolWriteAbi does", () => {
    const price = 66_000n * 10n ** 18n;
    const expiry = 3_371_163_205_000_000_000n;
    const c = ownerOrderCall(BTC_POOL, true, price, 13_000n, ORDER_TYPE_LIMIT, expiry);
    expect(c.to).toBe(BTC_POOL);
    expect(c.value).toBe(0n);
    expect(c.data.slice(0, 10)).toBe("0x4e978373");
    expect(c.data).toBe(
      encodeFunctionData({
        abi: perpPoolWriteAbi,
        functionName: "placeOrder",
        args: [true, 0n, price, 13_000n, expiry, ORDER_TYPE_LIMIT, 0, zeroAddress, 0n],
      }),
    );
  });
  it("grants the referee place and cancel on one pool through the registry", () => {
    const referee = "0xE358D82209ea9360F411A041C0200adc385877eb";
    const c = grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR]);
    expect(c.to).toBe(OPERATOR_REGISTRY);
    expect(c.data.slice(0, 10)).toBe("0x7bbc67e6");
    const d = decodeFunctionData({ abi: operatorRegistryAbi, data: c.data });
    expect(d.functionName).toBe("setOperatorApprovalForPool");
    expect(d.args).toEqual([BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR], true]);
  });
  it("signs with ORDER_GAS and an explicit nonce, and keeps the SDK send opt-in", () => {
    expect(ownerTx({ to: BTC_POOL, data: "0x4e978373", value: 0n }, 7, ORDER_GAS)).toEqual({
      to: BTC_POOL,
      data: "0x4e978373",
      value: 0n,
      gas: 10_000_000n,
      nonce: 7,
    });
    expect(parseSendPath(["node", "skeleton-close.ts"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--dry-run"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--sdk-send"])).toBe("sdk");
  });
});

describe("oracle outcome from SomniaAgents logs", () => {
  const id = 7_773_100n;
  const finalized = (requestId: bigint, status: number): AgentLog => ({
    topics: encodeEventTopics({ abi: somniaAgentsAbi, eventName: "RequestFinalized", args: { requestId } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint8" }], [status]),
    transactionHash: "0x851a",
    blockNumber: 47_437_498n,
  });
  const response = (requestId: bigint, validator: Hex, cost: bigint): AgentLog => ({
    topics: [AGENT_RESPONSE_TOPIC, pad(toHex(requestId), { size: 32 }), pad(validator, { size: 32 })],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [1n, 0n, 0n, cost]),
    transactionHash: "0x4789",
    blockNumber: 47_437_498n,
  });
  const validator: Hex = "0x92d237dea7eb9d37e1b303da586f4b83956df6ad";
  it("reads one request's final status and each validator's cost, ignoring other requests", () => {
    const out = oracleOutcomeFromLogs(
      [response(id, validator, 166_000_000_000_000n), response(id + 1n, validator, 1n), finalized(id + 1n, 2), finalized(id, 3)],
      id,
    );
    expect(out.finalStatus).toBe("Failed");
    expect(out.finalStatusCode).toBe(3);
    expect(out.finalizeTx).toBe("0x851a");
    expect(out.finalizeBlock).toBe(47_437_498n);
    expect(out.validatorResponses).toHaveLength(1);
    expect(out.validatorResponses[0]?.validator).toBe(getAddress(validator));
    expect(out.validatorResponses[0]?.executionCostWei).toBe(166_000_000_000_000n);
  });
  it("reports NotFinalized until the request's RequestFinalized log appears", () => {
    const out = oracleOutcomeFromLogs([response(id, validator, 5n), finalized(id + 1n, 2)], id);
    expect(out.finalStatus).toBe("NotFinalized");
    expect(out.finalizeTx).toBeNull();
    expect(out.validatorResponses).toHaveLength(1);
  });
});
```

Replace `packages/spike/test/evidence.test.ts` with:
```ts
import { describe, expect, it } from "vitest";
import { checkEvidence, toJsonSafe } from "../src/evidence";
import { pickMostFrequent } from "../src/find-active";

describe("toJsonSafe", () => {
  it("turns bigints into decimal strings, deeply", () => {
    expect(toJsonSafe({ a: 1n, b: [2n, { c: 3n }], d: "x" })).toEqual({ a: "1", b: ["2", { c: "3" }], d: "x" });
  });
});

describe("checkEvidence", () => {
  it("flags a missing file", () => {
    expect(checkEvidence("g1c-history", null)).toEqual(["g1c-history: evidence file is missing"]);
  });
  it("accepts a complete history file and rejects an empty one", () => {
    const good = { account: "0x1", depths: [{ back: 10, block: "1", ok: true }], maxServedBack: 10 };
    expect(checkEvidence("g1c-history", good)).toEqual([]);
    expect(checkEvidence("g1c-history", { account: "0x1", depths: [] })).not.toEqual([]);
  });
  it("requires ok: true and a flat end state for the referee close", () => {
    const base = {
      ok: true,
      txs: [
        { label: "grant", hash: "0x1", status: "success" },
        { label: "open", hash: "0x2", status: "success" },
        { label: "close", hash: "0x3", status: "success" },
      ],
      finalPositionSize: "0",
      leverage: { voucherLeverageCapX: 20 },
      entry: { costBps: 1.25 },
      costs: { totalWei: "1" },
    };
    expect(checkEvidence("g1a-close", base)).toEqual([]);
    expect(checkEvidence("g1a-close", { ...base, ok: false })).toContain("g1a-close: ok is not true (STOP and escalate)");
    expect(checkEvidence("g1a-close", { ...base, finalPositionSize: "13000" })).not.toEqual([]);
  });
  it("accepts a read oracle outcome and rejects Pending or a Success without prices", () => {
    expect(checkEvidence("g1d-oracle", { requestId: "7", finalStatus: "TimedOut", symbols: [] })).toEqual([]);
    expect(checkEvidence("g1d-oracle", { requestId: "7", finalStatus: "Failed", symbols: [] })).toEqual([]);
    expect(
      checkEvidence("g1d-oracle", { requestId: "7", finalStatus: "Success", symbols: [{ symbol: "BTC/USDC:PERP", numSources: 3 }] }),
    ).toEqual([]);
    expect(checkEvidence("g1d-oracle", { requestId: "7" })).not.toEqual([]);
    expect(checkEvidence("g1d-oracle", { requestId: "7", finalStatus: "Pending", symbols: [] })).not.toEqual([]);
    expect(
      checkEvidence("g1d-oracle", { requestId: "7", finalStatus: "Success", symbols: [{ symbol: "BTC/USDC:PERP", numSources: 0 }] }),
    ).not.toEqual([]);
  });
  it("needs three indexer reads, a watch with pushes and a tape with more than 100 points", () => {
    expect(checkEvidence("r1-indexer", { reads: [{}, {}, {}] })).toEqual([]);
    expect(checkEvidence("g1b-watch", { pushes: 3, blockNumbers: ["1"], timestampUnit: "seconds", equityDecoded: true })).toEqual([]);
    expect(checkEvidence("tape", { pool: "0x1", points: Array.from({ length: 101 }, (_, i) => ({ block: String(i + 1), ts: String(i + 2), mark: "3" })) })).toEqual([]);
    expect(checkEvidence("tape", { pool: "0x1", points: [] })).not.toEqual([]);
  });
});

describe("pickMostFrequent", () => {
  it("returns the address seen most often, or null", () => {
    expect(pickMostFrequent([])).toBeNull();
    expect(pickMostFrequent(["0xa", "0xb", "0xb"] as `0x${string}`[])).toBe("0xb");
  });
});
```

- [ ] **Step 2: Run to confirm the new tests fail**
Run: `npm test -w @basanos/spike -- test/live-lib.test.ts test/evidence.test.ts`
Expected: FAIL — `3 failed | 13 passed (16)`: two with `TypeError: oracleOutcomeFromLogs is not a function`, one because a `Pending` oracle file still passes.

- [ ] **Step 3: Make the check strict and add the log decoder**

Replace `packages/spike/src/evidence.ts` with:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { repoPath } from "@basanos/core/node";

export type EvidenceName = "g1a-close" | "g1b-watch" | "g1c-history" | "g1d-oracle" | "r1-indexer" | "tape";

export function evidencePath(name: EvidenceName): string {
  return name === "tape" ? repoPath("packages/core/test/fixtures/btc-tape.json") : repoPath(`docs/evidence/${name}.json`);
}

export function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => toJsonSafe(v));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJsonSafe(v)]));
  }
  return value;
}

export function writeEvidence(name: EvidenceName, data: Record<string, unknown>): string {
  const path = evidencePath(name);
  mkdirSync(dirname(path), { recursive: true });
  const body = { evidence: name, writtenAt: new Date().toISOString(), ...data };
  writeFileSync(path, `${JSON.stringify(toJsonSafe(body), null, 2)}\n`);
  return path;
}

export function readEvidence(name: EvidenceName): Record<string, unknown> | null {
  const path = evidencePath(name);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

export function checkEvidence(name: EvidenceName, data: Record<string, unknown> | null): string[] {
  if (!data) return [`${name}: evidence file is missing`];
  const p: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) p.push(`${name}: ${msg}`);
  };
  switch (name) {
    case "g1a-close": {
      need(data.ok === true, "ok is not true (STOP and escalate)");
      const txs = isArr(data.txs) ? (data.txs as Record<string, unknown>[]) : [];
      need(txs.length >= 2, "fewer than 2 transactions (open and close) recorded");
      need(
        txs.every((t) => typeof t.hash === "string" && typeof t.label === "string"),
        "every tx needs a label and a hash",
      );
      need(
        txs.some((t) => t.label === "close" && t.status === "success"),
        "no successful referee close tx",
      );
      need(data.finalPositionSize === "0", "the account is not flat at the end");
      const lev = (data.leverage ?? {}) as Record<string, unknown>;
      need(typeof lev.voucherLeverageCapX === "number", "leverage.voucherLeverageCapX missing");
      const entry = (data.entry ?? null) as Record<string, unknown> | null;
      need(entry !== null && typeof entry.costBps === "number", "entry fill vs mark missing");
      need(typeof data.costs === "object" && data.costs !== null, "costs missing");
      break;
    }
    case "g1b-watch":
      need(typeof data.pushes === "number" && data.pushes > 0, "no pushes recorded");
      need(isArr(data.blockNumbers) && data.blockNumbers.length > 0, "no block numbers decoded");
      need(data.timestampUnit === "seconds" || data.timestampUnit === "milliseconds", "timestampUnit missing");
      need(data.equityDecoded === true, "the attached equity multicall was not decoded");
      break;
    case "g1c-history":
      need(typeof data.account === "string", "account missing");
      need(isArr(data.depths) && data.depths.length > 0, "no depths measured");
      need(typeof data.maxServedBack === "number", "maxServedBack missing");
      break;
    case "g1d-oracle": {
      need(typeof data.requestId === "string", "requestId missing");
      need(
        data.finalStatus === "Success" || data.finalStatus === "Failed" || data.finalStatus === "TimedOut",
        `finalStatus must be Success, Failed or TimedOut, got ${String(data.finalStatus)} (the outcome was never read)`,
      );
      need(isArr(data.symbols), "symbols missing");
      if (data.finalStatus === "Success") {
        const symbols = isArr(data.symbols) ? (data.symbols as Record<string, unknown>[]) : [];
        need(symbols.some((s) => Number(s.numSources) > 0), "Success needs at least one symbol with numSources > 0");
      }
      break;
    }
    case "r1-indexer":
      need(isArr(data.reads) && data.reads.length === 3, "expected exactly 3 indexer reads");
      break;
    case "tape":
      need(typeof data.pool === "string", "pool missing");
      need(isArr(data.points) && data.points.length > 100, "fewer than 101 tape points (the tape-proof test needs more than 100)");
      break;
  }
  return p;
}
```

Replace `packages/spike/src/live-lib.ts` with:
```ts
import {
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  getAddress,
  parseAbi,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { explorerTx, operatorRegistryAbi, priceOracleAbi, somniaAgentsAbi, type AccountSnapshot } from "@basanos/core";

export interface TxRecord {
  label: string;
  hash: Hex;
  status: "success" | "reverted";
  gasUsed: bigint;
  costWei: bigint;
  explorer: string;
}

export function txRecord(
  label: string,
  receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint },
): TxRecord {
  return {
    label,
    hash: receipt.transactionHash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    costWei: receipt.gasUsed * receipt.effectiveGasPrice,
    explorer: explorerTx(receipt.transactionHash),
  };
}

export function sumCosts(txs: readonly TxRecord[]): bigint {
  return txs.reduce((acc, t) => acc + t.costWei, 0n);
}

export function isFlat(s: AccountSnapshot): boolean {
  return s.size === 0n && s.lockedCollateral === 0n && s.activePools.length === 0;
}

/** SomniaAgents ResponseStatus, in declaration order. */
export const ORACLE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"] as const;

export function decodeOraclePrices(
  result: Hex,
  symbols: readonly string[],
): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[] {
  const [prices, numSources, lastUpdated] = decodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", data: result });
  return symbols.map((symbol, i) => ({
    symbol,
    price: prices[i] ?? 0n,
    numSources: numSources[i] ?? 0,
    lastUpdated: lastUpdated[i] ?? 0n,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Owner-side writes (account A). The default path signs locally with viem and sends eth_sendRawTransaction to the
// standard RPC (rpcHttp(), api.hideki…), with ORDER_GAS and an explicit nonce. The SDK's own send path
// (eth_sendRawTransactionSync on send.hideki…, which surfaced TransactionOutcomeUnknownError in the Step 3
// preflight) is an opt-in fallback behind --sdk-send. The SDK stays in use for reads.
// ---------------------------------------------------------------------------------------------------------------

/** How account A's own writes reach the chain; recorded in the evidence as `sendPath`. */
export type SendPath = "viem" | "sdk";

export function parseSendPath(argv: readonly string[]): SendPath {
  return argv.includes("--sdk-send") ? "sdk" : "viem";
}

/** An unsigned call: the same shape as the SDK's build verbs return (to, data, value). */
export interface UnsignedCall {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Owner-side PerpPool order: the SDK 0.33.0 perpPoolWriteAbi signature, selector 0x4e978373 (present in the BTC
 *  pool's beacon implementation; a far resting bid simulates OK from an active account). */
export const ownerPoolAbi = parseAbi([
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
]);

/** Raw placeOrder on the pool, with the arguments the SDK's placePerpOrder fills in (userData 0, no self-match option, no builder). */
export function ownerOrderCall(
  pool: Address,
  isBid: boolean,
  price: bigint,
  quantity: bigint,
  orderType: number,
  expireTimestampNs: bigint,
): UnsignedCall {
  return {
    to: pool,
    value: 0n,
    data: encodeFunctionData({
      abi: ownerPoolAbi,
      functionName: "placeOrder",
      args: [isBid, 0n, price, quantity, expireTimestampNs, orderType, 0, zeroAddress, 0n],
    }),
  };
}

/** The per-pool operator grant on the OperatorPermissionsRegistry (the SDK has no build verb for it). */
export function grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({
      abi: operatorRegistryAbi,
      functionName: "setOperatorApprovalForPool",
      args: [pool, operator, [...selectors], true],
    }),
  };
}

/** The exact transaction account A signs on the viem path: a fixed gas limit and an explicit nonce. */
export function ownerTx(
  call: UnsignedCall,
  nonce: number,
  gas: bigint,
): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number } {
  return { to: call.to, data: call.data, value: call.value, gas, nonce };
}

// ---------------------------------------------------------------------------------------------------------------
// Price Oracle outcome from SomniaAgents logs. getRequest cannot report it: the platform deletes a request once it
// finalizes, and getRequest then reverts RequestNotFound (0x4ec726c7). Request 7773100 (2026-11-11) finalized one
// block after creation, so a getRequest poll only ever saw the revert.
// ---------------------------------------------------------------------------------------------------------------

/** topic0 of RequestFinalized(uint256 indexed requestId, uint8 status). */
export const REQUEST_FINALIZED_TOPIC: Hex = toEventSelector(getAbiItem({ abi: somniaAgentsAbi, name: "RequestFinalized" }));

/** topic0 of SomniaAgents' per-validator response event. It is not in the published ABI. Its topics are
 *  [topic0, requestId, validator] and its data is four words, the last being the validator's execution cost in wei
 *  (seen on requests 7773100 and 7773101). It carries no result bytes: prices reach only the callback. */
export const AGENT_RESPONSE_TOPIC: Hex = "0x1b44ed537f0ae64cca44e5a71b06bc838a30bbc5454ffdc2aee3844926264dfd";

export interface AgentLog {
  topics: readonly Hex[];
  data: Hex;
  transactionHash: Hex | null;
  blockNumber: bigint | null;
}

export interface ValidatorResponse {
  validator: Address;
  executionCostWei: bigint;
  words: bigint[];
  tx: Hex | null;
  block: bigint | null;
}

export interface OracleOutcome {
  /** An ORACLE_STATUS name, or "NotFinalized" while no RequestFinalized log for the request has been seen. */
  finalStatus: string;
  finalStatusCode: number | null;
  finalizeTx: Hex | null;
  finalizeBlock: bigint | null;
  validatorResponses: ValidatorResponse[];
}

export function oracleOutcomeFromLogs(logs: readonly AgentLog[], requestId: bigint): OracleOutcome {
  const out: OracleOutcome = { finalStatus: "NotFinalized", finalStatusCode: null, finalizeTx: null, finalizeBlock: null, validatorResponses: [] };
  for (const log of logs) {
    const [t0, t1, t2] = log.topics;
    if (!t0 || !t1 || BigInt(t1) !== requestId) continue;
    if (t0.toLowerCase() === REQUEST_FINALIZED_TOPIC.toLowerCase()) {
      const code = Number(BigInt(log.data));
      out.finalStatusCode = code;
      out.finalStatus = ORACLE_STATUS[code] ?? `status ${code}`;
      out.finalizeTx = log.transactionHash;
      out.finalizeBlock = log.blockNumber;
    } else if (t0.toLowerCase() === AGENT_RESPONSE_TOPIC && t2) {
      const words = (log.data.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
      out.validatorResponses.push({
        validator: getAddress(`0x${t2.slice(26)}`),
        executionCostWei: words[words.length - 1] ?? 0n,
        words,
        tx: log.transactionHash,
        block: log.blockNumber,
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run to confirm they pass**
Run: `npm test -w @basanos/spike -- test/live-lib.test.ts test/evidence.test.ts`
Expected: PASS — `16 passed`.

- [ ] **Step 5: Read the outcome from the logs; add the rebuild mode**

Replace `packages/spike/src/oracle-probe.ts` with:
```ts
// G1(d): one Price Oracle request on Tokyo testnet from the referee EOA (callback = the EOA itself), sending
// 0.0309 STT, the practical deposit (never the bare floor).
// The outcome is read from SomniaAgents logs (RequestFinalized and the per-validator response events), never from
// getRequest: the platform deletes a request once it finalizes, and getRequest then reverts RequestNotFound
// (0x4ec726c7). That is why the first run recorded "Pending" for a request that had finalized Failed.
// --dry-run reads only. --from-tx <hash> rebuilds the evidence from an earlier createRequest transaction: it loads
// no key and sends nothing.
import { decodeEventLog, decodeFunctionData, encodeFunctionData, pad, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ORACLE_AGENT_ID, ORACLE_DEPOSIT, SOMNIA_AGENTS, priceOracleAbi, somniaAgentsAbi } from "@basanos/core";
import { loadDotEnv, requirePrivateKey } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import {
  AGENT_RESPONSE_TOPIC,
  REQUEST_FINALIZED_TOPIC,
  oracleOutcomeFromLogs,
  txRecord,
  type AgentLog,
  type OracleOutcome,
} from "./live-lib";
import { publicClient, walletFor } from "./rpc";

loadDotEnv();
const dryRun = process.argv.includes("--dry-run");
const fromTxAt = process.argv.indexOf("--from-tx");
const fromTx = fromTxAt >= 0 ? process.argv[fromTxAt + 1] : undefined;
if (fromTxAt >= 0 && (!fromTx || !/^0x[0-9a-fA-F]{64}$/.test(fromTx))) {
  console.error("oracle-probe: --from-tx needs a 32-byte transaction hash");
  process.exit(1);
}
const client = publicClient();
const SYMBOLS = ["BTC/USDC:PERP", "BTC/USDC"] as const;
const LOG_WINDOW = 1_000n; // eth_getLogs answers at most 1,000 blocks per call on Hideki
const REBUILD_SPAN = 3_000n; // a rebuild scans this many blocks after the request (it finalizes within a few)

type Receipt = Awaited<ReturnType<typeof client.waitForTransactionReceipt>>;

/** SomniaAgents logs for one request (RequestFinalized or a validator response), in 1,000-block windows. */
async function agentLogs(requestId: bigint, fromBlock: bigint, toBlock: bigint): Promise<AgentLog[]> {
  const out: AgentLog[] = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_WINDOW) {
    const to = from + LOG_WINDOW - 1n < toBlock ? from + LOG_WINDOW - 1n : toBlock;
    const raw = await client.request({
      method: "eth_getLogs",
      params: [
        {
          address: SOMNIA_AGENTS,
          fromBlock: toHex(from),
          toBlock: toHex(to),
          topics: [[REQUEST_FINALIZED_TOPIC, AGENT_RESPONSE_TOPIC], pad(toHex(requestId), { size: 32 })],
        },
      ],
    });
    for (const l of raw) {
      out.push({ topics: l.topics, data: l.data, transactionHash: l.transactionHash, blockNumber: l.blockNumber === null ? null : BigInt(l.blockNumber) });
    }
  }
  return out;
}

/** Polls the logs from the request's block until it finalizes or the deadline passes. */
async function waitForOutcome(requestId: bigint, fromBlock: bigint, untilMs: number): Promise<OracleOutcome> {
  const logs: AgentLog[] = [];
  let scanned = fromBlock - 1n;
  for (;;) {
    const head = await client.getBlockNumber();
    if (head > scanned) {
      logs.push(...(await agentLogs(requestId, scanned + 1n, head)));
      scanned = head;
    }
    const outcome = oracleOutcomeFromLogs(logs, requestId);
    if (outcome.finalizeTx !== null || Date.now() > untilMs) return outcome;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

function createdFrom(receipt: Receipt): { requestId: bigint; perAgentBudget: bigint; subcommittee: readonly Address[] } | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: somniaAgentsAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "RequestCreated") {
        return { requestId: ev.args.requestId, perAgentBudget: ev.args.perAgentBudget, subcommittee: ev.args.subcommittee };
      }
    } catch {
      // another SomniaAgents event
    }
  }
  return null;
}

function payloadOf(payload: Hex): { selector: Hex; symbols: readonly string[] | null; decimals: number | null } {
  try {
    const d = decodeFunctionData({ abi: priceOracleAbi, data: payload });
    return { selector: payload.slice(0, 10) as Hex, symbols: d.args[0], decimals: d.args[1] };
  } catch {
    return { selector: payload.slice(0, 10) as Hex, symbols: null, decimals: null };
  }
}

function record(
  mode: "live" | "from-tx",
  receipt: Receipt,
  sent: { requester: Address; agentId: bigint; callback: Address; callbackSelector: Hex; payload: Hex; value: bigint; floor: bigint | null },
  created: { requestId: bigint; perAgentBudget: bigint; subcommittee: readonly Address[] },
  outcome: OracleOutcome,
): never {
  writeEvidence("g1d-oracle", {
    mode,
    requestId: created.requestId,
    agentId: sent.agentId,
    requester: sent.requester,
    callback: sent.callback.toLowerCase() === sent.requester.toLowerCase() ? "referee EOA" : sent.callback,
    callbackSelector: sent.callbackSelector,
    payload: payloadOf(sent.payload),
    depositFloorWei: sent.floor,
    sentWei: sent.value,
    perAgentBudget: created.perAgentBudget,
    subcommittee: created.subcommittee,
    finalStatus: outcome.finalStatus,
    finalStatusCode: outcome.finalStatusCode,
    finalizeTx: outcome.finalizeTx,
    finalizeBlock: outcome.finalizeBlock,
    responses: outcome.validatorResponses.length,
    validatorResponses: outcome.validatorResponses,
    validatorCostWei: outcome.validatorResponses.reduce((a, r) => a + r.executionCostWei, 0n),
    outcomeSource: "SomniaAgents logs: RequestFinalized and the per-validator response events",
    // Prices reach only the callback; the logs carry none, so no symbol is reported from them.
    symbols: [],
    tx: txRecord("createRequest", receipt),
  });
  console.log(
    `oracle-probe: request ${created.requestId} -> ${outcome.finalStatus} (${outcome.validatorResponses.length} validator responses` +
      `${outcome.finalizeTx ? `; finalized in ${outcome.finalizeTx}` : ""})`,
  );
  process.exit(outcome.finalizeTx === null ? 1 : 0);
}

if (fromTx) {
  // Rebuild from an earlier createRequest transaction: reads only, no key.
  const hash = fromTx as Hex;
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  if (tx.to?.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) {
    console.error(`oracle-probe: ${hash} is not a SomniaAgents transaction`);
    process.exit(1);
  }
  const call = decodeFunctionData({ abi: somniaAgentsAbi, data: tx.input });
  if (call.functionName !== "createRequest") {
    console.error(`oracle-probe: ${hash} calls ${call.functionName}, not createRequest`);
    process.exit(1);
  }
  const [agentId, callback, callbackSelector, payload] = call.args;
  const created = createdFrom(receipt);
  if (!created) {
    console.error(`oracle-probe: ${hash} emitted no RequestCreated`);
    process.exit(1);
  }
  let floor: bigint | null = null;
  try {
    floor = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequestDeposit", blockNumber: receipt.blockNumber - 1n });
  } catch {
    floor = null; // that block's state is no longer served
  }
  const head = await client.getBlockNumber();
  const last = receipt.blockNumber + REBUILD_SPAN < head ? receipt.blockNumber + REBUILD_SPAN : head;
  const outcome = oracleOutcomeFromLogs(await agentLogs(created.requestId, receipt.blockNumber, last), created.requestId);
  record("from-tx", receipt, { requester: tx.from, agentId, callback, callbackSelector, payload, value: tx.value, floor }, created, outcome);
}

const refereePk = requirePrivateKey("REFEREE_PK");
const referee: Address = privateKeyToAccount(refereePk).address;
const wallet = walletFor(refereePk);
const payload = encodeFunctionData({ abi: priceOracleAbi, functionName: "getPrices", args: [[...SYMBOLS], 18] });
const floor = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequestDeposit" });
const value = floor >= ORACLE_DEPOSIT ? floor + 900_000_000_000_000n : ORACLE_DEPOSIT;
console.log(`oracle-probe: floor ${floor} wei, sending ${value} wei from ${referee}`);
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}
const hash = await wallet.writeContract({
  address: SOMNIA_AGENTS,
  abi: somniaAgentsAbi,
  functionName: "createRequest",
  args: [ORACLE_AGENT_ID, referee, "0x00000000", payload],
  value,
});
const receipt = await client.waitForTransactionReceipt({ hash });
const created = createdFrom(receipt);
if (!created) {
  writeEvidence("g1d-oracle", { mode: "live", requestId: "none", finalStatus: "NoRequestCreated", symbols: [], tx: txRecord("createRequest", receipt) });
  process.exit(1);
}
const outcome = await waitForOutcome(created.requestId, receipt.blockNumber, Date.now() + 180_000);
record(
  "live",
  receipt,
  { requester: referee, agentId: ORACLE_AGENT_ID, callback: referee, callbackSelector: "0x00000000", payload, value, floor },
  created,
  outcome,
);
```

- [ ] **Step 6: Type-check (Task 12 runs the rebuild)**
Run: `npm run typecheck -w @basanos/spike`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 7: Run the package tests (the gate)**
Run: `npm test -w @basanos/spike`
Expected: PASS — `21 passed`.

- [ ] **Step 8: Commit (kernel-performed — no agent runs this)**
Message: `fix(spike): oracle probe reads RequestFinalized from the logs, rebuilds from a tx; strict g1d check`

---

### Task 16: Oracle probes P1 (one symbol, the registry's Majority path) and P2 (Threshold), each with its own evidence and a dry-run

**Files:**
- Modify: `packages/spike/src/oracle-probe.ts`
- Modify: `packages/spike/src/live-lib.ts`
- Test: `packages/spike/test/live-lib.test.ts`

**Depends on:** Task 1, Task 2, Task 3, Task 4, Task 7, Task 10, Task 14, Task 15
**Effort:** medium
**Model tier:** top
**Provides:** `agentsAdvancedAbi (createAdvancedRequest, selector 0x9256632b)`, `ADVANCED_REQUEST = { subcommitteeSize: 3n, threshold: 2n, consensusType: 1, timeoutSec: 30n, perAgentBudgetWei: 10_000_000_000_000_000n }`, `PROBE_MAX_WEI = 100_000_000_000_000_000n`, `type OracleEvidence = "g1d-oracle" | "g1d-probe-p1" | "g1d-probe-p2"`, `parseProbeArgs(argv: readonly string[]): ProbeArgs`, `probeDeposit(floorWei: bigint, advanced: boolean): bigint`, `findCallTo(node: TraceCall, to: Address): TraceCall | null`, `ORACLE_CALLBACK_PARAMS (requestId, responses, status, details)`, `decodeOracleCallback(input: Hex): OracleCallback`, `symbolsFromCallback(cb: OracleCallback | null, symbols: readonly string[]): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[]`, `CLI: npx tsx packages/spike/src/oracle-probe.ts --symbols BTC/USDC:PERP [--dry-run] (P1 -> docs/evidence/g1d-probe-p1.json)`, `CLI: npx tsx packages/spike/src/oracle-probe.ts --advanced [--dry-run] (P2 -> docs/evidence/g1d-probe-p2.json)`
**Requires:** `repoPath(rel: string): string`, `BTC_POOL`, `OPERATOR_REGISTRY`, `SOMNIA_AGENTS`, `PLACE_ORDER_FOR_SELECTOR`, `CANCEL_ORDER_FOR_SELECTOR`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_LIMIT = 0`, `ORACLE_AGENT_ID = 9911223344556677889n`, `ORACLE_DEPOSIT = 30_900_000_000_000_000n`, `explorerTx(hash: Hex): string`, `operatorRegistryAbi`, `somniaAgentsAbi`, `priceOracleAbi`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`, `toJsonSafe(value: unknown): unknown`, `writeEvidence(name: EvidenceName, data: Record<string, unknown>): string`, `publicClient(): PublicClient`, `walletFor(pk: Hex): viem WalletClient bound to CHAIN and the key's account`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `sumCosts(txs: readonly TxRecord[]): bigint`, `isFlat(s: AccountSnapshot): boolean`, `ORACLE_STATUS: readonly ["None", "Pending", "Success", "Failed", "TimedOut"]`, `decodeOraclePrices(result: Hex, symbols: readonly string[]): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[]`, `type SendPath = "viem" | "sdk"`, `parseSendPath(argv: readonly string[]): SendPath`, `interface UnsignedCall { to: Address; data: Hex; value: bigint }`, `ownerPoolAbi (owner-side placeOrder, selector 0x4e978373)`, `ownerOrderCall(pool: Address, isBid: boolean, price: bigint, quantity: bigint, orderType: number, expireTimestampNs: bigint): UnsignedCall`, `grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall`, `ownerTx(call: UnsignedCall, nonce: number, gas: bigint): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }`, `REQUEST_FINALIZED_TOPIC: Hex`, `AGENT_RESPONSE_TOPIC: Hex (SomniaAgents per-validator response event, not in the published ABI)`, `interface AgentLog { topics: readonly Hex[]; data: Hex; transactionHash: Hex | null; blockNumber: bigint | null }`, `interface ValidatorResponse { validator: Address; executionCostWei: bigint; words: bigint[]; tx: Hex | null; block: bigint | null }`, `interface OracleOutcome { finalStatus: string; finalStatusCode: number | null; finalizeTx: Hex | null; finalizeBlock: bigint | null; validatorResponses: ValidatorResponse[] }`, `oracleOutcomeFromLogs(logs: readonly AgentLog[], requestId: bigint): OracleOutcome`, `checkEvidence g1d-oracle: finalStatus must be Success, Failed or TimedOut; Success needs a symbol with numSources > 0`

Why: request 7773100 did not fail for lack of prices. Its three validators all answered Success: `BTC/USDC:PERP` was byte-identical across them, and `BTC/USDC` spot differed. The 4-argument `createRequest` uses Majority consensus, which needs byte-identical answers, so the request finalized Failed. The guide approved two probes:
- **P1** asks one symbol, `BTC/USDC:PERP`, through the 4-argument `createRequest`. That is the registry's exact path: `BasanosRegistry` builds `getPrices([oracleSymbol], 18)` and calls the 4-argument `createRequest`. If P1 succeeds, the registry works unchanged.
- **P2** asks the same symbol through `createAdvancedRequest` with Threshold consensus: 2 of 3, 30 s, 0.01 STT per validator, 0.06 STT sent. dreamDEX's PriceFeedScheduler makes this call every 5 blocks, and it succeeds.

Both modes:
- read the outcome from `RequestFinalized` and the validator events, using Task 15's mechanism;
- decode each validator's answer from the callback in the finalize transaction (`debug_traceTransaction`), so the evidence shows what came back and whether the answers were identical;
- write their own file (`docs/evidence/g1d-probe-p1.json` or `g1d-probe-p2.json`), never `g1d-oracle.json`;
- check that file with the strict G1(d) rule;
- have a `--dry-run`, and refuse to send more than 0.1 STT.

Verified read-only on Hideki on 2026-11-11:
- **Simulated with `eth_call` from the referee's address:** P1 `createRequest` and P2 `createAdvancedRequest` both simulate OK and return the next request id (about 1.34M and 1.37M gas).
- **Dry-runs:** they print `consensus Majority (4-argument createRequest) … sending 30900000000000000 wei` and `consensus Threshold 2 of 3, 30 s (createAdvancedRequest) … sending 60000000000000000 wei`.
- **Rebuild of request 7773100:** it prints `answers: 3 decoded, identical: false` and records each validator's prices.

**Runbook for the gate-concierge.** This is outside the manifest: each live probe needs the user's GO. It uses the referee burner and costs about 0.002 STT net; the floor and the unused budget are rebated.
- **P1:**
  1. Run `npx tsx packages/spike/src/oracle-probe.ts --symbols BTC/USDC:PERP --dry-run`. It should print `consensus Majority (4-argument createRequest)` and `sending 30900000000000000 wei`, then `dry-run: no transaction sent`.
  2. Then run `npx tsx packages/spike/src/oracle-probe.ts --symbols BTC/USDC:PERP`. It prints `oracle-probe: request <id> -> <Success | Failed> (…)`, then `answers: 3 decoded, identical: <true | false>`, then `PASS g1d-probe-p1` (or the FAIL reason).
  3. Commit `docs/evidence/g1d-probe-p1.json` by explicit path and report the result to the guide.
- **P2** (only if P1 finalized Failed, and only on the guide's approval): run the same two steps with `--advanced` in place of `--symbols BTC/USDC:PERP`. The dry-run should show `sending 60000000000000000 wei`. The evidence goes to `docs/evidence/g1d-probe-p2.json`.

Key safety is as in Task 10. This task writes code and runs unit tests; it sends nothing.

- [ ] **Step 1: Write the failing tests**

Replace `packages/spike/test/live-lib.test.ts` with:
```ts
import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  getAbiItem,
  toFunctionSelector,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  pad,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import { perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORACLE_DEPOSIT,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  operatorRegistryAbi,
  priceOracleAbi,
  somniaAgentsAbi,
} from "@basanos/core";
import {
  AGENT_RESPONSE_TOPIC,
  ORACLE_CALLBACK_PARAMS,
  ORACLE_STATUS,
  PROBE_MAX_WEI,
  agentsAdvancedAbi,
  decodeOracleCallback,
  findCallTo,
  parseProbeArgs,
  probeDeposit,
  symbolsFromCallback,
  decodeOraclePrices,
  oracleOutcomeFromLogs,
  type AgentLog,
  grantCall,
  isFlat,
  ownerOrderCall,
  ownerTx,
  parseSendPath,
  sumCosts,
  txRecord,
} from "../src/live-lib";

describe("txRecord", () => {
  it("records cost as gasUsed x effectiveGasPrice with an explorer link", () => {
    const r = txRecord("close", { transactionHash: "0xab", status: "success", gasUsed: 3_000_000n, effectiveGasPrice: 6_000_000_000n });
    expect(r.costWei).toBe(18_000_000_000_000_000n);
    expect(r.explorer).toBe("https://explorer.testnet.somnia.network/tokyo/tx/0xab");
    expect(sumCosts([r, r])).toBe(36_000_000_000_000_000n);
  });
});

describe("isFlat", () => {
  it("needs no position, no locked collateral and no active pools", () => {
    const base = { account: "0x1" as const, equityOk: true, equity: 1n, lockedCollateral: 0n, totalEquity: 1n, activePools: [], size: 0n };
    expect(isFlat(base)).toBe(true);
    expect(isFlat({ ...base, size: 1n })).toBe(false);
    expect(isFlat({ ...base, lockedCollateral: 1n })).toBe(false);
    expect(isFlat({ ...base, activePools: ["0x2"] })).toBe(false);
  });
});

describe("oracle decoding", () => {
  it("names statuses in the SomniaAgents enum order", () => {
    expect(ORACLE_STATUS[2]).toBe("Success");
    expect(ORACLE_STATUS[4]).toBe("TimedOut");
  });
  it("pairs each symbol with its median, sources and update time", () => {
    const data = encodeFunctionResult({
      abi: priceOracleAbi,
      functionName: "getPrices",
      result: [[74_500n * 10n ** 18n, 0n], [3, 0], [1_794_326_598_000n, 0n]],
    });
    expect(decodeOraclePrices(data, ["BTC/USDC:PERP", "BTC/USDC"])).toEqual([
      { symbol: "BTC/USDC:PERP", price: 74_500n * 10n ** 18n, numSources: 3, lastUpdated: 1_794_326_598_000n },
      { symbol: "BTC/USDC", price: 0n, numSources: 0, lastUpdated: 0n },
    ]);
  });
});

describe("owner-side writes on the viem path", () => {
  it("encodes the raw placeOrder exactly as the SDK's perpPoolWriteAbi does", () => {
    const price = 66_000n * 10n ** 18n;
    const expiry = 3_371_163_205_000_000_000n;
    const c = ownerOrderCall(BTC_POOL, true, price, 13_000n, ORDER_TYPE_LIMIT, expiry);
    expect(c.to).toBe(BTC_POOL);
    expect(c.value).toBe(0n);
    expect(c.data.slice(0, 10)).toBe("0x4e978373");
    expect(c.data).toBe(
      encodeFunctionData({
        abi: perpPoolWriteAbi,
        functionName: "placeOrder",
        args: [true, 0n, price, 13_000n, expiry, ORDER_TYPE_LIMIT, 0, zeroAddress, 0n],
      }),
    );
  });
  it("grants the referee place and cancel on one pool through the registry", () => {
    const referee = "0xE358D82209ea9360F411A041C0200adc385877eb";
    const c = grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR]);
    expect(c.to).toBe(OPERATOR_REGISTRY);
    expect(c.data.slice(0, 10)).toBe("0x7bbc67e6");
    const d = decodeFunctionData({ abi: operatorRegistryAbi, data: c.data });
    expect(d.functionName).toBe("setOperatorApprovalForPool");
    expect(d.args).toEqual([BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR], true]);
  });
  it("signs with ORDER_GAS and an explicit nonce, and keeps the SDK send opt-in", () => {
    expect(ownerTx({ to: BTC_POOL, data: "0x4e978373", value: 0n }, 7, ORDER_GAS)).toEqual({
      to: BTC_POOL,
      data: "0x4e978373",
      value: 0n,
      gas: 10_000_000n,
      nonce: 7,
    });
    expect(parseSendPath(["node", "skeleton-close.ts"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--dry-run"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--sdk-send"])).toBe("sdk");
  });
});

describe("oracle outcome from SomniaAgents logs", () => {
  const id = 7_773_100n;
  const finalized = (requestId: bigint, status: number): AgentLog => ({
    topics: encodeEventTopics({ abi: somniaAgentsAbi, eventName: "RequestFinalized", args: { requestId } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint8" }], [status]),
    transactionHash: "0x851a",
    blockNumber: 47_437_498n,
  });
  const response = (requestId: bigint, validator: Hex, cost: bigint): AgentLog => ({
    topics: [AGENT_RESPONSE_TOPIC, pad(toHex(requestId), { size: 32 }), pad(validator, { size: 32 })],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [1n, 0n, 0n, cost]),
    transactionHash: "0x4789",
    blockNumber: 47_437_498n,
  });
  const validator: Hex = "0x92d237dea7eb9d37e1b303da586f4b83956df6ad";
  it("reads one request's final status and each validator's cost, ignoring other requests", () => {
    const out = oracleOutcomeFromLogs(
      [response(id, validator, 166_000_000_000_000n), response(id + 1n, validator, 1n), finalized(id + 1n, 2), finalized(id, 3)],
      id,
    );
    expect(out.finalStatus).toBe("Failed");
    expect(out.finalStatusCode).toBe(3);
    expect(out.finalizeTx).toBe("0x851a");
    expect(out.finalizeBlock).toBe(47_437_498n);
    expect(out.validatorResponses).toHaveLength(1);
    expect(out.validatorResponses[0]?.validator).toBe(getAddress(validator));
    expect(out.validatorResponses[0]?.executionCostWei).toBe(166_000_000_000_000n);
  });
  it("reports NotFinalized until the request's RequestFinalized log appears", () => {
    const out = oracleOutcomeFromLogs([response(id, validator, 5n), finalized(id + 1n, 2)], id);
    expect(out.finalStatus).toBe("NotFinalized");
    expect(out.finalizeTx).toBeNull();
    expect(out.validatorResponses).toHaveLength(1);
  });
});

describe("oracle probes P1 / P2", () => {
  const E18 = 10n ** 18n;
  it("picks the request and the evidence file from the flags", () => {
    expect(parseProbeArgs(["node", "oracle-probe.ts"])).toEqual({ dryRun: false, fromTx: null, symbols: ["BTC/USDC:PERP", "BTC/USDC"], advanced: false, evidence: "g1d-oracle" });
    expect(parseProbeArgs(["node", "oracle-probe.ts", "--symbols", "BTC/USDC:PERP", "--dry-run"])).toEqual({ dryRun: true, fromTx: null, symbols: ["BTC/USDC:PERP"], advanced: false, evidence: "g1d-probe-p1" });
    expect(parseProbeArgs(["node", "oracle-probe.ts", "--advanced"])).toEqual({ dryRun: false, fromTx: null, symbols: ["BTC/USDC:PERP"], advanced: true, evidence: "g1d-probe-p2" });
    expect(() => parseProbeArgs(["node", "oracle-probe.ts", "--symbols", "btc"])).toThrow(/--symbols/);
    expect(() => parseProbeArgs(["node", "oracle-probe.ts", "--from-tx", "0x12"])).toThrow(/--from-tx/);
  });
  it("funds Majority with the practical deposit and Threshold with 0.01 STT per validator, under a 0.1 STT cap", () => {
    expect(probeDeposit(30_000_000_000_000_000n, false)).toBe(ORACLE_DEPOSIT);
    expect(probeDeposit(30_000_000_000_000_000n, true)).toBe(60_000_000_000_000_000n);
    expect(probeDeposit(30_000_000_000_000_000n, true) <= PROBE_MAX_WEI).toBe(true);
    expect(toFunctionSelector(getAbiItem({ abi: agentsAdvancedAbi, name: "createAdvancedRequest" }))).toBe("0x9256632b");
  });
  const answer = (validator: Hex, prices: bigint[], sources: number[], updated: bigint[], status = 2) => ({
    validator,
    result: encodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", result: [prices, sources, updated] }),
    status,
    receipt: 0n,
    timestamp: 0n,
    executionCost: 0n,
  });
  const callbackInput = (status: number, consensusType: number, responses: ReturnType<typeof answer>[]): Hex =>
    `0x00000000${encodeAbiParameters(ORACLE_CALLBACK_PARAMS, [
      7_773_100n,
      responses,
      status,
      {
        id: 7_773_100n,
        requester: "0xE358D82209ea9360F411A041C0200adc385877eb",
        callbackAddress: "0xE358D82209ea9360F411A041C0200adc385877eb",
        callbackSelector: "0x00000000",
        subcommittee: responses.map((r) => r.validator),
        responses,
        responseCount: BigInt(responses.length),
        failureCount: 0n,
        threshold: 2n,
        createdAt: 1n,
        deadline: 901n,
        status,
        consensusType,
        remainingBudget: 0n,
        perAgentBudget: 300_000_000_000_000n,
      },
    ]).slice(2)}`;
  const v1: Hex = "0x92d237DEa7eb9d37E1B303DA586f4B83956df6AD";
  const v2: Hex = "0xc400f086fDB3AA5b0A565DFc8988FB6Fe2511850";
  const v3: Hex = "0xd47dAa55Bd8f40fFf358Ad139Dd8549704DC842E";
  it("decodes every validator's answer and shows why Majority failed on request 7773100", () => {
    const input = callbackInput(3, 0, [
      answer(v1, [73_976n * E18, 74_010n * E18], [7, 6], [1_794_397_884_091n, 1_794_397_884_077n]),
      answer(v2, [73_976n * E18, 74_008n * E18], [7, 7], [1_794_397_884_091n, 1_794_397_884_059n]),
      answer(v3, [73_976n * E18, 74_011n * E18], [7, 6], [1_794_397_884_091n, 1_794_397_884_006n]),
    ]);
    const trace = { type: "CALL", to: "0x7407cb35a17d511d1bd32dd726adb8d5344ecbe3", calls: [{ type: "CALL", to: v1.toLowerCase() }, { type: "CALL", to: "0xe358d82209ea9360f411a041c0200adc385877eb", input }] };
    const call = findCallTo(trace, "0xE358D82209ea9360F411A041C0200adc385877eb");
    expect(call?.input).toBe(input);
    const cb = decodeOracleCallback(input);
    expect(cb.statusName).toBe("Failed");
    expect(cb.consensusType).toBe(0);
    expect(cb.answers).toHaveLength(3);
    expect(cb.answers[0]?.prices?.[0]).toEqual({ price: 73_976n * E18, numSources: 7, lastUpdated: 1_794_397_884_091n });
    expect(cb.answersIdentical).toBe(false);
    expect(symbolsFromCallback(cb, ["BTC/USDC:PERP", "BTC/USDC"])).toEqual([]);
  });
  it("reports the consensus reading only when the callback status is Success", () => {
    const same = answer(v1, [73_976n * E18], [7], [1_794_397_884_091n]);
    const cb = decodeOracleCallback(callbackInput(2, 0, [same, { ...same, validator: v2 }, { ...same, validator: v3 }]));
    expect(cb.answersIdentical).toBe(true);
    expect(symbolsFromCallback(cb, ["BTC/USDC:PERP"])).toEqual([{ symbol: "BTC/USDC:PERP", price: 73_976n * E18, numSources: 7, lastUpdated: 1_794_397_884_091n }]);
    expect(symbolsFromCallback(null, ["BTC/USDC:PERP"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm the new tests fail**
Run: `npm test -w @basanos/spike -- test/live-lib.test.ts`
Expected: FAIL — `4 failed | 9 passed (13)` (`parseProbeArgs`, `probeDeposit`, `decodeOracleCallback` and `symbolsFromCallback` do not exist yet).

- [ ] **Step 3: Add the probe helpers**

Replace `packages/spike/src/live-lib.ts` with:
```ts
import {
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  getAddress,
  parseAbi,
  parseAbiParameters,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { ORACLE_DEPOSIT, explorerTx, operatorRegistryAbi, priceOracleAbi, somniaAgentsAbi, type AccountSnapshot } from "@basanos/core";

export interface TxRecord {
  label: string;
  hash: Hex;
  status: "success" | "reverted";
  gasUsed: bigint;
  costWei: bigint;
  explorer: string;
}

export function txRecord(
  label: string,
  receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint },
): TxRecord {
  return {
    label,
    hash: receipt.transactionHash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    costWei: receipt.gasUsed * receipt.effectiveGasPrice,
    explorer: explorerTx(receipt.transactionHash),
  };
}

export function sumCosts(txs: readonly TxRecord[]): bigint {
  return txs.reduce((acc, t) => acc + t.costWei, 0n);
}

export function isFlat(s: AccountSnapshot): boolean {
  return s.size === 0n && s.lockedCollateral === 0n && s.activePools.length === 0;
}

/** SomniaAgents ResponseStatus, in declaration order. */
export const ORACLE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"] as const;

export function decodeOraclePrices(
  result: Hex,
  symbols: readonly string[],
): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[] {
  const [prices, numSources, lastUpdated] = decodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", data: result });
  return symbols.map((symbol, i) => ({
    symbol,
    price: prices[i] ?? 0n,
    numSources: numSources[i] ?? 0,
    lastUpdated: lastUpdated[i] ?? 0n,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Owner-side writes (account A). The default path signs locally with viem and sends eth_sendRawTransaction to the
// standard RPC (rpcHttp(), api.hideki…), with ORDER_GAS and an explicit nonce. The SDK's own send path
// (eth_sendRawTransactionSync on send.hideki…, which surfaced TransactionOutcomeUnknownError in the Step 3
// preflight) is an opt-in fallback behind --sdk-send. The SDK stays in use for reads.
// ---------------------------------------------------------------------------------------------------------------

/** How account A's own writes reach the chain; recorded in the evidence as `sendPath`. */
export type SendPath = "viem" | "sdk";

export function parseSendPath(argv: readonly string[]): SendPath {
  return argv.includes("--sdk-send") ? "sdk" : "viem";
}

/** An unsigned call: the same shape as the SDK's build verbs return (to, data, value). */
export interface UnsignedCall {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Owner-side PerpPool order: the SDK 0.33.0 perpPoolWriteAbi signature, selector 0x4e978373 (present in the BTC
 *  pool's beacon implementation; a far resting bid simulates OK from an active account). */
export const ownerPoolAbi = parseAbi([
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
]);

/** Raw placeOrder on the pool, with the arguments the SDK's placePerpOrder fills in (userData 0, no self-match option, no builder). */
export function ownerOrderCall(
  pool: Address,
  isBid: boolean,
  price: bigint,
  quantity: bigint,
  orderType: number,
  expireTimestampNs: bigint,
): UnsignedCall {
  return {
    to: pool,
    value: 0n,
    data: encodeFunctionData({
      abi: ownerPoolAbi,
      functionName: "placeOrder",
      args: [isBid, 0n, price, quantity, expireTimestampNs, orderType, 0, zeroAddress, 0n],
    }),
  };
}

/** The per-pool operator grant on the OperatorPermissionsRegistry (the SDK has no build verb for it). */
export function grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({
      abi: operatorRegistryAbi,
      functionName: "setOperatorApprovalForPool",
      args: [pool, operator, [...selectors], true],
    }),
  };
}

/** The exact transaction account A signs on the viem path: a fixed gas limit and an explicit nonce. */
export function ownerTx(
  call: UnsignedCall,
  nonce: number,
  gas: bigint,
): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number } {
  return { to: call.to, data: call.data, value: call.value, gas, nonce };
}

// ---------------------------------------------------------------------------------------------------------------
// Price Oracle outcome from SomniaAgents logs. getRequest cannot report it: the platform deletes a request once it
// finalizes, and getRequest then reverts RequestNotFound (0x4ec726c7). Request 7773100 (2026-11-11) finalized one
// block after creation, so a getRequest poll only ever saw the revert.
// ---------------------------------------------------------------------------------------------------------------

/** topic0 of RequestFinalized(uint256 indexed requestId, uint8 status). */
export const REQUEST_FINALIZED_TOPIC: Hex = toEventSelector(getAbiItem({ abi: somniaAgentsAbi, name: "RequestFinalized" }));

/** topic0 of SomniaAgents' per-validator response event. It is not in the published ABI. Its topics are
 *  [topic0, requestId, validator] and its data is four words, the last being the validator's execution cost in wei
 *  (seen on requests 7773100 and 7773101). It carries no result bytes: prices reach only the callback. */
export const AGENT_RESPONSE_TOPIC: Hex = "0x1b44ed537f0ae64cca44e5a71b06bc838a30bbc5454ffdc2aee3844926264dfd";

export interface AgentLog {
  topics: readonly Hex[];
  data: Hex;
  transactionHash: Hex | null;
  blockNumber: bigint | null;
}

export interface ValidatorResponse {
  validator: Address;
  executionCostWei: bigint;
  words: bigint[];
  tx: Hex | null;
  block: bigint | null;
}

export interface OracleOutcome {
  /** An ORACLE_STATUS name, or "NotFinalized" while no RequestFinalized log for the request has been seen. */
  finalStatus: string;
  finalStatusCode: number | null;
  finalizeTx: Hex | null;
  finalizeBlock: bigint | null;
  validatorResponses: ValidatorResponse[];
}

export function oracleOutcomeFromLogs(logs: readonly AgentLog[], requestId: bigint): OracleOutcome {
  const out: OracleOutcome = { finalStatus: "NotFinalized", finalStatusCode: null, finalizeTx: null, finalizeBlock: null, validatorResponses: [] };
  for (const log of logs) {
    const [t0, t1, t2] = log.topics;
    if (!t0 || !t1 || BigInt(t1) !== requestId) continue;
    if (t0.toLowerCase() === REQUEST_FINALIZED_TOPIC.toLowerCase()) {
      const code = Number(BigInt(log.data));
      out.finalStatusCode = code;
      out.finalStatus = ORACLE_STATUS[code] ?? `status ${code}`;
      out.finalizeTx = log.transactionHash;
      out.finalizeBlock = log.blockNumber;
    } else if (t0.toLowerCase() === AGENT_RESPONSE_TOPIC && t2) {
      const words = (log.data.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
      out.validatorResponses.push({
        validator: getAddress(`0x${t2.slice(26)}`),
        executionCostWei: words[words.length - 1] ?? 0n,
        words,
        tx: log.transactionHash,
        block: log.blockNumber,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Oracle probes P1 / P2 (guide GO, 2026-11-11). P1 asks one symbol through the 4-argument createRequest (Majority
// consensus): the registry's exact path. P2 asks it through createAdvancedRequest with Threshold consensus (2 of 3,
// 30 s, 0.01 STT per validator): the call dreamDEX's PriceFeedScheduler makes every 5 blocks.
// ---------------------------------------------------------------------------------------------------------------

/** createAdvancedRequest, selector 0x9256632b. The types are confirmed by that selector and by the scheduler's call
 *  arguments (3, 2, 1, 30); it returns the request id (eth_call). The parameter names are ours. */
export const agentsAdvancedAbi = parseAbi([
  "function createAdvancedRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes payload, uint256 subcommitteeSize, uint256 threshold, uint8 consensusType, uint256 timeout) payable returns (uint256 requestId)",
]);

/** Threshold consensus as the PriceFeedScheduler uses it. consensusType 1 = Threshold (0 = Majority, the default). */
export const ADVANCED_REQUEST = {
  subcommitteeSize: 3n,
  threshold: 2n,
  consensusType: 1,
  timeoutSec: 30n,
  perAgentBudgetWei: 10_000_000_000_000_000n,
} as const;

/** Hard cap on what one probe may send: 0.1 STT. */
export const PROBE_MAX_WEI = 100_000_000_000_000_000n;

export type OracleEvidence = "g1d-oracle" | "g1d-probe-p1" | "g1d-probe-p2";

export interface ProbeArgs {
  dryRun: boolean;
  fromTx: Hex | null;
  symbols: string[];
  advanced: boolean;
  evidence: OracleEvidence;
}

/** No flags: the original G1(d) request (two symbols) into g1d-oracle. --symbols: P1 into g1d-probe-p1.
 *  --advanced: P2 into g1d-probe-p2 (one symbol, BTC/USDC:PERP, unless --symbols says otherwise). */
export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  const valueOf = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const fromTx = valueOf("--from-tx");
  if (fromTx !== null && !/^0x[0-9a-fA-F]{64}$/.test(fromTx)) throw new Error("--from-tx needs a 32-byte transaction hash");
  const list = valueOf("--symbols");
  const advanced = argv.includes("--advanced");
  const symbols =
    list !== null ? list.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : advanced ? ["BTC/USDC:PERP"] : ["BTC/USDC:PERP", "BTC/USDC"];
  if (symbols.length === 0 || symbols.some((s) => !/^[A-Z0-9]+\/[A-Z0-9]+(:PERP)?$/.test(s))) {
    throw new Error(`--symbols must list symbols such as BTC/USDC:PERP (got ${list ?? "nothing"})`);
  }
  const evidence: OracleEvidence = advanced ? "g1d-probe-p2" : list !== null ? "g1d-probe-p1" : "g1d-oracle";
  return { dryRun: argv.includes("--dry-run"), fromTx: fromTx === null ? null : (fromTx as Hex), symbols, advanced, evidence };
}

/** What a request sends: Majority keeps the practical 0.0309 STT; Threshold funds 0.01 STT per validator over the floor. */
export function probeDeposit(floorWei: bigint, advanced: boolean): bigint {
  if (advanced) return floorWei + ADVANCED_REQUEST.perAgentBudgetWei * ADVANCED_REQUEST.subcommitteeSize;
  return floorWei >= ORACLE_DEPOSIT ? floorWei + 900_000_000_000_000n : ORACLE_DEPOSIT;
}

/** One node of a debug_traceTransaction callTracer result. */
export interface TraceCall {
  type?: string;
  to?: string;
  input?: Hex;
  calls?: TraceCall[];
}

/** The first call to `to` that carries data: SomniaAgents' callback inside the finalize transaction. */
export function findCallTo(node: TraceCall, to: Address): TraceCall | null {
  if ((node.to ?? "").toLowerCase() === to.toLowerCase() && (node.input ?? "0x").length > 10) return node;
  for (const k of node.calls ?? []) {
    const hit = findCallTo(k, to);
    if (hit) return hit;
  }
  return null;
}

const RESPONSE_T = "(address validator, bytes result, uint8 status, uint256 receipt, uint256 timestamp, uint256 executionCost)";
const REQUEST_T =
  "(uint256 id, address requester, address callbackAddress, bytes4 callbackSelector, address[] subcommittee, " +
  RESPONSE_T +
  "[] responses, uint256 responseCount, uint256 failureCount, uint256 threshold, uint256 createdAt, uint256 deadline, uint8 status, uint8 consensusType, uint256 remainingBudget, uint256 perAgentBudget)";

/** The callback's arguments as SomniaAgents sends them: (requestId, responses, status, details). */
export const ORACLE_CALLBACK_PARAMS = parseAbiParameters(`uint256 requestId, ${RESPONSE_T}[] responses, uint8 status, ${REQUEST_T} details`);

export interface OracleAnswer {
  validator: Address;
  status: number;
  result: Hex;
  prices: { price: bigint; numSources: number; lastUpdated: bigint }[] | null;
}

export interface OracleCallback {
  requestId: bigint;
  status: number;
  statusName: string;
  consensusType: number;
  threshold: bigint;
  failureCount: bigint;
  answers: OracleAnswer[];
  answersIdentical: boolean;
}

/** Decodes the callback input (selector + arguments), including each validator's getPrices answer. */
export function decodeOracleCallback(input: Hex): OracleCallback {
  const [requestId, responses, status, details] = decodeAbiParameters(ORACLE_CALLBACK_PARAMS, `0x${input.slice(10)}`);
  const answers: OracleAnswer[] = responses.map((r) => {
    let prices: OracleAnswer["prices"] = null;
    try {
      const [p, n, u] = decodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", data: r.result });
      prices = p.map((price, i) => ({ price, numSources: n[i] ?? 0, lastUpdated: u[i] ?? 0n }));
    } catch {
      prices = null;
    }
    return { validator: r.validator, status: r.status, result: r.result, prices };
  });
  const first = answers[0]?.result;
  return {
    requestId,
    status,
    statusName: ORACLE_STATUS[status] ?? `status ${status}`,
    consensusType: details.consensusType,
    threshold: details.threshold,
    failureCount: details.failureCount,
    answers,
    answersIdentical: first !== undefined && answers.every((a) => a.result === first),
  };
}

/** The consensus reading per symbol: only a Success callback yields one (taken from its first successful answer). */
export function symbolsFromCallback(
  cb: OracleCallback | null,
  symbols: readonly string[],
): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[] {
  if (!cb || cb.status !== 2) return [];
  const first = cb.answers.find((a) => a.status === 2 && a.prices !== null);
  if (!first?.prices) return [];
  const prices = first.prices;
  return symbols.map((symbol, i) => ({
    symbol,
    price: prices[i]?.price ?? 0n,
    numSources: prices[i]?.numSources ?? 0,
    lastUpdated: prices[i]?.lastUpdated ?? 0n,
  }));
}
```

- [ ] **Step 4: Run to confirm they pass**
Run: `npm test -w @basanos/spike -- test/live-lib.test.ts`
Expected: PASS — `13 passed`.

- [ ] **Step 5: Add the P1 / P2 modes to the probe**

Replace `packages/spike/src/oracle-probe.ts` with:
```ts
// G1(d) and the oracle probes P1 / P2, all from the referee EOA (callback = the EOA itself).
//   no flags                  the original G1(d) request: BTC/USDC:PERP + BTC/USDC, 4-argument createRequest -> g1d-oracle
//   --symbols BTC/USDC:PERP   P1: one symbol, 4-argument createRequest (Majority), the registry's exact path -> g1d-probe-p1
//   --advanced                P2: createAdvancedRequest, Threshold 2 of 3, 30 s, 0.06 STT (BTC/USDC:PERP) -> g1d-probe-p2
//   --dry-run                 reads only and prints what would be sent
//   --from-tx <hash>          rebuilds the evidence from an earlier request (no key, no send); the flags pick the file
// The outcome comes from SomniaAgents logs (RequestFinalized and the per-validator response events), never from
// getRequest: the platform deletes a request once it finalizes. Each validator's answer is decoded from the callback
// SomniaAgents makes inside the finalize transaction (debug_traceTransaction), so the evidence shows what was
// returned and whether the answers were identical (Majority needs byte-identical answers).
import { writeFileSync } from "node:fs";
import { decodeEventLog, decodeFunctionData, encodeFunctionData, pad, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ORACLE_AGENT_ID, SOMNIA_AGENTS, priceOracleAbi, somniaAgentsAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requirePrivateKey } from "@basanos/core/node";
import { checkEvidence, toJsonSafe, writeEvidence } from "./evidence";
import {
  ADVANCED_REQUEST,
  AGENT_RESPONSE_TOPIC,
  PROBE_MAX_WEI,
  REQUEST_FINALIZED_TOPIC,
  agentsAdvancedAbi,
  decodeOracleCallback,
  findCallTo,
  oracleOutcomeFromLogs,
  parseProbeArgs,
  probeDeposit,
  symbolsFromCallback,
  txRecord,
  type AgentLog,
  type OracleCallback,
  type OracleOutcome,
  type ProbeArgs,
  type TraceCall,
} from "./live-lib";
import { publicClient, walletFor } from "./rpc";

loadDotEnv();
let args: ProbeArgs;
try {
  args = parseProbeArgs(process.argv);
} catch (e) {
  console.error(`oracle-probe: ${(e as Error).message}`);
  process.exit(1);
}
const client = publicClient();
const LOG_WINDOW = 1_000n; // eth_getLogs answers at most 1,000 blocks per call on Hideki
const REBUILD_SPAN = 3_000n; // a rebuild scans this many blocks after the request (it finalizes within a few)
const agentsAbi = [...somniaAgentsAbi, ...agentsAdvancedAbi] as const;
const consensusLabel = args.advanced
  ? `Threshold ${ADVANCED_REQUEST.threshold} of ${ADVANCED_REQUEST.subcommitteeSize}, ${ADVANCED_REQUEST.timeoutSec} s (createAdvancedRequest)`
  : "Majority (4-argument createRequest)";

type Receipt = Awaited<ReturnType<typeof client.waitForTransactionReceipt>>;

/** SomniaAgents logs for one request (RequestFinalized or a validator response), in 1,000-block windows. */
async function agentLogs(requestId: bigint, fromBlock: bigint, toBlock: bigint): Promise<AgentLog[]> {
  const out: AgentLog[] = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_WINDOW) {
    const to = from + LOG_WINDOW - 1n < toBlock ? from + LOG_WINDOW - 1n : toBlock;
    const raw = await client.request({
      method: "eth_getLogs",
      params: [
        {
          address: SOMNIA_AGENTS,
          fromBlock: toHex(from),
          toBlock: toHex(to),
          topics: [[REQUEST_FINALIZED_TOPIC, AGENT_RESPONSE_TOPIC], pad(toHex(requestId), { size: 32 })],
        },
      ],
    });
    for (const l of raw) {
      out.push({ topics: l.topics, data: l.data, transactionHash: l.transactionHash, blockNumber: l.blockNumber === null ? null : BigInt(l.blockNumber) });
    }
  }
  return out;
}

/** Polls the logs from the request's block until it finalizes or the deadline passes. */
async function waitForOutcome(requestId: bigint, fromBlock: bigint, untilMs: number): Promise<OracleOutcome> {
  const logs: AgentLog[] = [];
  let scanned = fromBlock - 1n;
  for (;;) {
    const head = await client.getBlockNumber();
    if (head > scanned) {
      logs.push(...(await agentLogs(requestId, scanned + 1n, head)));
      scanned = head;
    }
    const outcome = oracleOutcomeFromLogs(logs, requestId);
    if (outcome.finalizeTx !== null || Date.now() > untilMs) return outcome;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

/** The validators' answers, from the callback inside the finalize transaction; null if the trace is not served. */
async function callbackOf(finalizeTx: Hex | null, callback: Address): Promise<OracleCallback | null> {
  if (finalizeTx === null) return null;
  try {
    const trace = (await client.request({ method: "debug_traceTransaction", params: [finalizeTx, { tracer: "callTracer" }] } as never)) as TraceCall;
    const call = findCallTo(trace, callback);
    return call?.input ? decodeOracleCallback(call.input) : null;
  } catch {
    return null;
  }
}

function createdFrom(receipt: Receipt): { requestId: bigint; perAgentBudget: bigint; subcommittee: readonly Address[] } | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: somniaAgentsAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "RequestCreated") {
        return { requestId: ev.args.requestId, perAgentBudget: ev.args.perAgentBudget, subcommittee: ev.args.subcommittee };
      }
    } catch {
      // another SomniaAgents event
    }
  }
  return null;
}

function payloadOf(payload: Hex): { selector: Hex; symbols: readonly string[] | null; decimals: number | null } {
  try {
    const d = decodeFunctionData({ abi: priceOracleAbi, data: payload });
    return { selector: payload.slice(0, 10) as Hex, symbols: d.args[0], decimals: d.args[1] };
  } catch {
    return { selector: payload.slice(0, 10) as Hex, symbols: null, decimals: null };
  }
}

async function record(
  mode: "live" | "from-tx",
  receipt: Receipt,
  sent: { requester: Address; agentId: bigint; callback: Address; callbackSelector: Hex; payload: Hex; value: bigint; floor: bigint | null; call: string },
  created: { requestId: bigint; perAgentBudget: bigint; subcommittee: readonly Address[] },
  outcome: OracleOutcome,
): Promise<never> {
  const cb = await callbackOf(outcome.finalizeTx, sent.callback);
  const symbolsAsked = payloadOf(sent.payload).symbols ?? args.symbols;
  const data = {
    mode,
    probe: args.evidence === "g1d-oracle" ? null : args.evidence === "g1d-probe-p1" ? "P1" : "P2",
    request: sent.call,
    consensus: cb ? (cb.consensusType === 1 ? "Threshold" : cb.consensusType === 0 ? "Majority" : `type ${cb.consensusType}`) : consensusLabel,
    requestId: created.requestId,
    agentId: sent.agentId,
    requester: sent.requester,
    callback: sent.callback.toLowerCase() === sent.requester.toLowerCase() ? "referee EOA" : sent.callback,
    callbackSelector: sent.callbackSelector,
    payload: payloadOf(sent.payload),
    depositFloorWei: sent.floor,
    sentWei: sent.value,
    perAgentBudget: created.perAgentBudget,
    subcommittee: created.subcommittee,
    finalStatus: outcome.finalStatus,
    finalStatusCode: outcome.finalStatusCode,
    finalizeTx: outcome.finalizeTx,
    finalizeBlock: outcome.finalizeBlock,
    responses: outcome.validatorResponses.length,
    validatorResponses: outcome.validatorResponses,
    validatorCostWei: outcome.validatorResponses.reduce((a, r) => a + r.executionCostWei, 0n),
    outcomeSource: "SomniaAgents logs: RequestFinalized and the per-validator response events",
    answers: cb ? cb.answers.map((a) => ({ validator: a.validator, status: a.status, prices: a.prices })) : null,
    answersIdentical: cb ? cb.answersIdentical : null,
    answersSource: cb ? "the callback in the finalize transaction (debug_traceTransaction)" : "trace not served",
    // The consensus reading: only a Success callback yields one.
    symbols: symbolsFromCallback(cb, symbolsAsked),
    tx: txRecord("createRequest", receipt),
  };
  if (args.evidence === "g1d-oracle") {
    writeEvidence("g1d-oracle", data);
  } else {
    const body = { evidence: args.evidence, writtenAt: new Date().toISOString(), ...data };
    writeFileSync(repoPath(`docs/evidence/${args.evidence}.json`), `${JSON.stringify(toJsonSafe(body), null, 2)}\n`);
  }
  console.log(
    `oracle-probe: request ${created.requestId} -> ${outcome.finalStatus} (${outcome.validatorResponses.length} validator responses` +
      `${outcome.finalizeTx ? `; finalized in ${outcome.finalizeTx}` : ""})`,
  );
  console.log(cb ? `answers: ${cb.answers.length} decoded, identical: ${cb.answersIdentical}` : "answers: trace not served");
  for (const s of data.symbols) console.log(`  ${s.symbol}: ${s.price} (${s.numSources} sources)`);
  if (args.evidence !== "g1d-oracle") {
    // The probe's own gate: the strict G1(d) rule applied to this file.
    const problems = checkEvidence("g1d-oracle", toJsonSafe(data) as Record<string, unknown>).map((p) => p.replace(/^g1d-oracle/, args.evidence));
    for (const p of problems) console.log(`FAIL ${p}`);
    if (problems.length === 0) console.log(`PASS ${args.evidence}`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
  process.exit(outcome.finalizeTx === null ? 1 : 0);
}

if (args.fromTx) {
  // Rebuild from an earlier createRequest / createAdvancedRequest transaction: reads only, no key.
  const hash = args.fromTx;
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  if (tx.to?.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) {
    console.error(`oracle-probe: ${hash} is not a SomniaAgents transaction`);
    process.exit(1);
  }
  const call = decodeFunctionData({ abi: agentsAbi, data: tx.input });
  if (call.functionName !== "createRequest" && call.functionName !== "createAdvancedRequest") {
    console.error(`oracle-probe: ${hash} calls ${call.functionName}, not a request`);
    process.exit(1);
  }
  const [agentId, callback, callbackSelector, payload] = call.args as unknown as [bigint, Address, Hex, Hex];
  const created = createdFrom(receipt);
  if (!created) {
    console.error(`oracle-probe: ${hash} emitted no RequestCreated`);
    process.exit(1);
  }
  let floor: bigint | null = null;
  try {
    floor = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequestDeposit", blockNumber: receipt.blockNumber - 1n });
  } catch {
    floor = null; // that block's state is no longer served
  }
  const head = await client.getBlockNumber();
  const last = receipt.blockNumber + REBUILD_SPAN < head ? receipt.blockNumber + REBUILD_SPAN : head;
  const outcome = oracleOutcomeFromLogs(await agentLogs(created.requestId, receipt.blockNumber, last), created.requestId);
  await record(
    "from-tx",
    receipt,
    { requester: tx.from, agentId, callback, callbackSelector, payload, value: tx.value, floor, call: call.functionName },
    created,
    outcome,
  );
}

const refereePk = requirePrivateKey("REFEREE_PK");
const referee: Address = privateKeyToAccount(refereePk).address;
const wallet = walletFor(refereePk);
const payload = encodeFunctionData({ abi: priceOracleAbi, functionName: "getPrices", args: [args.symbols, 18] });
const floor = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequestDeposit" });
const value = probeDeposit(floor, args.advanced);
console.log(
  `oracle-probe: ${args.evidence}, symbols ${args.symbols.join(", ")}, consensus ${consensusLabel}; floor ${floor} wei, sending ${value} wei from ${referee}`,
);
if (value > PROBE_MAX_WEI) {
  console.error(`oracle-probe: STOP — ${value} wei is above the ${PROBE_MAX_WEI} wei probe cap`);
  process.exit(1);
}
if (args.dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}
const hash = args.advanced
  ? await wallet.writeContract({
      address: SOMNIA_AGENTS,
      abi: agentsAdvancedAbi,
      functionName: "createAdvancedRequest",
      args: [
        ORACLE_AGENT_ID,
        referee,
        "0x00000000",
        payload,
        ADVANCED_REQUEST.subcommitteeSize,
        ADVANCED_REQUEST.threshold,
        ADVANCED_REQUEST.consensusType,
        ADVANCED_REQUEST.timeoutSec,
      ],
      value,
    })
  : await wallet.writeContract({
      address: SOMNIA_AGENTS,
      abi: somniaAgentsAbi,
      functionName: "createRequest",
      args: [ORACLE_AGENT_ID, referee, "0x00000000", payload],
      value,
    });
const receipt = await client.waitForTransactionReceipt({ hash });
const created = createdFrom(receipt);
if (!created) {
  const failed = { mode: "live", requestId: "none", finalStatus: "NoRequestCreated", symbols: [], tx: txRecord("createRequest", receipt) };
  if (args.evidence === "g1d-oracle") writeEvidence("g1d-oracle", failed);
  else writeFileSync(repoPath(`docs/evidence/${args.evidence}.json`), `${JSON.stringify(toJsonSafe({ evidence: args.evidence, ...failed }), null, 2)}\n`);
  console.log(`oracle-probe: no RequestCreated in ${hash}`);
  process.exit(1);
}
const outcome = await waitForOutcome(created.requestId, receipt.blockNumber, Date.now() + 180_000);
await record(
  "live",
  receipt,
  {
    requester: referee,
    agentId: ORACLE_AGENT_ID,
    callback: referee,
    callbackSelector: "0x00000000",
    payload,
    value,
    floor,
    call: args.advanced ? "createAdvancedRequest" : "createRequest",
  },
  created,
  outcome,
);
```

- [ ] **Step 6: Type-check (the gate-concierge runs the probes)**
Run: `npm run typecheck -w @basanos/spike`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 7: Run the package tests (the gate)**
Run: `npm test -w @basanos/spike`
Expected: PASS — `25 passed`.

- [ ] **Step 8: Commit (kernel-performed — no agent runs this)**
Message: `feat(spike): oracle probes P1 (one symbol, Majority) and P2 (Threshold) with callback decoding and dry-runs`

---

### Task 17: Deposit tool — an account's own wallet USDso into its own MarginBank balance (approve + deposit, viem-direct, dry-run, evidence)

**Files:**
- Create: `packages/spike/src/funding.ts`
- Create: `packages/spike/src/deposit.ts`
- Test: `packages/spike/test/funding.test.ts`

**Depends on:** Task 2, contracts:Task 8, Task 1, Task 3, Task 7, Task 10, Task 14
**Effort:** medium
**Model tier:** top
**Provides:** `marginBankConfigAbi (getSystemConfig: collateralToken, maxLeverageLimit)`, `SKELETON_MIN_UNLOCKED = 1 USDso (1_000_000_000_000_000_000n)`, `type DemoAccount = "A" | "B"`, `parseUsdso(text: string): bigint`, `formatUsdso(wei: bigint): string`, `parseDepositArgs(argv: readonly string[]): DepositArgs`, `depositProblem(walletWei: bigint, amountWei: bigint): string | null`, `approveCall(token: Address, spender: Address, amountWei: bigint): UnsignedCall`, `depositCall(bank: Address, amountWei: bigint): UnsignedCall`, `fundedProblem(who: string, unlockedWei: bigint, needWei: bigint): string | null`, `capFromLeverage(lev: { voucherLeverageCapX: number; marketMaxLeverageBps: bigint | null; protocolMaxLeverageX: number }, voucherClaimed: boolean): { capX: number; capSource: "voucher" | "market" }`, `checkDeposit(data: Record<string, unknown> | null, account: DemoAccount): string[]`, `CLI: npx tsx packages/spike/src/deposit.ts --account A|B [--dry-run | --amount <USDso> | --check] (the account's own key deposits its own wallet USDso into its own MarginBank balance; refuses during a run; writes docs/evidence/deposit-a.json / deposit-b.json)`
**Requires:** `USDSO`, `MARGIN_BANK`, `ORDER_GAS = 10_000_000n`, `STT_WRITE_HEADROOM = 600_000_000_000_000_000n`, `marginBankAbi`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `repoPath(rel: string): string`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `toJsonSafe(value: unknown): unknown`, `publicClient(): PublicClient`, `walletFor(pk: Hex): viem WalletClient bound to CHAIN and the key's account`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `ownerTx(call: UnsignedCall, nonce: number, gas: bigint): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }`, `interface UnsignedCall { to: Address; data: Hex; value: bigint }`

Why (guide, 2026-11-12):
- **Where the money is:** USDso arrived in account A's **wallet** from an organizer send. The user then moved about 50 to account B (one transfer, organizer-approved; ledger `62e1287`). Neither account has claimed a voucher (`claim()` still reverts `0x3e31dcc2`), and neither joins the Arena (B15).
- **What is missing:** no task deposits margin, and the repo has no approve or deposit code.
- **What this task builds:** a tool with which each account's own key approves exactly the amount to the MarginBank and calls `MarginBank.deposit(amount)`, then reads `getAccountState(account).unlockedCollateralBalance` back.
  - It sends viem-direct, as Task 14 does: signed locally, sent to the standard RPC, `ORDER_GAS`, explicit pending nonce.
  - It writes `docs/evidence/deposit-a.json` or `deposit-b.json`.
  - It refuses while the account has an active run, because a MarginBank flow during a run voids it.

Verified read-only on Hideki on 2026-11-12:
- **The bank's collateral token:** `MarginBank.getSystemConfig().collateralToken` is USDso `0xed79…4F72`, with `maxLeverageLimit` 40.
- **Both accounts:** each holds 50 USDso in its wallet, with allowance 0 and unlocked margin 0.
- **Simulations from A:** `approve(MarginBank, 50)` simulates OK, at about 1.39M gas. `deposit(50)` reverts without the allowance, as expected.
- **`getPerpLeverage` for a non-voucher account:** `marketMaxLeverageBps` 400000 (40×), `protocolMaxLeverageX` 40, `voucherLeverageCapX` 20. The voucher cap does not apply, so `capFromLeverage` takes 40×.
- **Dry-run with a throwaway key:** it reads all of the above and stops at the STT check.

Key safety is as in Task 10: keys only through `requirePrivateKey`, never printed. This task writes code and runs unit tests; it sends nothing. Tasks 18 and 19 run it live.

- [ ] **Step 1: Write the failing test**

`packages/spike/test/funding.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { marginBankWriteAbi } from "@somnia-chain/markets-sdk";
import { MARGIN_BANK, USDSO } from "@basanos/core";
import {
  SKELETON_MIN_UNLOCKED,
  approveCall,
  capFromLeverage,
  checkDeposit,
  depositCall,
  depositProblem,
  formatUsdso,
  fundedProblem,
  parseDepositArgs,
  parseUsdso,
} from "../src/funding";

const E18 = 10n ** 18n;

describe("funding a challenge account from its own wallet USDso", () => {
  it("reads the account, the amount and the mode from the flags", () => {
    expect(parseDepositArgs(["node", "deposit.ts", "--account", "A", "--dry-run"])).toEqual({ account: "A", amountWei: null, dryRun: true, check: false });
    expect(parseDepositArgs(["node", "deposit.ts", "--account", "B", "--amount", "50"])).toEqual({ account: "B", amountWei: 50n * E18, dryRun: false, check: false });
    expect(parseDepositArgs(["node", "deposit.ts", "--account", "A", "--check"]).check).toBe(true);
    expect(() => parseDepositArgs(["node", "deposit.ts", "--amount", "50"])).toThrow(/--account/);
    expect(() => parseDepositArgs(["node", "deposit.ts", "--account", "C"])).toThrow(/--account/);
  });
  it("parses and prints USDso amounts", () => {
    expect(parseUsdso("50.25")).toBe(50n * E18 + 25n * 10n ** 16n);
    expect(formatUsdso(50n * E18)).toBe("50");
    expect(formatUsdso(50n * E18 + 25n * 10n ** 16n)).toBe("50.25");
    expect(() => parseUsdso("-1")).toThrow(/USDso/);
  });
  it("refuses a deposit the wallet cannot cover", () => {
    expect(depositProblem(50n * E18, 50n * E18)).toBeNull();
    expect(depositProblem(50n * E18, 0n)).toMatch(/above 0/);
    expect(depositProblem(50n * E18, 51n * E18)).toMatch(/holds 50 USDso/);
  });
  it("encodes an exact approve and the MarginBank deposit the SDK encodes", () => {
    const a = approveCall(USDSO, MARGIN_BANK, 50n * E18);
    expect(a.to).toBe(USDSO);
    expect(a.data.slice(0, 10)).toBe("0x095ea7b3");
    const d = depositCall(MARGIN_BANK, 50n * E18);
    expect(d.to).toBe(MARGIN_BANK);
    expect(d.data.slice(0, 10)).toBe("0xb6b55f25");
    expect(d.data).toBe(encodeFunctionData({ abi: marginBankWriteAbi, functionName: "deposit", args: [50n * E18] }));
  });
  it("tests funded instead of a claimed voucher, and takes the market cap for a non-voucher account", () => {
    expect(fundedProblem("account A", 0n, SKELETON_MIN_UNLOCKED)).toMatch(/below the 1 USDso this run needs; deposit/);
    expect(fundedProblem("account A", 50n * E18, SKELETON_MIN_UNLOCKED)).toBeNull();
    const lev = { voucherLeverageCapX: 20, marketMaxLeverageBps: 400_000n, protocolMaxLeverageX: 40 };
    expect(capFromLeverage(lev, false)).toEqual({ capX: 40, capSource: "market" });
    expect(capFromLeverage(lev, true)).toEqual({ capX: 20, capSource: "voucher" });
  });
  it("checks a deposit evidence file", () => {
    const ok = { account: "A", ok: true, amountWei: "50000000000000000000", creditedWei: "50000000000000000000", txs: [{ label: "approve", status: "success" }, { label: "deposit", status: "success" }] };
    expect(checkDeposit(ok, "A")).toEqual([]);
    expect(checkDeposit({ ...ok, creditedWei: "0" }, "A")).not.toEqual([]);
    expect(checkDeposit(ok, "B")).not.toEqual([]);
    expect(checkDeposit(null, "A")).toEqual(["deposit-a: evidence file is missing"]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/spike -- test/funding.test.ts`
Expected: FAIL — `Cannot find module '../src/funding'`.

- [ ] **Step 3: Write the funding helpers**

`packages/spike/src/funding.ts`:
```ts
// Funding a challenge account from its own wallet USDso. B14/B15: the voucher claim reverts chain-wide, and the
// organizers sent USDso to the wallets instead. An account's own key approves its own USDso to the MarginBank and
// deposits it into its own MarginBank balance; nothing moves between accounts. Deposit before any startRun: a
// MarginBank money flow during a run voids it.
import { encodeFunctionData, erc20Abi, parseAbi, type Address } from "viem";
import { marginBankWriteAbi } from "@somnia-chain/markets-sdk";
import type { UnsignedCall } from "./live-lib";

/** MarginBank.getSystemConfig (the SDK 0.33.0 read ABI): collateralToken is the token a deposit pulls. */
export const marginBankConfigAbi = parseAbi([
  "function getSystemConfig() view returns ((address marginBank, address collateralToken, address perpPoolFactory, address liquidationEngine, address insuranceFund, address feeRecipient, uint16 maxLeverageLimit, bool fullyWired))",
]);

const E18 = 10n ** 18n;

/** The least unlocked MarginBank collateral spike:11's skeleton needs. Its minimum order (0.00013 BTC) is about
 *  9.6 USDso of notional, about 0.24 USDso of margin at the 40x market cap; 1 USDso leaves room for fees. */
export const SKELETON_MIN_UNLOCKED = E18;

export type DemoAccount = "A" | "B";

export interface DepositArgs {
  account: DemoAccount;
  amountWei: bigint | null;
  dryRun: boolean;
  check: boolean;
}

/** "50" or "50.25" USDso -> wei (18 decimals). */
export function parseUsdso(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) throw new Error(`not a USDso amount: ${text}`);
  return BigInt(m[1] ?? "0") * E18 + BigInt((m[2] ?? "").padEnd(18, "0"));
}

/** wei -> "50" or "50.25". */
export function formatUsdso(wei: bigint): string {
  const neg = wei < 0n;
  const abs = neg ? -wei : wei;
  const frac = (abs % E18).toString().padStart(18, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${abs / E18}${frac ? `.${frac}` : ""}`;
}

/** --account A|B (required), --amount <USDso> (a live deposit), --dry-run (reads only), --check (the gate). */
export function parseDepositArgs(argv: readonly string[]): DepositArgs {
  const valueOf = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const account = valueOf("--account");
  if (account !== "A" && account !== "B") throw new Error("--account must be A or B");
  const amount = valueOf("--amount");
  return { account, amountWei: amount === null ? null : parseUsdso(amount), dryRun: argv.includes("--dry-run"), check: argv.includes("--check") };
}

/** null when the wallet can fund the deposit; otherwise why not. */
export function depositProblem(walletWei: bigint, amountWei: bigint): string | null {
  if (amountWei <= 0n) return "the deposit amount must be above 0";
  if (amountWei > walletWei) return `the wallet holds ${formatUsdso(walletWei)} USDso, less than the ${formatUsdso(amountWei)} asked`;
  return null;
}

/** ERC-20 approve of exactly the deposit amount (never an unlimited allowance). */
export function approveCall(token: Address, spender: Address, amountWei: bigint): UnsignedCall {
  return { to: token, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amountWei] }) };
}

/** MarginBank.deposit(amount): the bank pulls the approved collateral into the caller's own balance. */
export function depositCall(bank: Address, amountWei: bigint): UnsignedCall {
  return { to: bank, value: 0n, data: encodeFunctionData({ abi: marginBankWriteAbi, functionName: "deposit", args: [amountWei] }) };
}

/** The funded test that replaces "holds a claimed voucher": unlocked MarginBank collateral at or above the need. */
export function fundedProblem(who: string, unlockedWei: bigint, needWei: bigint): string | null {
  if (unlockedWei >= needWei) return null;
  return `${who} has ${formatUsdso(unlockedWei)} USDso of unlocked margin in the MarginBank, below the ${formatUsdso(needWei)} USDso this run needs; deposit its own wallet USDso first (deposit.ts, spike:18 for A, spike:19 for B)`;
}

/** The leverage cap that applies: the voucher's cap only for a claimed voucher, else the market maximum (40x on BTC-PERP). */
export function capFromLeverage(
  lev: { voucherLeverageCapX: number; marketMaxLeverageBps: bigint | null; protocolMaxLeverageX: number },
  voucherClaimed: boolean,
): { capX: number; capSource: "voucher" | "market" } {
  const marketX = lev.marketMaxLeverageBps !== null ? Number(lev.marketMaxLeverageBps / 10_000n) : lev.protocolMaxLeverageX;
  if (voucherClaimed) return { capX: Math.min(lev.voucherLeverageCapX, marketX), capSource: "voucher" };
  return { capX: marketX, capSource: "market" };
}

/** The gate's check of a deposit evidence file. */
export function checkDeposit(data: Record<string, unknown> | null, account: DemoAccount): string[] {
  const name = `deposit-${account.toLowerCase()}`;
  if (!data) return [`${name}: evidence file is missing`];
  const p: string[] = [];
  const need = (cond: boolean, msg: string) => {
    if (!cond) p.push(`${name}: ${msg}`);
  };
  need(data.account === account, `account is ${String(data.account)}, expected ${account}`);
  need(data.ok === true, "ok is not true");
  const amount = BigInt(String(data.amountWei ?? "0"));
  const credited = BigInt(String(data.creditedWei ?? "0"));
  need(amount > 0n, "no deposit amount recorded");
  need(credited >= amount, `credited ${credited} is below the deposited ${amount}`);
  const txs = Array.isArray(data.txs) ? (data.txs as Record<string, unknown>[]) : [];
  need(txs.some((t) => t.label === "deposit" && t.status === "success"), "no successful deposit transaction");
  return p;
}
```

- [ ] **Step 4: Run to confirm they pass**
Run: `npm test -w @basanos/spike -- test/funding.test.ts`
Expected: `6 passed`.

- [ ] **Step 5: Write the deposit script**

`packages/spike/src/deposit.ts`:
```ts
// LIVE, human-gated (spike:18 for account A, spike:19 for B): the account's own key approves its own wallet USDso
// to the MarginBank and deposits it into its own MarginBank balance. viem-direct, as in spike:14: signed locally,
// sent to the standard RPC with ORDER_GAS and an explicit pending nonce. It reads unlockedCollateralBalance back and
// writes docs/evidence/deposit-a.json or deposit-b.json. Nothing moves between accounts. It refuses to run while the
// account has an active run, because a deposit during a run voids it.
//   --account A|B --dry-run            reads only and prints the plan
//   --account A|B --amount <USDso>     approves (if the allowance is short) and deposits
//   --account A|B --check              checks the evidence file (the gate; no key)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { erc20Abi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MARGIN_BANK, ORDER_GAS, STT_WRITE_HEADROOM, USDSO, basanosRegistryAbi, marginBankAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requirePrivateKey } from "@basanos/core/node";
import { toJsonSafe } from "./evidence";
import { approveCall, checkDeposit, depositCall, depositProblem, formatUsdso, marginBankConfigAbi, parseDepositArgs, type DepositArgs } from "./funding";
import { ownerTx, txRecord, type TxRecord, type UnsignedCall } from "./live-lib";
import { publicClient, walletFor } from "./rpc";

loadDotEnv();
let args: DepositArgs;
try {
  args = parseDepositArgs(process.argv);
} catch (e) {
  console.error(`deposit: ${(e as Error).message}`);
  process.exit(1);
}
const name = `deposit-${args.account.toLowerCase()}`;
const evidencePath = repoPath(`docs/evidence/${name}.json`);

if (args.check) {
  const data = existsSync(evidencePath) ? (JSON.parse(readFileSync(evidencePath, "utf8")) as Record<string, unknown>) : null;
  const problems = checkDeposit(data, args.account);
  for (const p of problems) console.log(`FAIL ${p}`);
  if (problems.length === 0) console.log(`PASS ${name}`);
  process.exit(problems.length === 0 ? 0 : 1);
}

const pk = requirePrivateKey(args.account === "A" ? "ACCOUNT_A_PK" : "ACCOUNT_B_PK");
const owner: Address = privateKeyToAccount(pk).address;
const client = publicClient();
const wallet = walletFor(pk);
const txs: TxRecord[] = [];

const reads = async () => {
  const [walletWei, allowanceWei, state] = await Promise.all([
    client.readContract({ address: USDSO, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    client.readContract({ address: USDSO, abi: erc20Abi, functionName: "allowance", args: [owner, MARGIN_BANK] }),
    client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [owner] }),
  ]);
  return { walletWei, allowanceWei, unlockedWei: state.unlockedCollateralBalance, lockedWei: state.lockedCollateral, activePools: state.activePerpPools.length };
};

function record(ok: boolean, extra: Record<string, unknown>): void {
  const body = { evidence: name, writtenAt: new Date().toISOString(), account: args.account, owner, token: USDSO, marginBank: MARGIN_BANK, txs, ok, ...extra };
  writeFileSync(evidencePath, `${JSON.stringify(toJsonSafe(body), null, 2)}\n`);
}

function stop(reason: string): never {
  console.error(`deposit ${args.account}: STOP — ${reason}`);
  if (txs.length > 0) record(false, { reason });
  process.exit(1);
}

const cfg = await client.readContract({ address: MARGIN_BANK, abi: marginBankConfigAbi, functionName: "getSystemConfig" });
if (cfg.collateralToken.toLowerCase() !== USDSO.toLowerCase()) stop(`the MarginBank collateral is ${cfg.collateralToken}, not USDso ${USDSO}`);
const before = await reads();
const stt = await client.getBalance({ address: owner });
const depPath = repoPath("deployments/hideki.json");
const registry = existsSync(depPath) ? (JSON.parse(readFileSync(depPath, "utf8")) as { registry: Address }).registry : null;
const activeRun = registry ? await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [owner] }) : 0n;
console.log(
  `deposit ${args.account}: owner ${owner}, wallet ${formatUsdso(before.walletWei)} USDso, allowance ${formatUsdso(before.allowanceWei)}, ` +
    `unlocked margin ${formatUsdso(before.unlockedWei)} USDso, STT ${stt}, active run ${activeRun}`,
);
if (activeRun !== 0n) stop(`account ${args.account} has active run ${activeRun}: a deposit now would void it; deposit only before startRun`);
if (stt < STT_WRITE_HEADROOM) stop(`STT ${stt} is below the 0.6 write headroom; top up from the Tokyo faucet`);
if (args.amountWei !== null) {
  const p = depositProblem(before.walletWei, args.amountWei);
  if (p) stop(p);
}
if (args.dryRun) {
  if (args.amountWei !== null) {
    const steps = before.allowanceWei < args.amountWei ? "approve, then deposit" : "deposit (the allowance already covers it)";
    console.log(`plan: ${steps} ${formatUsdso(args.amountWei)} USDso into account ${args.account}'s own MarginBank balance`);
  }
  console.log("dry-run: no transaction sent");
  process.exit(0);
}
if (args.amountWei === null) stop("--amount <USDso> is required for a live deposit");
const amountWei = args.amountWei;

async function send(label: string, call: UnsignedCall): Promise<void> {
  const nonce = await client.getTransactionCount({ address: owner, blockTag: "pending" });
  const hash = await wallet.sendTransaction(ownerTx(call, nonce, ORDER_GAS));
  const rec = txRecord(label, await client.waitForTransactionReceipt({ hash }));
  txs.push(rec);
  if (rec.status !== "success") stop(`${label} reverted: ${rec.explorer}`);
}

try {
  if (before.allowanceWei < amountWei) await send("approve", approveCall(USDSO, MARGIN_BANK, amountWei));
  await send("deposit", depositCall(MARGIN_BANK, amountWei));
} catch (e) {
  stop(`a send failed: ${(e as Error).message.slice(0, 200)}`);
}
const after = await reads();
const creditedWei = after.unlockedWei - before.unlockedWei;
const ok = creditedWei >= amountWei;
record(ok, { amountWei, before, after, creditedWei });
console.log(
  `deposit ${args.account}: ${ok ? "OK" : "MISMATCH"} — unlocked margin ${formatUsdso(before.unlockedWei)} -> ${formatUsdso(after.unlockedWei)} USDso ` +
    `(+${formatUsdso(creditedWei)}); wallet ${formatUsdso(before.walletWei)} -> ${formatUsdso(after.walletWei)} USDso`,
);
for (const t of txs) console.log(`  ${t.label} ${t.status} ${t.explorer}`);
process.exit(ok ? 0 : 1);
```

- [ ] **Step 6: Type-check (Tasks 18 and 19 run the script)**
Run: `npm run typecheck -w @basanos/spike`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 7: Run the test (the gate)**
Run: `npm test -w @basanos/spike -- test/funding.test.ts`
Expected: PASS — `6 passed`.

- [ ] **Step 8: Commit (kernel-performed — no agent runs this)**
Message: `feat(spike): deposit tool - an account's own USDso into its own MarginBank balance`

---

### Task 18: LIVE — deposit account A's own wallet USDso into its MarginBank balance

**Files:**
- Create: `docs/evidence/deposit-a.json`

**Depends on:** Task 17
**Effort:** low
**Model tier:** top
**Provides:** `docs/evidence/deposit-a.json (account A's own USDso deposited; unlockedCollateralBalance read back; approve and deposit tx hashes)`
**Requires:** `CLI: npx tsx packages/spike/src/deposit.ts --account A|B [--dry-run | --amount <USDso> | --check] (the account's own key deposits its own wallet USDso into its own MarginBank balance; refuses during a run; writes docs/evidence/deposit-a.json / deposit-b.json)`

**Human-gated.** This signs with `ACCOUNT_A_PK` from `.env`. It moves account A's **own** wallet USDso into account A's **own** MarginBank balance; nothing moves to or from account B.
- **Needs:** account A holds its USDso in its wallet (about 50 after the user's one A→B transfer, ledger `62e1287`), ≥ 0.6 STT, and no active run.
- **Order:** run it before any `startRun` on account A, because a MarginBank deposit during a run voids it. The script refuses while a run is active.
- **Amount:** the user picks it. The whole wallet is the default suggestion.

- [ ] **Step 1: Dry-run**
Run: `npx tsx packages/spike/src/deposit.ts --account A --amount <USDso> --dry-run`
Expected: `deposit A: owner 0x…, wallet <n> USDso, allowance 0, unlocked margin 0 USDso, STT …, active run 0`, then `plan: approve, then deposit <USDso> USDso into account A's own MarginBank balance`, then `dry-run: no transaction sent`. A `STOP —` line means a prerequisite is missing: fix it and re-run.

- [ ] **Step 2: Deposit**
Run: `npx tsx packages/spike/src/deposit.ts --account A --amount <USDso>`
Expected: `deposit A: OK — unlocked margin 0 -> <USDso> USDso (+<USDso>); wallet <n> -> <n − USDso> USDso`, then the approve and deposit explorer links.

- [ ] **Step 3: Check the evidence (the gate)**
Run: `npx tsx packages/spike/src/deposit.ts --account A --check`
Expected: PASS — `PASS deposit-a`.

- [ ] **Step 4: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): account A's own USDso deposited into its MarginBank balance`

---

### Task 19: LIVE — deposit account B's own wallet USDso into its MarginBank balance

**Files:**
- Create: `docs/evidence/deposit-b.json`

**Depends on:** Task 17
**Effort:** low
**Model tier:** top
**Provides:** `docs/evidence/deposit-b.json (account B's own USDso deposited; unlockedCollateralBalance read back; approve and deposit tx hashes)`
**Requires:** `CLI: npx tsx packages/spike/src/deposit.ts --account A|B [--dry-run | --amount <USDso> | --check] (the account's own key deposits its own wallet USDso into its own MarginBank balance; refuses during a run; writes docs/evidence/deposit-a.json / deposit-b.json)`

**Human-gated.** This signs with `ACCOUNT_B_PK` from `.env`. It moves account B's **own** wallet USDso into account B's **own** MarginBank balance; nothing moves to or from account A.
- **Needs:** account B holds its USDso in its wallet (about 50 after the user's one A→B transfer, ledger `62e1287`), ≥ 0.6 STT, and no active run.
- **Order:** run it before any `startRun` on account B, because a MarginBank deposit during a run voids it. The script refuses while a run is active.
- **Amount:** the user picks it. The whole wallet is the default suggestion.

- [ ] **Step 1: Dry-run**
Run: `npx tsx packages/spike/src/deposit.ts --account B --amount <USDso> --dry-run`
Expected: `deposit B: owner 0x…, wallet <n> USDso, allowance 0, unlocked margin 0 USDso, STT …, active run 0`, then `plan: approve, then deposit <USDso> USDso into account B's own MarginBank balance`, then `dry-run: no transaction sent`. A `STOP —` line means a prerequisite is missing: fix it and re-run.

- [ ] **Step 2: Deposit**
Run: `npx tsx packages/spike/src/deposit.ts --account B --amount <USDso>`
Expected: `deposit B: OK — unlocked margin 0 -> <USDso> USDso (+<USDso>); wallet <n> -> <n − USDso> USDso`, then the approve and deposit explorer links.

- [ ] **Step 3: Check the evidence (the gate)**
Run: `npx tsx packages/spike/src/deposit.ts --account B --check`
Expected: PASS — `PASS deposit-b`.

- [ ] **Step 4: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): account B's own USDso deposited into its MarginBank balance`

---

### Task 20: The skeleton tests a funded account, not a claimed voucher, and records the leverage cap that applies

**Files:**
- Modify: `packages/spike/src/skeleton-close.ts`

**Depends on:** Task 14, Task 17, Task 2, Task 6, Task 4, Task 3, Task 7, Task 10
**Effort:** low
**Model tier:** top
**Provides:** `CLI: npx tsx packages/spike/src/skeleton-close.ts [--dry-run] [--sdk-send] (funded test: account A needs >= 1 USDso of unlocked MarginBank margin; records the leverage cap that applies)`
**Requires:** `BTC_POOL`, `CANCEL_ORDER_FOR_SELECTOR`, `CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100]`, `MARGIN_BANK`, `marginBankAbi`, `OPERATOR_REGISTRY`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_IOC = 2`, `ORDER_TYPE_LIMIT = 0`, `PLACE_ORDER_FOR_SELECTOR`, `STT_WRITE_HEADROOM = 600_000_000_000_000_000n`, `alignUp(x: bigint, step: bigint): bigint`, `farFutureNs(nowMs?: number): bigint`, `perpPoolAbi`, `planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null`, `planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `writeEvidence(name: EvidenceName, data: Record<string, unknown>): string`, `SKELETON_MIN_UNLOCKED = 1 USDso (1_000_000_000_000_000_000n)`, `capFromLeverage(lev: { voucherLeverageCapX: number; marketMaxLeverageBps: bigint | null; protocolMaxLeverageX: number }, voucherClaimed: boolean): { capX: number; capSource: "voucher" | "market" }`, `formatUsdso(wei: bigint): string`, `fundedProblem(who: string, unlockedWei: bigint, needWei: bigint): string | null`, `grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall`, `isFlat(s: AccountSnapshot): boolean`, `ownerOrderCall(pool: Address, isBid: boolean, price: bigint, quantity: bigint, orderType: number, expireTimestampNs: bigint): UnsignedCall`, `ownerTx(call: UnsignedCall, nonce: number, gas: bigint): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }`, `parseSendPath(argv: readonly string[]): SendPath`, `sumCosts(txs: readonly TxRecord[]): bigint`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `type SendPath = "viem" | "sdk"`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `interface UnsignedCall { to: Address; data: Hex; value: bigint }`, `marketsFor(pk?: Hex): SomniaMarkets`, `publicClient(): PublicClient`, `walletFor(pk: Hex): viem WalletClient bound to CHAIN and the key's account`

Why (guide plan-bugs P1 and P3, 2026-11-12):
- **The gate:** Task 14's `skeleton-close.ts` stops unless account A holds a claimed voucher. No account will ever hold one, because `claim()` reverts chain-wide (B14).
- **The funding:** the accounts are funded with their own wallet USDso, deposited into their own MarginBank balance (Tasks 17–19).
- **The new test:** account A is "funded" when `MarginBank.getAccountState(A).unlockedCollateralBalance` ≥ 1 USDso (`SKELETON_MIN_UNLOCKED`). That is ample for the 0.00013 BTC minimum order: about 9.6 USDso of notional, about 0.24 USDso of margin at 40×.
- **The leverage cap:** the cap that applies is the voucher's 20× only for a claimed voucher, otherwise the market's 40× (`marketMaxLeverageBps` 400000, verified read-only on 2026-11-12). The evidence keeps `voucherLeverageCapX` and adds `capX`, `capSource`, `voucherClaimed` and a `funding` block; spike:13's summary states the cap that applies.
- **Unchanged:** every other line of Task 14's script, including the viem send path.

- [ ] **Step 1: Replace the script**

Replace `packages/spike/src/skeleton-close.ts` with:
```ts
// G1(a)+(e): account A grants the referee place+cancel on BTC-PERP, opens a minimum-size long and rests one
// far bid; the referee cancels the resting order, closes the long with an IOC placeOrderFor (no reduce-only
// flag exists), reads back flat. Follows the spec §8 close protocol: cancel first, fresh position read, IOC,
// read-back, at most 3 attempts with widening slippage, final cancel sweep. --dry-run only reads.
// Every write is signed locally by viem and sent to the standard RPC (rpcHttp()). Account A's grant, open and
// rest carry ORDER_GAS and an explicit pending nonce; --sdk-send routes those three through the SDK's own send
// path instead (fallback only). The evidence records which path ran as `sendPath`.
// Account A must be FUNDED, not voucher-backed (B14/B15, spike:20): at least 1 USDso of unlocked collateral in its
// own MarginBank balance (spike:18 deposits it). The leverage cap that applies is the voucher cap only for a claimed
// voucher, otherwise the market maximum (40x on BTC-PERP); the evidence records both.
import { zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CLOSE_SLIPPAGE_STEPS_BPS,
  MARGIN_BANK,
  marginBankAbi,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_IOC,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  farFutureNs,
  perpPoolAbi,
  planClose,
  planOpen,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { loadDotEnv, requirePrivateKey } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { SKELETON_MIN_UNLOCKED, capFromLeverage, formatUsdso, fundedProblem } from "./funding";
import {
  grantCall,
  isFlat,
  ownerOrderCall,
  ownerTx,
  parseSendPath,
  sumCosts,
  txRecord,
  type SendPath,
  type TxRecord,
  type UnsignedCall,
} from "./live-lib";
import { marketsFor, publicClient, walletFor } from "./rpc";

loadDotEnv();
const dryRun = process.argv.includes("--dry-run");
const sendPath: SendPath = parseSendPath(process.argv);
const ownerPk = requirePrivateKey("ACCOUNT_A_PK");
const refereePk = requirePrivateKey("REFEREE_PK");
const owner: Address = privateKeyToAccount(ownerPk).address;
const referee: Address = privateKeyToAccount(refereePk).address;
const client = publicClient();
const refWallet = walletFor(refereePk);
const ownerWallet = walletFor(ownerPk);
const ownerMarkets = marketsFor(ownerPk);
const txs: TxRecord[] = [];
const notes: string[] = [];

function stop(reason: string, extra: Record<string, unknown> = {}): never {
  console.error(`skeleton-close: STOP — ${reason}`);
  if (!dryRun) writeEvidence("g1a-close", { ok: false, reason, sendPath, owner, referee, pool: BTC_POOL, txs, notes, ...extra });
  process.exit(1);
}

/** One of account A's own writes. viem path: sign `call` with ORDER_GAS and the pending nonce, send it to the
 *  standard RPC and wait for the receipt there. sdk path (--sdk-send): the SDK's own send, kept as a fallback. */
async function ownerWrite(
  label: string,
  call: UnsignedCall,
  viaSdk: () => Promise<{ receipt: Parameters<typeof txRecord>[1] }>,
): Promise<TxRecord> {
  let rec: TxRecord;
  if (sendPath === "sdk") {
    rec = txRecord(label, (await viaSdk()).receipt);
  } else {
    const nonce = await client.getTransactionCount({ address: owner, blockTag: "pending" });
    const hash = await ownerWallet.sendTransaction(ownerTx(call, nonce, ORDER_GAS));
    rec = txRecord(label, await client.waitForTransactionReceipt({ hash }));
  }
  txs.push(rec);
  return rec;
}

async function authorized(selector: Hex): Promise<boolean> {
  return client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
}

async function openOrderIds(): Promise<readonly bigint[]> {
  // The pool answers for msg.sender, so read as the owner via eth_call `from` (never through Multicall3).
  return client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOwnOpenOrders", account: owner });
}

async function refereeCancelAll(label: string): Promise<void> {
  try {
    for (const id of await openOrderIds()) {
      const hash = await refWallet.writeContract({
        address: BTC_POOL,
        abi: perpPoolAbi,
        functionName: "cancelOrderFor",
        args: [owner, id],
        gas: ORDER_GAS,
      });
      txs.push(txRecord(label, await client.waitForTransactionReceipt({ hash })));
    }
  } catch (e) {
    notes.push(`${label} failed: ${(e as Error).message.slice(0, 200)}`);
  }
}

// 1. Preflight (reads only).
const [ownerStt, refereeStt] = await Promise.all([client.getBalance({ address: owner }), client.getBalance({ address: referee })]);
if (ownerStt < STT_WRITE_HEADROOM || refereeStt < STT_WRITE_HEADROOM) {
  stop(`STT below the 0.6 write headroom (owner ${ownerStt}, referee ${refereeStt}); top up from the Tokyo faucet`);
}
const voucher = await ownerMarkets.client.getPerpVoucher(MARGIN_BANK, owner);
const voucherClaimed = voucher?.claimed === true;
const ownerState = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [owner] });
const unfunded = fundedProblem("account A", ownerState.unlockedCollateralBalance, SKELETON_MIN_UNLOCKED);
if (unfunded) stop(unfunded);
const leverage = await ownerMarkets.client.getPerpLeverage({ marginBank: MARGIN_BANK, account: owner, pool: BTC_POOL });
const cap = capFromLeverage(leverage, voucherClaimed);
const params = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
const book: BookParams = { tickSize: params.tickSize, minQuantity: params.minQuantity, lotSize: params.lotSize };
const markets = await ownerMarkets.client.listPerpMarkets();
const btcRow = markets.find((m) => m.baseSymbol === "BTC");
if (!btcRow || btcRow.poolAddress.toLowerCase() !== BTC_POOL.toLowerCase()) stop("the live BTC-PERP pool differs from BTC_POOL in config");
const start = await readSnapshot(client, [owner], BTC_POOL);
const startAccount = start.accounts[0];
if (!startAccount || !isFlat(startAccount)) stop("account A is not flat; flatten it in the dreamDEX app first");
if (!start.markOk) stop("BTC-PERP has no fresh mark price");
const openQty = alignUp(book.minQuantity, book.lotSize);
console.log(
  `preflight ok: owner ${owner}, referee ${referee}, unlocked margin ${formatUsdso(ownerState.unlockedCollateralBalance)} USDso, ` +
    `leverage cap ${cap.capX}x (${cap.capSource}), voucher ${voucherClaimed ? "claimed" : "none"}, ` +
    `mark ${start.markPrice}, open qty ${openQty}, send path ${sendPath}`,
);
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}

// 2. Owner grants the referee place + cancel on the BTC pool only (a per-pool grant on the operator registry).
const selectors: Hex[] = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR];
if (!(await authorized(PLACE_ORDER_FOR_SELECTOR)) || !(await authorized(CANCEL_ORDER_FOR_SELECTOR))) {
  try {
    await ownerWrite("grant", grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, selectors), () =>
      ownerMarkets.trader.setOperatorApprovalForPool({
        pool: BTC_POOL,
        operator: referee,
        selectors,
        approved: true,
        operatorRegistry: OPERATOR_REGISTRY,
      }),
    );
  } catch (e) {
    stop(`the grant send failed before any order existed: ${(e as Error).message.slice(0, 200)}`);
  }
}
if (!(await authorized(PLACE_ORDER_FOR_SELECTOR)) || !(await authorized(CANCEL_ORDER_FOR_SELECTOR))) stop("the grant did not take effect");

// 3. Owner opens the minimum long (IOC) and rests one far bid (GTC) for the referee to cancel.
const preOpen = await readSnapshot(client, [owner], BTC_POOL);
const open = planOpen(true, openQty, preOpen.markPrice, book, 20);
try {
  const opened = await ownerWrite(
    "open",
    ownerOrderCall(BTC_POOL, true, open.price, open.quantity, ORDER_TYPE_IOC, farFutureNs()),
    () => ownerMarkets.trader.placePerpOrder({ pool: BTC_POOL, isBid: true, price: open.price, quantity: open.quantity, orderType: ORDER_TYPE_IOC }),
  );
  if (opened.status === "reverted") stop("the opening IOC reverted, so no position was opened");
} catch (e) {
  stop(`the opening IOC failed before any position existed: ${(e as Error).message.slice(0, 200)}`);
}
// Real entry fill vs mark (the demo's +0.5% target is only trusted once this cost is known; spec §5).
const openedPos = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getPosition", args: [owner, BTC_POOL] });
const entry = {
  side: "long",
  quantity: open.quantity,
  limitPrice: open.price,
  markBefore: preOpen.markPrice,
  markBlock: preOpen.blockNumber,
  avgEntryPrice: openedPos.avgEntryPrice,
  costBps: Number(((openedPos.avgEntryPrice - preOpen.markPrice) * 1_000_000n) / preOpen.markPrice) / 100,
};
console.log(`entry: avg ${entry.avgEntryPrice} vs mark ${entry.markBefore} = ${entry.costBps} bps`);
const restPrice = (start.markPrice * 9_000n) / 10_000n - ((start.markPrice * 9_000n) / 10_000n) % book.tickSize;
try {
  await ownerWrite(
    "rest",
    ownerOrderCall(BTC_POOL, true, restPrice, openQty, ORDER_TYPE_LIMIT, farFutureNs()),
    () => ownerMarkets.trader.placePerpOrder({ pool: BTC_POOL, isBid: true, price: restPrice, quantity: openQty, orderType: ORDER_TYPE_LIMIT }),
  );
} catch (e) {
  // A rejected resting order (e.g. outside the pool's price band) must not strand the open long: note it and close.
  notes.push(`resting order rejected: ${(e as Error).message.slice(0, 200)}; continuing to the referee close`);
}

// 4. Referee: cancel first, fresh read, IOC close, read back; at most 3 attempts.
await refereeCancelAll("cancel");
let attempts = 0;
for (const slippage of CLOSE_SLIPPAGE_STEPS_BPS) {
  const snap = await readSnapshot(client, [owner], BTC_POOL);
  const acct = snap.accounts[0];
  if (!acct || acct.size === 0n) break;
  const plan = planClose(acct.size, snap.markPrice, book, slippage);
  if (!plan) {
    notes.push(`residual ${acct.size} is below one lot`);
    break;
  }
  attempts += 1;
  try {
    const hash = await refWallet.writeContract({
      address: BTC_POOL,
      abi: perpPoolAbi,
      functionName: "placeOrderFor",
      args: [owner, plan.isBid, 0n, plan.price, plan.quantity, farFutureNs(), ORDER_TYPE_IOC, 0, zeroAddress, 0n],
      gas: ORDER_GAS,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    txs.push(txRecord("close", receipt));
    if (receipt.status === "reverted") notes.push(`close attempt ${attempts} at ${slippage} bps reverted (replay with eth_call at the parent block)`);
  } catch (e) {
    notes.push(`close attempt ${attempts} at ${slippage} bps failed to send: ${(e as Error).message.slice(0, 200)}`);
  }
}
await refereeCancelAll("sweep");

// 5. Read back and record.
const end = await readSnapshot(client, [owner], BTC_POOL);
const endAccount = end.accounts[0];
const flat = endAccount ? isFlat(endAccount) : false;
writeEvidence("g1a-close", {
  ok: flat && txs.some((t) => t.label === "close" && t.status === "success"),
  sdkVersion: "0.33.0",
  sendPath,
  owner,
  referee,
  pool: BTC_POOL,
  operatorRegistry: OPERATOR_REGISTRY,
  leverage: {
    voucherLeverageCapX: leverage.voucherLeverageCapX,
    accountMaxLeverageX: leverage.accountMaxLeverageX,
    protocolMaxLeverageX: leverage.protocolMaxLeverageX,
    marketMaxLeverageBps: leverage.marketMaxLeverageBps,
    creditFloor: leverage.creditFloor,
    voucherClaimed,
    // The cap that applies: the voucher cap only for a claimed voucher, else the market maximum (40x on BTC-PERP).
    capX: cap.capX,
    capSource: cap.capSource,
  },
  funding: { unlockedWei: ownerState.unlockedCollateralBalance, needWei: SKELETON_MIN_UNLOCKED, source: voucherClaimed ? "voucher" : "deposit" },
  book,
  entry,
  startSnapshot: start,
  endSnapshot: end,
  closeAttempts: attempts,
  finalPositionSize: endAccount?.size ?? -1n,
  finalLocked: endAccount?.lockedCollateral ?? -1n,
  txs,
  costs: { totalWei: sumCosts(txs), perTx: txs.map((t) => ({ label: t.label, gasUsed: t.gasUsed, costWei: t.costWei })) },
  notes,
});
console.log(`skeleton-close: ${flat ? "FLAT" : "NOT FLAT"} after ${attempts} close attempt(s); ${txs.length} txs (owner writes via ${sendPath})`);
for (const t of txs) console.log(`  ${t.label} ${t.status} ${t.explorer}`);
process.exit(flat ? 0 : 1);
```

- [ ] **Step 2: Type-check (Task 11 runs the script live)**
Run: `npm run typecheck -w @basanos/spike`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 3: Run the package tests (the gate)**
Run: `npm test -w @basanos/spike`
Expected: PASS — `31 passed`.

- [ ] **Step 4: Commit (kernel-performed — no agent runs this)**
Message: `fix(spike): the skeleton tests a funded account and records the leverage cap that applies`
