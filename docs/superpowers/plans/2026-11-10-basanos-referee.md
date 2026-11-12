# Basanos Referee and Bot Implementation Plan

**Goal:** Build the referee: it watches every enrolled account on each price write, closes the account on a breach with real perps orders, and records FAIL, VOID or (after locking the gain) PASS in the registry. Also build the scripted bot and demo runner that take the same rulebook, the demo-cost check, and run one live rehearsal that produces the first real verdicts.
**Architecture:** `@basanos/core` gains a pure evaluator (spec §5), a MarginBank log classifier and the tape simulator. `@basanos/referee` has three parts:
- a pure `Engine` that turns snapshots and account logs into actions;
- a close protocol behind an injectable I/O interface (R4);
- a daemon that wires two kinds of `somnia_watch` subscription to them, with pause-on-gap and re-evaluation at head (R3).

`@basanos/bot` signs with its own key and never with an operator grant. No build task here depends on a human gate; only task 10, the live rehearsal, does.
**Tech Stack:** Node 22, TypeScript 6.0.3 (strict, ESM, bundler resolution, tsx 4.23.15), vitest 4.1.12, `@somnia-chain/markets-sdk` 0.33.0 (exact), viem 2.57.12 (exact).
**Source spec:** docs/superpowers/specs/2026-11-10-basanos-design.md

**Boot notes for the orchestrator:**
- Append-only to push 1: every `spike:*` / `contracts:*` task referenced here keeps its id, files and gate.
- Task 1 adds a wildcard subpath export to `@basanos/core` (`"./*": "./src/*.ts"`). New core modules are imported as `@basanos/core/<module>`, so no task here edits `packages/core/src/index.ts`.
- **No task claims a voucher**, because `claim()` reverts chain-wide (B14). Each challenge account is funded with its own wallet USDso, deposited into its own MarginBank balance (spike:18 for A, spike:19 for B). The verdict path never calls `getMarginEvents`, `listPerpMarginPulls` or `listPerpMainFundingEvents` (R1).
- Task 10 is human-gated: it signs with `REFEREE_PK`, `ACCOUNT_A_PK` and `ACCOUNT_B_PK`, and it produces the first real verdict runs (`docs/evidence/rehearsal.json`) that the landing plan builds against.
- The repo path contains a space (tollgate S3). Every command here is run from the repo root.
- **Tasks 16 and 17 (P6, 2026-11-12)** run before Task 10. The bot's grant, `startRun` and opens leave the SDK's send path for viem-direct sends that are read back from the chain and never re-sent. A take that fails after a run started aborts into `docs/evidence/demo-aborted.json`. Task 16 moves the account-write builders from the spike's `live-lib.ts` into `@basanos/core/owner-tx`; `live-lib.ts` re-exports them.
- **Tasks 18 to 22 (P7, 2026-11-12)** follow Task 10's two FAILs.
  - Task 18: demo v2 and 10×, chosen by a replay of 12 hours of history (Task 19's tool).
  - Task 20: closes capped from the book and sent in one round trip from the push; a PASS lock buffer.
  - Task 21: a same-block pair, and the FAIL on demand after the first PASS.
  - Task 22: the live take that must produce the first PASS and certificate before ship:3.
  - Order: Task 18 first, then 20; Tasks 19 and 21 may run in parallel after it; then Task 22.

---

### Task 1: Core evaluator and MarginBank log classifier

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/src/evaluate.ts`
- Create: `packages/core/src/classify.ts`
- Test: `packages/core/test/evaluate.test.ts`
- Test: `packages/core/test/classify.test.ts`

**Depends on:** spike:Task 1, spike:Task 3, spike:Task 4
**Effort:** high
**Provides:** `@basanos/core subpath exports "./*" -> "./src/*.ts" (import "@basanos/core/evaluate", "@basanos/core/classify", "@basanos/core/demo-math")`, `type FailRule = "DailyLoss" | "TrailingDrawdown" | "MaxExposure" | "TimeLimit" | "Liquidated"`, `type Verdict = { kind: "ok" } | { kind: "pause"; reason: "unpriceable" } | { kind: "void"; reason: "ForeignMarket" } | { kind: "fail"; rule: FailRule } | { kind: "target" }`, `interface RunState { startTime: bigint; startEquity: bigint; hwm: bigint; dayStart: bigint; day: bigint }`, `interface MarketView { timestamp: bigint; markOk: boolean; markPrice: bigint }`, `interface Evaluation { state: RunState; verdict: Verdict; exposureX: number | null }`, `initRunState(startTime: bigint, startEquity: bigint): RunState`, `notional(size: bigint, mark: bigint, baseDecimals: number): bigint`, `evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation`, `type LogClass = "trading" | "liquidation" | "flow"`, `TRADING_EVENT_SIGNATURES`, `LIQUIDATION_EVENT_SIGNATURES`, `classifyMarginBankLog(topic0: Hex | undefined): LogClass`
**Requires:** `@basanos/core package with exports "." -> src/index.ts and "./node" -> src/node.ts`, `interface Rulebook`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`

`nowSec` is the snapshot block's timestamp, never the wall clock (spec §5), so the referee and the registry check time against the same clock.

- [ ] **Step 1: Add the subpath export (add one line, change nothing else)**

In `packages/core/package.json`, inside `"exports"`, replace
```json
    "./node": "./src/node.ts"
```
with
```json
    "./node": "./src/node.ts",
    "./*": "./src/*.ts"
```
Leave every other line as it is, including the `@somnia-chain/markets-sdk` version (the spike's timebox may have moved it to 0.32.1).

- [ ] **Step 2: Write the failing tests**

`packages/core/test/evaluate.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { evaluate, initRunState, notional, type MarketView, type RunState } from "../src/evaluate";
import type { AccountSnapshot } from "../src/snapshot";
import { loadRulebook } from "../src/node";

const E18 = 10n ** 18n;
const POOL: Address = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const OTHER: Address = "0x00000000000000000000000000000000000000aa";
const T0 = 1_794_268_800n; // 2026-11-10 00:00:00 UTC
// Thresholds pinned to the registered Tokyo Sprint · Demo values, so a raised demo target (referee Task 10 Step 1) never turns this test red.
const rb = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };

function acct(total: bigint, size = 0n, over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    account: "0x00000000000000000000000000000000000000a1",
    equityOk: true,
    equity: total,
    lockedCollateral: 0n,
    totalEquity: total,
    activePools: size === 0n ? [] : [POOL],
    size,
    ...over,
  };
}
const at = (dt: bigint, markOk = true): MarketView => ({ timestamp: T0 + dt, markOk, markPrice: 74_500n * E18 });
const fresh = (): RunState => initRunState(T0, 1_000n * E18);

describe("evaluate (Tokyo Sprint · Demo: +0.5% / -0.5% daily / -0.75% trailing / 15x / 60 s / 900 s)", () => {
  it("pauses on an unpriceable account or mark", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18, 0n, { equityOk: false }), at(1n)).verdict).toEqual({ kind: "pause", reason: "unpriceable" });
    expect(evaluate(rb, fresh(), acct(1_000n * E18), at(1n, false)).verdict).toEqual({ kind: "pause", reason: "unpriceable" });
  });
  it("voids on a position in another market", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18, 0n, { activePools: [OTHER] }), at(1n)).verdict).toEqual({
      kind: "void",
      reason: "ForeignMarket",
    });
  });
  it("is ok at the start", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18), at(1n)).verdict).toEqual({ kind: "ok" });
  });
  it("reaches the target only after the minimum time", () => {
    expect(evaluate(rb, fresh(), acct(1_005n * E18), at(59n)).verdict).toEqual({ kind: "ok" });
    expect(evaluate(rb, fresh(), acct(1_005n * E18), at(60n)).verdict).toEqual({ kind: "target" });
  });
  it("fails the daily-loss floor", () => {
    expect(evaluate(rb, fresh(), acct(995n * E18), at(5n)).verdict).toEqual({ kind: "fail", rule: "DailyLoss" });
  });
  it("fails the trailing drawdown from the high-water mark", () => {
    const up = evaluate(rb, fresh(), acct(1_004n * E18), at(5n));
    expect(up.state.hwm).toBe(1_004n * E18);
    expect(evaluate(rb, up.state, acct(9_964n * 10n ** 17n), at(6n)).verdict).toEqual({ kind: "fail", rule: "TrailingDrawdown" });
  });
  it("fails the exposure cap and reports exposure", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18, 20_200_000n), at(5n)).verdict).toEqual({ kind: "fail", rule: "MaxExposure" });
    expect(evaluate(rb, fresh(), acct(1_000n * E18, 16_107_000n), at(5n)).exposureX).toBe(11.99);
  });
  it("fails the time limit on the chain clock", () => {
    expect(evaluate(rb, fresh(), acct(1_000n * E18), at(900n)).verdict).toEqual({ kind: "ok" });
    expect(evaluate(rb, fresh(), acct(1_000n * E18), at(901n)).verdict).toEqual({ kind: "fail", rule: "TimeLimit" });
  });
  it("resets the daily start equity on a new UTC day", () => {
    const loose = { ...rb, trailingDrawdownBps: 5_000, timeLimitSec: 200_000 };
    const nextDay = evaluate(loose, fresh(), acct(990n * E18), at(86_400n + 10n));
    expect(nextDay.verdict).toEqual({ kind: "ok" });
    expect(nextDay.state.dayStart).toBe(990n * E18);
    expect(evaluate(loose, nextDay.state, acct(985n * E18), at(86_400n + 20n)).verdict).toEqual({ kind: "fail", rule: "DailyLoss" });
  });
  it("computes notional from signed size", () => {
    expect(notional(-16_107_000n, 74_500n * E18, 8)).toBe((16_107_000n * 74_500n * E18) / 100_000_000n);
  });
});
```

`packages/core/test/classify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { toEventSelector } from "viem";
import { marginBankEventsAbi } from "@somnia-chain/markets-sdk";
import { LIQUIDATION_EVENT_SIGNATURES, TRADING_EVENT_SIGNATURES, classifyMarginBankLog } from "../src/classify";

function topicOf(name: string) {
  const ev = marginBankEventsAbi.find((e) => e.type === "event" && e.name === name);
  if (!ev) throw new Error(`the SDK ABI has no ${name}`);
  return toEventSelector(ev);
}

describe("classifyMarginBankLog", () => {
  it("matches the SDK's own MarginBank ABI for trading and liquidation events", () => {
    for (const sig of TRADING_EVENT_SIGNATURES) expect(classifyMarginBankLog(topicOf(sig.slice(0, sig.indexOf("("))))).toBe("trading");
    for (const sig of LIQUIDATION_EVENT_SIGNATURES) {
      expect(classifyMarginBankLog(topicOf(sig.slice(0, sig.indexOf("("))))).toBe("liquidation");
    }
  });
  it("treats deposits, withdrawals, transfers and unknown topics as money flows", () => {
    for (const name of ["Deposited", "DepositedFor", "Withdrawn", "PositionTransferred", "MainFundedChild", "IsolatedModeSet", "MaxLeverageSet"]) {
      expect(classifyMarginBankLog(topicOf(name))).toBe("flow");
    }
    expect(classifyMarginBankLog(`0x${"ab".repeat(32)}`)).toBe("flow");
    expect(classifyMarginBankLog(undefined)).toBe("flow");
  });
});
```

- [ ] **Step 3: Run to confirm they fail**
Run: `npm test -w @basanos/core -- test/evaluate.test.ts test/classify.test.ts`
Expected: FAIL — `Failed to resolve import "../src/evaluate"`.

- [ ] **Step 4: Write the implementation**

`packages/core/src/evaluate.ts`:
```ts
import type { Rulebook } from "./rulebook";
import type { AccountSnapshot } from "./snapshot";

export type FailRule = "DailyLoss" | "TrailingDrawdown" | "MaxExposure" | "TimeLimit" | "Liquidated";

export type Verdict =
  | { kind: "ok" }
  | { kind: "pause"; reason: "unpriceable" }
  | { kind: "void"; reason: "ForeignMarket" }
  | { kind: "fail"; rule: FailRule }
  | { kind: "target" };

export interface RunState {
  startTime: bigint;
  startEquity: bigint;
  hwm: bigint;
  dayStart: bigint;
  day: bigint;
}

export interface MarketView {
  timestamp: bigint;
  markOk: boolean;
  markPrice: bigint;
}

export interface Evaluation {
  state: RunState;
  verdict: Verdict;
  exposureX: number | null;
}

const DAY = 86_400n;

export function initRunState(startTime: bigint, startEquity: bigint): RunState {
  return { startTime, startEquity, hwm: startEquity, dayStart: startEquity, day: startTime / DAY };
}

export function notional(size: bigint, mark: bigint, baseDecimals: number): bigint {
  const abs = size < 0n ? -size : size;
  return (abs * mark) / 10n ** BigInt(baseDecimals);
}

/** Spec §5, in order: pause, void, state update, time limit, daily loss, trailing drawdown, exposure, target. */
export function evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation {
  if (!acct.equityOk || !market.markOk) return { state, verdict: { kind: "pause", reason: "unpriceable" }, exposureX: null };
  const pool = rb.market.pool.toLowerCase();
  if (acct.activePools.some((p) => p.toLowerCase() !== pool)) {
    return { state, verdict: { kind: "void", reason: "ForeignMarket" }, exposureX: null };
  }
  const total = acct.totalEquity;
  const day = market.timestamp / DAY;
  const next: RunState = {
    ...state,
    hwm: total > state.hwm ? total : state.hwm,
    ...(day !== state.day ? { day, dayStart: total } : {}),
  };
  const n = notional(acct.size, market.markPrice, rb.market.baseDecimals);
  const exposureX = total > 0n ? Number((n * 100n) / total) / 100 : null;
  let verdict: Verdict = { kind: "ok" };
  if (market.timestamp > state.startTime + BigInt(rb.timeLimitSec)) {
    verdict = { kind: "fail", rule: "TimeLimit" };
  } else if (total * 10_000n <= next.dayStart * BigInt(10_000 - rb.dailyLossBps)) {
    verdict = { kind: "fail", rule: "DailyLoss" };
  } else if (total * 10_000n <= next.hwm * BigInt(10_000 - rb.trailingDrawdownBps)) {
    verdict = { kind: "fail", rule: "TrailingDrawdown" };
  } else if (n > total * BigInt(rb.maxExposureX)) {
    verdict = { kind: "fail", rule: "MaxExposure" };
  } else if (
    total * 10_000n >= state.startEquity * BigInt(10_000 + rb.profitTargetBps) &&
    market.timestamp >= state.startTime + BigInt(rb.minDurationSec)
  ) {
    verdict = { kind: "target" };
  }
  return { state: next, verdict, exposureX };
}
```

`packages/core/src/classify.ts`:
```ts
import { toEventSelector, type Hex } from "viem";

/** Signatures from @somnia-chain/markets-sdk 0.33.0 marginBankEventsAbi (spec §5). */
export const TRADING_EVENT_SIGNATURES = [
  "PositionUpdated(address,address,int128,uint128,int256,int256)",
  "FundingSettled(address,address,int256)",
  "CollateralLocked(address,address,uint256)",
  "CollateralUnlocked(address,address,uint256)",
  "FeeCharged(address,address,uint256,uint256)",
  "RebatePaid(address,address,uint256)",
  "BuilderFeeCharged(address,address,address,uint256)",
] as const;

export const LIQUIDATION_EVENT_SIGNATURES = [
  "AutoDeleveraged(address,address,address,int128,uint256)",
  "CloseOutMarginSettled(address,address,uint256)",
  "BadDebtAbsorbed(address,uint256,uint256,address)",
  "LiquidationOrderPanicked(address,address,uint256)",
] as const;

const TRADING = new Set<string>(TRADING_EVENT_SIGNATURES.map((s) => toEventSelector(s)));
const LIQUIDATION = new Set<string>(LIQUIDATION_EVENT_SIGNATURES.map((s) => toEventSelector(s)));

export type LogClass = "trading" | "liquidation" | "flow";

/** Anything that is not trading or liquidation — deposits, withdrawals, voucher credits, unknown topics — is a money flow. */
export function classifyMarginBankLog(topic0: Hex | undefined): LogClass {
  if (!topic0) return "flow";
  const t = topic0.toLowerCase();
  if (TRADING.has(t)) return "trading";
  if (LIQUIDATION.has(t)) return "liquidation";
  return "flow";
}
```

- [ ] **Step 5: Run to confirm they pass (the gate)**
Run: `npm test -w @basanos/core -- test/evaluate.test.ts test/classify.test.ts`
Expected: PASS — `12 passed`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): rulebook evaluator and MarginBank log classifier`

---

### Task 2: Tape simulator and the G4 movement proof

**Files:**
- Create: `packages/core/src/demo-math.ts`
- Test: `packages/core/test/demo-math.test.ts`
- Test: `packages/core/test/tape-proof.test.ts`

**Depends on:** Task 1, spike:Task 3, spike:Task 4, spike:Task 6, spike:Task 9
**Effort:** medium
**Provides:** `interface TapePoint { block: bigint; ts: bigint; mark: bigint }`, `parseTape(raw: unknown): TapePoint[]`, `interface SimOptions { leverageX: number; startEquity: bigint; lotSize: bigint; entryCostBps: number; exitCostBps: number }`, `interface SimSide { side: "long" | "short"; outcome: "target" | "fail" | "unresolved"; rule: FailRule | null; atTs: bigint | null }`, `simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint }`, `costBpsVsMark(isBid: boolean, reference: bigint, average: bigint): number`, `roundTripEquityBps(oneWayCostBps: number, leverageX: number): number`, `recommendDemoTargetBps(roundTripEqBps: number): number`
**Requires:** `@basanos/core subpath exports "./*" -> "./src/*.ts" (import "@basanos/core/evaluate", "@basanos/core/classify", "@basanos/core/demo-math")`, `evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation`, `initRunState(startTime: bigint, startEquity: bigint): RunState`, `type FailRule = "DailyLoss" | "TrailingDrawdown" | "MaxExposure" | "TimeLimit" | "Liquidated"`, `interface Rulebook`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `packages/core/test/fixtures/btc-tape.json (live BTC mark tape: { pool, points: [{ block, ts, mark }] })`

G4: the tape proof uses zero trading cost. It proves the market moved enough during the recorded 9 minutes (540 s) to resolve the demo rulebook at 12×. The cost check uses the measured entry fill (`g1a-close.json`) and a live book quote. That check runs in task 10 before the demo target is trusted. If the tape proof fails, the recorded market was too still for the demo thresholds: stop and route a design question to the architect. Never edit the fixture.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/demo-math.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { costBpsVsMark, parseTape, recommendDemoTargetBps, roundTripEquityBps, simulateTape } from "../src/demo-math";
import { loadRulebook } from "../src/node";

const E18 = 10n ** 18n;
// Thresholds pinned to the registered Tokyo Sprint · Demo values, so a raised demo target (referee Task 10 Step 1) never turns this test red.
const rb = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
const T0 = 1_794_326_400n;
const opts = { leverageX: 12, startEquity: 1_000n * E18, lotSize: 1_000n, entryCostBps: 0, exitCostBps: 0 };

function ramp(fromMark: number, toMark: number, seconds: number) {
  return Array.from({ length: seconds + 1 }, (_, i) => ({
    block: BigInt(i + 1),
    ts: T0 + BigInt(i),
    mark: BigInt(Math.round((fromMark + ((toMark - fromMark) * i) / seconds) * 10)) * (E18 / 10n),
  }));
}

describe("simulateTape", () => {
  it("passes the long and fails the short on a 0.1% rise over 2 minutes", () => {
    const r = simulateTape(rb, ramp(74_500, 74_574.5, 120), opts);
    expect(r.quantity).toBe(16_107_000n);
    expect(r.long.outcome).toBe("target");
    expect(r.short.outcome).toBe("fail");
    expect(r.short.rule).toBe("DailyLoss");
  });
  it("leaves both unresolved on a flat tape", () => {
    const r = simulateTape(rb, ramp(74_500, 74_500, 120), opts);
    expect(r.long.outcome).toBe("unresolved");
    expect(r.short.outcome).toBe("unresolved");
  });
  it("lets costs block a pass the market alone would give", () => {
    const r = simulateTape(rb, ramp(74_500, 74_540, 120), { ...opts, entryCostBps: 3, exitCostBps: 3 });
    expect(r.long.outcome).not.toBe("target");
  });
});

describe("cost helpers", () => {
  it("measures fill cost against the mark for both sides", () => {
    expect(costBpsVsMark(true, 74_500n * E18, 74_507_450n * 10n ** 15n)).toBe(1);
    expect(costBpsVsMark(false, 74_500n * E18, 74_492_550n * 10n ** 15n)).toBe(1);
  });
  it("converts a one-way notional cost into equity terms and recommends a target", () => {
    expect(roundTripEquityBps(2, 12)).toBe(48);
    expect(recommendDemoTargetBps(48)).toBe(100);
    expect(recommendDemoTargetBps(10)).toBe(50);
  });
  it("parses a JSON tape with string fields and millisecond timestamps", () => {
    expect(parseTape({ points: [{ block: "7", ts: "1794326400000", mark: "5" }] })).toEqual([{ block: 7n, ts: 1_794_326_400n, mark: 5n }]);
  });
});
```

`packages/core/test/tape-proof.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseTape, simulateTape } from "../src/demo-math";
import { loadRulebook, repoPath } from "../src/node";

describe("G4: the recorded live BTC tape resolves Tokyo Sprint · Demo at 12x (market movement alone)", () => {
  it("resolves at least one of the two opposite accounts", () => {
    const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
    expect(tape.length).toBeGreaterThan(100);
    // Thresholds pinned to the registered Tokyo Sprint · Demo values, so a raised demo target (referee Task 10 Step 1) never turns this test red.
    const r = simulateTape({ ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 }, tape, {
      leverageX: 12,
      startEquity: 1_000n * 10n ** 18n,
      lotSize: 1_000n,
      entryCostBps: 0,
      exitCostBps: 0,
    });
    const resolved = [r.long.outcome, r.short.outcome].filter((o) => o !== "unresolved");
    expect(resolved.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**
Run: `npm test -w @basanos/core -- test/demo-math.test.ts test/tape-proof.test.ts`
Expected: FAIL — `Failed to resolve import "../src/demo-math"`.

- [ ] **Step 3: Write the implementation**

`packages/core/src/demo-math.ts`:
```ts
import type { Address } from "viem";
import { quantityForLeverage } from "./close";
import { evaluate, initRunState, type FailRule } from "./evaluate";
import type { Rulebook } from "./rulebook";
import type { AccountSnapshot } from "./snapshot";

export interface TapePoint {
  block: bigint;
  ts: bigint;
  mark: bigint;
}

/** Tape JSON (bigints as strings); millisecond timestamps are converted to seconds. */
export function parseTape(raw: unknown): TapePoint[] {
  const points = ((raw as { points?: unknown[] }).points ?? []) as { block: string; ts: string; mark: string }[];
  return points.map((p) => {
    const ts = BigInt(p.ts);
    return { block: BigInt(p.block), ts: ts > 10_000_000_000n ? ts / 1000n : ts, mark: BigInt(p.mark) };
  });
}

export interface SimOptions {
  leverageX: number;
  startEquity: bigint;
  lotSize: bigint;
  entryCostBps: number;
  exitCostBps: number;
}

export interface SimSide {
  side: "long" | "short";
  outcome: "target" | "fail" | "unresolved";
  rule: FailRule | null;
  atTs: bigint | null;
}

const ACCOUNT: Address = "0x000000000000000000000000000000000000dEaD";

function simulateSide(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions, qty: bigint, sign: 1n | -1n): SimSide {
  const side = sign === 1n ? "long" : "short";
  const first = tape[0];
  if (!first) return { side, outcome: "unresolved", rule: null, atTs: null };
  const oneBase = 10n ** BigInt(rb.market.baseDecimals);
  const entryNotional = (qty * first.mark) / oneBase;
  const entryCost = (entryNotional * BigInt(Math.round(o.entryCostBps * 100))) / 1_000_000n;
  let state = initRunState(first.ts, o.startEquity);
  for (const p of tape) {
    const pnl = (sign * qty * (p.mark - first.mark)) / oneBase;
    const total = o.startEquity - entryCost + pnl;
    const acct: AccountSnapshot = {
      account: ACCOUNT,
      equityOk: true,
      equity: total,
      lockedCollateral: 0n,
      totalEquity: total,
      activePools: [rb.market.pool],
      size: sign * qty,
    };
    const ev = evaluate(rb, state, acct, { timestamp: p.ts, markOk: true, markPrice: p.mark });
    state = ev.state;
    if (ev.verdict.kind === "fail") return { side, outcome: "fail", rule: ev.verdict.rule, atTs: p.ts };
    if (ev.verdict.kind === "target") {
      const exitCost = (((qty * p.mark) / oneBase) * BigInt(Math.round(o.exitCostBps * 100))) / 1_000_000n;
      const lockedEquity = total - exitCost;
      if (lockedEquity * 10_000n >= o.startEquity * BigInt(10_000 + rb.profitTargetBps)) {
        return { side, outcome: "target", rule: null, atTs: p.ts };
      }
    }
  }
  return { side, outcome: "unresolved", rule: null, atTs: null };
}

/** Two opposite accounts opened at the first tape point, judged by the real evaluator; a pass counts only once the lock's close cost still clears the target. */
export function simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint } {
  const first = tape[0];
  const quantity = first
    ? quantityForLeverage(o.startEquity, o.leverageX, first.mark, rb.market.baseDecimals, { tickSize: 1n, minQuantity: 0n, lotSize: o.lotSize })
    : 0n;
  return { long: simulateSide(rb, tape, o, quantity, 1n), short: simulateSide(rb, tape, o, quantity, -1n), quantity };
}

/** Fill cost against the mark, in bps of notional (positive = worse than the mark). */
export function costBpsVsMark(isBid: boolean, reference: bigint, average: bigint): number {
  const diff = isBid ? average - reference : reference - average;
  return Number((diff * 1_000_000n) / reference) / 100;
}

/** A round trip (entry + lock close) costs 2 x one-way notional bps x leverage in equity bps. */
export function roundTripEquityBps(oneWayCostBps: number, leverageX: number): number {
  return 2 * oneWayCostBps * leverageX;
}

/** Spec §5: the round trip may use at most half the demo target; never below the registered 50 bps. */
export function recommendDemoTargetBps(roundTripEqBps: number): number {
  return Math.max(50, Math.ceil((2 * roundTripEqBps) / 25) * 25);
}
```

- [ ] **Step 4: Run to confirm they pass (the gate)**
Run: `npm test -w @basanos/core -- test/demo-math.test.ts test/tape-proof.test.ts`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): tape simulator and G4 movement proof on the live BTC tape`

---

### Task 3: Referee package — tx records, run discovery, evidence store

**Files:**
- Create: `packages/referee/package.json`
- Create: `packages/referee/tsconfig.json`
- Create: `packages/referee/vitest.config.ts`
- Create: `packages/referee/src/index.ts`
- Create: `packages/referee/src/tx.ts`
- Create: `packages/referee/src/runs.ts`
- Create: `packages/referee/src/evidence.ts`
- Test: `packages/referee/test/runs.test.ts`
- Test: `packages/referee/test/evidence.test.ts`

**Depends on:** spike:Task 1, spike:Task 2, spike:Task 3, contracts:Task 8
**Effort:** medium
**Provides:** `@basanos/referee package (exports "." -> src/index.ts)`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `interface TrackedRun { runId: bigint; account: Address; rulebookId: Hex; rulebook: Rulebook; startTime: bigint; startEquity: bigint; startBlock: bigint }`, `rulebookIndex(rbs: readonly Rulebook[]): Map<string, Rulebook>`, `readActiveRuns(client: PublicClient, registry: Address, index: Map<string, Rulebook>): Promise<TrackedRun[]>`, `RUNS_EVIDENCE = "docs/evidence/runs.json"`, `jsonSafe(value: unknown): unknown`, `evidenceHash(bundle: unknown): Hex`, `readRunsEvidence(path?: string): Record<string, { bundle: unknown; evidenceHash: Hex; verdictTx?: unknown }>`, `writeRunEvidence(runId: bigint, bundle: Record<string, unknown>, path?: string): Hex`, `attachVerdictTx(runId: bigint, tx: TxRecord, path?: string): void`
**Requires:** `@basanos/core package with exports "." -> src/index.ts and "./node" -> src/node.ts`, `repoPath(rel: string): string`, `explorerTx(hash: Hex): string`, `interface Rulebook`, `rulebookId(rb: Rulebook): Hex`, `canonicalJson(value: unknown): string`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `basanosRegistryAbi (as const, generated from the forge artifact)`

The evidence store keeps every run under one fixed file, `docs/evidence/runs.json`, keyed by run id. The verdict tasks can therefore declare a fixed path even though run ids are unknown in advance. A third party verifies a FAIL as follows: `keccak256(canonicalJson(runs[runId].bundle))` must equal the run's on-chain `evidenceHash`.

- [ ] **Step 1: Write the package files**

`packages/referee/package.json`:
```json
{
  "name": "@basanos/referee",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
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

`packages/referee/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/referee/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 2: Write the failing tests**

`packages/referee/test/runs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { PublicClient } from "viem";
import { rulebookId } from "@basanos/core";
import { loadRulebook } from "@basanos/core/node";
import { readActiveRuns, rulebookIndex } from "../src/runs";

const demo = loadRulebook("tokyo-sprint-demo");
const standard = loadRulebook("tokyo-sprint");
const REG = "0x00000000000000000000000000000000000000f0";

describe("rulebookIndex", () => {
  it("maps lowercase on-chain ids to local rulebooks", () => {
    const idx = rulebookIndex([demo, standard]);
    expect(idx.get(rulebookId(demo).toLowerCase())?.variant).toBe("demo");
    expect(idx.size).toBe(2);
  });
});

describe("readActiveRuns", () => {
  it("reads active runs and skips rulebooks this referee does not judge", async () => {
    const fake = {
      readContract: async (p: { functionName: string; args?: readonly unknown[] }) => {
        if (p.functionName === "getActiveRunIds") return [1n, 2n];
        const id = (p.args ?? [])[0];
        return {
          account: "0x00000000000000000000000000000000000000a1",
          rulebookId: id === 1n ? rulebookId(demo) : `0x${"99".repeat(32)}`,
          startTime: 1_794_326_400n,
          start: { blockNumber: 46_725_618n, equityOk: true, equity: 1_000n * 10n ** 18n, lockedCollateral: 0n, positionSize: 0n, markOk: true, markPrice: 1n },
        };
      },
    } as unknown as PublicClient;
    const runs = await readActiveRuns(fake, REG, rulebookIndex([demo]));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runId).toBe(1n);
    expect(runs[0]?.rulebook.variant).toBe("demo");
    expect(runs[0]?.startEquity).toBe(1_000n * 10n ** 18n);
    expect(runs[0]?.startBlock).toBe(46_725_618n);
  });
});
```

`packages/referee/test/evidence.test.ts`:
```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { keccak256, toBytes } from "viem";
import { canonicalJson } from "@basanos/core";
import { attachVerdictTx, evidenceHash, readRunsEvidence, writeRunEvidence } from "../src/evidence";

describe("evidence store", () => {
  it("hashes the canonical JSON of the bundle, independent of key order", () => {
    expect(evidenceHash({ b: 1n, a: "x" })).toBe(evidenceHash({ a: "x", b: 1n }));
    expect(evidenceHash({ a: 1n })).toBe(keccak256(toBytes('{"a":"1"}')));
  });
  it("writes runs under one file, and a reader recomputes the same hash from the file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "basanos ev ")), "runs.json");
    const hash = writeRunEvidence(7n, { runId: 7n, verdict: "FAILED", breach: { equity: 994n } }, path);
    writeRunEvidence(8n, { runId: 8n, verdict: "VOID" }, path);
    const all = readRunsEvidence(path);
    expect(Object.keys(all)).toEqual(["7", "8"]);
    expect(keccak256(toBytes(canonicalJson(all["7"]?.bundle)))).toBe(hash);
    attachVerdictTx(
      7n,
      { label: "recordFail", hash: "0xab", status: "success", gasUsed: 1n, costWei: 2n, explorer: "https://x/tx/0xab" },
      path,
    );
    const again = JSON.parse(readFileSync(path, "utf8")) as Record<string, { evidenceHash: string; verdictTx: { hash: string } }>;
    expect(again["7"]?.evidenceHash).toBe(hash);
    expect(again["7"]?.verdictTx.hash).toBe("0xab");
  });
});
```

- [ ] **Step 3: Run to confirm they fail**
Run: `npm install`
Expected: exits 0 (links the new workspace).
Run: `npm test -w @basanos/referee`
Expected: FAIL — `Failed to resolve import "../src/runs"`.

- [ ] **Step 4: Write the implementation**

`packages/referee/src/tx.ts`:
```ts
import type { Hex } from "viem";
import { explorerTx } from "@basanos/core";

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
```

`packages/referee/src/runs.ts`:
```ts
import type { Address, Hex, PublicClient } from "viem";
import { basanosRegistryAbi, rulebookId, type Rulebook } from "@basanos/core";

export interface TrackedRun {
  runId: bigint;
  account: Address;
  rulebookId: Hex;
  rulebook: Rulebook;
  startTime: bigint;
  startEquity: bigint;
  startBlock: bigint;
}

export function rulebookIndex(rbs: readonly Rulebook[]): Map<string, Rulebook> {
  return new Map(rbs.map((rb) => [rulebookId(rb).toLowerCase(), rb]));
}

/** Active runs from the registry; a run under a rulebook this referee does not hold locally is skipped. */
export async function readActiveRuns(client: PublicClient, registry: Address, index: Map<string, Rulebook>): Promise<TrackedRun[]> {
  const ids = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getActiveRunIds" });
  const out: TrackedRun[] = [];
  for (const runId of ids) {
    const run = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
    const rulebook = index.get(run.rulebookId.toLowerCase());
    if (!rulebook) continue;
    out.push({
      runId,
      account: run.account,
      rulebookId: run.rulebookId,
      rulebook,
      startTime: run.startTime,
      startEquity: run.start.equity + run.start.lockedCollateral,
      startBlock: run.start.blockNumber,
    });
  }
  return out;
}
```

`packages/referee/src/evidence.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { keccak256, toBytes, type Hex } from "viem";
import { canonicalJson } from "@basanos/core";
import { repoPath } from "@basanos/core/node";
import type { TxRecord } from "./tx";

export const RUNS_EVIDENCE = "docs/evidence/runs.json";

export function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => jsonSafe(v));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, jsonSafe(v)]));
  }
  return value;
}

export function evidenceHash(bundle: unknown): Hex {
  return keccak256(toBytes(canonicalJson(jsonSafe(bundle))));
}

type Store = Record<string, { bundle: unknown; evidenceHash: Hex; verdictTx?: unknown }>;

export function readRunsEvidence(path: string = repoPath(RUNS_EVIDENCE)): Store {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as Store;
}

function save(store: Store, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
}

/** Stores the run's bundle and returns its evidence hash (the value recordFail / recordVoid put on-chain). */
export function writeRunEvidence(runId: bigint, bundle: Record<string, unknown>, path: string = repoPath(RUNS_EVIDENCE)): Hex {
  const store = readRunsEvidence(path);
  const hash = evidenceHash(bundle);
  store[runId.toString()] = { bundle: jsonSafe(bundle), evidenceHash: hash };
  save(store, path);
  return hash;
}

/** Records the verdict transaction beside the bundle; it is outside the hashed bundle, so the hash never changes. */
export function attachVerdictTx(runId: bigint, tx: TxRecord, path: string = repoPath(RUNS_EVIDENCE)): void {
  const store = readRunsEvidence(path);
  const entry = store[runId.toString()];
  if (!entry) return;
  entry.verdictTx = jsonSafe(tx);
  save(store, path);
}
```

`packages/referee/src/index.ts`:
```ts
export * from "./tx";
export * from "./runs";
export * from "./evidence";
```

- [ ] **Step 5: Run to confirm they pass (the gate)**
Run: `npm test -w @basanos/referee`
Expected: PASS — `4 passed`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(referee): tx records, registry run discovery and evidence store`

---

### Task 4: The decision engine (snapshots and account logs to actions)

**Files:**
- Create: `packages/referee/src/engine.ts`
- Modify: `packages/referee/src/index.ts`
- Test: `packages/referee/test/engine.test.ts`

**Depends on:** Task 1, Task 3, spike:Task 3, spike:Task 4
**Effort:** high
**Provides:** `interface BreachRead { blockNumber: bigint; equityOk: boolean; equity: bigint; lockedCollateral: bigint; positionSize: bigint; markOk: boolean; markPrice: bigint }`, `type Action = { kind: "fail"; runId: bigint; account: Address; rule: FailRule; breach: BreachRead } | { kind: "lock"; runId: bigint; account: Address } | { kind: "void"; runId: bigint; account: Address; reason: "Flow" | "ForeignMarket"; txHash: Hex | null }`, `type RunPhase = "watching" | "acting" | "done"`, `interface EngineRun { run: TrackedRun; state: RunState; phase: RunPhase; exposureX: number | null; lastTotal: bigint | null }`, `breachRead(snap: Snapshot, acct: AccountSnapshot): BreachRead`, `class Engine { paused; track(run): boolean; get(runId): EngineRun | undefined; watchedAccounts(): Address[]; retain(activeRunIds: readonly bigint[]): bigint[]; pause(); resume(); finish(runId); release(runId); onSnapshot(snap): Action[]; onAccountLog(account, topic0, txHash, snap): Action[] }`
**Requires:** `classifyMarginBankLog(topic0: Hex | undefined): LogClass`, `evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation`, `initRunState(startTime: bigint, startEquity: bigint): RunState`, `type FailRule = "DailyLoss" | "TrailingDrawdown" | "MaxExposure" | "TimeLimit" | "Liquidated"`, `interface RunState { startTime: bigint; startEquity: bigint; hwm: bigint; dayStart: bigint; day: bigint }`, `interface TrackedRun { runId: bigint; account: Address; rulebookId: Hex; rulebook: Rulebook; startTime: bigint; startEquity: bigint; startBlock: bigint }`, `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`, `interface Snapshot { blockNumber: bigint; timestamp: bigint; pool: Address; markOk: boolean; markPrice: bigint; accounts: AccountSnapshot[] }`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`

Rules (spec §5, §8, R3):
- A run issues at most one action until it is released (a lock that did not clear) or finished.
- While paused (a watch gap), price snapshots produce no action.
- A money-flow or liquidation log is a fact, so it is acted on even while paused.
- A VOID never closes the account; only FAIL and a PASS lock do.

- [ ] **Step 1: Write the failing test**

`packages/referee/test/engine.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { toEventSelector, type Address, type Hex } from "viem";
import type { AccountSnapshot, Snapshot } from "@basanos/core";
import { rulebookId } from "@basanos/core";
import { loadRulebook } from "@basanos/core/node";
import { Engine } from "../src/engine";
import type { TrackedRun } from "../src/runs";

const E18 = 10n ** 18n;
const POOL: Address = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const A: Address = "0x00000000000000000000000000000000000000a1";
const T0 = 1_794_326_400n;
// Thresholds pinned to the registered Tokyo Sprint · Demo values, so a raised demo target (referee Task 10 Step 1) never turns this test red.
const demo = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
const run: TrackedRun = { runId: 1n, account: A, rulebookId: rulebookId(demo), rulebook: demo, startTime: T0, startEquity: 1_000n * E18, startBlock: 100n };

function snap(total: bigint, dt: bigint, size = 0n, over: Partial<AccountSnapshot> = {}): Snapshot {
  return {
    blockNumber: 100n + dt,
    timestamp: T0 + dt,
    pool: POOL,
    markOk: true,
    markPrice: 74_500n * E18,
    accounts: [
      { account: A, equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: size === 0n ? [] : [POOL], size, ...over },
    ],
  };
}
const POSITION_UPDATED: Hex = toEventSelector("PositionUpdated(address,address,int128,uint128,int256,int256)");
const DEPOSITED: Hex = toEventSelector("Deposited(address,uint256)");
const CLOSE_OUT: Hex = toEventSelector("CloseOutMarginSettled(address,address,uint256)");

describe("Engine", () => {
  it("issues one lock at the target and waits until released", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onSnapshot(snap(1_005n * E18, 61n))).toEqual([{ kind: "lock", runId: 1n, account: A }]);
    expect(e.get(1n)?.phase).toBe("acting");
    expect(e.onSnapshot(snap(1_006n * E18, 62n))).toEqual([]);
    e.release(1n);
    expect(e.onSnapshot(snap(1_006n * E18, 63n))).toHaveLength(1);
  });

  it("issues a fail with the breach reads", () => {
    const e = new Engine();
    e.track(run);
    const [action] = e.onSnapshot(snap(994n * E18, 30n, -16_107_000n));
    expect(action).toMatchObject({ kind: "fail", runId: 1n, rule: "DailyLoss" });
    if (action?.kind !== "fail") throw new Error("expected a fail");
    expect(action.breach).toEqual({
      blockNumber: 130n,
      equityOk: true,
      equity: 994n * E18,
      lockedCollateral: 0n,
      positionSize: -16_107_000n,
      markOk: true,
      markPrice: 74_500n * E18,
    });
  });

  it("stays silent while paused and judges again after resume", () => {
    const e = new Engine();
    e.track(run);
    e.pause();
    expect(e.paused).toBe(true);
    expect(e.onSnapshot(snap(990n * E18, 10n))).toEqual([]);
    e.resume();
    expect(e.onSnapshot(snap(990n * E18, 11n))).toHaveLength(1);
  });

  it("voids on a money flow even while paused, and never on a trading log", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onAccountLog(A, POSITION_UPDATED, null, snap(1_000n * E18, 5n))).toEqual([]);
    e.pause();
    expect(e.onAccountLog(A, DEPOSITED, "0xdead", null)).toEqual([{ kind: "void", runId: 1n, account: A, reason: "Flow", txHash: "0xdead" }]);
  });

  it("fails on a liquidation log", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onAccountLog(A, CLOSE_OUT, null, snap(700n * E18, 5n))[0]).toMatchObject({ kind: "fail", rule: "Liquidated" });
  });

  it("voids a foreign-market position and drops finished or vanished runs", () => {
    const e = new Engine();
    e.track(run);
    e.track({ ...run, runId: 2n, account: "0x00000000000000000000000000000000000000b2" });
    expect(e.onSnapshot(snap(1_000n * E18, 5n, 0n, { activePools: ["0x00000000000000000000000000000000000000aa"] }))).toEqual([
      { kind: "void", runId: 1n, account: A, reason: "ForeignMarket", txHash: null },
    ]);
    e.finish(1n);
    expect(e.watchedAccounts()).toEqual(["0x00000000000000000000000000000000000000b2"]);
    expect(e.retain([2n])).toEqual([2n]);
    expect(e.retain([])).toEqual([]);
    expect(e.watchedAccounts()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/referee -- test/engine.test.ts`
Expected: FAIL — `Failed to resolve import "../src/engine"`.

- [ ] **Step 3: Write the implementation**

`packages/referee/src/engine.ts`:
```ts
import type { Address, Hex } from "viem";
import type { AccountSnapshot, Snapshot } from "@basanos/core";
import { classifyMarginBankLog } from "@basanos/core/classify";
import { evaluate, initRunState, type FailRule, type RunState } from "@basanos/core/evaluate";
import type { TrackedRun } from "./runs";

export interface BreachRead {
  blockNumber: bigint;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  positionSize: bigint;
  markOk: boolean;
  markPrice: bigint;
}

export type Action =
  | { kind: "fail"; runId: bigint; account: Address; rule: FailRule; breach: BreachRead }
  | { kind: "lock"; runId: bigint; account: Address }
  | { kind: "void"; runId: bigint; account: Address; reason: "Flow" | "ForeignMarket"; txHash: Hex | null };

export type RunPhase = "watching" | "acting" | "done";

export interface EngineRun {
  run: TrackedRun;
  state: RunState;
  phase: RunPhase;
  exposureX: number | null;
  lastTotal: bigint | null;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export function breachRead(snap: Snapshot, acct: AccountSnapshot): BreachRead {
  return {
    blockNumber: snap.blockNumber,
    equityOk: acct.equityOk,
    equity: acct.equity,
    lockedCollateral: acct.lockedCollateral,
    positionSize: acct.size,
    markOk: snap.markOk,
    markPrice: snap.markPrice,
  };
}

export class Engine {
  private readonly runs = new Map<string, EngineRun>();
  private pausedFlag = false;

  get paused(): boolean {
    return this.pausedFlag;
  }

  track(run: TrackedRun): boolean {
    const key = run.runId.toString();
    if (this.runs.has(key)) return false;
    this.runs.set(key, { run, state: initRunState(run.startTime, run.startEquity), phase: "watching", exposureX: null, lastTotal: null });
    return true;
  }

  get(runId: bigint): EngineRun | undefined {
    return this.runs.get(runId.toString());
  }

  watchedAccounts(): Address[] {
    const out: Address[] = [];
    for (const r of this.runs.values()) {
      if (r.phase !== "done" && !out.some((a) => same(a, r.run.account))) out.push(r.run.account);
    }
    return out;
  }

  /** Finishes tracked runs that are no longer active on-chain (e.g. voidRevoked by anyone); returns the ids still live. */
  retain(activeRunIds: readonly bigint[]): bigint[] {
    const live = new Set(activeRunIds.map((id) => id.toString()));
    for (const [key, r] of this.runs) if (!live.has(key) && r.phase === "watching") r.phase = "done";
    return [...this.runs.values()].filter((r) => r.phase !== "done").map((r) => r.run.runId);
  }

  pause(): void {
    this.pausedFlag = true;
  }

  resume(): void {
    this.pausedFlag = false;
  }

  finish(runId: bigint): void {
    const r = this.get(runId);
    if (r) r.phase = "done";
  }

  release(runId: bigint): void {
    const r = this.get(runId);
    if (r && r.phase === "acting") r.phase = "watching";
  }

  onSnapshot(snap: Snapshot): Action[] {
    if (this.pausedFlag) return [];
    const actions: Action[] = [];
    for (const r of this.runs.values()) {
      if (r.phase !== "watching") continue;
      const acct = snap.accounts.find((a) => same(a.account, r.run.account));
      if (!acct) continue;
      const ev = evaluate(r.run.rulebook, r.state, acct, { timestamp: snap.timestamp, markOk: snap.markOk, markPrice: snap.markPrice });
      r.state = ev.state;
      r.exposureX = ev.exposureX;
      if (acct.equityOk) r.lastTotal = acct.totalEquity;
      const v = ev.verdict;
      if (v.kind === "fail") {
        r.phase = "acting";
        actions.push({ kind: "fail", runId: r.run.runId, account: r.run.account, rule: v.rule, breach: breachRead(snap, acct) });
      } else if (v.kind === "void") {
        r.phase = "acting";
        actions.push({ kind: "void", runId: r.run.runId, account: r.run.account, reason: "ForeignMarket", txHash: null });
      } else if (v.kind === "target") {
        r.phase = "acting";
        actions.push({ kind: "lock", runId: r.run.runId, account: r.run.account });
      }
    }
    return actions;
  }

  onAccountLog(account: Address, topic0: Hex | undefined, txHash: Hex | null, snap: Snapshot | null): Action[] {
    const r = [...this.runs.values()].find((x) => x.phase === "watching" && same(x.run.account, account));
    if (!r) return [];
    const cls = classifyMarginBankLog(topic0);
    if (cls === "flow") {
      r.phase = "acting";
      return [{ kind: "void", runId: r.run.runId, account: r.run.account, reason: "Flow", txHash }];
    }
    if (cls === "liquidation") {
      r.phase = "acting";
      const acct = snap?.accounts.find((a) => same(a.account, account));
      const breach: BreachRead =
        snap && acct
          ? breachRead(snap, acct)
          : { blockNumber: snap?.blockNumber ?? 0n, equityOk: false, equity: 0n, lockedCollateral: 0n, positionSize: 0n, markOk: false, markPrice: 0n };
      return [{ kind: "fail", runId: r.run.runId, account: r.run.account, rule: "Liquidated", breach }];
    }
    return snap ? this.onSnapshot(snap) : [];
  }
}
```

Replace `packages/referee/src/index.ts` with:
```ts
export * from "./tx";
export * from "./runs";
export * from "./evidence";
export * from "./engine";
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/referee -- test/engine.test.ts`
Expected: PASS — `6 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(referee): decision engine for snapshots and account logs`

---

### Task 5: Close protocol (R4) and the PASS-lock prediction

**Files:**
- Create: `packages/referee/src/close.ts`
- Create: `packages/referee/src/lock.ts`
- Modify: `packages/referee/src/index.ts`
- Test: `packages/referee/test/close.test.ts`
- Test: `packages/referee/test/lock.test.ts`

**Depends on:** Task 3, Task 4, spike:Task 6
**Effort:** high
**Model tier:** top
**Provides:** `interface CloseIO { openOrderIds(account: Address): Promise<readonly bigint[]>; cancel(account: Address, orderId: bigint): Promise<TxRecord>; position(account: Address): Promise<{ size: bigint; mark: bigint }>; book(): Promise<BookParams>; placeClose(account: Address, plan: OrderPlan): Promise<TxRecord> }`, `interface CloseResult { flat: boolean; finalSize: bigint; attempts: number; txs: TxRecord[]; notes: string[] }`, `flatten(io: CloseIO, account: Address): Promise<CloseResult>`, `type CloseQuoteLike = { priceable: false } | { priceable: true; isBid: boolean; quantity: bigint; referencePrice: bigint; averagePrice: bigint | null; fillableSize: bigint }`, `predictClosedEquity(totalEquity: bigint, quote: CloseQuoteLike, baseDecimals: number): bigint | null`, `clearsTarget(predicted: bigint | null, startEquity: bigint, targetBps: number): boolean`
**Requires:** `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `interface OrderPlan { isBid: boolean; quantity: bigint; price: bigint }`, `CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100]`, `planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null`

Security-sensitive: this code sends orders on someone else's account through the operator grant. The protocol is spec §8 / R4:
1. Cancel resting orders first.
2. Read the position fresh.
3. Send an opposite-side IOC sized to that read.
4. Read the position back.
5. Retry at most 3 times with widening slippage; a flipped position is closed the same way.
6. Do a final cancel sweep.

Every transaction is recorded.

- [ ] **Step 1: Write the failing tests**

`packages/referee/test/close.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Address, Hex } from "viem";
import type { OrderPlan } from "@basanos/core";
import { flatten, type CloseIO } from "../src/close";
import type { TxRecord } from "../src/tx";

const A: Address = "0x00000000000000000000000000000000000000a1";
const E18 = 10n ** 18n;
const rec = (label: string, status: "success" | "reverted" = "success"): TxRecord => ({
  label,
  hash: `0x${label.length.toString(16).padStart(64, "0")}` as Hex,
  status,
  gasUsed: 1n,
  costWei: 1n,
  explorer: "https://x",
});

function fakeIO(start: { size: bigint; orders: bigint[] }, onClose: (size: bigint, plan: OrderPlan) => bigint, revert = false) {
  let size = start.size;
  let orders = [...start.orders];
  const calls: string[] = [];
  const io: CloseIO = {
    openOrderIds: async () => orders,
    cancel: async (_a, id) => {
      calls.push(`cancel:${id}`);
      orders = orders.filter((o) => o !== id);
      return rec("cancel");
    },
    position: async () => ({ size, mark: 74_500n * E18 }),
    book: async () => ({ tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n }),
    placeClose: async (_a, plan) => {
      calls.push(`close:${plan.isBid ? "buy" : "sell"}:${plan.quantity}`);
      if (revert) return rec("close", "reverted");
      size = onClose(size, plan);
      return rec("close");
    },
  };
  return { io, calls };
}

describe("flatten", () => {
  it("cancels first, closes the fresh position, reads back flat", async () => {
    const { io, calls } = fakeIO({ size: 13_000n, orders: [5n, 6n] }, () => 0n);
    const r = await flatten(io, A);
    expect(calls).toEqual(["cancel:5", "cancel:6", "close:sell:13000"]);
    expect(r).toMatchObject({ flat: true, finalSize: 0n, attempts: 1 });
  });

  it("closes a flipped remainder after a concurrent fill", async () => {
    let first = true;
    const { io, calls } = fakeIO({ size: 13_000n, orders: [] }, (size, plan) => {
      if (first) {
        first = false;
        return -2_000n;
      }
      return size + (plan.isBid ? plan.quantity : -plan.quantity);
    });
    const r = await flatten(io, A);
    expect(calls).toEqual(["close:sell:13000", "close:buy:2000"]);
    expect(r.flat).toBe(true);
    expect(r.attempts).toBe(2);
  });

  it("stops after three reverted attempts and reports the residual", async () => {
    const { io } = fakeIO({ size: 13_000n, orders: [] }, (s) => s, true);
    const r = await flatten(io, A);
    expect(r.attempts).toBe(3);
    expect(r.flat).toBe(false);
    expect(r.finalSize).toBe(13_000n);
    expect(r.notes).toHaveLength(3);
  });

  it("notes a residual below one lot", async () => {
    const { io } = fakeIO({ size: 500n, orders: [] }, (s) => s);
    const r = await flatten(io, A);
    expect(r.attempts).toBe(0);
    expect(r.notes[0]).toMatch(/below one lot/);
  });
});
```

`packages/referee/test/lock.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { clearsTarget, predictClosedEquity } from "../src/lock";

const E18 = 10n ** 18n;
const quote = (isBid: boolean, avg: bigint | null, fill = 16_107_000n) => ({
  priceable: true as const,
  isBid,
  quantity: 16_107_000n,
  referencePrice: 74_500n * E18,
  averagePrice: avg,
  fillableSize: fill,
});

describe("predictClosedEquity", () => {
  it("charges the close's distance from the mark", () => {
    expect(predictClosedEquity(1_006n * E18, quote(false, 74_496n * E18), 8)).toBe(1_006n * E18 - (4n * E18 * 16_107_000n) / 100_000_000n);
    expect(predictClosedEquity(1_006n * E18, quote(true, 74_504n * E18), 8)).toBe(1_006n * E18 - (4n * E18 * 16_107_000n) / 100_000_000n);
  });
  it("refuses an unpriceable or unfillable close", () => {
    expect(predictClosedEquity(1_006n * E18, { priceable: false }, 8)).toBeNull();
    expect(predictClosedEquity(1_006n * E18, quote(false, null), 8)).toBeNull();
    expect(predictClosedEquity(1_006n * E18, quote(false, 74_496n * E18, 1_000n), 8)).toBeNull();
  });
});

describe("clearsTarget", () => {
  it("compares the predicted closed equity with the target", () => {
    expect(clearsTarget(1_005n * E18, 1_000n * E18, 50)).toBe(true);
    expect(clearsTarget(1_004n * E18, 1_000n * E18, 50)).toBe(false);
    expect(clearsTarget(null, 1_000n * E18, 50)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**
Run: `npm test -w @basanos/referee -- test/close.test.ts test/lock.test.ts`
Expected: FAIL — `Failed to resolve import "../src/close"`.

- [ ] **Step 3: Write the implementation**

`packages/referee/src/close.ts`:
```ts
import type { Address } from "viem";
import { CLOSE_SLIPPAGE_STEPS_BPS, planClose, type BookParams, type OrderPlan } from "@basanos/core";
import type { TxRecord } from "./tx";

export interface CloseIO {
  openOrderIds(account: Address): Promise<readonly bigint[]>;
  cancel(account: Address, orderId: bigint): Promise<TxRecord>;
  position(account: Address): Promise<{ size: bigint; mark: bigint }>;
  book(): Promise<BookParams>;
  placeClose(account: Address, plan: OrderPlan): Promise<TxRecord>;
}

export interface CloseResult {
  flat: boolean;
  finalSize: bigint;
  attempts: number;
  txs: TxRecord[];
  notes: string[];
}

/** Spec §8 close protocol (R4). */
export async function flatten(io: CloseIO, account: Address): Promise<CloseResult> {
  const txs: TxRecord[] = [];
  const notes: string[] = [];
  const sweep = async (label: string): Promise<void> => {
    for (const id of await io.openOrderIds(account)) txs.push({ ...(await io.cancel(account, id)), label });
  };
  await sweep("cancel");
  const book = await io.book();
  let attempts = 0;
  for (const slippage of CLOSE_SLIPPAGE_STEPS_BPS) {
    const pos = await io.position(account);
    if (pos.size === 0n) break;
    const plan = planClose(pos.size, pos.mark, book, slippage);
    if (!plan) {
      notes.push(`residual ${pos.size} is below one lot`);
      break;
    }
    attempts += 1;
    const r = await io.placeClose(account, plan);
    txs.push({ ...r, label: "close" });
    if (r.status === "reverted") notes.push(`close attempt ${attempts} at ${slippage} bps reverted`);
  }
  await sweep("sweep");
  const final = await io.position(account);
  return { flat: final.size === 0n, finalSize: final.size, attempts, txs, notes };
}
```

`packages/referee/src/lock.ts`:
```ts
/** The subset of the SDK's PerpCloseQuote the lock needs (client.quotePerpClose, SDK 0.33.0). */
export type CloseQuoteLike =
  | { priceable: false }
  | { priceable: true; isBid: boolean; quantity: bigint; referencePrice: bigint; averagePrice: bigint | null; fillableSize: bigint };

/** Equity after closing at the quoted average instead of the mark; null if the close cannot be priced or fully filled. */
export function predictClosedEquity(totalEquity: bigint, quote: CloseQuoteLike, baseDecimals: number): bigint | null {
  if (!quote.priceable) return null;
  if (quote.quantity === 0n) return totalEquity;
  if (quote.averagePrice === null || quote.fillableSize < quote.quantity) return null;
  const diff = quote.isBid ? quote.averagePrice - quote.referencePrice : quote.referencePrice - quote.averagePrice;
  return totalEquity - (diff * quote.quantity) / 10n ** BigInt(baseDecimals);
}

export function clearsTarget(predicted: bigint | null, startEquity: bigint, targetBps: number): boolean {
  return predicted !== null && predicted * 10_000n >= startEquity * BigInt(10_000 + targetBps);
}
```

Replace `packages/referee/src/index.ts` with:
```ts
export * from "./tx";
export * from "./runs";
export * from "./evidence";
export * from "./engine";
export * from "./close";
export * from "./lock";
```

- [ ] **Step 4: Run to confirm they pass (the gate)**
Run: `npm test -w @basanos/referee -- test/close.test.ts test/lock.test.ts`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(referee): bounded close protocol and PASS-lock prediction`

---

### Task 6: Registry writer and chain I/O

**Files:**
- Create: `packages/referee/src/writer.ts`
- Create: `packages/referee/src/chain.ts`
- Modify: `packages/referee/src/index.ts`
- Test: `packages/referee/test/writer.test.ts`

**Depends on:** Task 1, Task 3, Task 4, Task 5, spike:Task 2, spike:Task 4, spike:Task 6, contracts:Task 8
**Effort:** high
**Model tier:** top
**Provides:** `ZERO_HASH: Hex`, `ruleIndex(rule: FailRule): number`, `voidIndex(reason: "Flow" | "ForeignMarket"): number`, `failArgs(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[])`, `voidArgs(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex)`, `interface RegistryWriter { recordFail(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]): Promise<TxRecord>; recordPass(runId: bigint): Promise<TxRecord>; recordVoid(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex): Promise<TxRecord> }`, `makePublicClient(url: string): PublicClient`, `makeRefereeWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`, `type RefereeWallet = ReturnType<typeof makeRefereeWallet>`, `makeRegistryWriter(wallet: RefereeWallet, client: PublicClient, registry: Address, oracleValue: bigint): RegistryWriter`, `chainCloseIO(client: PublicClient, wallet: RefereeWallet, pool: Address): CloseIO`
**Requires:** `type FailRule = "DailyLoss" | "TrailingDrawdown" | "MaxExposure" | "TimeLimit" | "Liquidated"`, `interface BreachRead { blockNumber: bigint; equityOk: boolean; equity: bigint; lockedCollateral: bigint; positionSize: bigint; markOk: boolean; markPrice: bigint }`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `interface CloseIO { openOrderIds(account: Address): Promise<readonly bigint[]>; cancel(account: Address, orderId: bigint): Promise<TxRecord>; position(account: Address): Promise<{ size: bigint; mark: bigint }>; book(): Promise<BookParams>; placeClose(account: Address, plan: OrderPlan): Promise<TxRecord> }`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`, `CHAIN (hidekiTestnet, id 50383)`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_IOC = 2`, `farFutureNs(nowMs?: number): bigint`, `perpPoolAbi`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`

Security-sensitive: this sends the referee's operator writes (`cancelOrderFor`, `placeOrderFor`) and verdict writes. It reads the key only through `makeRefereeWallet(pk, …)`, whose caller gets `pk` from `requirePrivateKey("REFEREE_PK")`. The key is never logged.

- [ ] **Step 1: Write the failing test**

`packages/referee/test/writer.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ZERO_HASH, failArgs, ruleIndex, voidArgs, voidIndex } from "../src/writer";

const breach = {
  blockNumber: 130n,
  equityOk: true,
  equity: 994n * 10n ** 18n,
  lockedCollateral: 0n,
  positionSize: -16_107_000n,
  markOk: true,
  markPrice: 74_500n * 10n ** 18n,
};

describe("registry argument mapping", () => {
  it("maps rules and void reasons to the contract enums", () => {
    expect(ruleIndex("DailyLoss")).toBe(1);
    expect(ruleIndex("TrailingDrawdown")).toBe(2);
    expect(ruleIndex("MaxExposure")).toBe(3);
    expect(ruleIndex("TimeLimit")).toBe(4);
    expect(ruleIndex("Liquidated")).toBe(5);
    expect(voidIndex("Flow")).toBe(1);
    expect(voidIndex("ForeignMarket")).toBe(2);
  });
  it("builds recordFail and recordVoid arguments in contract order", () => {
    expect(failArgs(9n, "DailyLoss", breach, "0xaa", ["0x01", "0x02"])).toEqual([9n, 1, breach, "0xaa", ["0x01", "0x02"]]);
    expect(voidArgs(9n, "Flow", null, "0xbb")).toEqual([9n, 1, ZERO_HASH, "0xbb"]);
    expect(ZERO_HASH).toBe(`0x${"0".repeat(64)}`);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/referee -- test/writer.test.ts`
Expected: FAIL — `Failed to resolve import "../src/writer"`.

- [ ] **Step 3: Write the implementation**

`packages/referee/src/chain.ts`:
```ts
import { createPublicClient, createWalletClient, http, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, ORDER_GAS, ORDER_TYPE_IOC, farFutureNs, perpPoolAbi, readSnapshot } from "@basanos/core";
import type { CloseIO } from "./close";
import { txRecord } from "./tx";

export function makePublicClient(url: string): PublicClient {
  return createPublicClient({ chain: CHAIN, transport: http(url) }) as unknown as PublicClient;
}

/** Inferred return type: bound to CHAIN and the referee's account. */
export function makeRefereeWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type RefereeWallet = ReturnType<typeof makeRefereeWallet>;

export function chainCloseIO(client: PublicClient, wallet: RefereeWallet, pool: Address): CloseIO {
  return {
    // The pool answers getOwnOpenOrders for msg.sender: read as the owner via eth_call `from`, never through Multicall3.
    openOrderIds: (account) => client.readContract({ address: pool, abi: perpPoolAbi, functionName: "getOwnOpenOrders", account }),
    cancel: async (account, orderId) => {
      const hash = await wallet.writeContract({ address: pool, abi: perpPoolAbi, functionName: "cancelOrderFor", args: [account, orderId], gas: ORDER_GAS });
      return txRecord("cancel", await client.waitForTransactionReceipt({ hash }));
    },
    position: async (account) => {
      const snap = await readSnapshot(client, [account], pool);
      return { size: snap.accounts[0]?.size ?? 0n, mark: snap.markPrice };
    },
    book: async () => {
      const p = await client.readContract({ address: pool, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
      return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
    },
    placeClose: async (account, plan) => {
      const hash = await wallet.writeContract({
        address: pool,
        abi: perpPoolAbi,
        functionName: "placeOrderFor",
        args: [account, plan.isBid, 0n, plan.price, plan.quantity, farFutureNs(), ORDER_TYPE_IOC, 0, zeroAddress, 0n],
        gas: ORDER_GAS,
      });
      return txRecord("close", await client.waitForTransactionReceipt({ hash }));
    },
  };
}
```

`packages/referee/src/writer.ts`:
```ts
import type { Address, Hex, PublicClient } from "viem";
import { RULE_NAMES, basanosRegistryAbi } from "@basanos/core";
import type { FailRule } from "@basanos/core/evaluate";
import type { RefereeWallet } from "./chain";
import type { BreachRead } from "./engine";
import { txRecord, type TxRecord } from "./tx";

export const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

export function ruleIndex(rule: FailRule): number {
  const i = RULE_NAMES.indexOf(rule);
  if (i <= 0) throw new Error(`unknown rule ${rule}`);
  return i;
}

export function voidIndex(reason: "Flow" | "ForeignMarket"): number {
  return reason === "Flow" ? 1 : 2;
}

export function failArgs(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]) {
  return [runId, ruleIndex(rule), { ...breach }, evidenceHash, [...closeTxs]] as const;
}

export function voidArgs(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex) {
  return [runId, voidIndex(reason), txHash ?? ZERO_HASH, evidenceHash] as const;
}

export interface RegistryWriter {
  recordFail(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]): Promise<TxRecord>;
  recordPass(runId: bigint): Promise<TxRecord>;
  recordVoid(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex): Promise<TxRecord>;
}

/** oracleValue is ORACLE_DEPOSIT when ORACLE_ENABLED=true (cut-order switch), else 0n; only PASS and FAIL carry it. */
export function makeRegistryWriter(wallet: RefereeWallet, client: PublicClient, registry: Address, oracleValue: bigint): RegistryWriter {
  const done = async (label: string, hash: Hex): Promise<TxRecord> => {
    const r = txRecord(label, await client.waitForTransactionReceipt({ hash }));
    if (r.status !== "success") throw new Error(`${label} reverted: ${r.explorer}`);
    return r;
  };
  return {
    recordFail: async (runId, rule, breach, evidenceHash, closeTxs) =>
      done(
        "recordFail",
        await wallet.writeContract({
          address: registry,
          abi: basanosRegistryAbi,
          functionName: "recordFail",
          args: failArgs(runId, rule, breach, evidenceHash, closeTxs),
          value: oracleValue,
        }),
      ),
    recordPass: async (runId) =>
      done("recordPass", await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "recordPass", args: [runId], value: oracleValue })),
    recordVoid: async (runId, reason, txHash, evidenceHash) =>
      done(
        "recordVoid",
        await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "recordVoid", args: voidArgs(runId, reason, txHash, evidenceHash) }),
      ),
  };
}
```

Replace `packages/referee/src/index.ts` with:
```ts
export * from "./tx";
export * from "./runs";
export * from "./evidence";
export * from "./engine";
export * from "./close";
export * from "./lock";
export * from "./chain";
export * from "./writer";
```

- [ ] **Step 4: Run to confirm it passes (the gate)**
Run: `npm test -w @basanos/referee -- test/writer.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `feat(referee): registry writer and on-chain close I/O`

---

### Task 7: Referee daemon and CLI (watches, pause-on-gap, actions)

**Files:**
- Create: `packages/referee/src/daemon.ts`
- Create: `packages/referee/src/cli.ts`

**Depends on:** Task 3, Task 4, Task 5, Task 6, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 5, contracts:Task 8
**Effort:** high
**Model tier:** top
**Provides:** `interface DaemonDeps { client: PublicClient; wss: string; registry: Address; rulebooks: readonly Rulebook[]; closeIO: CloseIO; writer: RegistryWriter; markets: SomniaMarkets; log: (line: string) => void; pollMs?: number }`, `runDaemon(d: DaemonDeps): Promise<void>`, `CLI: npx tsx packages/referee/src/cli.ts start | enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo> | status`
**Requires:** `class Engine { paused; track(run): boolean; get(runId): EngineRun | undefined; watchedAccounts(): Address[]; retain(activeRunIds: readonly bigint[]): bigint[]; pause(); resume(); finish(runId); release(runId); onSnapshot(snap): Action[]; onAccountLog(account, topic0, txHash, snap): Action[] }`, `type Action = { kind: "fail"; runId: bigint; account: Address; rule: FailRule; breach: BreachRead } | { kind: "lock"; runId: bigint; account: Address } | { kind: "void"; runId: bigint; account: Address; reason: "Flow" | "ForeignMarket"; txHash: Hex | null }`, `flatten(io: CloseIO, account: Address): Promise<CloseResult>`, `predictClosedEquity(totalEquity: bigint, quote: CloseQuoteLike, baseDecimals: number): bigint | null`, `clearsTarget(predicted: bigint | null, startEquity: bigint, targetBps: number): boolean`, `readActiveRuns(client: PublicClient, registry: Address, index: Map<string, Rulebook>): Promise<TrackedRun[]>`, `rulebookIndex(rbs: readonly Rulebook[]): Map<string, Rulebook>`, `writeRunEvidence(runId: bigint, bundle: Record<string, unknown>, path?: string): Hex`, `attachVerdictTx(runId: bigint, tx: TxRecord, path?: string): void`, `interface RegistryWriter { recordFail(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]): Promise<TxRecord>; recordPass(runId: bigint): Promise<TxRecord>; recordVoid(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex): Promise<TxRecord> }`, `makePublicClient(url: string): PublicClient`, `makeRefereeWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`, `makeRegistryWriter(wallet: RefereeWallet, client: PublicClient, registry: Address, oracleValue: bigint): RegistryWriter`, `chainCloseIO(client: PublicClient, wallet: RefereeWallet, pool: Address): CloseIO`, `BTC_POOL`, `MARGIN_BANK`, `PRICE_FEED_SCHEDULER`, `CHAIN (hidekiTestnet, id 50383)`, `INDEXER_URL`, `HIDEKI_ADDRESSES`, `ORACLE_DEPOSIT = 30_900_000_000_000_000n`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `rulebookId(rb: Rulebook): Hex`, `snapshotCall(accounts: readonly Address[], pool: Address): { to: Address; data: Hex }`, `decodeSnapshot(result: Hex, accounts: readonly Address[], pool: Address): Snapshot`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `startWatch(url: string, filter: WatchFilter, handlers: WatchHandlers, opts?: WatchOptions): WatchHandle`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `rpcWss(env?: NodeJS.ProcessEnv): string`, `flag(name: "ORACLE_ENABLED", env?: NodeJS.ProcessEnv): boolean`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string }`

How the daemon works (spec §8, R3):
- It polls `getActiveRunIds` every 5 s and subscribes to three `somnia_watch` streams, each with the snapshot multicall attached:
  1. PriceFeedScheduler, with `push_changes_only`.
  2. MarginBank logs with an account in topic 1.
  3. MarginBank logs with an account in topic 2.
- **Gaps:** any stream's gap pauses judging. Once all three are back, it reads the snapshot at head over HTTP and evaluates before resuming. Every gap goes into each run's evidence.
- **Actions:** they run one at a time on a queue.
  - **FAIL:** close, then write the evidence, then `recordFail` with the evidence hash and close tx hashes (3 tries).
  - **Lock:** `quotePerpClose` predicts the closed equity. If it clears the target: close, then `recordPass`. If `recordPass` refuses (the close cost more than predicted), the run continues.
  - **VOID:** record only; no close. The flow's tx hash is looked up with `eth_getLogs` at the snapshot's block, because pushes carry no tx hash.

The gate is a type-check: the daemon is exercised live by task 10.

- [ ] **Step 1: Write the daemon**

`packages/referee/src/daemon.ts`:
```ts
import { pad, type Address, type Hex, type PublicClient } from "viem";
import type { SomniaMarkets } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  MARGIN_BANK,
  PRICE_FEED_SCHEDULER,
  decodeSnapshot,
  readSnapshot,
  snapshotCall,
  startWatch,
  type Rulebook,
  type Snapshot,
  type WatchHandle,
} from "@basanos/core";
import { flatten, type CloseIO } from "./close";
import { Engine, type Action } from "./engine";
import { attachVerdictTx, writeRunEvidence } from "./evidence";
import { clearsTarget, predictClosedEquity } from "./lock";
import { readActiveRuns, rulebookIndex } from "./runs";
import type { TxRecord } from "./tx";
import type { RegistryWriter } from "./writer";

export interface DaemonDeps {
  client: PublicClient;
  wss: string;
  registry: Address;
  rulebooks: readonly Rulebook[];
  closeIO: CloseIO;
  writer: RegistryWriter;
  markets: SomniaMarkets;
  log: (line: string) => void;
  pollMs?: number;
}

interface Gap {
  atMs: number;
  reason: string;
  lastBlock: string;
  resumedAtBlock: string | null;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
    }
  }
  throw last;
}

export async function runDaemon(d: DaemonDeps): Promise<void> {
  const engine = new Engine();
  const index = rulebookIndex(d.rulebooks);
  const gaps: Gap[] = [];
  const connected = new Set<number>();
  let watches: WatchHandle[] = [];
  let watchedKey = "";
  let lastSnap: Snapshot | null = null;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (actions: Action[]): void => {
    for (const a of actions) {
      queue = queue
        .then(() => act(a))
        .catch((e: unknown) => {
          d.log(`action error on run ${a.runId}: ${(e as Error).message}`);
          engine.release(a.runId);
        });
    }
  };

  const onSnap = (snap: Snapshot): void => {
    lastSnap = snap;
    enqueue(engine.onSnapshot(snap));
  };

  const findFlowTx = async (account: Address, block: bigint): Promise<Hex | null> => {
    const tag = `0x${block.toString(16)}` as Hex;
    for (const topics of [[null, pad(account)], [null, null, pad(account)]]) {
      const logs = (await d.client.request({
        method: "eth_getLogs",
        params: [{ address: MARGIN_BANK, topics: topics as Hex[], fromBlock: tag, toBlock: tag }],
      })) as { transactionHash: Hex }[];
      const first = logs[0];
      if (first) return first.transactionHash;
    }
    return null;
  };

  const resumeAtHead = async (): Promise<void> => {
    const accounts = engine.watchedAccounts();
    if (accounts.length === 0) {
      engine.resume();
      return;
    }
    const snap = await readSnapshot(d.client, accounts, BTC_POOL);
    const gap = gaps.at(-1);
    if (gap && gap.resumedAtBlock === null) gap.resumedAtBlock = snap.blockNumber.toString();
    engine.resume();
    d.log(`resumed at block ${snap.blockNumber} after a gap; re-evaluating at head`);
    onSnap(snap);
  };

  const resubscribe = (): void => {
    for (const w of watches) w.close();
    watches = [];
    connected.clear();
    const accounts = engine.watchedAccounts();
    watchedKey = accounts.map((a) => a.toLowerCase()).sort().join(",");
    if (accounts.length === 0) return;
    const call = snapshotCall(accounts, BTC_POOL);
    const topics = accounts.map((a) => pad(a));
    const decode = (results: Hex[]): Snapshot | null => {
      const raw = results[0];
      return raw ? decodeSnapshot(raw, accounts, BTC_POOL) : null;
    };
    const handlers = (i: number, onPush: (results: Hex[], logTopics: Hex[]) => void) => ({
      onPush: (p: { simulationResults: Hex[]; topics: Hex[] }) => onPush(p.simulationResults, p.topics),
      onConnected: ({ reconnects }: { reconnects: number }) => {
        connected.add(i);
        if (reconnects > 0 && connected.size === 3) void resumeAtHead().catch((e: unknown) => d.log(`resume error: ${(e as Error).message}`));
      },
      onGap: ({ atMs, reason }: { atMs: number; reason: string }) => {
        connected.delete(i);
        if (!engine.paused) {
          engine.pause();
          gaps.push({ atMs, reason, lastBlock: lastSnap ? lastSnap.blockNumber.toString() : "none", resumedAtBlock: null });
          d.log(`gap (${reason}): judging paused`);
        }
      },
    });
    watches.push(
      startWatch(
        d.wss,
        { address: PRICE_FEED_SCHEDULER, ethCalls: [call], pushChangesOnly: true },
        handlers(0, (results) => {
          const s = decode(results);
          if (s) onSnap(s);
        }),
      ),
    );
    for (const position of [1, 2] as const) {
      const filterTopics = position === 1 ? [null, topics] : [null, null, topics];
      watches.push(
        startWatch(
          d.wss,
          { address: MARGIN_BANK, topics: filterTopics, ethCalls: [call] },
          handlers(position, (results, logTopics) => {
            const s = decode(results);
            if (s) lastSnap = s;
            const t = logTopics[position];
            const account = accounts.find((a) => t !== undefined && same(pad(a), t));
            if (account) enqueue(engine.onAccountLog(account, logTopics[0], null, s));
          }),
        ),
      );
    }
  };

  const act = async (a: Action): Promise<void> => {
    const er = engine.get(a.runId);
    if (!er) return;
    const rb = er.run.rulebook;
    const base = {
      runId: a.runId,
      account: a.account,
      rulebook: { name: rb.name, variant: rb.variant, label: rb.label, id: er.run.rulebookId },
      startBlock: er.run.startBlock,
      startEquity: er.run.startEquity,
      gaps: gaps.map((g) => ({ ...g })),
    };
    if (a.kind === "void") {
      const txHash = a.txHash ?? (lastSnap ? await findFlowTx(a.account, lastSnap.blockNumber) : null);
      const hash = writeRunEvidence(a.runId, { ...base, verdict: "VOIDED", reason: a.reason, flowTx: txHash });
      const tx = await retry(() => d.writer.recordVoid(a.runId, a.reason, txHash, hash));
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} VOIDED (${a.reason}) ${tx.explorer}`);
      return;
    }
    if (a.kind === "fail") {
      d.log(`run ${a.runId} breach ${a.rule} at block ${a.breach.blockNumber}: cancelling and closing`);
      const close = await flatten(d.closeIO, a.account);
      for (const t of close.txs) d.log(`  ${t.label} ${t.status} ${t.explorer}`);
      const hash = writeRunEvidence(a.runId, { ...base, verdict: "FAILED", rule: a.rule, breach: a.breach, close });
      const tx: TxRecord = await retry(() => d.writer.recordFail(a.runId, a.rule, a.breach, hash, close.txs.map((t) => t.hash)));
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} FAILED (${a.rule}) ${tx.explorer}`);
      return;
    }
    const quote = await d.markets.client.quotePerpClose({ pool: rb.market.pool, marginBank: MARGIN_BANK, account: a.account });
    const total = lastSnap?.accounts.find((x) => same(x.account, a.account))?.totalEquity ?? 0n;
    const predicted = predictClosedEquity(total, quote, rb.market.baseDecimals);
    if (!clearsTarget(predicted, er.run.startEquity, rb.profitTargetBps)) {
      engine.release(a.runId);
      return;
    }
    d.log(`run ${a.runId} target reached (predicted closed equity ${predicted}): locking`);
    const close = await flatten(d.closeIO, a.account);
    for (const t of close.txs) d.log(`  ${t.label} ${t.status} ${t.explorer}`);
    try {
      const tx = await d.writer.recordPass(a.runId);
      writeRunEvidence(a.runId, { ...base, verdict: "PASSED", predictedClosedEquity: predicted, close });
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} PASSED ${tx.explorer}`);
    } catch (e) {
      d.log(`run ${a.runId} recordPass refused (${(e as Error).message.slice(0, 160)}); the run continues`);
      engine.release(a.runId);
    }
  };

  const refresh = async (): Promise<void> => {
    const runs = await readActiveRuns(d.client, d.registry, index);
    for (const r of runs) if (engine.track(r)) d.log(`tracking run ${r.runId}: ${r.account} on ${r.rulebook.label}`);
    engine.retain(runs.map((r) => r.runId));
    const key = engine.watchedAccounts().map((a) => a.toLowerCase()).sort().join(",");
    if (key !== watchedKey) {
      resubscribe();
      // fresh sockets report reconnects === 0, so a pause from an earlier gap would otherwise never lift
      if (engine.paused) void resumeAtHead().catch((e: unknown) => d.log(`resume error: ${(e as Error).message}`));
    }
  };

  await refresh();
  setInterval(() => {
    void refresh().catch((e: unknown) => d.log(`refresh error: ${(e as Error).message}`));
  }, d.pollMs ?? 5_000);
  d.log(`referee watching registry ${d.registry}`);
  await new Promise<never>(() => undefined);
}
```

- [ ] **Step 2: Write the CLI**

`packages/referee/src/cli.ts`:
```ts
import { decodeEventLog, getAddress, type Hex } from "viem";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { BTC_POOL, CHAIN, HIDEKI_ADDRESSES, INDEXER_URL, ORACLE_DEPOSIT, basanosRegistryAbi, rulebookId } from "@basanos/core";
import { RULEBOOK_FILES, flag, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp, rpcWss } from "@basanos/core/node";
import { chainCloseIO, makePublicClient, makeRefereeWallet } from "./chain";
import { runDaemon } from "./daemon";
import { readActiveRuns, rulebookIndex } from "./runs";
import { makeRegistryWriter } from "./writer";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const rulebooks = [loadRulebook("tokyo-sprint"), loadRulebook("tokyo-sprint-demo")];

if (cmd === "start") {
  const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
  const markets = new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
  await runDaemon({
    client,
    wss: rpcWss(),
    registry,
    rulebooks,
    closeIO: chainCloseIO(client, wallet, BTC_POOL),
    writer: makeRegistryWriter(wallet, client, registry, flag("ORACLE_ENABLED") ? ORACLE_DEPOSIT : 0n),
    markets,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
} else if (cmd === "enroll") {
  const target = rest[0];
  const name = opt("--rulebook") as keyof typeof RULEBOOK_FILES | undefined;
  if (!target || !name || !(name in RULEBOOK_FILES)) {
    console.error("usage: cli.ts enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo>");
    process.exit(2);
  }
  const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
  const hash = await wallet.writeContract({
    address: registry,
    abi: basanosRegistryAbi,
    functionName: "startRun",
    args: [getAddress(target), rulebookId(loadRulebook(name))],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  let runId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") runId = ev.args.runId;
    } catch {
      // not a registry event
    }
  }
  console.log(runId === null ? `enroll failed: ${hash}` : `enrolled run ${runId} (${hash})`);
  process.exit(runId === null ? 1 : 0);
} else if (cmd === "status") {
  const runs = await readActiveRuns(client, registry, rulebookIndex(rulebooks));
  if (runs.length === 0) console.log("no active runs");
  for (const r of runs) console.log(`run ${r.runId}: ${r.account} on ${r.rulebook.label}, start equity ${r.startEquity} at block ${r.startBlock}`);
  process.exit(0);
} else {
  console.error("usage: cli.ts start | enroll <account> --rulebook <name> | status");
  process.exit(2);
}
```

- [ ] **Step 3: Type-check the package (the gate)**
Run: `npm run typecheck -w @basanos/referee`
Expected: PASS — exits 0 with no `error TS` lines.

- [ ] **Step 4: Commit (kernel-performed — no agent runs this)**
Message: `feat(referee): watch daemon with pause-on-gap and the referee CLI`

---

### Task 8: Bot package — scripted challenger and demo runner

**Files:**
- Create: `packages/bot/package.json`
- Create: `packages/bot/tsconfig.json`
- Create: `packages/bot/vitest.config.ts`
- Create: `packages/bot/src/actions.ts`
- Create: `packages/bot/src/bot.ts`
- Create: `packages/bot/src/demo.ts`
- Test: `packages/bot/test/actions.test.ts`

**Depends on:** Task 3, Task 6, spike:Task 1, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6, contracts:Task 8
**Effort:** high
**Model tier:** top
**Provides:** `@basanos/bot package`, `interface Preflight { account: Address; stt: bigint; sttOk: boolean; voucherClaimed: boolean; flat: boolean; equity: bigint }`, `makeAccountWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`, `makeMarkets(pk: Hex): SomniaMarkets`, `preflight(client: PublicClient, markets: SomniaMarkets, account: Address): Promise<Preflight>`, `readBook(client: PublicClient): Promise<BookParams>`, `ensureGrant(client: PublicClient, markets: SomniaMarkets, owner: Address, referee: Address): Promise<TxRecord | null>`, `runIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], registry: Address): bigint | null`, `startRunAs(wallet: AccountWallet, client: PublicClient, registry: Address, rulebookId: Hex): Promise<{ runId: bigint; tx: TxRecord }>`, `breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `openIoc(markets: SomniaMarkets, client: PublicClient, isBid: boolean, quantity: bigint): Promise<TxRecord>`, `DEMO_TAKES = "docs/evidence/demo-takes.json"`, `appendDemoTake(take: Record<string, unknown>, path?: string): number`, `CLI: npx tsx packages/bot/src/bot.ts start [--rulebook <name>] [--side short|long] [--leverage 12] | breach [--leverage 16]`, `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--wait-min 10]`
**Requires:** `@basanos/referee package (exports "." -> src/index.ts)`, `makePublicClient(url: string): PublicClient`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `jsonSafe(value: unknown): unknown`, `BTC_POOL`, `MARGIN_BANK`, `OPERATOR_REGISTRY`, `PLACE_ORDER_FOR_SELECTOR`, `CANCEL_ORDER_FOR_SELECTOR`, `ORDER_TYPE_IOC = 2`, `STT_WRITE_HEADROOM = 600_000_000_000_000_000n`, `CHAIN (hidekiTestnet, id 50383)`, `INDEXER_URL`, `HIDEKI_ADDRESSES`, `explorerTx(hash: Hex): string`, `perpPoolAbi`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`, `rulebookId(rb: Rulebook): Hex`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `alignUp(x: bigint, step: bigint): bigint`, `planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `repoPath(rel: string): string`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string }`

The bot signs as its own account (`ACCOUNT_B_PK`), never through an operator grant. Neither the bot nor the demo runner ever claims a voucher: `preflight` only reads whether one was claimed, and a run without one stops with a message. Both demo accounts are operated by the builder (spec §5), and the runner prints that line at start.

- [ ] **Step 1: Write the package files**

`packages/bot/package.json`:
```json
{
  "name": "@basanos/bot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "demo": "tsx src/demo.ts"
  },
  "dependencies": {
    "@basanos/core": "*",
    "@basanos/referee": "*",
    "@somnia-chain/markets-sdk": "0.33.0",
    "viem": "2.57.12"
  }
}
```

`packages/bot/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

`packages/bot/vitest.config.ts`:
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

`packages/bot/test/actions.test.ts`:
```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { basanosRegistryAbi } from "@basanos/core";
import { appendDemoTake, breachQuantity, runIdFromLogs } from "../src/actions";

const E18 = 10n ** 18n;
const BOOK = { tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n };
const REG = "0x00000000000000000000000000000000000000f0";

describe("breachQuantity", () => {
  it("adds just enough size to pass the target exposure", () => {
    const add = breachQuantity(-16_107_000n, 1_000n * E18, 16, 74_500n * E18, 8, BOOK);
    const after = 16_107_000n + add;
    expect((after * 74_500n * E18) / 100_000_000n > 16_000n * E18).toBe(true);
    expect(((after - 1_000n) * 74_500n * E18) / 100_000_000n <= 16_000n * E18 + (1_000n * 74_500n * E18) / 100_000_000n).toBe(true);
    expect(add % 1_000n).toBe(0n);
  });
  it("is at least the market minimum", () => {
    expect(breachQuantity(-30_000_000n, 1_000n * E18, 16, 74_500n * E18, 8, BOOK)).toBe(13_000n);
  });
});

describe("runIdFromLogs", () => {
  it("decodes RunStarted from the registry's own logs only", () => {
    const topics = encodeEventTopics({
      abi: basanosRegistryAbi,
      eventName: "RunStarted",
      args: { runId: 42n, account: "0x00000000000000000000000000000000000000a1", rulebookId: `0x${"11".repeat(32)}` },
    }) as Hex[];
    const data = encodeAbiParameters([{ type: "uint64" }, { type: "int256" }], [100n, 1_000n * E18]);
    expect(runIdFromLogs([{ address: REG, data, topics }], REG)).toBe(42n);
    expect(runIdFromLogs([{ address: "0x00000000000000000000000000000000000000ee", data, topics }], REG)).toBeNull();
  });
});

describe("appendDemoTake", () => {
  it("appends numbered takes to one file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "basanos takes ")), "demo-takes.json");
    expect(appendDemoTake({ outcome: "a" }, path)).toBe(1);
    expect(appendDemoTake({ outcome: "b", big: 5n }, path)).toBe(2);
    const all = JSON.parse(readFileSync(path, "utf8")) as { take: number; big?: string }[];
    expect(all.map((t) => t.take)).toEqual([1, 2]);
    expect(all[1]?.big).toBe("5");
  });
});
```

- [ ] **Step 3: Run to confirm it fails**
Run: `npm install`
Expected: exits 0 (links the new workspace).
Run: `npm test -w @basanos/bot`
Expected: FAIL — `Failed to resolve import "../src/actions"`.

- [ ] **Step 4: Write the actions module**

`packages/bot/src/actions.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createWalletClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  INDEXER_URL,
  MARGIN_BANK,
  OPERATOR_REGISTRY,
  ORDER_TYPE_IOC,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  basanosRegistryAbi,
  perpPoolAbi,
  planOpen,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { repoPath } from "@basanos/core/node";
import { jsonSafe, txRecord, type TxRecord } from "@basanos/referee";

export interface Preflight {
  account: Address;
  stt: bigint;
  sttOk: boolean;
  voucherClaimed: boolean;
  flat: boolean;
  equity: bigint;
}

/** Inferred return type: bound to CHAIN and the key's account. */
export function makeAccountWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type AccountWallet = ReturnType<typeof makeAccountWallet>;

export function makeMarkets(pk: Hex): SomniaMarkets {
  return new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES, privateKey: pk });
}

/** Reads only. Never claims a voucher: the Step 3 preflight claimed one per account. */
export async function preflight(client: PublicClient, markets: SomniaMarkets, account: Address): Promise<Preflight> {
  const [stt, voucher, snap] = await Promise.all([
    client.getBalance({ address: account }),
    markets.client.getPerpVoucher(MARGIN_BANK, account),
    readSnapshot(client, [account], BTC_POOL),
  ]);
  const a = snap.accounts[0];
  return {
    account,
    stt,
    sttOk: stt >= STT_WRITE_HEADROOM,
    voucherClaimed: voucher?.claimed ?? false,
    flat: a ? a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0 : false,
    equity: a?.totalEquity ?? 0n,
  };
}

export async function readBook(client: PublicClient): Promise<BookParams> {
  const p = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
  return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
}

/** Grants the referee place + cancel on the BTC pool only, if not already granted. */
export async function ensureGrant(client: PublicClient, markets: SomniaMarkets, owner: Address, referee: Address): Promise<TxRecord | null> {
  const has = async (selector: Hex) =>
    client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
  if ((await has(PLACE_ORDER_FOR_SELECTOR)) && (await has(CANCEL_ORDER_FOR_SELECTOR))) return null;
  const r = await markets.trader.setOperatorApprovalForPool({
    pool: BTC_POOL,
    operator: referee,
    selectors: [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR],
    approved: true,
    operatorRegistry: OPERATOR_REGISTRY,
  });
  return txRecord("grant", r.receipt);
}

export function runIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], registry: Address): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") return ev.args.runId;
    } catch {
      // another registry event
    }
  }
  return null;
}

/** The account itself enrolls (msg.sender == account); the registry reads its start equity in the same tx. */
export async function startRunAs(wallet: AccountWallet, client: PublicClient, registry: Address, rulebookId: Hex): Promise<{ runId: bigint; tx: TxRecord }> {
  const hash = await wallet.writeContract({
    address: registry,
    abi: basanosRegistryAbi,
    functionName: "startRun",
    args: [wallet.account.address, rulebookId],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const runId = runIdFromLogs(receipt.logs, registry);
  if (runId === null) throw new Error(`startRun emitted no RunStarted: ${hash}`);
  return { runId, tx: txRecord("startRun", receipt) };
}

/** Extra size so the account's notional strictly exceeds targetX x equity (the on-demand exposure breach). */
export function breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint {
  const oneBase = 10n ** BigInt(baseDecimals);
  const abs = currentSize < 0n ? -currentSize : currentSize;
  const targetNotional = equity * BigInt(targetX);
  const current = (abs * mark) / oneBase;
  const neededNotional = targetNotional > current ? targetNotional - current : 0n;
  const qty = alignUp((neededNotional * oneBase) / mark + 1n, book.lotSize);
  return qty < book.minQuantity ? book.minQuantity : qty;
}

export async function openIoc(markets: SomniaMarkets, client: PublicClient, isBid: boolean, quantity: bigint): Promise<TxRecord> {
  const book = await readBook(client);
  const snap = await readSnapshot(client, [], BTC_POOL);
  if (!snap.markOk) throw new Error("BTC-PERP has no fresh mark");
  const plan = planOpen(isBid, quantity, snap.markPrice, book, 20);
  const r = await markets.trader.placePerpOrder({ pool: BTC_POOL, isBid, price: plan.price, quantity: plan.quantity, orderType: ORDER_TYPE_IOC });
  return txRecord(isBid ? "open long" : "open short", r.receipt);
}

export const DEMO_TAKES = "docs/evidence/demo-takes.json";

export function appendDemoTake(take: Record<string, unknown>, path: string = repoPath(DEMO_TAKES)): number {
  const all = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
  const n = all.length + 1;
  all.push(jsonSafe({ take: n, ...take }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
  return n;
}
```

- [ ] **Step 5: Write the bot CLI and the demo runner**

`packages/bot/src/bot.ts`:
```ts
// The scripted challenger (account B). It signs as itself; the referee's grant is the only delegation.
import { BTC_POOL, readSnapshot, rulebookId, quantityForLeverage } from "@basanos/core";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, openIoc, preflight, readBook, startRunAs } from "./actions";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? (rest[i + 1] as string) : fallback;
};
const pk = requirePrivateKey("ACCOUNT_B_PK");
const wallet = makeAccountWallet(pk, rpcHttp());
const account = wallet.account.address;
const client = makePublicClient(rpcHttp());
const markets = makeMarkets(pk);
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");

if (cmd === "start") {
  const name = opt("--rulebook", "tokyo-sprint-demo") as keyof typeof RULEBOOK_FILES;
  const side = opt("--side", "short");
  const leverage = Number(opt("--leverage", "12"));
  const pf = await preflight(client, markets, account);
  if (!pf.sttOk || !pf.voucherClaimed || !pf.flat) {
    console.error(`bot preflight failed: ${JSON.stringify({ sttOk: pf.sttOk, voucherClaimed: pf.voucherClaimed, flat: pf.flat })}`);
    process.exit(1);
  }
  const grant = await ensureGrant(client, markets, account, referee);
  if (grant) console.log(`grant ${grant.explorer}`);
  const { runId, tx } = await startRunAs(wallet, client, registry, rulebookId(loadRulebook(name)));
  console.log(`run ${runId} started ${tx.explorer}`);
  const snap = await readSnapshot(client, [], BTC_POOL);
  const qty = quantityForLeverage(pf.equity, leverage, snap.markPrice, 8, await readBook(client));
  const open = await openIoc(markets, client, side === "long", qty);
  console.log(`${open.label} ${qty} ${open.status} ${open.explorer}`);
  process.exit(0);
} else if (cmd === "breach") {
  const leverage = Number(opt("--leverage", "16"));
  const snap = await readSnapshot(client, [account], BTC_POOL);
  const a = snap.accounts[0];
  if (!a || a.size === 0n) {
    console.error("bot has no position to extend");
    process.exit(1);
  }
  const add = breachQuantity(a.size, a.totalEquity, leverage, snap.markPrice, 8, await readBook(client));
  const tx = await openIoc(markets, client, a.size > 0n, add);
  console.log(`exposure breach: +${add} ${tx.status} ${tx.explorer}`);
  process.exit(0);
} else {
  console.error("usage: bot.ts start [--rulebook <name>] [--side short|long] [--leverage 12] | breach [--leverage 16]");
  process.exit(2);
}
```

`packages/bot/src/demo.ts`:
```ts
// The demo runner: both builder-operated accounts take Tokyo Sprint · Demo with opposite 12x positions.
// The referee daemon (packages/referee/src/cli.ts start) must already be running in another terminal.
import type { Address, Hex } from "viem";
import { BTC_POOL, RULE_NAMES, RUN_STATUS, basanosRegistryAbi, explorerTx, quantityForLeverage, readSnapshot, rulebookId } from "@basanos/core";
import { loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, type TxRecord } from "@basanos/referee";
import { appendDemoTake, breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, openIoc, preflight, readBook, startRunAs } from "./actions";

loadDotEnv();
const argv = process.argv.slice(2);
const manualA = argv.includes("--a-manual");
const waitMin = Number(argv[argv.indexOf("--wait-min") + 1] ?? "10") || 10;
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");
const rb = loadRulebook("tokyo-sprint-demo");
const id: Hex = rulebookId(rb);
const txs: TxRecord[] = [];
const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

say("Basanos demo: both challenge accounts are burners operated by the builder (A human-driven, B scripted).");
const accounts = (["ACCOUNT_A_PK", "ACCOUNT_B_PK"] as const).map((name) => {
  const pk = requirePrivateKey(name);
  const wallet = makeAccountWallet(pk, rpcHttp());
  return { name, wallet, markets: makeMarkets(pk), address: wallet.account.address as Address };
});
for (const a of accounts) {
  const pf = await preflight(client, a.markets, a.address);
  say(`${a.name} ${a.address}: stt ${pf.stt} voucher ${pf.voucherClaimed} flat ${pf.flat} equity ${pf.equity}`);
  if (!pf.sttOk || !pf.voucherClaimed || !pf.flat) {
    say(`STOP: ${a.name} is not ready (top up from the faucet, flatten, or run the preflight). No voucher is ever claimed here.`);
    process.exit(1);
  }
  const g = await ensureGrant(client, a.markets, a.address, referee);
  if (g) txs.push(g);
}
const runs: bigint[] = [];
for (const a of accounts) {
  const { runId, tx } = await startRunAs(a.wallet, client, registry, id);
  runs.push(runId);
  txs.push(tx);
  say(`${a.name} run ${runId} on ${rb.label}: ${tx.explorer}`);
}
const book = await readBook(client);
const snap = await readSnapshot(client, accounts.map((a) => a.address), BTC_POOL);
const [accA, accB] = accounts;
if (!accA || !accB) throw new Error("two accounts expected");
const qtyB = quantityForLeverage(snap.accounts[1]?.totalEquity ?? 0n, 12, snap.markPrice, 8, book);
txs.push(await openIoc(accB.markets, client, false, qtyB));
say(`B short ${qtyB} at 12x`);
if (manualA) {
  say("A: open the long from the Basanos terminal now (12x).");
} else {
  const qtyA = quantityForLeverage(snap.accounts[0]?.totalEquity ?? 0n, 12, snap.markPrice, 8, book);
  txs.push(await openIoc(accA.markets, client, true, qtyA));
  say(`A long ${qtyA} at 12x`);
}
const openedAt = Date.now();
let breached = false;
const statusOf = async (runId: bigint) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
for (;;) {
  const [ra, rbRun] = await Promise.all(runs.map((r) => statusOf(r)));
  const states = [ra, rbRun].map((r) => (r ? `${RUN_STATUS[r.status] ?? r.status}${r.rule ? `/${RULE_NAMES[r.rule]}` : ""}` : "?"));
  say(`runs ${runs.join(", ")}: ${states.join(" | ")}`);
  if (ra && rbRun && ra.status !== 1 && rbRun.status !== 1) break;
  if (!breached && Date.now() - openedAt > waitMin * 60_000 && rbRun?.status === 1) {
    say("market still — take aborted: exposure breach on B (FAIL on demand); A resolves or hits its time limit");
    const s = await readSnapshot(client, [accB.address], BTC_POOL);
    const b = s.accounts[0];
    if (b && b.size !== 0n) txs.push(await openIoc(accB.markets, client, b.size > 0n, breachQuantity(b.size, b.totalEquity, 16, s.markPrice, 8, book)));
    breached = true;
  }
  await new Promise((r) => setTimeout(r, 2_000));
}
const final = await Promise.all(runs.map((r) => statusOf(r)));
const take = appendDemoTake({
  at: new Date().toISOString(),
  rulebook: { id, label: rb.label },
  runs: runs.map((r, i) => ({ runId: r, account: accounts[i]?.address, status: RUN_STATUS[final[i]?.status ?? 0], rule: RULE_NAMES[final[i]?.rule ?? 0] })),
  breachedOnDemand: breached,
  txs,
});
say(`take ${take} recorded in docs/evidence/demo-takes.json`);
for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
process.exit(0);
```

- [ ] **Step 6: Type-check the bot (bot.ts and demo.ts first run live in Task 10)**
Run: `npm run typecheck -w @basanos/bot`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 7: Run the tests (the gate)**
Run: `npm test -w @basanos/bot`
Expected: PASS — `4 passed`.

- [ ] **Step 8: Commit (kernel-performed — no agent runs this)**
Message: `feat(bot): scripted challenger and demo runner on the shared rulebook`

---

### Task 9: Demo-cost check, rulebook registration and rehearsal check scripts

**Files:**
- Create: `packages/bot/src/demo-check.ts`
- Create: `packages/referee/src/register-rulebook.ts`
- Create: `packages/referee/src/check-rehearsal.ts`
- Test: `packages/referee/test/rehearsal.test.ts`

**Depends on:** Task 2, Task 3, Task 6, Task 8, spike:Task 1, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6, contracts:Task 8
**Effort:** medium
**Model tier:** top
**Provides:** `CLI: npx tsx packages/bot/src/demo-check.ts -> PASS demo-check, or FAIL with a recommended demo target`, `CLI: npx tsx packages/referee/src/register-rulebook.ts <tokyo-sprint|tokyo-sprint-demo> (owner = REFEREE_PK; updates deployments/hideki.json)`, `summarizeRehearsal(runs: readonly { runId: bigint; status: number; rule: number; closeTxs: number }[]): { ok: boolean; firstVerdictRunId: bigint | null; problems: string[] }`, `CLI: npx tsx packages/referee/src/check-rehearsal.ts -> writes docs/evidence/rehearsal.json, prints PASS rehearsal`
**Requires:** `parseTape(raw: unknown): TapePoint[]`, `simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint }`, `costBpsVsMark(isBid: boolean, reference: bigint, average: bigint): number`, `roundTripEquityBps(oneWayCostBps: number, leverageX: number): number`, `recommendDemoTargetBps(roundTripEqBps: number): number`, `jsonSafe(value: unknown): unknown`, `makePublicClient(url: string): PublicClient`, `makeRefereeWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`, `readBook(client: PublicClient): Promise<BookParams>`, `BTC_POOL`, `MARGIN_BANK`, `CHAIN (hidekiTestnet, id 50383)`, `INDEXER_URL`, `HIDEKI_ADDRESSES`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `registerArgs(rb: Rulebook): RegisterArgs`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `loadDotEnv(path?: string): boolean`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `repoPath(rel: string): string`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string }`

`demo-check` decides whether the +0.5% demo target can be trusted (spec §5):
- **One-way cost:** the worse of the spike's real entry fill (`docs/evidence/g1a-close.json` → `entry.costBps`) and a live quote of the demo size against the book, on both sides.
- **Check 1:** the round trip in equity terms must use at most half the target.
- **Check 2:** the recorded tape must still resolve the long to a PASS once those costs are charged.

`register-rulebook` is used only in task 10, and only when `demo-check` fails.

- [ ] **Step 1: Write the failing test**

`packages/referee/test/rehearsal.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { summarizeRehearsal } from "../src/check-rehearsal";

describe("summarizeRehearsal", () => {
  it("passes when a real verdict exists and every FAIL carries close txs", () => {
    const r = summarizeRehearsal([
      { runId: 3n, status: 3, rule: 1, closeTxs: 2 },
      { runId: 4n, status: 2, rule: 0, closeTxs: 0 },
    ]);
    expect(r).toEqual({ ok: true, firstVerdictRunId: 3n, problems: [] });
  });
  it("fails with no verdict, or a FAIL without close txs", () => {
    expect(summarizeRehearsal([{ runId: 3n, status: 1, rule: 0, closeTxs: 0 }]).ok).toBe(false);
    const r = summarizeRehearsal([{ runId: 5n, status: 3, rule: 2, closeTxs: 0 }]);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/run 5/);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/referee -- test/rehearsal.test.ts`
Expected: FAIL — `Failed to resolve import "../src/check-rehearsal"`.

- [ ] **Step 3: Write the three scripts**

`packages/referee/src/check-rehearsal.ts`:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { RULE_NAMES, RUN_STATUS, basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "./chain";
import { jsonSafe } from "./evidence";

export function summarizeRehearsal(runs: readonly { runId: bigint; status: number; rule: number; closeTxs: number }[]): {
  ok: boolean;
  firstVerdictRunId: bigint | null;
  problems: string[];
} {
  const problems: string[] = [];
  const verdicts = runs.filter((r) => r.status === 2 || r.status === 3).sort((a, b) => (a.runId < b.runId ? -1 : 1));
  if (verdicts.length === 0) problems.push("no PASSED or FAILED run recorded");
  for (const r of runs) if (r.status === 3 && r.closeTxs === 0) problems.push(`run ${r.runId} FAILED without close transactions`);
  return { ok: problems.length === 0, firstVerdictRunId: verdicts[0]?.runId ?? null, problems };
}

const isMain = process.argv[1]?.endsWith("check-rehearsal.ts") ?? false;
if (isMain) {
  loadDotEnv();
  const takesPath = repoPath("docs/evidence/demo-takes.json");
  if (!existsSync(takesPath)) {
    console.log("FAIL rehearsal (docs/evidence/demo-takes.json is missing; run the demo first)");
    process.exit(1);
  }
  const takes = JSON.parse(readFileSync(takesPath, "utf8")) as { runs: { runId: string }[] }[];
  const registry = requireAddress("REGISTRY_ADDRESS");
  const client = makePublicClient(rpcHttp());
  const rows: { runId: bigint; status: number; rule: number; closeTxs: number }[] = [];
  for (const t of takes) {
    for (const r of t.runs) {
      const runId = BigInt(r.runId);
      const run = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
      const closes = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getCloseTxs", args: [runId] });
      rows.push({ runId, status: run.status, rule: run.rule, closeTxs: closes.length });
    }
  }
  const s = summarizeRehearsal(rows);
  const out = {
    evidence: "rehearsal",
    writtenAt: new Date().toISOString(),
    registry,
    firstVerdictRunId: s.firstVerdictRunId,
    runs: rows.map((r) => ({ ...r, statusName: RUN_STATUS[r.status], ruleName: RULE_NAMES[r.rule] })),
    problems: s.problems,
  };
  mkdirSync(dirname(repoPath("docs/evidence/rehearsal.json")), { recursive: true });
  writeFileSync(repoPath("docs/evidence/rehearsal.json"), `${JSON.stringify(jsonSafe(out), null, 2)}\n`);
  for (const p of s.problems) console.log(`FAIL ${p}`);
  console.log(s.ok ? `PASS rehearsal (first verdict run ${s.firstVerdictRunId})` : "FAIL rehearsal");
  process.exit(s.ok ? 0 : 1);
}
```

`packages/referee/src/register-rulebook.ts`:
```ts
// Owner-only (REFEREE_PK): registers a rulebook file's id and contract-checked fields, and records it in
// deployments/hideki.json. Used only when demo-check fails and the demo target is raised (a new rulebook id).
import { readFileSync, writeFileSync } from "node:fs";
import type { Hex } from "viem";
import { basanosRegistryAbi, registerArgs } from "@basanos/core";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, repoPath, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, makeRefereeWallet } from "./chain";

loadDotEnv();
const name = process.argv[2] as keyof typeof RULEBOOK_FILES | undefined;
if (!name || !(name in RULEBOOK_FILES)) {
  console.error("usage: register-rulebook.ts <tokyo-sprint|tokyo-sprint-demo>");
  process.exit(2);
}
const registry = requireAddress("REGISTRY_ADDRESS");
const client = makePublicClient(rpcHttp());
const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
const args = registerArgs(loadRulebook(name));
const existing = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRulebook", args: [args[0]] });
if (existing.exists) {
  console.log(`rulebook ${name} (${args[0]}) is already registered`);
  process.exit(0);
}
const tx = await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "registerRulebook", args: [...args] });
const receipt = await client.waitForTransactionReceipt({ hash: tx });
const depPath = repoPath("deployments/hideki.json");
const dep = JSON.parse(readFileSync(depPath, "utf8")) as { rulebooks: { name: string; id: Hex; tx: Hex; status: string; gasUsed: string }[] };
dep.rulebooks.push({ name, id: args[0], tx, status: receipt.status, gasUsed: receipt.gasUsed.toString() });
writeFileSync(depPath, `${JSON.stringify(dep, null, 2)}\n`);
console.log(`registered ${name} ${args[0]} (${receipt.status}) ${tx}`);
process.exit(receipt.status === "success" ? 0 : 1);
```

`packages/bot/src/demo-check.ts`:
```ts
// Decides whether the demo target is trustworthy given real trading costs (spec §5). Read-only.
import { existsSync, readFileSync } from "node:fs";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { BTC_POOL, CHAIN, HIDEKI_ADDRESSES, INDEXER_URL, MARGIN_BANK, quantityForLeverage, readSnapshot } from "@basanos/core";
import { costBpsVsMark, parseTape, recommendDemoTargetBps, roundTripEquityBps, simulateTape } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { readBook } from "./actions";

loadDotEnv();
const rb = loadRulebook("tokyo-sprint-demo");
const LEVERAGE = 12;
const client = makePublicClient(rpcHttp());
const markets = new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
const g1aPath = repoPath("docs/evidence/g1a-close.json");
const entryCost = existsSync(g1aPath) ? Number((JSON.parse(readFileSync(g1aPath, "utf8")) as { entry?: { costBps?: number } }).entry?.costBps ?? 0) : 0;
const book = await readBook(client);
const snap = await readSnapshot(client, [], BTC_POOL);
const qty = quantityForLeverage(1_000n * 10n ** 18n, LEVERAGE, snap.markPrice, rb.market.baseDecimals, book);
const live: number[] = [];
for (const isBid of [true, false]) {
  const q = await markets.client.quotePerpClose({ pool: BTC_POOL, marginBank: MARGIN_BANK, isBid, quantity: qty });
  if (q.priceable && q.averagePrice !== null && q.fillableSize === q.quantity) live.push(costBpsVsMark(isBid, q.referencePrice, q.averagePrice));
  else live.push(Number.POSITIVE_INFINITY);
}
const oneWay = Math.max(entryCost, ...live);
if (!Number.isFinite(oneWay)) {
  console.log(`FAIL demo-check: the book is too thin to fill the demo size ${qty} on both sides (live buy ${live[0]}, live sell ${live[1]}); retry when the book refills, or lower the demo leverage`);
  process.exit(1);
}
const roundTripEq = roundTripEquityBps(oneWay, LEVERAGE);
const halfTarget = rb.profitTargetBps / 2;
const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
const sim = simulateTape(rb, tape, { leverageX: LEVERAGE, startEquity: 1_000n * 10n ** 18n, lotSize: book.lotSize, entryCostBps: oneWay, exitCostBps: oneWay });
const costOk = roundTripEq <= halfTarget;
const tapeOk = sim.long.outcome === "target" || sim.short.outcome === "target";
console.log(`demo size ${qty} (${LEVERAGE}x); one-way cost ${oneWay} bps (g1a entry ${entryCost}, live buy ${live[0]}, live sell ${live[1]})`);
console.log(`round trip ${roundTripEq} equity bps vs half target ${halfTarget}: ${costOk ? "ok" : "too costly"}`);
console.log(`tape with costs: long ${sim.long.outcome}, short ${sim.short.outcome}`);
if (costOk && tapeOk) {
  console.log("PASS demo-check");
  process.exit(0);
}
console.log(`FAIL demo-check: raise profitTargetBps in rulebooks/tokyo-sprint-demo.json to ${recommendDemoTargetBps(roundTripEq)} and register it`);
process.exit(1);
```

- [ ] **Step 4: Type-check both packages (the live rehearsal is the first run of these scripts)**
Run: `npm run typecheck -w @basanos/referee`
Expected: exits 0 with no `error TS` lines.
Run: `npm run typecheck -w @basanos/bot`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 5: Run to confirm the test passes (the gate)**
Run: `npm test -w @basanos/referee -- test/rehearsal.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `feat(referee): demo-cost check, rulebook registration and rehearsal check`

---

### Task 10: LIVE — the referee rehearsal (Nov 12): the first real verdict runs

**Files:**
- Create: `docs/evidence/runs.json`
- Create: `docs/evidence/demo-takes.json`
- Create: `docs/evidence/rehearsal.json`
- Modify: `rulebooks/tokyo-sprint-demo.json`
- Modify: `deployments/hideki.json`

**Depends on:** Task 7, Task 8, Task 9, Task 11, Task 12, Task 14, Task 15, Task 17, contracts:Task 10, contracts:Task 11, spike:Task 11, spike:Task 18, spike:Task 19
**Effort:** medium
**Model tier:** top
**Provides:** `docs/evidence/rehearsal.json (first real verdict runs: firstVerdictRunId, runs with statusName, ruleName, closeTxs)`, `docs/evidence/runs.json (per-run evidence bundles + evidenceHash + verdictTx)`, `docs/evidence/demo-takes.json (demo takes with run ids and tx hashes)`
**Requires:** `CLI: npx tsx packages/referee/src/cli.ts start | enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo> | status`, `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--wait-min 10] [--one-account [--pass-side long|short]] (two funded accounts by default; --one-account is the A-only fallback; every account write viem-direct and read back; a take that fails after a run started aborts: nothing re-sent, verdicts awaited, recorded in docs/evidence/demo-aborted.json, exit 1)`, `CLI: npx tsx packages/bot/src/demo-check.ts [--equity <USDso>] -> PASS demo-check, or FAIL with a recommended demo target (closeable-equity cost: the spread for the demo size walked from one book read, at DEMO_LEVERAGE_X)`, `CLI: npx tsx packages/referee/src/register-rulebook.ts <tokyo-sprint|tokyo-sprint-demo> (owner = REFEREE_PK; updates deployments/hideki.json)`, `CLI: npx tsx packages/referee/src/check-rehearsal.ts -> writes docs/evidence/rehearsal.json, prints PASS rehearsal`, `deployments/hideki.json (registry address, deploy block, rulebook ids)`

**Human-gated.** This signs real transactions with `REFEREE_PK` (closes and verdicts, plus 0.0309 STT per PASS or FAIL verdict for the Price Oracle, mostly rebated; set `ORACLE_ENABLED=true` in `.env` first), `ACCOUNT_A_PK` and `ACCOUNT_B_PK` (grant, `startRun`, orders). Needed first:
- all three burners topped up to about 1 STT from the Tokyo faucet;
- `REGISTRY_ADDRESS` and `REFEREE_ADDRESS` set in `.env`;
- both accounts flat, each funded: its own USDso deposited in its own MarginBank balance (spike:18, spike:19; no voucher).

No voucher is ever claimed. The referee judges closeable equity (referee:13, referee:14), and the demo opens from the book at 5× (referee:15), so a fresh position starts only the spread down, not the mark-to-book basis. The demo's own writes (grant, `startRun`, opens) are viem-direct and read back from the chain, never re-sent (referee:16, referee:17): the first GO stopped at B's grant on the SDK's send path (B18). `rulebooks/tokyo-sprint-demo.json` and `deployments/hideki.json` change only if step 1 fails.

- [ ] **Step 1: Check the demo target against real costs**
Run: `npx tsx packages/bot/src/demo-check.ts` (it sizes from A's and B's live equity; `--equity <USDso>` is only for checking before the accounts are funded)
Expected: `PASS demo-check`. If it prints `FAIL demo-check: raise profitTargetBps … to <N>`:
1. Set `"profitTargetBps": <N>` in `rulebooks/tokyo-sprint-demo.json`, raising `"dailyLossBps"` to the same value and `"trailingDrawdownBps"` to `<N> + 25` so the two sides stay symmetric.
2. Run `npx tsx packages/referee/src/register-rulebook.ts tokyo-sprint-demo` (it prints `registered tokyo-sprint-demo 0x…`).
3. Re-run `demo-check` until it prints PASS.

- [ ] **Step 2: Start the referee (terminal 1, leave it running)**
Run: `npx tsx packages/referee/src/cli.ts start`
Expected: `referee watching registry 0x…`. Keep this terminal open until step 4.

- [ ] **Step 3: Run one demo take (terminal 2)**
Run: `npx tsx packages/bot/src/demo.ts`
Expected:
- the line `Basanos demo: both challenge accounts are burners operated by the builder …`;
- a `granted the referee place + cancel on BTC-PERP` line for each account not yet granted (B; A was granted by spike:11);
- two `run <id> on Tokyo Sprint · Demo` lines, then `runs …` status lines every 2 s;
- within about 15 minutes, both runs leave `Active`. Terminal 1 shows the referee's `breach … cancelling and closing`, its close tx links, then `FAILED (DailyLoss)` or `PASSED`. The take ends with `take 1 recorded in docs/evidence/demo-takes.json`.

If it prints a `STOP:` line instead, stop and report; no second take without a new GO:
- **`STOP:` before any `run <id>` line:** the take started nothing. Nothing was re-sent and nothing needs cleaning up.
- **`STOP: take aborted: …`:** a write failed after a run started. Nothing was re-sent and no run was voided. The demo waits for the referee's verdicts, at most the 900 s time limit + 300 s, so keep terminal 1 running until it exits. It records the take in `docs/evidence/demo-aborted.json` (leave it for the orchestrator) and exits 1.

- [ ] **Step 4: Stop the referee and check the rehearsal (the gate)**
Stop terminal 1 with Ctrl+C.
Run: `npx tsx packages/referee/src/check-rehearsal.ts`
Expected: PASS — `PASS rehearsal (first verdict run <id>)`.

- [ ] **Step 5: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): referee rehearsal — first real Basanos verdicts on Hideki`

---

### Task 11: Demo sizing from real equity — `demo-check` reads A's and B's live equity (or `--equity`) and checks the pool minimum

**Files:**
- Create: `packages/bot/src/sizing.ts`
- Modify: `packages/bot/src/demo-check.ts`
- Test: `packages/bot/test/sizing.test.ts`

**Depends on:** Task 9, spike:Task 2, spike:Task 4, Task 2, spike:Task 3, spike:Task 1, Task 6, Task 8, spike:Task 6
**Effort:** low
**Provides:** `parseUsdso(text: string): bigint`, `demoEquity(flagValue: string | null, live: readonly bigint[]): bigint | null`, `minEquityFor(book: BookParams, leverageX: number, mark: bigint, baseDecimals: number): bigint`, `demoSize(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): { qty: bigint; problem: string | null }`, `CLI: npx tsx packages/bot/src/demo-check.ts [--equity <USDso>] -> PASS demo-check, or FAIL with a recommended demo target (sizes from A's and B's live equity; checks the pool minimum)`
**Requires:** `BTC_POOL`, `CHAIN (hidekiTestnet, id 50383)`, `HIDEKI_ADDRESSES`, `INDEXER_URL`, `MARGIN_BANK`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `costBpsVsMark(isBid: boolean, reference: bigint, average: bigint): number`, `parseTape(raw: unknown): TapePoint[]`, `recommendDemoTargetBps(roundTripEqBps: number): number`, `roundTripEquityBps(oneWayCostBps: number, leverageX: number): number`, `simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint }`, `loadDotEnv(path?: string): boolean`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `repoPath(rel: string): string`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `makePublicClient(url: string): PublicClient`, `readBook(client: PublicClient): Promise<BookParams>`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`

Why (guide, 2026-11-11): B14 may be resolved with 100–200 USDso per account instead of the 1,000-USDso voucher. Sizing today:
- **The demo runner and the bot already size from live equity:** `demo.ts` and `bot.ts` call `quantityForLeverage(totalEquity, 12, …)`. At 100–200 USDso that gives 0.0162–0.0324 BTC, 125–250× the pool minimum of 0.00013 BTC.
- **spike:11's skeleton** opens exactly the pool minimum, so it works at any equity.
- **The one hard-coded spot is Task 9's `demo-check.ts`:** it sizes its quotes and the tape simulation from a fixed 1,000 USDso.

This task makes `demo-check` size from the smaller live equity of A and B, or from `--equity <USDso>`. It stops with a clear message when neither account holds equity. It refuses a size below the pool minimum and says how much equity is needed: about 0.80 USDso at 12× and a 74k mark.

Checked read-only on Hideki on 2026-11-11, in scratch:
- `--equity 150` sizes 2,441,000 (0.02441 BTC) at 12×.
- Without the flag, against the real A and B addresses, it prints `FAIL demo-check: accounts A and B hold no equity yet; fund them, or pass --equity <USDso>`.

- [ ] **Step 1: Write the failing test**

`packages/bot/test/sizing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { demoEquity, demoSize, minEquityFor, parseUsdso } from "../src/sizing";

const E18 = 10n ** 18n;
// BTC-PERP on 2026-11-11: tick 0.1, minimum 0.00013 BTC (13,000 at 8 decimals), lot 0.00001 BTC.
const book = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };
const mark = 74_000n * E18;

describe("demo sizing from real equity", () => {
  it("reads --equity first, else the smaller funded live equity, else nothing", () => {
    expect(parseUsdso("150")).toBe(150n * E18);
    expect(parseUsdso("150.25")).toBe(150n * E18 + 25n * 10n ** 16n);
    expect(() => parseUsdso("1e3")).toThrow(/USDso/);
    expect(demoEquity("120", [500n * E18])).toBe(120n * E18);
    expect(demoEquity(null, [200n * E18, 150n * E18])).toBe(150n * E18);
    expect(demoEquity(null, [0n, 150n * E18])).toBe(150n * E18);
    expect(demoEquity(null, [0n, 0n])).toBeNull();
  });
  it("sizes 100–200 USDso at 12x far above the 0.00013 BTC minimum", () => {
    const at100 = demoSize(100n * E18, 12, mark, 8, book);
    expect(at100.problem).toBeNull();
    expect(at100.qty).toBe(1_621_000n);
    expect(demoSize(200n * E18, 12, mark, 8, book).qty).toBe(3_243_000n);
  });
  it("refuses a size under the pool minimum and says how much equity is needed", () => {
    expect(minEquityFor(book, 12, mark, 8)).toBe(801_666_666_666_666_667n);
    const tiny = demoSize(E18 / 2n, 12, mark, 8, book);
    expect(tiny.qty < book.minQuantity).toBe(true);
    expect(tiny.problem).toMatch(/below the pool minimum 13000/);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/bot -- test/sizing.test.ts`
Expected: FAIL — `Cannot find module '../src/sizing'`.

- [ ] **Step 3: Write the sizing helpers**

`packages/bot/src/sizing.ts`:
```ts
// Demo sizing from real equity (guide, 2026-11-11). The demo accounts may hold 100–200 USDso instead of the
// 1,000-USDso voucher, so nothing assumes 1,000, and every size is checked against the pool's minimum order.
import { quantityForLeverage, type BookParams } from "@basanos/core";

const E18 = 10n ** 18n;

/** "150" or "150.25" USDso -> wei (18 decimals). */
export function parseUsdso(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) throw new Error(`not a USDso amount: ${text}`);
  return BigInt(m[1] ?? "0") * E18 + BigInt((m[2] ?? "").padEnd(18, "0"));
}

/** --equity wins; otherwise the smaller live equity of the demo accounts that hold any; null when neither does. */
export function demoEquity(flagValue: string | null, live: readonly bigint[]): bigint | null {
  if (flagValue !== null) return parseUsdso(flagValue);
  const funded = live.filter((e) => e > 0n);
  return funded.length === 0 ? null : funded.reduce((a, b) => (a < b ? a : b));
}

/** The least equity (wei) whose leveraged size reaches the pool minimum. */
export function minEquityFor(book: BookParams, leverageX: number, mark: bigint, baseDecimals: number): bigint {
  const unit = 10n ** BigInt(baseDecimals);
  const minNotional = (book.minQuantity * mark + unit - 1n) / unit;
  return (minNotional + BigInt(leverageX) - 1n) / BigInt(leverageX);
}

/** The demo order size for an equity, or why it cannot trade. */
export function demoSize(
  equity: bigint,
  leverageX: number,
  mark: bigint,
  baseDecimals: number,
  book: BookParams,
): { qty: bigint; problem: string | null } {
  const qty = quantityForLeverage(equity, leverageX, mark, baseDecimals, book);
  if (qty >= book.minQuantity) return { qty, problem: null };
  return {
    qty,
    problem: `the demo size ${qty} is below the pool minimum ${book.minQuantity}; at ${leverageX}x the account needs at least ${minEquityFor(book, leverageX, mark, baseDecimals)} wei of equity`,
  };
}
```

- [ ] **Step 4: Size the demo check from real equity**

Replace `packages/bot/src/demo-check.ts` with:
```ts
// Decides whether the demo target is trustworthy given real trading costs (spec §5). Read-only.
// Sizes from the demo accounts' real equity (or --equity <USDso>), never from a fixed 1,000 USDso, and checks the
// size against the pool's minimum order (0.00013 BTC on BTC-PERP).
import { existsSync, readFileSync } from "node:fs";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { BTC_POOL, CHAIN, HIDEKI_ADDRESSES, INDEXER_URL, MARGIN_BANK, readSnapshot } from "@basanos/core";
import { costBpsVsMark, parseTape, recommendDemoTargetBps, roundTripEquityBps, simulateTape } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { readBook } from "./actions";
import { demoEquity, demoSize } from "./sizing";

loadDotEnv();
const rb = loadRulebook("tokyo-sprint-demo");
const LEVERAGE = 12;
const flagAt = process.argv.indexOf("--equity");
const equityFlag = flagAt >= 0 ? (process.argv[flagAt + 1] ?? "") : null;
const client = makePublicClient(rpcHttp());
const markets = new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
const g1aPath = repoPath("docs/evidence/g1a-close.json");
const entryCost = existsSync(g1aPath) ? Number((JSON.parse(readFileSync(g1aPath, "utf8")) as { entry?: { costBps?: number } }).entry?.costBps ?? 0) : 0;
const book = await readBook(client);
const accounts = equityFlag === null ? [requireAddress("ACCOUNT_A_ADDRESS"), requireAddress("ACCOUNT_B_ADDRESS")] : [];
const snap = await readSnapshot(client, accounts, BTC_POOL);
let equity: bigint | null;
try {
  equity = demoEquity(equityFlag, snap.accounts.map((a) => a.totalEquity));
} catch (e) {
  console.log(`FAIL demo-check: ${(e as Error).message}`);
  process.exit(1);
}
if (equity === null) {
  console.log("FAIL demo-check: accounts A and B hold no equity yet; fund them, or pass --equity <USDso> (for example --equity 150)");
  process.exit(1);
}
const size = demoSize(equity, LEVERAGE, snap.markPrice, rb.market.baseDecimals, book);
if (size.problem) {
  console.log(`FAIL demo-check: ${size.problem}`);
  process.exit(1);
}
const qty = size.qty;
const live: number[] = [];
for (const isBid of [true, false]) {
  const q = await markets.client.quotePerpClose({ pool: BTC_POOL, marginBank: MARGIN_BANK, isBid, quantity: qty });
  if (q.priceable && q.averagePrice !== null && q.fillableSize === q.quantity) live.push(costBpsVsMark(isBid, q.referencePrice, q.averagePrice));
  else live.push(Number.POSITIVE_INFINITY);
}
const oneWay = Math.max(entryCost, ...live);
if (!Number.isFinite(oneWay)) {
  console.log(`FAIL demo-check: the book is too thin to fill the demo size ${qty} on both sides (live buy ${live[0]}, live sell ${live[1]}); retry when the book refills, or lower the demo leverage`);
  process.exit(1);
}
const roundTripEq = roundTripEquityBps(oneWay, LEVERAGE);
const halfTarget = rb.profitTargetBps / 2;
const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
const sim = simulateTape(rb, tape, { leverageX: LEVERAGE, startEquity: equity, lotSize: book.lotSize, entryCostBps: oneWay, exitCostBps: oneWay });
const costOk = roundTripEq <= halfTarget;
const tapeOk = sim.long.outcome === "target" || sim.short.outcome === "target";
console.log(`demo size ${qty} (${LEVERAGE}x on ${equity} wei of equity, ${equityFlag === null ? "the smaller live equity of A and B" : "from --equity"}); one-way cost ${oneWay} bps (g1a entry ${entryCost}, live buy ${live[0]}, live sell ${live[1]})`);
console.log(`round trip ${roundTripEq} equity bps vs half target ${halfTarget}: ${costOk ? "ok" : "too costly"}`);
console.log(`tape with costs: long ${sim.long.outcome}, short ${sim.short.outcome}`);
if (costOk && tapeOk) {
  console.log("PASS demo-check");
  process.exit(0);
}
console.log(`FAIL demo-check: raise profitTargetBps in rulebooks/tokyo-sprint-demo.json to ${recommendDemoTargetBps(roundTripEq)} and register it`);
process.exit(1);
```

- [ ] **Step 5: Type-check (Task 10 runs the check live)**
Run: `npm run typecheck -w @basanos/bot`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 6: Run the test (the gate)**
Run: `npm test -w @basanos/bot -- test/sizing.test.ts`
Expected: PASS — `3 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `fix(bot): demo-check sizes from the accounts' live equity and checks the pool minimum`

---

### Task 12: The bot and the demo test funded accounts, not vouchers; the demo keeps a one-account fallback

**Files:**
- Modify: `packages/bot/src/actions.ts`
- Modify: `packages/bot/src/bot.ts`
- Modify: `packages/bot/src/demo.ts`
- Test: `packages/bot/test/readiness.test.ts`

**Depends on:** Task 8, spike:Task 2, spike:Task 6, contracts:Task 8, spike:Task 4, spike:Task 1, Task 3, spike:Task 10, spike:Task 3, Task 6
**Effort:** medium
**Model tier:** top
**Provides:** `interface Preflight { account: Address; stt: bigint; sttOk: boolean; voucherClaimed: boolean; unlockedCollateral: bigint; funded: boolean; flat: boolean; equity: bigint }`, `DEMO_MIN_UNLOCKED = 5 USDso (5_000_000_000_000_000_000n)`, `preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei?: bigint): Promise<Preflight>`, `notReady(pf: Preflight): string[]`, `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--wait-min 10] [--one-account [--pass-side long|short]] (two funded accounts by default; --one-account is the A-only fallback)`, `CLI: npx tsx packages/bot/src/bot.ts start [--rulebook <name>] [--side short|long] [--leverage 12] | breach [--leverage 16] (funded preflight)`
**Requires:** `BTC_POOL`, `CANCEL_ORDER_FOR_SELECTOR`, `CHAIN (hidekiTestnet, id 50383)`, `HIDEKI_ADDRESSES`, `INDEXER_URL`, `MARGIN_BANK`, `OPERATOR_REGISTRY`, `ORDER_TYPE_IOC = 2`, `PLACE_ORDER_FOR_SELECTOR`, `STT_WRITE_HEADROOM = 600_000_000_000_000_000n`, `alignUp(x: bigint, step: bigint): bigint`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `marginBankAbi`, `perpPoolAbi`, `planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `repoPath(rel: string): string`, `jsonSafe(value: unknown): unknown`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `rulebookId(rb: Rulebook): Hex`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string }`, `loadDotEnv(path?: string): boolean`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `makePublicClient(url: string): PublicClient`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `explorerTx(hash: Hex): string`

Why (guide plan-bugs P1 and P3, 2026-11-12):
- **The gate:** Task 8's `preflight()` reports `voucherClaimed`, and `demo.ts` and `bot.ts start` stop unless it is true. No account will ever hold a voucher, because `claim()` reverts chain-wide (B14).
- **The funding:** both accounts are funded instead. Account A held 100 USDso and moved about 50 to B, organizer-approved; spike:18 and spike:19 deposit each account's own USDso into its own MarginBank balance.

This task makes four changes:
- **`preflight()`** adds `unlockedCollateral` (`MarginBank.getAccountState().unlockedCollateralBalance`) and `funded` (≥ `DEMO_MIN_UNLOCKED`, 5 USDso, ample for a 12× size above the 0.00013 BTC minimum). It keeps `voucherClaimed` for the record.
- **`notReady()`** lists what is missing (STT, funded, flat). It never asks for a voucher, and it points an unfunded account at its deposit task.
- **The two-account demo is primary again:** A long, B short, 12× each, sized from live equity.
- **`--one-account` is a fallback only,** for the case where B cannot be funded. A takes run 1, a FAIL on demand (12× long, then size past the 15× exposure cap; the market's 40× cap leaves room). Once the referee has closed it and A is flat, A takes run 2, the PASS attempt: 12× on `--pass-side`, held until the referee locks the target or a rule ends it.
  - A PASS is not guaranteed with one account, which is why two accounts stay primary.
  - Demo takes record `mode`.

- [ ] **Step 1: Write the failing test**

`packages/bot/test/readiness.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEMO_MIN_UNLOCKED, notReady, type Preflight } from "../src/actions";

const E18 = 10n ** 18n;
const ready: Preflight = {
  account: "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1",
  stt: 1n * E18,
  sttOk: true,
  voucherClaimed: false,
  unlockedCollateral: 50n * E18,
  funded: true,
  flat: true,
  equity: 50n * E18,
};

describe("demo readiness (funded, not voucher-backed)", () => {
  it("accepts a funded, flat account with STT and no voucher", () => {
    expect(notReady(ready)).toEqual([]);
    expect(DEMO_MIN_UNLOCKED).toBe(5n * E18);
  });
  it("names each missing prerequisite and points an unfunded account at its deposit", () => {
    const unfunded = notReady({ ...ready, unlockedCollateral: 0n, funded: false });
    expect(unfunded).toHaveLength(1);
    expect(unfunded[0]).toMatch(/deposit the account's own wallet USDso first/);
    expect(unfunded[0]).not.toMatch(/claim/);
    expect(notReady({ ...ready, sttOk: false, stt: 0n, flat: false })).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/bot -- test/readiness.test.ts`
Expected: FAIL — `2 failed (2)` (`notReady` and `DEMO_MIN_UNLOCKED` are not exported yet).

- [ ] **Step 3: Report funded in the preflight**

Replace `packages/bot/src/actions.ts` with:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createWalletClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  INDEXER_URL,
  MARGIN_BANK,
  OPERATOR_REGISTRY,
  ORDER_TYPE_IOC,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  basanosRegistryAbi,
  marginBankAbi,
  perpPoolAbi,
  planOpen,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { repoPath } from "@basanos/core/node";
import { jsonSafe, txRecord, type TxRecord } from "@basanos/referee";

export interface Preflight {
  account: Address;
  stt: bigint;
  sttOk: boolean;
  voucherClaimed: boolean;
  /** MarginBank getAccountState().unlockedCollateralBalance: the account's own deposited USDso not locked in a position. */
  unlockedCollateral: bigint;
  /** unlockedCollateral at or above what a demo run needs (DEMO_MIN_UNLOCKED unless the caller passes another need). */
  funded: boolean;
  flat: boolean;
  equity: bigint;
}

/** The least unlocked MarginBank margin a demo run needs: its 12x size must clear the 0.00013 BTC pool minimum
 *  (about 0.8 USDso of equity) with room for costs. */
export const DEMO_MIN_UNLOCKED = 5n * 10n ** 18n;

/** Inferred return type: bound to CHAIN and the key's account. */
export function makeAccountWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type AccountWallet = ReturnType<typeof makeAccountWallet>;

export function makeMarkets(pk: Hex): SomniaMarkets {
  return new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES, privateKey: pk });
}

/** Reads only. Never claims a voucher: claim() reverts chain-wide (B14), so an account is ready when it is FUNDED,
 *  with its own wallet USDso deposited into its own MarginBank balance (spike:18 for A, spike:19 for B). */
export async function preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei: bigint = DEMO_MIN_UNLOCKED): Promise<Preflight> {
  const [stt, voucher, snap, state] = await Promise.all([
    client.getBalance({ address: account }),
    markets.client.getPerpVoucher(MARGIN_BANK, account),
    readSnapshot(client, [account], BTC_POOL),
    client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [account] }),
  ]);
  const a = snap.accounts[0];
  return {
    account,
    stt,
    sttOk: stt >= STT_WRITE_HEADROOM,
    voucherClaimed: voucher?.claimed ?? false,
    unlockedCollateral: state.unlockedCollateralBalance,
    funded: state.unlockedCollateralBalance >= needWei,
    flat: a ? a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0 : false,
    equity: a?.totalEquity ?? 0n,
  };
}

/** Why an account cannot start a demo run, or [] when it can. A voucher is never required. */
export function notReady(pf: Preflight): string[] {
  const p: string[] = [];
  if (!pf.sttOk) p.push(`STT ${pf.stt} is below the 0.6 write headroom (top up from the Tokyo faucet)`);
  if (!pf.funded) {
    p.push(
      `unlocked MarginBank margin is ${pf.unlockedCollateral} wei, below what a demo run needs; deposit the account's own wallet USDso first (deposit.ts: spike:18 for A, spike:19 for B)`,
    );
  }
  if (!pf.flat) p.push("the account is not flat (flatten it in the dreamDEX app first)");
  return p;
}

export async function readBook(client: PublicClient): Promise<BookParams> {
  const p = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
  return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
}

/** Grants the referee place + cancel on the BTC pool only, if not already granted. */
export async function ensureGrant(client: PublicClient, markets: SomniaMarkets, owner: Address, referee: Address): Promise<TxRecord | null> {
  const has = async (selector: Hex) =>
    client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
  if ((await has(PLACE_ORDER_FOR_SELECTOR)) && (await has(CANCEL_ORDER_FOR_SELECTOR))) return null;
  const r = await markets.trader.setOperatorApprovalForPool({
    pool: BTC_POOL,
    operator: referee,
    selectors: [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR],
    approved: true,
    operatorRegistry: OPERATOR_REGISTRY,
  });
  return txRecord("grant", r.receipt);
}

export function runIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], registry: Address): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") return ev.args.runId;
    } catch {
      // another registry event
    }
  }
  return null;
}

/** The account itself enrolls (msg.sender == account); the registry reads its start equity in the same tx. */
export async function startRunAs(wallet: AccountWallet, client: PublicClient, registry: Address, rulebookId: Hex): Promise<{ runId: bigint; tx: TxRecord }> {
  const hash = await wallet.writeContract({
    address: registry,
    abi: basanosRegistryAbi,
    functionName: "startRun",
    args: [wallet.account.address, rulebookId],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const runId = runIdFromLogs(receipt.logs, registry);
  if (runId === null) throw new Error(`startRun emitted no RunStarted: ${hash}`);
  return { runId, tx: txRecord("startRun", receipt) };
}

/** Extra size so the account's notional strictly exceeds targetX x equity (the on-demand exposure breach). */
export function breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint {
  const oneBase = 10n ** BigInt(baseDecimals);
  const abs = currentSize < 0n ? -currentSize : currentSize;
  const targetNotional = equity * BigInt(targetX);
  const current = (abs * mark) / oneBase;
  const neededNotional = targetNotional > current ? targetNotional - current : 0n;
  const qty = alignUp((neededNotional * oneBase) / mark + 1n, book.lotSize);
  return qty < book.minQuantity ? book.minQuantity : qty;
}

export async function openIoc(markets: SomniaMarkets, client: PublicClient, isBid: boolean, quantity: bigint): Promise<TxRecord> {
  const book = await readBook(client);
  const snap = await readSnapshot(client, [], BTC_POOL);
  if (!snap.markOk) throw new Error("BTC-PERP has no fresh mark");
  const plan = planOpen(isBid, quantity, snap.markPrice, book, 20);
  const r = await markets.trader.placePerpOrder({ pool: BTC_POOL, isBid, price: plan.price, quantity: plan.quantity, orderType: ORDER_TYPE_IOC });
  return txRecord(isBid ? "open long" : "open short", r.receipt);
}

export const DEMO_TAKES = "docs/evidence/demo-takes.json";

export function appendDemoTake(take: Record<string, unknown>, path: string = repoPath(DEMO_TAKES)): number {
  const all = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
  const n = all.length + 1;
  all.push(jsonSafe({ take: n, ...take }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
  return n;
}
```

- [ ] **Step 4: Gate the bot and the demo on readiness; add the one-account fallback**

Replace `packages/bot/src/bot.ts` with:
```ts
// The scripted challenger (account B). It signs as itself; the referee's grant is the only delegation.
import { BTC_POOL, readSnapshot, rulebookId, quantityForLeverage } from "@basanos/core";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, notReady, openIoc, preflight, readBook, startRunAs } from "./actions";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? (rest[i + 1] as string) : fallback;
};
const pk = requirePrivateKey("ACCOUNT_B_PK");
const wallet = makeAccountWallet(pk, rpcHttp());
const account = wallet.account.address;
const client = makePublicClient(rpcHttp());
const markets = makeMarkets(pk);
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");

if (cmd === "start") {
  const name = opt("--rulebook", "tokyo-sprint-demo") as keyof typeof RULEBOOK_FILES;
  const side = opt("--side", "short");
  const leverage = Number(opt("--leverage", "12"));
  const pf = await preflight(client, markets, account);
  const problems = notReady(pf);
  if (problems.length > 0) {
    console.error(`bot preflight failed: ${problems.join("; ")}`);
    process.exit(1);
  }
  const grant = await ensureGrant(client, markets, account, referee);
  if (grant) console.log(`grant ${grant.explorer}`);
  const { runId, tx } = await startRunAs(wallet, client, registry, rulebookId(loadRulebook(name)));
  console.log(`run ${runId} started ${tx.explorer}`);
  const snap = await readSnapshot(client, [], BTC_POOL);
  const qty = quantityForLeverage(pf.equity, leverage, snap.markPrice, 8, await readBook(client));
  const open = await openIoc(markets, client, side === "long", qty);
  console.log(`${open.label} ${qty} ${open.status} ${open.explorer}`);
  process.exit(0);
} else if (cmd === "breach") {
  const leverage = Number(opt("--leverage", "16"));
  const snap = await readSnapshot(client, [account], BTC_POOL);
  const a = snap.accounts[0];
  if (!a || a.size === 0n) {
    console.error("bot has no position to extend");
    process.exit(1);
  }
  const add = breachQuantity(a.size, a.totalEquity, leverage, snap.markPrice, 8, await readBook(client));
  const tx = await openIoc(markets, client, a.size > 0n, add);
  console.log(`exposure breach: +${add} ${tx.status} ${tx.explorer}`);
  process.exit(0);
} else {
  console.error("usage: bot.ts start [--rulebook <name>] [--side short|long] [--leverage 12] | breach [--leverage 16]");
  process.exit(2);
}
```

Replace `packages/bot/src/demo.ts` with:
```ts
// The demo runner. Primary: both builder-operated accounts take Tokyo Sprint · Demo with opposite 12x positions.
// Fallback (--one-account, only if account B cannot be funded): account A takes two runs in sequence. Run 1 is a FAIL
// on demand: 12x long, then size past the 15x exposure cap. Run 2 is the PASS attempt: 12x (--pass-side long|short),
// held until the referee locks the target or a rule ends it. A PASS is not guaranteed with one account, which is why
// the two-account demo is primary. Accounts must be FUNDED (own USDso deposited, spike:18 / spike:19); no voucher.
// The referee daemon (packages/referee/src/cli.ts start) must already be running in another terminal.
import type { Address, Hex } from "viem";
import { BTC_POOL, RULE_NAMES, RUN_STATUS, basanosRegistryAbi, explorerTx, quantityForLeverage, readSnapshot, rulebookId } from "@basanos/core";
import { loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, type TxRecord } from "@basanos/referee";
import { appendDemoTake, breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, notReady, openIoc, preflight, readBook, startRunAs } from "./actions";

loadDotEnv();
const argv = process.argv.slice(2);
const manualA = argv.includes("--a-manual");
const oneAccount = argv.includes("--one-account");
const passSide = argv[argv.indexOf("--pass-side") + 1] === "short" ? "short" : "long";
const waitMin = Number(argv[argv.indexOf("--wait-min") + 1] ?? "10") || 10;
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");
const rb = loadRulebook("tokyo-sprint-demo");
const id: Hex = rulebookId(rb);
const txs: TxRecord[] = [];
const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

say(
  oneAccount
    ? "Basanos demo (one-account fallback): account A is a burner operated by the builder; run 1 FAIL by exposure, run 2 the PASS attempt."
    : "Basanos demo: both challenge accounts are burners operated by the builder (A human-driven, B scripted).",
);
const accounts = (oneAccount ? (["ACCOUNT_A_PK"] as const) : (["ACCOUNT_A_PK", "ACCOUNT_B_PK"] as const)).map((name) => {
  const pk = requirePrivateKey(name);
  const wallet = makeAccountWallet(pk, rpcHttp());
  return { name, wallet, markets: makeMarkets(pk), address: wallet.account.address as Address };
});
for (const a of accounts) {
  const pf = await preflight(client, a.markets, a.address);
  say(`${a.name} ${a.address}: stt ${pf.stt} unlocked margin ${pf.unlockedCollateral} flat ${pf.flat} equity ${pf.equity}`);
  const problems = notReady(pf);
  if (problems.length > 0) {
    say(`STOP: ${a.name} is not ready: ${problems.join("; ")}. No voucher is ever claimed here.`);
    process.exit(1);
  }
  const g = await ensureGrant(client, a.markets, a.address, referee);
  if (g) txs.push(g);
}
const statusOf = async (runId: bigint) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
const label = (r: Awaited<ReturnType<typeof statusOf>> | undefined) => (r ? `${RUN_STATUS[r.status] ?? r.status}${r.rule ? `/${RULE_NAMES[r.rule]}` : ""}` : "?");

if (oneAccount) {
  const [accA] = accounts;
  if (!accA) throw new Error("account A expected");
  const book = await readBook(client);
  const waitVerdict = async (runId: bigint) => {
    for (;;) {
      const r = await statusOf(runId);
      say(`run ${runId}: ${label(r)}`);
      if (r && r.status !== 1) return r;
      await new Promise((res) => setTimeout(res, 2_000));
    }
  };
  const waitFlat = async () => {
    const until = Date.now() + 5 * 60_000;
    for (;;) {
      const a = (await readSnapshot(client, [accA.address], BTC_POOL)).accounts[0];
      if (a && a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0) return;
      if (Date.now() > until) throw new Error("account A is not flat 5 min after run 1's verdict");
      await new Promise((res) => setTimeout(res, 3_000));
    }
  };
  const runIds: bigint[] = [];
  // Run 1: FAIL on demand by exposure.
  const r1 = await startRunAs(accA.wallet, client, registry, id);
  runIds.push(r1.runId);
  txs.push(r1.tx);
  say(`run 1 (${r1.runId}) on ${rb.label}: ${r1.tx.explorer}`);
  const s1 = await readSnapshot(client, [accA.address], BTC_POOL);
  txs.push(await openIoc(accA.markets, client, true, quantityForLeverage(s1.accounts[0]?.totalEquity ?? 0n, 12, s1.markPrice, 8, book)));
  const s1b = (await readSnapshot(client, [accA.address], BTC_POOL)).accounts[0];
  if (s1b && s1b.size !== 0n) {
    txs.push(await openIoc(accA.markets, client, true, breachQuantity(s1b.size, s1b.totalEquity, 16, s1.markPrice, 8, book)));
    say("run 1: size added past the 15x exposure cap (FAIL on demand)");
  }
  const v1 = await waitVerdict(r1.runId);
  await waitFlat();
  // Run 2: the PASS attempt.
  const r2 = await startRunAs(accA.wallet, client, registry, id);
  runIds.push(r2.runId);
  txs.push(r2.tx);
  say(`run 2 (${r2.runId}) on ${rb.label}, ${passSide} 12x: ${r2.tx.explorer}`);
  const s2 = await readSnapshot(client, [accA.address], BTC_POOL);
  txs.push(await openIoc(accA.markets, client, passSide === "long", quantityForLeverage(s2.accounts[0]?.totalEquity ?? 0n, 12, s2.markPrice, 8, book)));
  const v2 = await waitVerdict(r2.runId);
  const take = appendDemoTake({
    at: new Date().toISOString(),
    mode: "one-account",
    rulebook: { id, label: rb.label },
    runs: [
      { runId: r1.runId, account: accA.address, status: RUN_STATUS[v1.status], rule: RULE_NAMES[v1.rule] },
      { runId: r2.runId, account: accA.address, status: RUN_STATUS[v2.status], rule: RULE_NAMES[v2.rule], side: passSide },
    ],
    breachedOnDemand: true,
    txs,
  });
  say(`take ${take} recorded in docs/evidence/demo-takes.json (one-account fallback)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  process.exit(0);
}

const runs: bigint[] = [];
for (const a of accounts) {
  const { runId, tx } = await startRunAs(a.wallet, client, registry, id);
  runs.push(runId);
  txs.push(tx);
  say(`${a.name} run ${runId} on ${rb.label}: ${tx.explorer}`);
}
const book = await readBook(client);
const snap = await readSnapshot(client, accounts.map((a) => a.address), BTC_POOL);
const [accA, accB] = accounts;
if (!accA || !accB) throw new Error("two accounts expected");
const qtyB = quantityForLeverage(snap.accounts[1]?.totalEquity ?? 0n, 12, snap.markPrice, 8, book);
txs.push(await openIoc(accB.markets, client, false, qtyB));
say(`B short ${qtyB} at 12x`);
if (manualA) {
  say("A: open the long from the Basanos terminal now (12x).");
} else {
  const qtyA = quantityForLeverage(snap.accounts[0]?.totalEquity ?? 0n, 12, snap.markPrice, 8, book);
  txs.push(await openIoc(accA.markets, client, true, qtyA));
  say(`A long ${qtyA} at 12x`);
}
const openedAt = Date.now();
let breached = false;
for (;;) {
  const [ra, rbRun] = await Promise.all(runs.map((r) => statusOf(r)));
  const states = [ra, rbRun].map((r) => label(r));
  say(`runs ${runs.join(", ")}: ${states.join(" | ")}`);
  if (ra && rbRun && ra.status !== 1 && rbRun.status !== 1) break;
  if (!breached && Date.now() - openedAt > waitMin * 60_000 && rbRun?.status === 1) {
    say("market still — take aborted: exposure breach on B (FAIL on demand); A resolves or hits its time limit");
    const s = await readSnapshot(client, [accB.address], BTC_POOL);
    const b = s.accounts[0];
    if (b && b.size !== 0n) txs.push(await openIoc(accB.markets, client, b.size > 0n, breachQuantity(b.size, b.totalEquity, 16, s.markPrice, 8, book)));
    breached = true;
  }
  await new Promise((r) => setTimeout(r, 2_000));
}
const final = await Promise.all(runs.map((r) => statusOf(r)));
const take = appendDemoTake({
  at: new Date().toISOString(),
  mode: "two-account",
  rulebook: { id, label: rb.label },
  runs: runs.map((r, i) => ({ runId: r, account: accounts[i]?.address, status: RUN_STATUS[final[i]?.status ?? 0], rule: RULE_NAMES[final[i]?.rule ?? 0] })),
  breachedOnDemand: breached,
  txs,
});
say(`take ${take} recorded in docs/evidence/demo-takes.json`);
for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
process.exit(0);
```

- [ ] **Step 5: Type-check (the demo runs live in referee:10 and ship:3)**
Run: `npm run typecheck -w @basanos/bot`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 6: Run the test (the gate)**
Run: `npm test -w @basanos/bot -- test/readiness.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 7: Commit (kernel-performed — no agent runs this)**
Message: `fix(bot): readiness tests funded accounts, not vouchers; the demo keeps a one-account fallback`

---

### Task 13: Closeable equity — the core reads the book, the evaluator judges closeable equity, opens are capped from the book (P5)

**Files:**
- Create: `packages/core/src/book.ts`
- Modify: `packages/core/src/evaluate.ts`
- Modify: `packages/core/src/demo-math.ts`
- Test: `packages/core/test/book.test.ts`
- Test: `packages/core/test/evaluate-closeable.test.ts`
- Test: `packages/core/test/demo-closeable.test.ts`

**Depends on:** Task 1, Task 2, spike:Task 1, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6
**Effort:** medium
**Model tier:** top
**Provides:** `interface BookLevel { price: bigint; quantity: bigint }`, `interface BookSides { bids: readonly BookLevel[]; asks: readonly BookLevel[] } (best level first: bids descending, asks ascending)`, `interface BookRead extends BookSides { blockNumber: bigint }`, `BOOK_DEPTH = 20`, `OPEN_MARGIN_BPS = 20`, `bookCall(pool: Address, depth?: number): { to: Address; data: Hex } (one Multicall3 call: block number and both sides)`, `decodeBook(result: Hex): BookRead | null`, `readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth?: number): Promise<BookRead | null>`, `closeableEquity(totalEquity: bigint, size: bigint, mark: bigint, book: BookSides, baseDecimals: number): bigint | null`, `averageFill(isBid: boolean, quantity: bigint, book: BookSides): bigint | null`, `fillableAt(isBid: boolean, limit: bigint, book: BookSides): bigint`, `planOpenFromBook(isBid: boolean, quantity: bigint, book: BookSides, params: BookParams, marginBps?: number): OrderPlan`, `interface MarketView { timestamp: bigint; markOk: boolean; markPrice: bigint; book?: BookSides | null }`, `interface Evaluation { state: RunState; verdict: Verdict; exposureX: number | null; judgedEquity: bigint | null }`, `equityToJudge(acct: AccountSnapshot, market: MarketView, baseDecimals: number): bigint | null`, `evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation (judges closeable equity when market.book is given; omitted, at the mark)`, `DEMO_LEVERAGE_X = 5`, `roundTripSpreadBps(buyAverage: bigint, sellAverage: bigint): number`
**Requires:** `MULTICALL3`, `multicall3Abi`, `perpPoolAbi`, `BTC_POOL`, `alignDown(x: bigint, step: bigint): bigint`, `alignUp(x: bigint, step: bigint): bigint`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `interface OrderPlan { isBid: boolean; quantity: bigint; price: bigint }`, `iocPrice(isBid: boolean, mark: bigint, tickSize: bigint, slippageBps: number): bigint`, `planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null`, `planOpen(isBid: boolean, quantity: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan`, `CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100]`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`, `evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation`, `initRunState(startTime: bigint, startEquity: bigint): RunState`, `interface RunState { startTime: bigint; startEquity: bigint; hwm: bigint; dayStart: bigint; day: bigint }`, `parseTape(raw: unknown): TapePoint[]`, `simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint }`, `roundTripEquityBps(oneWayCostBps: number, leverageX: number): number`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `repoPath(rel: string): string`

Why (guide plan-bug P5 and the architect's ruling, 2026-11-12):
- **The finding (guide plan-bug P5, 2026-11-12):** spike:11 stopped before its live run. Its opening IOC buy at mark + 20 bps simulated a revert (`0xd48c4403`) because the whole BTC-PERP book trades above the on-chain mark. The guide measured it read-only (8 samples): best bid +18.1 to +19.9 bps and best ask +19.5 to +21.7 bps above `getMarkPrice`, spread 0.2 to 2.3 bps. The architect's re-read about 13:00 WAT found a spread of 1.2 to 3.6 bps and zero taker and maker fees (`getPerpPoolParameters`).
- **The design consequence:** MarginBank equity is marked at the mark, so opening a position books an instant paper PnL of about ±19 bps × leverage.
  - A fresh 12× long reads −252 bps: an unearned DailyLoss on the demo's 50 bps floor, and on the standard rulebook's 150.
  - A fresh 12× short reads +228 bps: a phantom target that the lock guard and the registry's flat check would then refuse.
- **The ruling: every rule judges *closeable equity*.** That is the marked equity revalued from the mark to the book levels that would fill a close (bids for a long, asks for a short), read in the same block.
  - Opening then costs only the spread actually crossed; the basis cancels.
  - It is the quantity the PASS lock's `quotePerpClose` guard already uses, and what the registry's flat-equity check at mint realizes.
  - An open position that the book read cannot price pauses, like an unpriceable mark.
  - The rulebooks and their registered ids are unchanged.
- **This task (core only):**
  - `book.ts`: one Multicall3 read of the block number and both sides; closeable equity; average fills; book-capped opening IOCs.
  - `evaluate()` judges closeable equity whenever `market.book` is given. When it is omitted, equity is valued at the mark, so the tape simulator and every existing caller keep their behaviour and the workspace still type-checks.
  - Two demo helpers: `DEMO_LEVERAGE_X = 5` and `roundTripSpreadBps()`.
  - The wiring follows in later tasks: referee:14 the referee, referee:15 the bot, spike:21 the skeleton, web:11 and web:12 the app.
- **The close ladder is kept:** it stays at [20, 50, 100] bps from the mark (spec §8). A new test pins that it closes both sides on a book skewed ±17 to 25 bps; the side against the skew needs the 50 bps step.

- [ ] **Step 1: Write the failing tests**

`packages/core/test/book.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { encodeFunctionResult, encodeAbiParameters } from "viem";
import { multicall3Abi } from "../src/abi";
import { BOOK_DEPTH, OPEN_MARGIN_BPS, averageFill, bookCall, closeableEquity, decodeBook, fillableAt, planOpenFromBook, type BookSides } from "../src/book";
import { CLOSE_SLIPPAGE_STEPS_BPS, iocPrice, planClose, planOpen } from "../src/close";
import { BTC_POOL } from "../src/config";

const E18 = 10n ** 18n;
const MARK = 72_800n * E18;
const PARAMS = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };
const at = (bps: number): bigint => (MARK * BigInt(10_000 * 100 + Math.round(bps * 100))) / 1_000_000n;
const levels = (bps: number[], quantity: bigint) => bps.map((b) => ({ price: at(b), quantity }));
// The measured book (guide, 2026-11-12): bids +17..+19 bps and asks +21..+25 bps above the mark, and its mirror image.
const ABOVE: BookSides = { bids: levels([19, 18, 17], 1_373_000n), asks: levels([21, 23, 25], 1_373_000n) };
const BELOW: BookSides = { bids: levels([-21, -23, -25], 1_373_000n), asks: levels([-19, -18, -17], 1_373_000n) };

describe("closeable equity (spec §5, P5 ruling)", () => {
  it("cancels the mark-to-book basis: a 12x long opened at the ask pays the spread, not the basis", () => {
    const start = 50n * E18;
    const qty = 824_000n; // 12x of 50 USDso at 72,800, about 0.00824 BTC
    const ask = ABOVE.asks[0]?.price ?? 0n;
    const marked = start - ((ask - MARK) * qty) / 10n ** 8n;
    const closeable = closeableEquity(marked, qty, MARK, ABOVE, 8);
    const bps = (e: bigint) => Math.round(Number(((e - start) * 1_000_000n) / start) / 100);
    expect(bps(marked)).toBe(-252);
    expect(closeable).not.toBeNull();
    expect(bps(closeable ?? 0n)).toBe(-24);
  });
  it("revalues a long at the bids and a short at the asks, walking the levels", () => {
    const total = 50n * E18;
    const twoLevels = 2_000_000n;
    const long = total + ((at(19) - MARK) * 1_373_000n + (at(18) - MARK) * 627_000n) / 10n ** 8n;
    const short = total - ((at(21) - MARK) * 1_373_000n + (at(23) - MARK) * 627_000n) / 10n ** 8n;
    expect(closeableEquity(total, twoLevels, MARK, ABOVE, 8)).toBe(long);
    expect(closeableEquity(total, -twoLevels, MARK, ABOVE, 8)).toBe(short);
    expect(closeableEquity(total, 0n, MARK, { bids: [], asks: [] }, 8)).toBe(total);
  });
  it("cannot price a close larger than the levels read", () => {
    expect(closeableEquity(50n * E18, 5_000_000n, MARK, ABOVE, 8)).toBeNull();
    expect(closeableEquity(50n * E18, -1_000n, MARK, { bids: ABOVE.bids, asks: [] }, 8)).toBeNull();
  });
});

describe("average fills from one book read", () => {
  it("walks the asks to buy and the bids to sell, and refuses a size the levels cannot fill", () => {
    expect(averageFill(true, 2_000_000n, ABOVE)).toBe((at(21) * 1_373_000n + at(23) * 627_000n) / 2_000_000n);
    expect(averageFill(false, 13_000n, ABOVE)).toBe(at(19));
    expect(averageFill(true, 5_000_000n, ABOVE)).toBeNull();
    expect(averageFill(false, 0n, ABOVE)).toBeNull();
  });
});

describe("opening IOCs are capped from the book", () => {
  it("a mark + 20 bps buy cannot fill a book above the mark; the book-capped buy can", () => {
    const fromMark = planOpen(true, 13_000n, MARK, PARAMS, 20);
    expect(fillableAt(true, fromMark.price, ABOVE)).toBe(0n);
    const fromBook = planOpenFromBook(true, 13_000n, ABOVE, PARAMS);
    expect(fromBook.price).toBe(iocPrice(true, ABOVE.asks[0]?.price ?? 0n, PARAMS.tickSize, OPEN_MARGIN_BPS));
    expect(fillableAt(true, fromBook.price, ABOVE)).toBeGreaterThanOrEqual(13_000n);
    const sell = planOpenFromBook(false, 13_000n, BELOW, PARAMS);
    expect(sell.price % PARAMS.tickSize).toBe(0n);
    expect(fillableAt(false, sell.price, BELOW)).toBeGreaterThanOrEqual(13_000n);
  });
  it("refuses an empty opposite side and a size below the pool minimum", () => {
    expect(() => planOpenFromBook(true, 13_000n, { bids: ABOVE.bids, asks: [] }, PARAMS)).toThrow(/no asks/);
    expect(() => planOpenFromBook(false, 13_000n, { bids: [], asks: ABOVE.asks }, PARAMS)).toThrow(/no bids/);
    expect(() => planOpenFromBook(true, 12_999n, ABOVE, PARAMS)).toThrow(/below minQuantity/);
  });
});

describe("the close ladder (20, 50, 100 bps from the mark) on a book skewed both ways", () => {
  const firstFill = (size: bigint, book: BookSides): number | null => {
    for (const step of CLOSE_SLIPPAGE_STEPS_BPS) {
      const plan = planClose(size, MARK, PARAMS, step);
      if (plan && fillableAt(plan.isBid, plan.price, book) >= plan.quantity) return step;
    }
    return null;
  };
  it("closes both sides within the ladder; the side against the skew needs the 50 bps step", () => {
    expect(firstFill(13_000n, ABOVE)).toBe(20);
    expect(firstFill(-13_000n, ABOVE)).toBe(50);
    expect(firstFill(13_000n, BELOW)).toBe(50);
    expect(firstFill(-13_000n, BELOW)).toBe(20);
  });
});

describe("book reads", () => {
  it("reads the block number and both sides in one Multicall3 call, and decodes them", () => {
    expect(bookCall(BTC_POOL).data.startsWith("0x82ad56cb")).toBe(true);
    expect(BOOK_DEPTH).toBe(20);
    const side = (b: BookSides["bids"]) =>
      encodeAbiParameters([{ type: "tuple[]", components: [{ name: "price", type: "uint256" }, { name: "quantity", type: "uint256" }] }], [b.map((l) => ({ ...l }))]);
    const ok = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [
        { success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [48_306_001n]) },
        { success: true, returnData: side(ABOVE.bids) },
        { success: true, returnData: side(ABOVE.asks) },
      ],
    });
    expect(decodeBook(ok)).toEqual({ blockNumber: 48_306_001n, bids: ABOVE.bids, asks: ABOVE.asks });
    const failed = encodeFunctionResult({
      abi: multicall3Abi,
      functionName: "aggregate3",
      result: [
        { success: true, returnData: encodeAbiParameters([{ type: "uint256" }], [1n]) },
        { success: false, returnData: "0x" },
        { success: true, returnData: side(ABOVE.asks) },
      ],
    });
    expect(decodeBook(failed)).toBeNull();
  });
});
```

`packages/core/test/evaluate-closeable.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import type { BookSides } from "../src/book";
import { evaluate, initRunState, type MarketView } from "../src/evaluate";
import type { AccountSnapshot } from "../src/snapshot";
import { loadRulebook } from "../src/node";

const E18 = 10n ** 18n;
const POOL: Address = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const OTHER: Address = "0x00000000000000000000000000000000000000aa";
const T0 = 1_794_268_800n; // 2026-11-10 00:00:00 UTC
const MARK = 72_800n * E18;
const START = 50n * E18;
// Thresholds pinned to the registered Tokyo Sprint · Demo values.
const rb = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
// The measured book (guide, 2026-11-12): best bid +19 bps and best ask +21 bps above the mark.
const BOOK: BookSides = { bids: [{ price: px(19), quantity: 1_373_000n }], asks: [{ price: px(21), quantity: 1_373_000n }] };
const QTY = 824_000n; // 12x of 50 USDso at 72,800

function acct(total: bigint, size: bigint, over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return { account: "0x00000000000000000000000000000000000000a1", equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: size === 0n ? [] : [POOL], size, ...over };
}
const market = (dt: bigint, book?: BookSides | null): MarketView => ({ timestamp: T0 + dt, markOk: true, markPrice: MARK, ...(book === undefined ? {} : { book }) });
// Marked equity right after opening at the book: a long bought at the ask, a short sold at the bid.
const longMarked = START - ((px(21) - MARK) * QTY) / 10n ** 8n;
const shortMarked = START + ((px(19) - MARK) * QTY) / 10n ** 8n;

describe("rules judge closeable equity (spec §5, P5 ruling 2026-11-12)", () => {
  it("valued at the mark, a fresh 12x long fails daily loss at once and a fresh 12x short shows a phantom target", () => {
    expect(evaluate(rb, initRunState(T0, START), acct(longMarked, QTY), market(5n)).verdict).toEqual({ kind: "fail", rule: "DailyLoss" });
    expect(evaluate(rb, initRunState(T0, START), acct(shortMarked, -QTY), market(61n)).verdict).toEqual({ kind: "target" });
  });
  it("valued at the book, both fresh positions are only the spread down and keep running", () => {
    const long = evaluate(rb, initRunState(T0, START), acct(longMarked, QTY), market(5n, BOOK));
    const short = evaluate(rb, initRunState(T0, START), acct(shortMarked, -QTY), market(61n, BOOK));
    expect(long.verdict).toEqual({ kind: "ok" });
    expect(short.verdict).toEqual({ kind: "ok" });
    const spread = ((px(21) - px(19)) * QTY) / 10n ** 8n;
    expect(long.judgedEquity).toBe(START - spread);
    expect(short.judgedEquity).toBe(START - spread);
    expect(long.state.hwm).toBe(START);
    expect(short.state.hwm).toBe(START);
  });
  it("still fails a real loss and reaches a real target, both measured at the book", () => {
    const down = acct(longMarked - (START * 60n) / 10_000n, QTY);
    expect(evaluate(rb, initRunState(T0, START), down, market(5n, BOOK)).verdict).toEqual({ kind: "fail", rule: "DailyLoss" });
    const up = acct(shortMarked + (START * 80n) / 10_000n, -QTY);
    expect(evaluate(rb, initRunState(T0, START), up, market(61n, BOOK)).verdict).toEqual({ kind: "target" });
  });
  it("pauses an open position when the book read failed or cannot price it; a flat account needs no book", () => {
    const pause = { kind: "pause", reason: "unpriceable" };
    expect(evaluate(rb, initRunState(T0, START), acct(longMarked, QTY), market(5n, null))).toMatchObject({ verdict: pause, judgedEquity: null });
    expect(evaluate(rb, initRunState(T0, START), acct(longMarked, 2_000_000n), market(5n, BOOK)).verdict).toEqual(pause);
    expect(evaluate(rb, initRunState(T0, START), acct(START, 0n), market(5n, null))).toMatchObject({ verdict: { kind: "ok" }, judgedEquity: START });
  });
  it("voids a foreign market before it pauses on the book", () => {
    expect(evaluate(rb, initRunState(T0, START), acct(longMarked, QTY, { activePools: [POOL, OTHER] }), market(5n, null)).verdict).toEqual({ kind: "void", reason: "ForeignMarket" });
  });
});
```

`packages/core/test/demo-closeable.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_LEVERAGE_X, parseTape, roundTripEquityBps, roundTripSpreadBps, simulateTape } from "../src/demo-math";
import { loadRulebook, repoPath } from "../src/node";

const E18 = 10n ** 18n;

describe("the demo at closeable equity (P5 ruling 2026-11-12)", () => {
  it("measures the round trip as the spread between the two sides, not the distance from the mark", () => {
    expect(roundTripSpreadBps(73_043_800n * 10n ** 15n, 73_042_200n * 10n ** 15n)).toBe(0.21);
    expect(roundTripSpreadBps(100_036n * E18, 100_000n * E18)).toBe(3.59);
    expect(() => roundTripSpreadBps(0n, 0n)).toThrow(/positive/);
  });
  it("runs at 5x, where the widest measured spread costs well under half the demo target", () => {
    expect(DEMO_LEVERAGE_X).toBe(5);
    expect(roundTripEquityBps(3.6 / 2, DEMO_LEVERAGE_X)).toBe(18);
    expect(roundTripEquityBps(3.6 / 2, DEMO_LEVERAGE_X)).toBeLessThanOrEqual(50 / 2);
  });
  it("resolves both opposite accounts on the recorded tape at 5x with a 3.6 bps round trip paid at entry", () => {
    const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
    const demo = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
    const r = simulateTape(demo, tape, { leverageX: DEMO_LEVERAGE_X, startEquity: 50n * E18, lotSize: 1_000n, entryCostBps: 3.6, exitCostBps: 0 });
    expect(r.quantity).toBeGreaterThanOrEqual(13_000n);
    expect([r.long.outcome, r.short.outcome].sort()).toEqual(["fail", "target"]);
  });
});
```

- [ ] **Step 2: Run to confirm they fail**
Run: `npm test -w @basanos/core -- test/book.test.ts test/evaluate-closeable.test.ts test/demo-closeable.test.ts`
Expected: FAIL — `Test Files  3 failed (3)` and `Tests  5 failed | 3 passed (8)`. `book.test.ts` cannot import `../src/book`; the old evaluator ignores the book, and `DEMO_LEVERAGE_X` and `roundTripSpreadBps` do not exist yet.

- [ ] **Step 3: Add the book module**

`packages/core/src/book.ts`:
```ts
// Closeable equity and book-capped opens (spec §5; architect ruling P5, 2026-11-12). The BTC-PERP book trades about
// 19 bps above the on-chain mark (guide measurement, 2026-11-12), so equity marked at the mark misstates what an
// account would hold if it flattened: a long reads low by about the basis x its notional, a short reads high. The
// rules judge closeable equity instead: the marked equity revalued from the mark to the book levels that would fill
// the close (bids for a long, asks for a short), read in the same block. Opening IOCs are capped from the book too,
// since a cap of mark + 20 bps sits below the whole ask side and never fills.
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { multicall3Abi, perpPoolAbi } from "./abi";
import { alignDown, alignUp, type BookParams, type OrderPlan } from "./close";
import { MULTICALL3 } from "./config";

export interface BookLevel {
  price: bigint;
  quantity: bigint;
}

/** Best level first on each side: bids descending, asks ascending (PerpPool.getBookLevels order). */
export interface BookSides {
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
}

export interface BookRead extends BookSides {
  blockNumber: bigint;
}

/** Levels read per side. 20 levels held 3.3 BTC of bids and 42 BTC of asks on 2026-11-12, against a demo position of
 *  about 0.003 BTC and at most about 0.03 BTC for 40x of a 50 USDso account. */
export const BOOK_DEPTH = 20;

/** How far past the best opposite level an opening IOC may fill. The IOC fills at the book's prices; this only caps
 *  the slippage. */
export const OPEN_MARGIN_BPS = 20;

interface Row {
  success: boolean;
  returnData: Hex;
}

/** One Multicall3 call: the block number and both sides of the book, read in the same block. */
export function bookCall(pool: Address, depth: number = BOOK_DEPTH): { to: Address; data: Hex } {
  const side = (isBid: boolean) => ({
    target: pool,
    allowFailure: true,
    callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "getBookLevels", args: [isBid, BigInt(depth)] }),
  });
  const calls = [
    { target: MULTICALL3, allowFailure: true, callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getBlockNumber" }) },
    side(true),
    side(false),
  ];
  return { to: MULTICALL3, data: encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] }) };
}

/** The decoded book, or null when the block number or either side could not be read. */
export function decodeBook(result: Hex): BookRead | null {
  const rows = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: result }) as readonly Row[];
  const [blockRow, bidRow, askRow] = rows;
  if (!blockRow?.success || !bidRow?.success || !askRow?.success) return null;
  const blockNumber = decodeFunctionResult({ abi: multicall3Abi, functionName: "getBlockNumber", data: blockRow.returnData });
  const levels = (row: Row): BookLevel[] =>
    decodeFunctionResult({ abi: perpPoolAbi, functionName: "getBookLevels", data: row.returnData }).map((l) => ({ price: l.price, quantity: l.quantity }));
  return { blockNumber, bids: levels(bidRow), asks: levels(askRow) };
}

/** Both sides of the book at `blockNumber` (default: latest); null when the read fails. */
export async function readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth: number = BOOK_DEPTH): Promise<BookRead | null> {
  const call = bookCall(pool, depth);
  try {
    const res = await client.call({ to: call.to, data: call.data, ...(blockNumber === undefined ? {} : { blockNumber }) });
    return res.data ? decodeBook(res.data) : null;
  } catch {
    return null;
  }
}

/** The marked equity revalued from the mark to the levels that would fill a close of `size` (signed, raw base units):
 *  a long sells into the bids, a short buys from the asks. Flat returns totalEquity. null when the levels read cannot
 *  fill the whole close (the position cannot be priced from this book). */
export function closeableEquity(totalEquity: bigint, size: bigint, mark: bigint, book: BookSides, baseDecimals: number): bigint | null {
  if (size === 0n) return totalEquity;
  const long = size > 0n;
  let left = long ? size : -size;
  let diff = 0n;
  for (const level of long ? book.bids : book.asks) {
    if (left === 0n) break;
    const q = level.quantity < left ? level.quantity : left;
    diff += (level.price - mark) * q;
    left -= q;
  }
  if (left > 0n) return null;
  const adjust = diff / 10n ** BigInt(baseDecimals);
  return long ? totalEquity + adjust : totalEquity - adjust;
}

/** The average price an IOC of `quantity` would fill at, walking the opposite side (asks for a buy, bids for a sell);
 *  null when the levels read cannot fill it. */
export function averageFill(isBid: boolean, quantity: bigint, book: BookSides): bigint | null {
  if (quantity <= 0n) return null;
  let left = quantity;
  let cost = 0n;
  for (const level of isBid ? book.asks : book.bids) {
    if (left === 0n) break;
    const q = level.quantity < left ? level.quantity : left;
    cost += level.price * q;
    left -= q;
  }
  return left > 0n ? null : cost / quantity;
}

/** Quantity an IOC at `limit` can take from the opposite side: asks at or below a buy limit, bids at or above a sell limit. */
export function fillableAt(isBid: boolean, limit: bigint, book: BookSides): bigint {
  let total = 0n;
  for (const level of isBid ? book.asks : book.bids) {
    if (isBid ? level.price > limit : level.price < limit) break;
    total += level.quantity;
  }
  return total;
}

/** An opening IOC capped from the book: best ask + marginBps (rounded up to the tick) to buy, best bid - marginBps
 *  (rounded down) to sell. Throws when the quantity is below the pool minimum or the opposite side is empty. */
export function planOpenFromBook(isBid: boolean, quantity: bigint, book: BookSides, params: BookParams, marginBps: number = OPEN_MARGIN_BPS): OrderPlan {
  const q = alignDown(quantity, params.lotSize);
  if (q < params.minQuantity) throw new Error(`planOpenFromBook: quantity ${q} is below minQuantity ${params.minQuantity}`);
  const best = (isBid ? book.asks : book.bids)[0];
  if (!best) throw new Error(`planOpenFromBook: the book has no ${isBid ? "asks" : "bids"} to open against`);
  const m = BigInt(marginBps);
  const price = isBid ? alignUp((best.price * (10_000n + m)) / 10_000n, params.tickSize) : alignDown((best.price * (10_000n - m)) / 10_000n, params.tickSize);
  return { isBid, quantity: q, price };
}
```

- [ ] **Step 4: Judge closeable equity in the evaluator**

Replace `packages/core/src/evaluate.ts` with:
```ts
import { closeableEquity, type BookSides } from "./book";
import type { Rulebook } from "./rulebook";
import type { AccountSnapshot } from "./snapshot";

export type FailRule = "DailyLoss" | "TrailingDrawdown" | "MaxExposure" | "TimeLimit" | "Liquidated";

export type Verdict =
  | { kind: "ok" }
  | { kind: "pause"; reason: "unpriceable" }
  | { kind: "void"; reason: "ForeignMarket" }
  | { kind: "fail"; rule: FailRule }
  | { kind: "target" };

export interface RunState {
  startTime: bigint;
  startEquity: bigint;
  hwm: bigint;
  dayStart: bigint;
  day: bigint;
}

export interface MarketView {
  timestamp: bigint;
  markOk: boolean;
  markPrice: bigint;
  /** The book in the same block (spec §5: rules judge closeable equity). Omitted: equity is valued at the mark (tape
   *  simulations). null: the book read failed, so an open position cannot be judged and the run pauses. */
  book?: BookSides | null;
}

export interface Evaluation {
  state: RunState;
  verdict: Verdict;
  exposureX: number | null;
  /** The equity the rules judged: closeable equity when a book was given (marked equity when flat or when no book
   *  was given); null on a pause or void. */
  judgedEquity: bigint | null;
}

const DAY = 86_400n;

export function initRunState(startTime: bigint, startEquity: bigint): RunState {
  return { startTime, startEquity, hwm: startEquity, dayStart: startEquity, day: startTime / DAY };
}

export function notional(size: bigint, mark: bigint, baseDecimals: number): bigint {
  const abs = size < 0n ? -size : size;
  return (abs * mark) / 10n ** BigInt(baseDecimals);
}

/** The equity the rules judge (spec §5): the marked equity revalued at the book that would fill a close; the marked
 *  equity itself when flat or when no book was given; null when the book cannot price the position. */
export function equityToJudge(acct: AccountSnapshot, market: MarketView, baseDecimals: number): bigint | null {
  if (market.book === undefined || acct.size === 0n) return acct.totalEquity;
  if (market.book === null) return null;
  return closeableEquity(acct.totalEquity, acct.size, market.markPrice, market.book, baseDecimals);
}

/** Spec §5, in order: pause, void, book pause, state update, time limit, daily loss, trailing drawdown, exposure, target. */
export function evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation {
  const pause: Evaluation = { state, verdict: { kind: "pause", reason: "unpriceable" }, exposureX: null, judgedEquity: null };
  if (!acct.equityOk || !market.markOk) return pause;
  const pool = rb.market.pool.toLowerCase();
  if (acct.activePools.some((p) => p.toLowerCase() !== pool)) {
    return { state, verdict: { kind: "void", reason: "ForeignMarket" }, exposureX: null, judgedEquity: null };
  }
  const total = equityToJudge(acct, market, rb.market.baseDecimals);
  if (total === null) return pause;
  const day = market.timestamp / DAY;
  const next: RunState = {
    ...state,
    hwm: total > state.hwm ? total : state.hwm,
    ...(day !== state.day ? { day, dayStart: total } : {}),
  };
  const n = notional(acct.size, market.markPrice, rb.market.baseDecimals);
  const exposureX = total > 0n ? Number((n * 100n) / total) / 100 : null;
  let verdict: Verdict = { kind: "ok" };
  if (market.timestamp > state.startTime + BigInt(rb.timeLimitSec)) {
    verdict = { kind: "fail", rule: "TimeLimit" };
  } else if (total * 10_000n <= next.dayStart * BigInt(10_000 - rb.dailyLossBps)) {
    verdict = { kind: "fail", rule: "DailyLoss" };
  } else if (total * 10_000n <= next.hwm * BigInt(10_000 - rb.trailingDrawdownBps)) {
    verdict = { kind: "fail", rule: "TrailingDrawdown" };
  } else if (n > total * BigInt(rb.maxExposureX)) {
    verdict = { kind: "fail", rule: "MaxExposure" };
  } else if (
    total * 10_000n >= state.startEquity * BigInt(10_000 + rb.profitTargetBps) &&
    market.timestamp >= state.startTime + BigInt(rb.minDurationSec)
  ) {
    verdict = { kind: "target" };
  }
  return { state: next, verdict, exposureX, judgedEquity: total };
}
```

- [ ] **Step 5: Add the demo leverage and the spread helper**

Replace `packages/core/src/demo-math.ts` with:
```ts
import type { Address } from "viem";
import { quantityForLeverage } from "./close";
import { evaluate, initRunState, type FailRule } from "./evaluate";
import type { Rulebook } from "./rulebook";
import type { AccountSnapshot } from "./snapshot";

export interface TapePoint {
  block: bigint;
  ts: bigint;
  mark: bigint;
}

/** Tape JSON (bigints as strings); millisecond timestamps are converted to seconds. */
export function parseTape(raw: unknown): TapePoint[] {
  const points = ((raw as { points?: unknown[] }).points ?? []) as { block: string; ts: string; mark: string }[];
  return points.map((p) => {
    const ts = BigInt(p.ts);
    return { block: BigInt(p.block), ts: ts > 10_000_000_000n ? ts / 1000n : ts, mark: BigInt(p.mark) };
  });
}

export interface SimOptions {
  leverageX: number;
  startEquity: bigint;
  lotSize: bigint;
  entryCostBps: number;
  exitCostBps: number;
}

export interface SimSide {
  side: "long" | "short";
  outcome: "target" | "fail" | "unresolved";
  rule: FailRule | null;
  atTs: bigint | null;
}

const ACCOUNT: Address = "0x000000000000000000000000000000000000dEaD";

function simulateSide(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions, qty: bigint, sign: 1n | -1n): SimSide {
  const side = sign === 1n ? "long" : "short";
  const first = tape[0];
  if (!first) return { side, outcome: "unresolved", rule: null, atTs: null };
  const oneBase = 10n ** BigInt(rb.market.baseDecimals);
  const entryNotional = (qty * first.mark) / oneBase;
  const entryCost = (entryNotional * BigInt(Math.round(o.entryCostBps * 100))) / 1_000_000n;
  let state = initRunState(first.ts, o.startEquity);
  for (const p of tape) {
    const pnl = (sign * qty * (p.mark - first.mark)) / oneBase;
    const total = o.startEquity - entryCost + pnl;
    const acct: AccountSnapshot = {
      account: ACCOUNT,
      equityOk: true,
      equity: total,
      lockedCollateral: 0n,
      totalEquity: total,
      activePools: [rb.market.pool],
      size: sign * qty,
    };
    const ev = evaluate(rb, state, acct, { timestamp: p.ts, markOk: true, markPrice: p.mark });
    state = ev.state;
    if (ev.verdict.kind === "fail") return { side, outcome: "fail", rule: ev.verdict.rule, atTs: p.ts };
    if (ev.verdict.kind === "target") {
      const exitCost = (((qty * p.mark) / oneBase) * BigInt(Math.round(o.exitCostBps * 100))) / 1_000_000n;
      const lockedEquity = total - exitCost;
      if (lockedEquity * 10_000n >= o.startEquity * BigInt(10_000 + rb.profitTargetBps)) {
        return { side, outcome: "target", rule: null, atTs: p.ts };
      }
    }
  }
  return { side, outcome: "unresolved", rule: null, atTs: null };
}

/** Two opposite accounts opened at the first tape point, judged by the real evaluator; a pass counts only once the lock's close cost still clears the target. */
export function simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint } {
  const first = tape[0];
  const quantity = first
    ? quantityForLeverage(o.startEquity, o.leverageX, first.mark, rb.market.baseDecimals, { tickSize: 1n, minQuantity: 0n, lotSize: o.lotSize })
    : 0n;
  return { long: simulateSide(rb, tape, o, quantity, 1n), short: simulateSide(rb, tape, o, quantity, -1n), quantity };
}

/** Fill cost against the mark, in bps of notional (positive = worse than the mark). */
export function costBpsVsMark(isBid: boolean, reference: bigint, average: bigint): number {
  const diff = isBid ? average - reference : reference - average;
  return Number((diff * 1_000_000n) / reference) / 100;
}

/** A round trip (entry + lock close) costs 2 x one-way notional bps x leverage in equity bps. */
export function roundTripEquityBps(oneWayCostBps: number, leverageX: number): number {
  return 2 * oneWayCostBps * leverageX;
}

/** Spec §5: the round trip may use at most half the demo target; never below the registered 50 bps. */
export function recommendDemoTargetBps(roundTripEqBps: number): number {
  return Math.max(50, Math.ceil((2 * roundTripEqBps) / 25) * 25);
}

/** Demo leverage (architect ruling P5, 2026-11-12). Rules judge closeable equity, so opening costs the spread x
 *  leverage at once: at most about 18 bps of equity at 5x on the measured 0.2-3.6 bps spread, inside the demo's 50 bps
 *  daily-loss floor. At 12x a 4.2 bps spread alone would breach it. */
export const DEMO_LEVERAGE_X = 5;

/** What a closeable-equity run pays at entry, in bps of notional: buying at the ask side and being valued at the bid
 *  side (or the reverse). The demo-cost input since P5; costBpsVsMark measured the mark-to-book basis instead. */
export function roundTripSpreadBps(buyAverage: bigint, sellAverage: bigint): number {
  const mid = (buyAverage + sellAverage) / 2n;
  if (mid <= 0n) throw new Error("roundTripSpreadBps: prices must be positive");
  return Number(((buyAverage - sellAverage) * 1_000_000n) / mid) / 100;
}
```

- [ ] **Step 6: Type-check the core and every workspace that imports it**
Run: `npm run typecheck -w @basanos/core`
Expected: exits 0 with no `error TS` lines.
Run: `npm run typecheck`
Expected: exits 0 (`Evaluation` gained a field and `MarketView` an optional one; no caller changes).

- [ ] **Step 7: Run the whole core suite**
Run: `npm test -w @basanos/core`
Expected: no failed tests (`69 passed` on top of the 53 already there).

- [ ] **Step 8: Run the new tests (the gate)**
Run: `npm test -w @basanos/core -- test/book.test.ts test/evaluate-closeable.test.ts test/demo-closeable.test.ts`
Expected: PASS — `16 passed`.

- [ ] **Step 9: Commit (kernel-performed — no agent runs this)**
Message: `feat(core): closeable equity — book reads, the evaluator judges the book, opens capped from the book (P5)`

---

### Task 14: The referee judges closeable equity — the price watch carries the book of the same block; FAIL evidence records it (P5)

**Files:**
- Modify: `packages/referee/src/engine.ts`
- Modify: `packages/referee/src/daemon.ts`
- Test: `packages/referee/test/engine-closeable.test.ts`

**Depends on:** Task 3, Task 4, Task 7, Task 13, spike:Task 3, spike:Task 4
**Effort:** medium
**Model tier:** top
**Provides:** `interface JudgedRead { equity: bigint; book: BookRead | null }`, `type Action = { kind: "fail"; runId: bigint; account: Address; rule: FailRule; breach: BreachRead; judged: JudgedRead | null } | { kind: "lock"; runId: bigint; account: Address } | { kind: "void"; runId: bigint; account: Address; reason: "Flow" | "ForeignMarket"; txHash: Hex | null }`, `Engine.onSnapshot(snap: Snapshot, book?: BookRead | null): Action[] (rules judge closeable equity; a trading log is no longer judged at the mark)`, `referee daemon: the price-feed watch attaches [snapshotCall, bookCall(BTC_POOL)], so every judged snapshot carries the book of its own block; FAIL bundles in docs/evidence/runs.json carry judged { equity, book }`
**Requires:** `class Engine { paused; track(run): boolean; get(runId): EngineRun | undefined; watchedAccounts(): Address[]; retain(activeRunIds: readonly bigint[]): bigint[]; pause(); resume(); finish(runId); release(runId); onSnapshot(snap): Action[]; onAccountLog(account, topic0, txHash, snap): Action[] }`, `interface BreachRead { blockNumber: bigint; equityOk: boolean; equity: bigint; lockedCollateral: bigint; positionSize: bigint; markOk: boolean; markPrice: bigint }`, `runDaemon(d: DaemonDeps): Promise<void>`, `interface TrackedRun { runId: bigint; account: Address; rulebookId: Hex; rulebook: Rulebook; startTime: bigint; startEquity: bigint; startBlock: bigint }`, `interface Snapshot { blockNumber: bigint; timestamp: bigint; pool: Address; markOk: boolean; markPrice: bigint; accounts: AccountSnapshot[] }`, `rulebookId(rb: Rulebook): Hex`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `interface BookRead extends BookSides { blockNumber: bigint }`, `bookCall(pool: Address, depth?: number): { to: Address; data: Hex } (one Multicall3 call: block number and both sides)`, `decodeBook(result: Hex): BookRead | null`, `readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth?: number): Promise<BookRead | null>`, `interface Evaluation { state: RunState; verdict: Verdict; exposureX: number | null; judgedEquity: bigint | null }`, `evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation (judges closeable equity when market.book is given; omitted, at the mark)`

Why (architect ruling P5, 2026-11-12; spec §5 and §8):
- **The gap:** referee:13 makes `evaluate()` judge closeable equity when it is given the book, but the engine passed only the mark. A fresh long would still FAIL at once.
- **The book rides on the price watch:** the price-feed watch now attaches two eth_calls, the snapshot and `bookCall(BTC_POOL)`, so every push carries the book of the same block.
  - Verified read-only on 2026-11-12: 73 of 73 pushes in 20 s returned both results at the same block, with 20 levels per side.
  - On a resume, the referee reads the book over HTTP at the snapshot's own block.
  - A missing or mismatched book pauses runs with an open position until the next push.
- **Trading logs are no longer judged:** a trading log (`PositionUpdated` and the rest) used to re-judge the account at the mark. That push carries no book, and judging it at the mark is exactly the unearned FAIL. The price watch judges within about a second. Flows still void and liquidations still fail on the log.
- **The evidence:** a FAIL action, and its evidence bundle, carry `judged: { equity, book }` beside the stored reads. The registry's `Read` struct is fixed, so the closeable equity lives in the bundle, whose hash is on-chain; web:12 replays it from the chain.
- **The PASS lock is unchanged:** it already predicts the closed equity with `quotePerpClose`, and the registry checks the flat result at mint.

- [ ] **Step 1: Write the failing test**

`packages/referee/test/engine-closeable.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { toEventSelector, type Address, type Hex } from "viem";
import type { Snapshot } from "@basanos/core";
import { rulebookId } from "@basanos/core";
import type { BookRead } from "@basanos/core/book";
import { loadRulebook } from "@basanos/core/node";
import { Engine } from "../src/engine";
import type { TrackedRun } from "../src/runs";

const E18 = 10n ** 18n;
const POOL: Address = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const A: Address = "0x00000000000000000000000000000000000000a1";
const T0 = 1_794_326_400n;
const MARK = 72_800n * E18;
const START = 50n * E18;
const QTY = 824_000n; // 12x of 50 USDso at 72,800
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
const demo = { ...loadRulebook("tokyo-sprint-demo"), profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 };
const run: TrackedRun = { runId: 1n, account: A, rulebookId: rulebookId(demo), rulebook: demo, startTime: T0, startEquity: START, startBlock: 100n };
const POSITION_UPDATED: Hex = toEventSelector("PositionUpdated(address,address,int128,uint128,int256,int256)");

function snap(total: bigint, dt: bigint, size: bigint): Snapshot {
  return {
    blockNumber: 100n + dt,
    timestamp: T0 + dt,
    pool: POOL,
    markOk: true,
    markPrice: MARK,
    accounts: [{ account: A, equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: size === 0n ? [] : [POOL], size }],
  };
}
const book = (dt: bigint): BookRead => ({ blockNumber: 100n + dt, bids: [{ price: px(19), quantity: 1_373_000n }], asks: [{ price: px(21), quantity: 1_373_000n }] });
// A fresh 12x long bought at the ask: marked about -252 bps, closeable about -24 bps (the spread).
const freshLong = START - ((px(21) - MARK) * QTY) / 10n ** 8n;

describe("the referee judges closeable equity (spec §5, P5 ruling)", () => {
  it("keeps a fresh position running when the snapshot comes with its book, and pauses it without one", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onSnapshot(snap(freshLong, 5n, QTY), book(5n))).toEqual([]);
    expect(e.onSnapshot(snap(freshLong, 6n, QTY), null)).toEqual([]);
    expect(e.get(1n)?.phase).toBe("watching");
  });
  it("records the judged equity and its book beside the breach reads", () => {
    const e = new Engine();
    e.track(run);
    const lost = freshLong - (START * 60n) / 10_000n;
    const [action] = e.onSnapshot(snap(lost, 7n, QTY), book(7n));
    expect(action).toMatchObject({ kind: "fail", rule: "DailyLoss" });
    if (action?.kind !== "fail") throw new Error("expected a fail");
    expect(action.breach.equity).toBe(lost);
    expect(action.judged).toEqual({ equity: lost + ((px(19) - MARK) * QTY) / 10n ** 8n, book: book(7n) });
  });
  it("no longer judges a trading log at the mark (it carries no book)", () => {
    const e = new Engine();
    e.track(run);
    expect(e.onAccountLog(A, POSITION_UPDATED, null, snap(freshLong, 5n, QTY))).toEqual([]);
    expect(e.get(1n)?.phase).toBe("watching");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/referee -- test/engine-closeable.test.ts`
Expected: FAIL — `3 failed (3)`. The engine still judges at the mark, and the fail action has no `judged`.

- [ ] **Step 3: Pass the book to the evaluator; stop judging trading logs**

Replace `packages/referee/src/engine.ts` with:
```ts
import type { Address, Hex } from "viem";
import type { AccountSnapshot, Snapshot } from "@basanos/core";
import type { BookRead } from "@basanos/core/book";
import { classifyMarginBankLog } from "@basanos/core/classify";
import { evaluate, initRunState, type FailRule, type RunState } from "@basanos/core/evaluate";
import type { TrackedRun } from "./runs";

export interface BreachRead {
  blockNumber: bigint;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  positionSize: bigint;
  markOk: boolean;
  markPrice: bigint;
}

/** What a snapshot rule judged (spec §5): the closeable equity and the book it was revalued at, read in the breach
 *  block (book null: valued at the mark). Kept in the run evidence beside the stored reads. */
export interface JudgedRead {
  equity: bigint;
  book: BookRead | null;
}

export type Action =
  | { kind: "fail"; runId: bigint; account: Address; rule: FailRule; breach: BreachRead; judged: JudgedRead | null }
  | { kind: "lock"; runId: bigint; account: Address }
  | { kind: "void"; runId: bigint; account: Address; reason: "Flow" | "ForeignMarket"; txHash: Hex | null };

export type RunPhase = "watching" | "acting" | "done";

export interface EngineRun {
  run: TrackedRun;
  state: RunState;
  phase: RunPhase;
  exposureX: number | null;
  lastTotal: bigint | null;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export function breachRead(snap: Snapshot, acct: AccountSnapshot): BreachRead {
  return {
    blockNumber: snap.blockNumber,
    equityOk: acct.equityOk,
    equity: acct.equity,
    lockedCollateral: acct.lockedCollateral,
    positionSize: acct.size,
    markOk: snap.markOk,
    markPrice: snap.markPrice,
  };
}

export class Engine {
  private readonly runs = new Map<string, EngineRun>();
  private pausedFlag = false;

  get paused(): boolean {
    return this.pausedFlag;
  }

  track(run: TrackedRun): boolean {
    const key = run.runId.toString();
    if (this.runs.has(key)) return false;
    this.runs.set(key, { run, state: initRunState(run.startTime, run.startEquity), phase: "watching", exposureX: null, lastTotal: null });
    return true;
  }

  get(runId: bigint): EngineRun | undefined {
    return this.runs.get(runId.toString());
  }

  watchedAccounts(): Address[] {
    const out: Address[] = [];
    for (const r of this.runs.values()) {
      if (r.phase !== "done" && !out.some((a) => same(a, r.run.account))) out.push(r.run.account);
    }
    return out;
  }

  /** Finishes tracked runs that are no longer active on-chain (e.g. voidRevoked by anyone); returns the ids still live. */
  retain(activeRunIds: readonly bigint[]): bigint[] {
    const live = new Set(activeRunIds.map((id) => id.toString()));
    for (const [key, r] of this.runs) if (!live.has(key) && r.phase === "watching") r.phase = "done";
    return [...this.runs.values()].filter((r) => r.phase !== "done").map((r) => r.run.runId);
  }

  pause(): void {
    this.pausedFlag = true;
  }

  resume(): void {
    this.pausedFlag = false;
  }

  finish(runId: bigint): void {
    const r = this.get(runId);
    if (r) r.phase = "done";
  }

  release(runId: bigint): void {
    const r = this.get(runId);
    if (r && r.phase === "acting") r.phase = "watching";
  }

  /** Judges every watched run on one snapshot. `book` is the book in the same block: rules then judge closeable
   *  equity, and null pauses runs with an open position. Omitted, equity is valued at the mark. */
  onSnapshot(snap: Snapshot, book?: BookRead | null): Action[] {
    if (this.pausedFlag) return [];
    const actions: Action[] = [];
    for (const r of this.runs.values()) {
      if (r.phase !== "watching") continue;
      const acct = snap.accounts.find((a) => same(a.account, r.run.account));
      if (!acct) continue;
      const ev = evaluate(r.run.rulebook, r.state, acct, {
        timestamp: snap.timestamp,
        markOk: snap.markOk,
        markPrice: snap.markPrice,
        ...(book === undefined ? {} : { book }),
      });
      r.state = ev.state;
      r.exposureX = ev.exposureX;
      if (acct.equityOk) r.lastTotal = acct.totalEquity;
      const v = ev.verdict;
      if (v.kind === "fail") {
        r.phase = "acting";
        const judged = ev.judgedEquity === null ? null : { equity: ev.judgedEquity, book: book ?? null };
        actions.push({ kind: "fail", runId: r.run.runId, account: r.run.account, rule: v.rule, breach: breachRead(snap, acct), judged });
      } else if (v.kind === "void") {
        r.phase = "acting";
        actions.push({ kind: "void", runId: r.run.runId, account: r.run.account, reason: "ForeignMarket", txHash: null });
      } else if (v.kind === "target") {
        r.phase = "acting";
        actions.push({ kind: "lock", runId: r.run.runId, account: r.run.account });
      }
    }
    return actions;
  }

  onAccountLog(account: Address, topic0: Hex | undefined, txHash: Hex | null, snap: Snapshot | null): Action[] {
    const r = [...this.runs.values()].find((x) => x.phase === "watching" && same(x.run.account, account));
    if (!r) return [];
    const cls = classifyMarginBankLog(topic0);
    if (cls === "flow") {
      r.phase = "acting";
      return [{ kind: "void", runId: r.run.runId, account: r.run.account, reason: "Flow", txHash }];
    }
    if (cls === "liquidation") {
      r.phase = "acting";
      const acct = snap?.accounts.find((a) => same(a.account, account));
      const breach: BreachRead =
        snap && acct
          ? breachRead(snap, acct)
          : { blockNumber: snap?.blockNumber ?? 0n, equityOk: false, equity: 0n, lockedCollateral: 0n, positionSize: 0n, markOk: false, markPrice: 0n };
      return [{ kind: "fail", runId: r.run.runId, account: r.run.account, rule: "Liquidated", breach, judged: null }];
    }
    // A trading log carries no book, so it is not judged here: the price-feed watch pushes the snapshot and the book
    // of the same block within about a second, and judges closeable equity (spec §5).
    return [];
  }
}
```

- [ ] **Step 4: Carry the book on the price watch and into the FAIL evidence**

Replace `packages/referee/src/daemon.ts` with:
```ts
import { pad, type Address, type Hex, type PublicClient } from "viem";
import type { SomniaMarkets } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  MARGIN_BANK,
  PRICE_FEED_SCHEDULER,
  decodeSnapshot,
  readSnapshot,
  snapshotCall,
  startWatch,
  type Rulebook,
  type Snapshot,
  type WatchHandle,
} from "@basanos/core";
import { bookCall, decodeBook, readBookLevels, type BookRead } from "@basanos/core/book";
import { flatten, type CloseIO } from "./close";
import { Engine, type Action } from "./engine";
import { attachVerdictTx, writeRunEvidence } from "./evidence";
import { clearsTarget, predictClosedEquity } from "./lock";
import { readActiveRuns, rulebookIndex } from "./runs";
import type { TxRecord } from "./tx";
import type { RegistryWriter } from "./writer";

export interface DaemonDeps {
  client: PublicClient;
  wss: string;
  registry: Address;
  rulebooks: readonly Rulebook[];
  closeIO: CloseIO;
  writer: RegistryWriter;
  markets: SomniaMarkets;
  log: (line: string) => void;
  pollMs?: number;
}

interface Gap {
  atMs: number;
  reason: string;
  lastBlock: string;
  resumedAtBlock: string | null;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
    }
  }
  throw last;
}

export async function runDaemon(d: DaemonDeps): Promise<void> {
  const engine = new Engine();
  const index = rulebookIndex(d.rulebooks);
  const gaps: Gap[] = [];
  const connected = new Set<number>();
  let watches: WatchHandle[] = [];
  let watchedKey = "";
  let lastSnap: Snapshot | null = null;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (actions: Action[]): void => {
    for (const a of actions) {
      queue = queue
        .then(() => act(a))
        .catch((e: unknown) => {
          d.log(`action error on run ${a.runId}: ${(e as Error).message}`);
          engine.release(a.runId);
        });
    }
  };

  // Rules judge closeable equity (spec §5), so every judged snapshot comes with the book of the same block; a missing
  // book pauses runs with an open position until the next push.
  const onSnap = (snap: Snapshot, book: BookRead | null): void => {
    lastSnap = snap;
    enqueue(engine.onSnapshot(snap, book));
  };

  const bookOf = (raw: Hex | undefined, block: bigint): BookRead | null => {
    try {
      const book = raw ? decodeBook(raw) : null;
      return book && book.blockNumber === block ? book : null;
    } catch {
      return null;
    }
  };

  const findFlowTx = async (account: Address, block: bigint): Promise<Hex | null> => {
    const tag = `0x${block.toString(16)}` as Hex;
    for (const topics of [[null, pad(account)], [null, null, pad(account)]]) {
      const logs = (await d.client.request({
        method: "eth_getLogs",
        params: [{ address: MARGIN_BANK, topics: topics as Hex[], fromBlock: tag, toBlock: tag }],
      })) as { transactionHash: Hex }[];
      const first = logs[0];
      if (first) return first.transactionHash;
    }
    return null;
  };

  const resumeAtHead = async (): Promise<void> => {
    const accounts = engine.watchedAccounts();
    if (accounts.length === 0) {
      engine.resume();
      return;
    }
    const snap = await readSnapshot(d.client, accounts, BTC_POOL);
    const gap = gaps.at(-1);
    if (gap && gap.resumedAtBlock === null) gap.resumedAtBlock = snap.blockNumber.toString();
    engine.resume();
    d.log(`resumed at block ${snap.blockNumber} after a gap; re-evaluating at head`);
    onSnap(snap, await readBookLevels(d.client, BTC_POOL, snap.blockNumber));
  };

  const resubscribe = (): void => {
    for (const w of watches) w.close();
    watches = [];
    connected.clear();
    const accounts = engine.watchedAccounts();
    watchedKey = accounts.map((a) => a.toLowerCase()).sort().join(",");
    if (accounts.length === 0) return;
    const call = snapshotCall(accounts, BTC_POOL);
    const topics = accounts.map((a) => pad(a));
    const decode = (results: Hex[]): Snapshot | null => {
      const raw = results[0];
      return raw ? decodeSnapshot(raw, accounts, BTC_POOL) : null;
    };
    const handlers = (i: number, onPush: (results: Hex[], logTopics: Hex[]) => void) => ({
      onPush: (p: { simulationResults: Hex[]; topics: Hex[] }) => onPush(p.simulationResults, p.topics),
      onConnected: ({ reconnects }: { reconnects: number }) => {
        connected.add(i);
        if (reconnects > 0 && connected.size === 3) void resumeAtHead().catch((e: unknown) => d.log(`resume error: ${(e as Error).message}`));
      },
      onGap: ({ atMs, reason }: { atMs: number; reason: string }) => {
        connected.delete(i);
        if (!engine.paused) {
          engine.pause();
          gaps.push({ atMs, reason, lastBlock: lastSnap ? lastSnap.blockNumber.toString() : "none", resumedAtBlock: null });
          d.log(`gap (${reason}): judging paused`);
        }
      },
    });
    watches.push(
      startWatch(
        d.wss,
        { address: PRICE_FEED_SCHEDULER, ethCalls: [call, bookCall(BTC_POOL)], pushChangesOnly: true },
        handlers(0, (results) => {
          const s = decode(results);
          if (s) onSnap(s, bookOf(results[1], s.blockNumber));
        }),
      ),
    );
    for (const position of [1, 2] as const) {
      const filterTopics = position === 1 ? [null, topics] : [null, null, topics];
      watches.push(
        startWatch(
          d.wss,
          { address: MARGIN_BANK, topics: filterTopics, ethCalls: [call] },
          handlers(position, (results, logTopics) => {
            const s = decode(results);
            if (s) lastSnap = s;
            const t = logTopics[position];
            const account = accounts.find((a) => t !== undefined && same(pad(a), t));
            if (account) enqueue(engine.onAccountLog(account, logTopics[0], null, s));
          }),
        ),
      );
    }
  };

  const act = async (a: Action): Promise<void> => {
    const er = engine.get(a.runId);
    if (!er) return;
    const rb = er.run.rulebook;
    const base = {
      runId: a.runId,
      account: a.account,
      rulebook: { name: rb.name, variant: rb.variant, label: rb.label, id: er.run.rulebookId },
      startBlock: er.run.startBlock,
      startEquity: er.run.startEquity,
      gaps: gaps.map((g) => ({ ...g })),
    };
    if (a.kind === "void") {
      const txHash = a.txHash ?? (lastSnap ? await findFlowTx(a.account, lastSnap.blockNumber) : null);
      const hash = writeRunEvidence(a.runId, { ...base, verdict: "VOIDED", reason: a.reason, flowTx: txHash });
      const tx = await retry(() => d.writer.recordVoid(a.runId, a.reason, txHash, hash));
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} VOIDED (${a.reason}) ${tx.explorer}`);
      return;
    }
    if (a.kind === "fail") {
      d.log(`run ${a.runId} breach ${a.rule} at block ${a.breach.blockNumber}: cancelling and closing`);
      const close = await flatten(d.closeIO, a.account);
      for (const t of close.txs) d.log(`  ${t.label} ${t.status} ${t.explorer}`);
      const hash = writeRunEvidence(a.runId, { ...base, verdict: "FAILED", rule: a.rule, breach: a.breach, judged: a.judged, close });
      const tx: TxRecord = await retry(() => d.writer.recordFail(a.runId, a.rule, a.breach, hash, close.txs.map((t) => t.hash)));
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} FAILED (${a.rule}) ${tx.explorer}`);
      return;
    }
    const quote = await d.markets.client.quotePerpClose({ pool: rb.market.pool, marginBank: MARGIN_BANK, account: a.account });
    const total = lastSnap?.accounts.find((x) => same(x.account, a.account))?.totalEquity ?? 0n;
    const predicted = predictClosedEquity(total, quote, rb.market.baseDecimals);
    if (!clearsTarget(predicted, er.run.startEquity, rb.profitTargetBps)) {
      engine.release(a.runId);
      return;
    }
    d.log(`run ${a.runId} target reached (predicted closed equity ${predicted}): locking`);
    const close = await flatten(d.closeIO, a.account);
    for (const t of close.txs) d.log(`  ${t.label} ${t.status} ${t.explorer}`);
    try {
      const tx = await d.writer.recordPass(a.runId);
      writeRunEvidence(a.runId, { ...base, verdict: "PASSED", predictedClosedEquity: predicted, close });
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} PASSED ${tx.explorer}`);
    } catch (e) {
      d.log(`run ${a.runId} recordPass refused (${(e as Error).message.slice(0, 160)}); the run continues`);
      engine.release(a.runId);
    }
  };

  const refresh = async (): Promise<void> => {
    const runs = await readActiveRuns(d.client, d.registry, index);
    for (const r of runs) if (engine.track(r)) d.log(`tracking run ${r.runId}: ${r.account} on ${r.rulebook.label}`);
    engine.retain(runs.map((r) => r.runId));
    const key = engine.watchedAccounts().map((a) => a.toLowerCase()).sort().join(",");
    if (key !== watchedKey) {
      resubscribe();
      // fresh sockets report reconnects === 0, so a pause from an earlier gap would otherwise never lift
      if (engine.paused) void resumeAtHead().catch((e: unknown) => d.log(`resume error: ${(e as Error).message}`));
    }
  };

  await refresh();
  setInterval(() => {
    void refresh().catch((e: unknown) => d.log(`refresh error: ${(e as Error).message}`));
  }, d.pollMs ?? 5_000);
  d.log(`referee watching registry ${d.registry}`);
  await new Promise<never>(() => undefined);
}
```

- [ ] **Step 5: Type-check (the daemon runs live in referee:10)**
Run: `npm run typecheck -w @basanos/referee`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 6: Run the whole referee suite**
Run: `npm test -w @basanos/referee`
Expected: no failed tests (`24 passed`).

- [ ] **Step 7: Run the new test (the gate)**
Run: `npm test -w @basanos/referee -- test/engine-closeable.test.ts`
Expected: PASS — `3 passed`.

- [ ] **Step 8: Commit (kernel-performed — no agent runs this)**
Message: `fix(referee): judge closeable equity with the book of the same block; FAIL evidence records it (P5)`

---

### Task 15: The bot opens from the book, the demo runs at 5×, and demo-check measures the spread (P5)

**Files:**
- Modify: `packages/bot/src/actions.ts`
- Modify: `packages/bot/src/sizing.ts`
- Modify: `packages/bot/src/demo.ts`
- Modify: `packages/bot/src/bot.ts`
- Modify: `packages/bot/src/demo-check.ts`
- Test: `packages/bot/test/demo-cost.test.ts`

**Depends on:** Task 2, Task 6, Task 8, Task 9, Task 11, Task 12, Task 13, spike:Task 1, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6
**Effort:** medium
**Model tier:** top
**Provides:** `openIoc(markets: SomniaMarkets, client: PublicClient, isBid: boolean, quantity: bigint): Promise<TxRecord> (capped from the book: best ask + 20 bps to buy, best bid - 20 bps to sell)`, `demoCost(buyAverage: bigint, sellAverage: bigint, leverageX: number, targetBps: number): { spreadBps: number; equityBps: number; ok: boolean }`, `CLI: npx tsx packages/bot/src/demo-check.ts [--equity <USDso>] -> PASS demo-check, or FAIL with a recommended demo target (closeable-equity cost: the spread for the demo size walked from one book read, at DEMO_LEVERAGE_X)`, `demo.ts and bot.ts size every demo order at DEMO_LEVERAGE_X (5x); the exposure breach stays at 16x`
**Requires:** `readBook(client: PublicClient): Promise<BookParams>`, `breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `demoEquity(flagValue: string | null, live: readonly bigint[]): bigint | null`, `demoSize(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): { qty: bigint; problem: string | null }`, `preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei?: bigint): Promise<Preflight>`, `notReady(pf: Preflight): string[]`, `parseTape(raw: unknown): TapePoint[]`, `simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint }`, `recommendDemoTargetBps(roundTripEqBps: number): number`, `makePublicClient(url: string): PublicClient`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `BTC_POOL`, `ORDER_TYPE_IOC = 2`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `loadDotEnv(path?: string): boolean`, `repoPath(rel: string): string`, `planOpenFromBook(isBid: boolean, quantity: bigint, book: BookSides, params: BookParams, marginBps?: number): OrderPlan`, `readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth?: number): Promise<BookRead | null>`, `averageFill(isBid: boolean, quantity: bigint, book: BookSides): bigint | null`, `DEMO_LEVERAGE_X = 5`, `roundTripSpreadBps(buyAverage: bigint, sellAverage: bigint): number`

Why (architect ruling P5, 2026-11-12; spec §5 and §9):
- **The open:** `openIoc()` priced the opening IOC at mark + 20 bps, below the whole ask side, so every demo open would revert.
  - It is now capped from the book with `planOpenFromBook`: best ask + 20 bps to buy, best bid − 20 bps to sell.
  - An IOC fills at the book's prices, so the wider cap does not worsen the fill.
- **The leverage: demo leverage 12× becomes `DEMO_LEVERAGE_X` (5×).** With closeable equity, opening costs the spread × leverage at once.
  - At 5× that is 1 to 18 equity bps on the measured 0.2 to 3.6 bps spread, inside the demo's 50 bps daily floor. At 12×, a 4.2 bps spread alone breaches it.
  - The recorded 540 s tape (−18.8 bps) still resolves both sides at 5×: a core test in referee:13.
  - The on-demand exposure breach stays at 16×.
- **The demo cost:** `demo-check` measured cost against the mark. That is the basis, about 19 bps, and it recommended a 1,100 bps demo target.
  - It now walks ONE book read for the demo size on both sides. The SDK's two quotes landed in different blocks and once gave a negative spread.
  - It charges that spread once, at entry, at 5×, against half the target. The tape simulation gets the same cost at entry and none at exit.
  - Read-only run on 2026-11-12 (`--equity 50`): round trip 1.98 to 2.84 bps of notional, which is 9.9 to 14.2 equity bps against 25: `PASS demo-check`.
- **Unchanged:** no rulebook changes; both registered ids stay. `DEMO_MIN_UNLOCKED` stays 5 USDso; a 5× size needs about 1.9 USDso to clear the pool minimum.

- [ ] **Step 1: Write the failing test**

`packages/bot/test/demo-cost.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { demoCost } from "../src/sizing";

const E15 = 10n ** 15n;
const source = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("the demo at closeable equity (P5 ruling 2026-11-12)", () => {
  it("charges the quoted spread once, at the demo leverage", () => {
    expect(demoCost(73_043_800n * E15, 73_042_200n * E15, DEMO_LEVERAGE_X, 50)).toEqual({ spreadBps: 0.21, equityBps: 1.05, ok: true });
    expect(demoCost(73_068_000n * E15, 73_042_000n * E15, DEMO_LEVERAGE_X, 50)).toEqual({ spreadBps: 3.55, equityBps: 17.75, ok: true });
    expect(demoCost(73_068_000n * E15, 73_042_000n * E15, 12, 50).ok).toBe(false);
  });
  it("sizes every demo order at DEMO_LEVERAGE_X and opens from the book, not the mark", () => {
    for (const file of ["demo.ts", "bot.ts", "demo-check.ts"]) {
      expect(source(file), file).toContain("DEMO_LEVERAGE_X");
      expect(source(file), file).not.toMatch(/\b12x\b|, 12, |"12"/);
    }
    expect(source("actions.ts")).toContain("planOpenFromBook(isBid, quantity, levels, params)");
    expect(source("actions.ts")).not.toContain("planOpen(");
    expect(source("demo-check.ts")).not.toContain("costBpsVsMark");
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/bot -- test/demo-cost.test.ts`
Expected: FAIL — `2 failed (2)`. `demoCost` does not exist, and the demo CLIs still say 12x and open from the mark.

- [ ] **Step 3: Open from the book**

Replace `packages/bot/src/actions.ts` with:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createWalletClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  INDEXER_URL,
  MARGIN_BANK,
  OPERATOR_REGISTRY,
  ORDER_TYPE_IOC,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  basanosRegistryAbi,
  marginBankAbi,
  perpPoolAbi,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { planOpenFromBook, readBookLevels } from "@basanos/core/book";
import { repoPath } from "@basanos/core/node";
import { jsonSafe, txRecord, type TxRecord } from "@basanos/referee";

export interface Preflight {
  account: Address;
  stt: bigint;
  sttOk: boolean;
  voucherClaimed: boolean;
  /** MarginBank getAccountState().unlockedCollateralBalance: the account's own deposited USDso not locked in a position. */
  unlockedCollateral: bigint;
  /** unlockedCollateral at or above what a demo run needs (DEMO_MIN_UNLOCKED unless the caller passes another need). */
  funded: boolean;
  flat: boolean;
  equity: bigint;
}

/** The least unlocked MarginBank margin a demo run needs: its DEMO_LEVERAGE_X (5x) size must clear the 0.00013 BTC
 *  pool minimum (about 1.9 USDso of equity) with room for costs. */
export const DEMO_MIN_UNLOCKED = 5n * 10n ** 18n;

/** Inferred return type: bound to CHAIN and the key's account. */
export function makeAccountWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type AccountWallet = ReturnType<typeof makeAccountWallet>;

export function makeMarkets(pk: Hex): SomniaMarkets {
  return new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES, privateKey: pk });
}

/** Reads only. Never claims a voucher: claim() reverts chain-wide (B14), so an account is ready when it is FUNDED,
 *  with its own wallet USDso deposited into its own MarginBank balance (spike:18 for A, spike:19 for B). */
export async function preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei: bigint = DEMO_MIN_UNLOCKED): Promise<Preflight> {
  const [stt, voucher, snap, state] = await Promise.all([
    client.getBalance({ address: account }),
    markets.client.getPerpVoucher(MARGIN_BANK, account),
    readSnapshot(client, [account], BTC_POOL),
    client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [account] }),
  ]);
  const a = snap.accounts[0];
  return {
    account,
    stt,
    sttOk: stt >= STT_WRITE_HEADROOM,
    voucherClaimed: voucher?.claimed ?? false,
    unlockedCollateral: state.unlockedCollateralBalance,
    funded: state.unlockedCollateralBalance >= needWei,
    flat: a ? a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0 : false,
    equity: a?.totalEquity ?? 0n,
  };
}

/** Why an account cannot start a demo run, or [] when it can. A voucher is never required. */
export function notReady(pf: Preflight): string[] {
  const p: string[] = [];
  if (!pf.sttOk) p.push(`STT ${pf.stt} is below the 0.6 write headroom (top up from the Tokyo faucet)`);
  if (!pf.funded) {
    p.push(
      `unlocked MarginBank margin is ${pf.unlockedCollateral} wei, below what a demo run needs; deposit the account's own wallet USDso first (deposit.ts: spike:18 for A, spike:19 for B)`,
    );
  }
  if (!pf.flat) p.push("the account is not flat (flatten it in the dreamDEX app first)");
  return p;
}

export async function readBook(client: PublicClient): Promise<BookParams> {
  const p = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
  return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
}

/** Grants the referee place + cancel on the BTC pool only, if not already granted. */
export async function ensureGrant(client: PublicClient, markets: SomniaMarkets, owner: Address, referee: Address): Promise<TxRecord | null> {
  const has = async (selector: Hex) =>
    client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
  if ((await has(PLACE_ORDER_FOR_SELECTOR)) && (await has(CANCEL_ORDER_FOR_SELECTOR))) return null;
  const r = await markets.trader.setOperatorApprovalForPool({
    pool: BTC_POOL,
    operator: referee,
    selectors: [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR],
    approved: true,
    operatorRegistry: OPERATOR_REGISTRY,
  });
  return txRecord("grant", r.receipt);
}

export function runIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], registry: Address): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") return ev.args.runId;
    } catch {
      // another registry event
    }
  }
  return null;
}

/** The account itself enrolls (msg.sender == account); the registry reads its start equity in the same tx. */
export async function startRunAs(wallet: AccountWallet, client: PublicClient, registry: Address, rulebookId: Hex): Promise<{ runId: bigint; tx: TxRecord }> {
  const hash = await wallet.writeContract({
    address: registry,
    abi: basanosRegistryAbi,
    functionName: "startRun",
    args: [wallet.account.address, rulebookId],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  const runId = runIdFromLogs(receipt.logs, registry);
  if (runId === null) throw new Error(`startRun emitted no RunStarted: ${hash}`);
  return { runId, tx: txRecord("startRun", receipt) };
}

/** Extra size so the account's notional strictly exceeds targetX x equity (the on-demand exposure breach). */
export function breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint {
  const oneBase = 10n ** BigInt(baseDecimals);
  const abs = currentSize < 0n ? -currentSize : currentSize;
  const targetNotional = equity * BigInt(targetX);
  const current = (abs * mark) / oneBase;
  const neededNotional = targetNotional > current ? targetNotional - current : 0n;
  const qty = alignUp((neededNotional * oneBase) / mark + 1n, book.lotSize);
  return qty < book.minQuantity ? book.minQuantity : qty;
}

/** An opening IOC capped from the book (best ask + 20 bps to buy, best bid - 20 bps to sell), never from the mark:
 *  the BTC-PERP book trades about 19 bps above the mark, so a mark + 20 bps buy does not fill (P5, 2026-11-12). */
export async function openIoc(markets: SomniaMarkets, client: PublicClient, isBid: boolean, quantity: bigint): Promise<TxRecord> {
  const params = await readBook(client);
  const levels = await readBookLevels(client, BTC_POOL);
  if (!levels) throw new Error("the BTC-PERP book could not be read");
  const plan = planOpenFromBook(isBid, quantity, levels, params);
  const r = await markets.trader.placePerpOrder({ pool: BTC_POOL, isBid, price: plan.price, quantity: plan.quantity, orderType: ORDER_TYPE_IOC });
  return txRecord(isBid ? "open long" : "open short", r.receipt);
}

export const DEMO_TAKES = "docs/evidence/demo-takes.json";

export function appendDemoTake(take: Record<string, unknown>, path: string = repoPath(DEMO_TAKES)): number {
  const all = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
  const n = all.length + 1;
  all.push(jsonSafe({ take: n, ...take }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
  return n;
}
```

- [ ] **Step 4: Add the demo-cost verdict**

Replace `packages/bot/src/sizing.ts` with:
```ts
// Demo sizing from real equity (guide, 2026-11-11). The demo accounts may hold 100–200 USDso instead of the
// 1,000-USDso voucher, so nothing assumes 1,000, and every size is checked against the pool's minimum order.
import { quantityForLeverage, type BookParams } from "@basanos/core";
import { roundTripSpreadBps } from "@basanos/core/demo-math";

const E18 = 10n ** 18n;

/** "150" or "150.25" USDso -> wei (18 decimals). */
export function parseUsdso(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim());
  if (!m) throw new Error(`not a USDso amount: ${text}`);
  return BigInt(m[1] ?? "0") * E18 + BigInt((m[2] ?? "").padEnd(18, "0"));
}

/** --equity wins; otherwise the smaller live equity of the demo accounts that hold any; null when neither does. */
export function demoEquity(flagValue: string | null, live: readonly bigint[]): bigint | null {
  if (flagValue !== null) return parseUsdso(flagValue);
  const funded = live.filter((e) => e > 0n);
  return funded.length === 0 ? null : funded.reduce((a, b) => (a < b ? a : b));
}

/** The least equity (wei) whose leveraged size reaches the pool minimum. */
export function minEquityFor(book: BookParams, leverageX: number, mark: bigint, baseDecimals: number): bigint {
  const unit = 10n ** BigInt(baseDecimals);
  const minNotional = (book.minQuantity * mark + unit - 1n) / unit;
  return (minNotional + BigInt(leverageX) - 1n) / BigInt(leverageX);
}

/** The demo order size for an equity, or why it cannot trade. */
export function demoSize(
  equity: bigint,
  leverageX: number,
  mark: bigint,
  baseDecimals: number,
  book: BookParams,
): { qty: bigint; problem: string | null } {
  const qty = quantityForLeverage(equity, leverageX, mark, baseDecimals, book);
  if (qty >= book.minQuantity) return { qty, problem: null };
  return {
    qty,
    problem: `the demo size ${qty} is below the pool minimum ${book.minQuantity}; at ${leverageX}x the account needs at least ${minEquityFor(book, leverageX, mark, baseDecimals)} wei of equity`,
  };
}

/** The demo-cost verdict at closeable equity (spec §5, P5 ruling 2026-11-12): a run pays the spread between the quoted
 *  buy and sell averages for the demo size at entry, and nothing more at the close. The round trip may use at most half
 *  the demo target. */
export function demoCost(buyAverage: bigint, sellAverage: bigint, leverageX: number, targetBps: number): { spreadBps: number; equityBps: number; ok: boolean } {
  const spreadBps = roundTripSpreadBps(buyAverage, sellAverage);
  const equityBps = Math.round(spreadBps * leverageX * 100) / 100;
  return { spreadBps, equityBps, ok: equityBps <= targetBps / 2 };
}
```

- [ ] **Step 5: Size the demo at DEMO_LEVERAGE_X**

Replace `packages/bot/src/demo.ts` with:
```ts
// The demo runner. Primary: both builder-operated accounts take Tokyo Sprint · Demo with opposite positions at
// DEMO_LEVERAGE_X (5x; rules judge closeable equity, spec §5). Fallback (--one-account, only if account B cannot be
// funded): account A takes two runs in sequence. Run 1 is a FAIL on demand: a 5x long, then size past the 15x
// exposure cap. Run 2 is the PASS attempt: 5x (--pass-side long|short),
// held until the referee locks the target or a rule ends it. A PASS is not guaranteed with one account, which is why
// the two-account demo is primary. Accounts must be FUNDED (own USDso deposited, spike:18 / spike:19); no voucher.
// The referee daemon (packages/referee/src/cli.ts start) must already be running in another terminal.
import type { Address, Hex } from "viem";
import { BTC_POOL, RULE_NAMES, RUN_STATUS, basanosRegistryAbi, explorerTx, quantityForLeverage, readSnapshot, rulebookId } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, type TxRecord } from "@basanos/referee";
import { appendDemoTake, breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, notReady, openIoc, preflight, readBook, startRunAs } from "./actions";

loadDotEnv();
const argv = process.argv.slice(2);
const manualA = argv.includes("--a-manual");
const oneAccount = argv.includes("--one-account");
const passSide = argv[argv.indexOf("--pass-side") + 1] === "short" ? "short" : "long";
const waitMin = Number(argv[argv.indexOf("--wait-min") + 1] ?? "10") || 10;
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");
const rb = loadRulebook("tokyo-sprint-demo");
const id: Hex = rulebookId(rb);
const txs: TxRecord[] = [];
const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);

say(
  oneAccount
    ? "Basanos demo (one-account fallback): account A is a burner operated by the builder; run 1 FAIL by exposure, run 2 the PASS attempt."
    : "Basanos demo: both challenge accounts are burners operated by the builder (A human-driven, B scripted).",
);
const accounts = (oneAccount ? (["ACCOUNT_A_PK"] as const) : (["ACCOUNT_A_PK", "ACCOUNT_B_PK"] as const)).map((name) => {
  const pk = requirePrivateKey(name);
  const wallet = makeAccountWallet(pk, rpcHttp());
  return { name, wallet, markets: makeMarkets(pk), address: wallet.account.address as Address };
});
for (const a of accounts) {
  const pf = await preflight(client, a.markets, a.address);
  say(`${a.name} ${a.address}: stt ${pf.stt} unlocked margin ${pf.unlockedCollateral} flat ${pf.flat} equity ${pf.equity}`);
  const problems = notReady(pf);
  if (problems.length > 0) {
    say(`STOP: ${a.name} is not ready: ${problems.join("; ")}. No voucher is ever claimed here.`);
    process.exit(1);
  }
  const g = await ensureGrant(client, a.markets, a.address, referee);
  if (g) txs.push(g);
}
const statusOf = async (runId: bigint) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
const label = (r: Awaited<ReturnType<typeof statusOf>> | undefined) => (r ? `${RUN_STATUS[r.status] ?? r.status}${r.rule ? `/${RULE_NAMES[r.rule]}` : ""}` : "?");

if (oneAccount) {
  const [accA] = accounts;
  if (!accA) throw new Error("account A expected");
  const book = await readBook(client);
  const waitVerdict = async (runId: bigint) => {
    for (;;) {
      const r = await statusOf(runId);
      say(`run ${runId}: ${label(r)}`);
      if (r && r.status !== 1) return r;
      await new Promise((res) => setTimeout(res, 2_000));
    }
  };
  const waitFlat = async () => {
    const until = Date.now() + 5 * 60_000;
    for (;;) {
      const a = (await readSnapshot(client, [accA.address], BTC_POOL)).accounts[0];
      if (a && a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0) return;
      if (Date.now() > until) throw new Error("account A is not flat 5 min after run 1's verdict");
      await new Promise((res) => setTimeout(res, 3_000));
    }
  };
  const runIds: bigint[] = [];
  // Run 1: FAIL on demand by exposure.
  const r1 = await startRunAs(accA.wallet, client, registry, id);
  runIds.push(r1.runId);
  txs.push(r1.tx);
  say(`run 1 (${r1.runId}) on ${rb.label}: ${r1.tx.explorer}`);
  const s1 = await readSnapshot(client, [accA.address], BTC_POOL);
  txs.push(await openIoc(accA.markets, client, true, quantityForLeverage(s1.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, s1.markPrice, 8, book)));
  const s1b = (await readSnapshot(client, [accA.address], BTC_POOL)).accounts[0];
  if (s1b && s1b.size !== 0n) {
    txs.push(await openIoc(accA.markets, client, true, breachQuantity(s1b.size, s1b.totalEquity, 16, s1.markPrice, 8, book)));
    say("run 1: size added past the 15x exposure cap (FAIL on demand)");
  }
  const v1 = await waitVerdict(r1.runId);
  await waitFlat();
  // Run 2: the PASS attempt.
  const r2 = await startRunAs(accA.wallet, client, registry, id);
  runIds.push(r2.runId);
  txs.push(r2.tx);
  say(`run 2 (${r2.runId}) on ${rb.label}, ${passSide} ${DEMO_LEVERAGE_X}x: ${r2.tx.explorer}`);
  const s2 = await readSnapshot(client, [accA.address], BTC_POOL);
  txs.push(await openIoc(accA.markets, client, passSide === "long", quantityForLeverage(s2.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, s2.markPrice, 8, book)));
  const v2 = await waitVerdict(r2.runId);
  const take = appendDemoTake({
    at: new Date().toISOString(),
    mode: "one-account",
    rulebook: { id, label: rb.label },
    runs: [
      { runId: r1.runId, account: accA.address, status: RUN_STATUS[v1.status], rule: RULE_NAMES[v1.rule] },
      { runId: r2.runId, account: accA.address, status: RUN_STATUS[v2.status], rule: RULE_NAMES[v2.rule], side: passSide },
    ],
    breachedOnDemand: true,
    txs,
  });
  say(`take ${take} recorded in docs/evidence/demo-takes.json (one-account fallback)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  process.exit(0);
}

const runs: bigint[] = [];
for (const a of accounts) {
  const { runId, tx } = await startRunAs(a.wallet, client, registry, id);
  runs.push(runId);
  txs.push(tx);
  say(`${a.name} run ${runId} on ${rb.label}: ${tx.explorer}`);
}
const book = await readBook(client);
const snap = await readSnapshot(client, accounts.map((a) => a.address), BTC_POOL);
const [accA, accB] = accounts;
if (!accA || !accB) throw new Error("two accounts expected");
const qtyB = quantityForLeverage(snap.accounts[1]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, snap.markPrice, 8, book);
txs.push(await openIoc(accB.markets, client, false, qtyB));
say(`B short ${qtyB} at ${DEMO_LEVERAGE_X}x`);
if (manualA) {
  say(`A: open the long from the Basanos terminal now (${DEMO_LEVERAGE_X}x).`);
} else {
  const qtyA = quantityForLeverage(snap.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, snap.markPrice, 8, book);
  txs.push(await openIoc(accA.markets, client, true, qtyA));
  say(`A long ${qtyA} at ${DEMO_LEVERAGE_X}x`);
}
const openedAt = Date.now();
let breached = false;
for (;;) {
  const [ra, rbRun] = await Promise.all(runs.map((r) => statusOf(r)));
  const states = [ra, rbRun].map((r) => label(r));
  say(`runs ${runs.join(", ")}: ${states.join(" | ")}`);
  if (ra && rbRun && ra.status !== 1 && rbRun.status !== 1) break;
  if (!breached && Date.now() - openedAt > waitMin * 60_000 && rbRun?.status === 1) {
    say("market still — take aborted: exposure breach on B (FAIL on demand); A resolves or hits its time limit");
    const s = await readSnapshot(client, [accB.address], BTC_POOL);
    const b = s.accounts[0];
    if (b && b.size !== 0n) txs.push(await openIoc(accB.markets, client, b.size > 0n, breachQuantity(b.size, b.totalEquity, 16, s.markPrice, 8, book)));
    breached = true;
  }
  await new Promise((r) => setTimeout(r, 2_000));
}
const final = await Promise.all(runs.map((r) => statusOf(r)));
const take = appendDemoTake({
  at: new Date().toISOString(),
  mode: "two-account",
  rulebook: { id, label: rb.label },
  runs: runs.map((r, i) => ({ runId: r, account: accounts[i]?.address, status: RUN_STATUS[final[i]?.status ?? 0], rule: RULE_NAMES[final[i]?.rule ?? 0] })),
  breachedOnDemand: breached,
  txs,
});
say(`take ${take} recorded in docs/evidence/demo-takes.json`);
for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
process.exit(0);
```

Replace `packages/bot/src/bot.ts` with:
```ts
// The scripted challenger (account B). It signs as itself; the referee's grant is the only delegation.
import { BTC_POOL, readSnapshot, rulebookId, quantityForLeverage } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, notReady, openIoc, preflight, readBook, startRunAs } from "./actions";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? (rest[i + 1] as string) : fallback;
};
const pk = requirePrivateKey("ACCOUNT_B_PK");
const wallet = makeAccountWallet(pk, rpcHttp());
const account = wallet.account.address;
const client = makePublicClient(rpcHttp());
const markets = makeMarkets(pk);
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");

if (cmd === "start") {
  const name = opt("--rulebook", "tokyo-sprint-demo") as keyof typeof RULEBOOK_FILES;
  const side = opt("--side", "short");
  const leverage = Number(opt("--leverage", String(DEMO_LEVERAGE_X)));
  const pf = await preflight(client, markets, account);
  const problems = notReady(pf);
  if (problems.length > 0) {
    console.error(`bot preflight failed: ${problems.join("; ")}`);
    process.exit(1);
  }
  const grant = await ensureGrant(client, markets, account, referee);
  if (grant) console.log(`grant ${grant.explorer}`);
  const { runId, tx } = await startRunAs(wallet, client, registry, rulebookId(loadRulebook(name)));
  console.log(`run ${runId} started ${tx.explorer}`);
  const snap = await readSnapshot(client, [], BTC_POOL);
  const qty = quantityForLeverage(pf.equity, leverage, snap.markPrice, 8, await readBook(client));
  const open = await openIoc(markets, client, side === "long", qty);
  console.log(`${open.label} ${qty} ${open.status} ${open.explorer}`);
  process.exit(0);
} else if (cmd === "breach") {
  const leverage = Number(opt("--leverage", "16"));
  const snap = await readSnapshot(client, [account], BTC_POOL);
  const a = snap.accounts[0];
  if (!a || a.size === 0n) {
    console.error("bot has no position to extend");
    process.exit(1);
  }
  const add = breachQuantity(a.size, a.totalEquity, leverage, snap.markPrice, 8, await readBook(client));
  const tx = await openIoc(markets, client, a.size > 0n, add);
  console.log(`exposure breach: +${add} ${tx.status} ${tx.explorer}`);
  process.exit(0);
} else {
  console.error(`usage: bot.ts start [--rulebook <name>] [--side short|long] [--leverage ${DEMO_LEVERAGE_X}] | breach [--leverage 16]`);
  process.exit(2);
}
```

- [ ] **Step 6: Measure the demo cost as the spread from one book read**

Replace `packages/bot/src/demo-check.ts` with:
```ts
// Decides whether the demo target is trustworthy given real trading costs (spec §5). Read-only.
// Rules judge closeable equity (P5 ruling, 2026-11-12), so a run pays the spread between the two sides of the book at
// entry and nothing more at the close: the cost is the buy average minus the sell average for the demo size, both
// walked from ONE book read (one block), at DEMO_LEVERAGE_X. (The distance from the mark is the mark-to-book basis, about 19 bps on 2026-11-12, and is
// not a cost any more.) Sizes from the demo accounts' real equity (or --equity <USDso>), never from a fixed 1,000
// USDso, and checks the size against the pool's minimum order (0.00013 BTC on BTC-PERP).
import { readFileSync } from "node:fs";
import { BTC_POOL, readSnapshot } from "@basanos/core";
import { averageFill, readBookLevels } from "@basanos/core/book";
import { DEMO_LEVERAGE_X, parseTape, recommendDemoTargetBps, simulateTape } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { readBook } from "./actions";
import { demoCost, demoEquity, demoSize } from "./sizing";

loadDotEnv();
const rb = loadRulebook("tokyo-sprint-demo");
const flagAt = process.argv.indexOf("--equity");
const equityFlag = flagAt >= 0 ? (process.argv[flagAt + 1] ?? "") : null;
const client = makePublicClient(rpcHttp());
const book = await readBook(client);
const accounts = equityFlag === null ? [requireAddress("ACCOUNT_A_ADDRESS"), requireAddress("ACCOUNT_B_ADDRESS")] : [];
const snap = await readSnapshot(client, accounts, BTC_POOL);
let equity: bigint | null;
try {
  equity = demoEquity(equityFlag, snap.accounts.map((a) => a.totalEquity));
} catch (e) {
  console.log(`FAIL demo-check: ${(e as Error).message}`);
  process.exit(1);
}
if (equity === null) {
  console.log("FAIL demo-check: accounts A and B hold no equity yet; fund them, or pass --equity <USDso> (for example --equity 50)");
  process.exit(1);
}
const size = demoSize(equity, DEMO_LEVERAGE_X, snap.markPrice, rb.market.baseDecimals, book);
if (size.problem) {
  console.log(`FAIL demo-check: ${size.problem}`);
  process.exit(1);
}
const qty = size.qty;
const levels = await readBookLevels(client, BTC_POOL);
const buyAverage = levels ? averageFill(true, qty, levels) : null;
const sellAverage = levels ? averageFill(false, qty, levels) : null;
if (buyAverage === null || sellAverage === null) {
  console.log(`FAIL demo-check: the book is too thin to fill the demo size ${qty} on both sides; retry when the book refills, or lower the demo leverage`);
  process.exit(1);
}
const cost = demoCost(buyAverage, sellAverage, DEMO_LEVERAGE_X, rb.profitTargetBps);
const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
const sim = simulateTape(rb, tape, { leverageX: DEMO_LEVERAGE_X, startEquity: equity, lotSize: book.lotSize, entryCostBps: cost.spreadBps, exitCostBps: 0 });
const tapeOk = sim.long.outcome === "target" || sim.short.outcome === "target";
console.log(
  `demo size ${qty} (${DEMO_LEVERAGE_X}x on ${equity} wei of equity, ${equityFlag === null ? "the smaller live equity of A and B" : "from --equity"}); ` +
    `round trip ${cost.spreadBps} bps of notional at block ${levels?.blockNumber} (buy average ${buyAverage}, sell average ${sellAverage})`,
);
console.log(`round trip ${cost.equityBps} equity bps vs half target ${rb.profitTargetBps / 2}: ${cost.ok ? "ok" : "too costly"}`);
console.log(`tape with costs: long ${sim.long.outcome}, short ${sim.short.outcome}`);
if (cost.ok && tapeOk) {
  console.log("PASS demo-check");
  process.exit(0);
}
console.log(`FAIL demo-check: raise profitTargetBps in rulebooks/tokyo-sprint-demo.json to ${recommendDemoTargetBps(cost.equityBps)} and register it`);
process.exit(1);
```

- [ ] **Step 7: Type-check (the demo runs live in referee:10 and ship:3)**
Run: `npm run typecheck -w @basanos/bot`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 8: Run the whole bot suite**
Run: `npm test -w @basanos/bot`
Expected: no failed tests (`11 passed`).

- [ ] **Step 9: Run the new test (the gate)**
Run: `npm test -w @basanos/bot -- test/demo-cost.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 10: Commit (kernel-performed — no agent runs this)**
Message: `fix(bot): open from the book, run the demo at 5x, measure the demo cost as the spread (P5)`

---

### Task 16: Account writes in core — the grant, open and startRun calls, byte-identical to the SDK's encoding (P6)

**Files:**
- Create: `packages/core/src/owner-tx.ts`
- Modify: `packages/spike/src/live-lib.ts`
- Test: `packages/core/test/owner-tx.test.ts`

**Depends on:** spike:Task 2, contracts:Task 8, spike:Task 10, spike:Task 14, spike:Task 15, spike:Task 16
**Effort:** low
**Model tier:** standard
**Provides:** `interface UnsignedCall { to: Address; data: Hex; value: bigint }`, `ownerPoolAbi (owner-side placeOrder, selector 0x4e978373)`, `ownerOrderCall(pool: Address, isBid: boolean, price: bigint, quantity: bigint, orderType: number, expireTimestampNs: bigint): UnsignedCall`, `grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall`, `startRunCall(registry: Address, account: Address, rulebookId: Hex): UnsignedCall`, `ownerTx(call: UnsignedCall, nonce: number, gas: bigint): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }`, `@basanos/core/owner-tx (the account-write builders, byte-identical to the SDK's encoding; packages/spike/src/live-lib.ts re-exports them)`
**Requires:** `operatorRegistryAbi`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `BTC_POOL`, `CANCEL_ORDER_FOR_SELECTOR`, `PLACE_ORDER_FOR_SELECTOR`, `CHAIN (hidekiTestnet, id 50383)`, `HIDEKI_ADDRESSES`, `INDEXER_URL`, `OPERATOR_REGISTRY`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_IOC = 2`

Why (architect P6, 2026-11-12; spec §9): referee:17 moves the bot's own writes onto viem-direct, as spike:14 did for account A's skeleton writes. The calls it signs must be the bytes the SDK encodes. spike:14's builders live in `packages/spike/src/live-lib.ts`, which the bot cannot import, so this task moves them into `@basanos/core/owner-tx`:
- `ownerOrderCall`, `grantCall`, `ownerTx`, `ownerPoolAbi` and `UnsignedCall` move unchanged. `live-lib.ts` re-exports them, so the spike scripts and their tests keep one import and the spike suite stays at 35.
- `startRunCall` is new: the account's own `startRun(account, rulebookId)`.
- The test pins the bytes to the SDK itself: the opening IOC against the SDK's own build verb `buildPlacePerpOrder` (which shares its call with `placePerpOrder`), on both sides, built from a throwaway key that is never funded and sends nothing; the grant against `operatorRegistryWriteAbi.setOperatorApprovalForPool` (the SDK has no build verb for it).

Checked read-only on Hideki on 2026-11-12, from public addresses only: B's grant, B's book-capped 5× short and A's book-capped 5× long simulate OK; A's `startRun` simulates OK (previewStart code 0); B's reverts with code 3 until its grant lands, which the demo sends first.

- [ ] **Step 1: Write the failing test**

`packages/core/test/owner-tx.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeFunctionData, type Address } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { SomniaMarkets, operatorRegistryWriteAbi } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  INDEXER_URL,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORDER_TYPE_IOC,
  PLACE_ORDER_FOR_SELECTOR,
  basanosRegistryAbi,
} from "../src/index";
import { grantCall, ownerOrderCall, ownerTx, startRunCall } from "../src/owner-tx";

const E18 = 10n ** 18n;
const REFEREE: Address = "0xE358D82209ea9360F411A041C0200adc385877eb";
const ACCOUNT: Address = "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1";
const REGISTRY: Address = "0xf5d8099239200dF961E0910a42c105214d1e9370";
const EXPIRY = 3_371_163_205_000_000_000n;

describe("account writes build the bytes the SDK encodes (P6)", () => {
  it("encodes an opening IOC exactly as the SDK's own build verb, on both sides", async () => {
    // A throwaway key, never funded: the SDK needs one to hand out a trader. Building sends nothing.
    const trader = new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES, privateKey: generatePrivateKey() }).trader;
    for (const isBid of [true, false]) {
      const price = isBid ? 72_797_900n * 10n ** 15n : 72_506_200n * 10n ** 15n;
      const { order } = await trader.buildPlacePerpOrder({ pool: BTC_POOL, isBid, price, quantity: 342_000n, orderType: ORDER_TYPE_IOC, expireTimestampNs: EXPIRY });
      const c = ownerOrderCall(BTC_POOL, isBid, price, 342_000n, ORDER_TYPE_IOC, EXPIRY);
      expect(c.to).toBe(order.to);
      expect(c.value).toBe(order.value);
      expect(c.data).toBe(order.data);
      expect(c.data.slice(0, 10)).toBe("0x4e978373");
    }
  });
  it("encodes the referee's grant exactly as the SDK's setOperatorApprovalForPool", () => {
    const selectors = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR];
    const c = grantCall(OPERATOR_REGISTRY, BTC_POOL, REFEREE, selectors);
    expect(c.to).toBe(OPERATOR_REGISTRY);
    expect(c.value).toBe(0n);
    expect(c.data.slice(0, 10)).toBe("0x7bbc67e6");
    expect(c.data).toBe(encodeFunctionData({ abi: operatorRegistryWriteAbi, functionName: "setOperatorApprovalForPool", args: [BTC_POOL, REFEREE, selectors, true] }));
  });
  it("encodes startRun for the account itself", () => {
    const id = "0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757";
    const c = startRunCall(REGISTRY, ACCOUNT, id);
    expect(c.to).toBe(REGISTRY);
    expect(c.value).toBe(0n);
    const d = decodeFunctionData({ abi: basanosRegistryAbi, data: c.data });
    expect(d.functionName).toBe("startRun");
    expect(d.args).toEqual([ACCOUNT, id]);
  });
  it("signs with ORDER_GAS and an explicit nonce", () => {
    const c = ownerOrderCall(BTC_POOL, true, 72_000n * E18, 13_000n, ORDER_TYPE_IOC, EXPIRY);
    expect(ownerTx(c, 2, ORDER_GAS)).toEqual({ to: BTC_POOL, data: c.data, value: 0n, gas: 10_000_000n, nonce: 2 });
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/core -- test/owner-tx.test.ts`
Expected: FAIL — `Cannot find module '../src/owner-tx'`.

- [ ] **Step 3: Add the account-write builders to core**

`packages/core/src/owner-tx.ts`:
```ts
// The writes a challenge account signs itself, as unsigned calls, and the exact transaction it signs (P6, 2026-11-12).
// Moved here from packages/spike/src/live-lib.ts (spike:14), which re-exports them, so the bot and the spike build the
// same bytes. Each call encodes what the SDK's own write encodes: placeOrder as perpPoolWriteAbi (the SDK's
// placePerpOrder and buildPlacePerpOrder), the grant as operatorRegistryWriteAbi (the SDK's setOperatorApprovalForPool);
// owner-tx.test.ts pins both byte for byte. Nothing here sends: packages/bot/src/send.ts and the spike scripts do.
import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem";
import { operatorRegistryAbi } from "./abi";
import { basanosRegistryAbi } from "./abi/basanosRegistry";

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

/** The account enrolls itself on a rulebook (msg.sender == account; the registry reads its start equity in the same tx). */
export function startRunCall(registry: Address, account: Address, rulebookId: Hex): UnsignedCall {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({ abi: basanosRegistryAbi, functionName: "startRun", args: [account, rulebookId] }),
  };
}

/** The exact transaction an account signs: a fixed gas limit and an explicit nonce. */
export function ownerTx(
  call: UnsignedCall,
  nonce: number,
  gas: bigint,
): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number } {
  return { to: call.to, data: call.data, value: call.value, gas, nonce };
}
```

- [ ] **Step 4: Re-export them from the spike**

Replace `packages/spike/src/live-lib.ts` with:
```ts
import {
  decodeAbiParameters,
  decodeFunctionResult,
  getAbiItem,
  getAddress,
  parseAbi,
  parseAbiParameters,
  toEventSelector,
  type Address,
  type Hex,
} from "viem";
import { ORACLE_DEPOSIT, explorerTx, priceOracleAbi, somniaAgentsAbi, type AccountSnapshot } from "@basanos/core";

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
// The call builders live in @basanos/core/owner-tx since P6 (2026-11-12), shared with the bot; they are re-exported
// here so the spike scripts and their tests keep one import.
// ---------------------------------------------------------------------------------------------------------------

export { grantCall, ownerOrderCall, ownerPoolAbi, ownerTx, type UnsignedCall } from "@basanos/core/owner-tx";

/** How account A's own writes reach the chain; recorded in the evidence as `sendPath`. */
export type SendPath = "viem" | "sdk";

export function parseSendPath(argv: readonly string[]): SendPath {
  return argv.includes("--sdk-send") ? "sdk" : "viem";
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

- [ ] **Step 5: Type-check core and the spike**
Run: `npm run typecheck -w @basanos/core`
Run: `npm run typecheck -w @basanos/spike`
Expected: both exit 0 with no `error TS` lines.

- [ ] **Step 6: Run the spike suite (the re-export keeps every import)**
Run: `npm test -w @basanos/spike`
Expected: no failed tests (`35 passed`).

- [ ] **Step 7: Run the new test (the gate)**
Run: `npm test -w @basanos/core -- test/owner-tx.test.ts`
Expected: PASS — `4 passed`.

- [ ] **Step 8: Commit (kernel-performed — no agent runs this)**
Message: `refactor(core): account-write builders move to @basanos/core/owner-tx, pinned to the SDK's encoding (P6)`

---

### Task 17: The bot's writes go viem-direct and are read back from the chain; a take that fails after a run started aborts without re-sending (P6)

**Files:**
- Create: `packages/bot/src/send.ts`
- Modify: `packages/bot/src/actions.ts`
- Modify: `packages/bot/src/demo.ts`
- Modify: `packages/bot/src/bot.ts`
- Test: `packages/bot/test/send.test.ts`

**Depends on:** Task 3, Task 6, Task 8, Task 12, Task 13, Task 15, Task 16, spike:Task 1, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6, contracts:Task 8
**Effort:** medium
**Model tier:** top
**Provides:** `RECEIPT_WAIT_MS = 60_000`, `VERDICT_GRACE_SEC = 300`, `interface Sender { address: Address; pendingNonce(): Promise<number>; sign(tx: SignedTx): Promise<Hex>; sendRaw(raw: Hex): Promise<unknown>; waitReceipt(hash: Hex, timeoutMs: number): Promise<Receipt>; receipt(hash: Hex): Promise<Receipt | null> }`, `type SendResult = { outcome: "landed"; label: string; hash: Hex; nonce: number; tx: TxRecord; reason: null } | { outcome: "unknown"; label: string; hash: Hex; nonce: number; tx: null; reason: string }`, `sendWrite(s: Sender, label: string, call: UnsignedCall, waitMs?: number): Promise<SendResult> (signs at the pending nonce with ORDER_GAS, sends the raw transaction once, takes the receipt by the hash known before the send; never re-sends)`, `type Effect = "done" | "not-done" | "unknown"`, `effectOf(sent: SendResult, seen: boolean, latestNonce: number): Effect`, `interface AccountWrite { sent: SendResult; effect: Effect }`, `describeWrite(w: AccountWrite): string`, `type WriteKind = "grant" | "start" | "open" | "breach"`, `onFailure(kind: WriteKind | "error", runsStarted: number): "stop" | "abort" | "note"`, `verdictDeadline(lastStartMs: number, timeLimitSec: number): number`, `type AccountWallet = ReturnType<typeof makeAccountWallet>`, `viemSender(wallet: AccountWallet, client: PublicClient): Sender (signs locally; nonce, raw send and receipt on the standard RPC)`, `makeMarkets(): SomniaMarkets (read-only: the bot never hands the SDK a key)`, `ensureGrant(client: PublicClient, wallet: AccountWallet, referee: Address): Promise<AccountWrite | null> (viem-direct; done only when both selectors read authorized)`, `startRunAs(client: PublicClient, wallet: AccountWallet, registry: Address, rulebookId: Hex): Promise<AccountWrite & { runId: bigint | null }> (viem-direct; the run read back from activeRunOf)`, `openIoc(client: PublicClient, wallet: AccountWallet, isBid: boolean, quantity: bigint, label?: string): Promise<AccountWrite> (capped from the book; viem-direct; done only if the position size moved; never re-sent)`, `DEMO_ABORTED = "docs/evidence/demo-aborted.json"`, `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--wait-min 10] [--one-account [--pass-side long|short]] (two funded accounts by default; --one-account is the A-only fallback; every account write viem-direct and read back; a take that fails after a run started aborts: nothing re-sent, verdicts awaited, recorded in docs/evidence/demo-aborted.json, exit 1)`, `CLI: npx tsx packages/bot/src/bot.ts start [--rulebook <name>] [--side short|long] [--leverage 5] | breach [--leverage 16] (viem-direct writes, read back; stops on a write that does not take effect)`
**Requires:** `interface UnsignedCall { to: Address; data: Hex; value: bigint }`, `ownerOrderCall(pool: Address, isBid: boolean, price: bigint, quantity: bigint, orderType: number, expireTimestampNs: bigint): UnsignedCall`, `grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall`, `startRunCall(registry: Address, account: Address, rulebookId: Hex): UnsignedCall`, `ownerTx(call: UnsignedCall, nonce: number, gas: bigint): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `interface TxRecord { label: string; hash: Hex; status: "success" | "reverted"; gasUsed: bigint; costWei: bigint; explorer: string }`, `jsonSafe(value: unknown): unknown`, `makePublicClient(url: string): PublicClient`, `makeAccountWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`, `readBook(client: PublicClient): Promise<BookParams>`, `breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `appendDemoTake(take: Record<string, unknown>, path?: string): number`, `runIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], registry: Address): bigint | null`, `preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei?: bigint): Promise<Preflight>`, `notReady(pf: Preflight): string[]`, `interface Preflight { account: Address; stt: bigint; sttOk: boolean; voucherClaimed: boolean; unlockedCollateral: bigint; funded: boolean; flat: boolean; equity: bigint }`, `planOpenFromBook(isBid: boolean, quantity: bigint, book: BookSides, params: BookParams, marginBps?: number): OrderPlan`, `readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth?: number): Promise<BookRead | null>`, `DEMO_LEVERAGE_X = 5`, `repoPath(rel: string): string`, `BTC_POOL`, `CANCEL_ORDER_FOR_SELECTOR`, `PLACE_ORDER_FOR_SELECTOR`, `CHAIN (hidekiTestnet, id 50383)`, `HIDEKI_ADDRESSES`, `INDEXER_URL`, `MARGIN_BANK`, `OPERATOR_REGISTRY`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_IOC = 2`, `farFutureNs(nowMs?: number): bigint`, `explorerTx(hash: Hex): string`, `marginBankAbi`, `perpPoolAbi`, `loadDotEnv(path?: string): boolean`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `rulebookId(rb: Rulebook): Hex`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`

Why (architect P6, 2026-11-12, on the guide's diagnosis B18; spec §9):
- **The stop:** referee:10's first GO died in `ensureGrant` for B. The SDK's `setOperatorApprovalForPool` threw `TransactionOutcomeUnknownError`: `eth_sendRawTransactionSync` timed out on `send.hideki…`. The guide found nothing on either RPC host, B's nonce still 2 and runCount 0. It is the second "outcome unknown" on the SDK's send path (the first was the voucher claim on Nov 11, why spike:14 moved A's writes). Every viem-direct transaction since has landed: the deploy, both registrations, the A-to-B transfer, 4 deposits and 5 skeleton transactions.
- **P6a, the send path.** The bot was the one place still on it: `ensureGrant` (`markets.trader.setOperatorApprovalForPool`) and `openIoc` (`markets.trader.placePerpOrder`), used by `demo.ts` and `bot.ts`.
  - `send.ts` does what spike:14 does for A. It signs locally with `ORDER_GAS` and the pending nonce, sends the raw bytes once with `eth_sendRawTransaction` to the standard RPC, and takes the receipt from the public client.
  - Signing first gives the hash before the send, so a send that fails or times out is still looked up by that hash.
  - The grant, `startRun` and every open go through it, with calls built by referee:16.
  - `makeMarkets()` loses its key: the SDK stays for reads only, so no SDK write can leave the bot.
- **P6b, never a blind re-send.**
  - A write counts only when its effect is read back: both grant selectors authorized, the account's `activeRunOf`, or its position size moving.
  - Unseen, it did not happen if it has a receipt or its nonce was used; otherwise its outcome is unknown and it may still land. The latest nonce is read before the effect, so a write that lands between the two reads is seen.
  - Nothing is ever re-sent. A grant is idempotent, but an open is not.
- **P6b, what the demo does (`onFailure`):**
  - **Before the take has started a run:** it stops (exit 1). A re-run starts over and re-reads the grant and the active run before sending anything. All preflights now pass before the first write.
  - **Once a run has started, the take aborts.** Nothing is re-sent and no run is voided. A void is the referee's verdict on a flow, a foreign market or a revoked grant, and none of those happened. Revoking the grant to force one would leave the referee unable to close an open that lands late.
  - **What the abort does next:** the referee ends each run by a rule or at its time limit (FAIL TimeLimit at 900 s for a flat account), closing any position first. The demo waits for every verdict, at most the time limit + 300 s after the last start. It checks the accounts are flat, records the take in `docs/evidence/demo-aborted.json` and exits 1.
  - **Why demo-takes.json is not used:** check-rehearsal and check-money-shot judge every take in `demo-takes.json`, and an aborted take's flat TimeLimit FAIL has no close, so it would fail every later good take.
  - **The exposure top-up** for a FAIL on demand is only noted if it does not take effect. The runner's "market still" line no longer says "take aborted".
  - **Every wait is now bounded,** and a take also exits 1 when an account still holds a position after its verdict.
- **Checked read-only on Hideki, 2026-11-12:** `viemSender`'s prepare-and-sign, with a throwaway key (never sent), gives an EIP-1559 transaction on chain 50383 with gas 10,000,000 and the grant's calldata. B's nonce reads 2, latest and pending.

- [ ] **Step 1: Write the failing test**

`packages/bot/test/send.test.ts`:
```ts
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { keccak256, type Address, type Hex } from "viem";
import { BTC_POOL, ORDER_GAS, ORDER_TYPE_IOC } from "@basanos/core";
import { ownerOrderCall } from "@basanos/core/owner-tx";
import { RECEIPT_WAIT_MS, describeWrite, effectOf, onFailure, sendWrite, verdictDeadline, type Receipt, type SendResult, type Sender } from "../src/send";

// Any signed bytes will do: the fake signer returns them, and the hash is theirs.
const RAW: Hex = "0x02f8b28301c8cf0284017d784084017d784083989680944181dd08e73bbcdd1ba3e615a18f6abd941b94c080";
const HASH = keccak256(RAW);
const ACCOUNT: Address = "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1";
const OPEN = ownerOrderCall(BTC_POOL, false, 72_506_200n * 10n ** 15n, 342_000n, ORDER_TYPE_IOC, 3_371_163_205_000_000_000n);
const receipt = (status: "success" | "reverted"): Receipt => ({ transactionHash: HASH, status, gasUsed: 3_149_456n, effectiveGasPrice: 6_000_000_000n });
// What B's grant hit on the SDK's send path in the first rehearsal (2026-11-12).
const timedOut = () => Promise.reject(new Error("TransactionOutcomeUnknownError: eth_sendRawTransactionSync timed out"));

function fakeSender(over: Partial<Sender> = {}) {
  const s = {
    address: ACCOUNT,
    pendingNonce: vi.fn(async () => 2),
    sign: vi.fn(async () => RAW),
    sendRaw: vi.fn(async () => HASH as unknown),
    waitReceipt: vi.fn(async () => receipt("success")),
    receipt: vi.fn(async (): Promise<Receipt | null> => null),
    ...over,
  };
  return s;
}

const source = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("bot writes are viem-direct and sent once (P6a)", () => {
  it("signs at the pending nonce with ORDER_GAS, sends the raw bytes once and takes the receipt by their hash", async () => {
    const s = fakeSender();
    const r = await sendWrite(s, "open short", OPEN);
    expect(s.sign).toHaveBeenCalledWith({ to: BTC_POOL, data: OPEN.data, value: 0n, gas: ORDER_GAS, nonce: 2 });
    expect(s.sendRaw).toHaveBeenCalledTimes(1);
    expect(s.sendRaw).toHaveBeenCalledWith(RAW);
    expect(s.waitReceipt).toHaveBeenCalledWith(HASH, RECEIPT_WAIT_MS);
    expect(r.outcome).toBe("landed");
    expect(r.hash).toBe(HASH);
    expect(r.nonce).toBe(2);
    expect(r.tx?.costWei).toBe(18_896_736_000_000_000n);
  });
  it("looks a failed send up by the hash it signed, and never sends twice", async () => {
    const landedAnyway = fakeSender({ sendRaw: vi.fn(timedOut) });
    expect((await sendWrite(landedAnyway, "grant", OPEN)).outcome).toBe("landed");
    expect(landedAnyway.sendRaw).toHaveBeenCalledTimes(1);

    const late = fakeSender({ sendRaw: vi.fn(timedOut), waitReceipt: vi.fn(timedOut), receipt: vi.fn(async () => receipt("reverted")) });
    const lateResult = await sendWrite(late, "open short", OPEN);
    expect(lateResult.outcome).toBe("landed");
    expect(lateResult.tx?.status).toBe("reverted");

    const lost = fakeSender({ sendRaw: vi.fn(timedOut), waitReceipt: vi.fn(timedOut) });
    const lostResult = await sendWrite(lost, "open short", OPEN);
    expect(lostResult).toMatchObject({ outcome: "unknown", hash: HASH, nonce: 2, tx: null });
    expect(lostResult.reason).toMatch(/^send failed: TransactionOutcomeUnknownError/);
    expect(lost.sendRaw).toHaveBeenCalledTimes(1);

    const noReceipt = fakeSender({ waitReceipt: vi.fn(timedOut) });
    expect((await sendWrite(noReceipt, "startRun", OPEN, 1_000)).reason).toMatch(/^no receipt within 1 s/);
  });
  it("leaves the SDK out of every bot write", () => {
    for (const file of readdirSync(new URL("../src/", import.meta.url))) {
      expect(source(file), file).not.toMatch(/\.trader\.|placePerpOrder|privateKey\s*:/);
    }
    const actions = source("actions.ts");
    expect(actions.match(/sendWrite\(viemSender\(wallet, client\)/g)).toHaveLength(3);
    expect(actions).toContain("planOpenFromBook(isBid, quantity, levels, params)");
  });
});

describe("a write counts only when the chain shows it (P6b)", () => {
  const landed = (status: "success" | "reverted"): SendResult => ({ outcome: "landed", label: "open short", hash: HASH, nonce: 2, tx: { label: "open short", hash: HASH, status, gasUsed: 1n, costWei: 1n, explorer: "" }, reason: null });
  const unknown: SendResult = { outcome: "unknown", label: "open short", hash: HASH, nonce: 2, tx: null, reason: "send failed: timed out" };
  it("reads the effect back: a position, a grant or a run, never the send call", () => {
    expect(effectOf(landed("success"), true, 3)).toBe("done");
    expect(effectOf(landed("reverted"), false, 3)).toBe("not-done");
    expect(effectOf(unknown, true, 2)).toBe("done");
    expect(effectOf(unknown, false, 3)).toBe("not-done");
    expect(effectOf(unknown, false, 2)).toBe("unknown");
    expect(describeWrite({ sent: unknown, effect: "unknown" })).toBe(`open short: unknown (send failed: timed out; tx ${HASH}, nonce 2)`);
    expect(describeWrite({ sent: landed("reverted"), effect: "not-done" })).toBe(`open short: not-done (receipt reverted; tx ${HASH}, nonce 2)`);
  });
  it("stops before any run, aborts once a run has started, and only notes a failed exposure top-up", () => {
    for (const kind of ["grant", "start", "open", "error"] as const) expect(onFailure(kind, 0)).toBe("stop");
    for (const kind of ["start", "open", "error"] as const) expect(onFailure(kind, 1)).toBe("abort");
    expect(onFailure("open", 2)).toBe("abort");
    expect(onFailure("breach", 2)).toBe("note");
    expect(verdictDeadline(1_000, 900)).toBe(1_201_000);
  });
  it("records an aborted take apart from the takes check-rehearsal judges, and never voids a run", () => {
    const demo = source("demo.ts");
    expect(demo).toContain("repoPath(DEMO_ABORTED)");
    expect(demo).toContain("onFailure(e instanceof WriteFailed ? e.kind : \"error\", started.length)");
    expect(demo).not.toMatch(/voidRun|setOperatorApproval|approved: false/);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/bot -- test/send.test.ts`
Expected: FAIL — `Cannot find module '../src/send'`.

- [ ] **Step 3: Send once, read the effect back**

`packages/bot/src/send.ts`:
```ts
// How a challenge account's own writes reach the chain (P6, 2026-11-12). viem-direct, as spike:14 does for account A:
// the transaction is signed locally with ORDER_GAS and an explicit pending nonce, sent once with
// eth_sendRawTransaction to the standard RPC (rpcHttp()), and its receipt is taken from the public client. Signing
// first gives the hash before the send, so a send that fails or times out can still be looked up.
// The SDK's send path (eth_sendRawTransactionSync on send.hideki…) ended "outcome unknown" with nothing on-chain twice:
// the voucher claim (2026-11-11) and B's grant in the first rehearsal (2026-11-12). No bot write uses it.
// Nothing here re-sends. Whether a write took effect is read back from the chain (effectOf), never assumed from the
// send call: a grant is idempotent, but an open is not, and a blind re-send could double a position.
import { keccak256, type Address, type Hex } from "viem";
import { ORDER_GAS } from "@basanos/core";
import { ownerTx, type UnsignedCall } from "@basanos/core/owner-tx";
import { txRecord, type TxRecord } from "@basanos/referee";

/** How long a send waits for its receipt before its outcome counts as unknown. Hideki blocks are about 0.1 s apart. */
export const RECEIPT_WAIT_MS = 60_000;

/** After the last run starts, how long past the rulebook's time limit the demo waits for the verdicts. */
export const VERDICT_GRACE_SEC = 300;

export type Receipt = Parameters<typeof txRecord>[1];
export type SignedTx = ReturnType<typeof ownerTx>;

/** The chain calls one send makes. viemSender() in actions.ts binds them to an account wallet and the public client;
 *  tests fake them. */
export interface Sender {
  address: Address;
  pendingNonce(): Promise<number>;
  sign(tx: SignedTx): Promise<Hex>;
  sendRaw(raw: Hex): Promise<unknown>;
  waitReceipt(hash: Hex, timeoutMs: number): Promise<Receipt>;
  receipt(hash: Hex): Promise<Receipt | null>;
}

/** A write that reached a receipt (success or reverted), or one whose outcome is not known yet. */
export type SendResult =
  | { outcome: "landed"; label: string; hash: Hex; nonce: number; tx: TxRecord; reason: null }
  | { outcome: "unknown"; label: string; hash: Hex; nonce: number; tx: null; reason: string };

const short = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 160) ?? "";

/** Signs `call` at the pending nonce with ORDER_GAS, sends it once, and waits for its receipt by the hash known before
 *  the send. A failed send still waits, since a timed-out send may have reached the node. Never re-sends. */
export async function sendWrite(s: Sender, label: string, call: UnsignedCall, waitMs: number = RECEIPT_WAIT_MS): Promise<SendResult> {
  const nonce = await s.pendingNonce();
  const raw = await s.sign(ownerTx(call, nonce, ORDER_GAS));
  const hash = keccak256(raw);
  let reason = "";
  try {
    await s.sendRaw(raw);
  } catch (e) {
    reason = `send failed: ${short(e)}`;
  }
  try {
    return { outcome: "landed", label, hash, nonce, tx: txRecord(label, await s.waitReceipt(hash, waitMs)), reason: null };
  } catch (e) {
    if (!reason) reason = `no receipt within ${waitMs / 1000} s: ${short(e)}`;
  }
  const late = await s.receipt(hash);
  if (late) return { outcome: "landed", label, hash, nonce, tx: txRecord(label, late), reason: null };
  return { outcome: "unknown", label, hash, nonce, tx: null, reason };
}

export type Effect = "done" | "not-done" | "unknown";

/** Whether a write took effect, from the chain (P6b). `seen` is the effect itself, read back after the send: both
 *  grant selectors authorized, the account's active run, or its position size moving. Unseen, the write did not
 *  happen if it has a receipt (it reverted) or its nonce was used by another transaction; otherwise its outcome is
 *  unknown and it may still land. */
export function effectOf(sent: SendResult, seen: boolean, latestNonce: number): Effect {
  if (seen) return "done";
  if (sent.outcome === "landed" || latestNonce > sent.nonce) return "not-done";
  return "unknown";
}

/** One account write and what it did on-chain. */
export interface AccountWrite {
  sent: SendResult;
  effect: Effect;
}

export function describeWrite(w: AccountWrite): string {
  const how = w.sent.outcome === "landed" ? `receipt ${w.sent.tx.status}` : w.sent.reason;
  return `${w.sent.label}: ${w.effect} (${how}; tx ${w.sent.hash}, nonce ${w.sent.nonce})`;
}

export type WriteKind = "grant" | "start" | "open" | "breach";

/** What a demo take does when a write does not take effect, or anything else throws (P6b):
 *  - "stop": the take has started no run, so there is nothing to clean up. The demo exits 1, and a re-run starts
 *    over: the grant and the active run are read before anything is sent, so nothing is sent twice.
 *  - "abort": the take has started a run. Nothing is re-sent and no run is voided: a void is the referee's verdict on
 *    a flow, a foreign market or a revoked grant, and none of those happened. Revoking the grant to force one would
 *    also leave the referee unable to close an open that lands late. The referee keeps judging and ends each run by a
 *    rule or at its time limit (FAIL TimeLimit), closing any position first. The demo waits for every verdict, checks
 *    the accounts are flat, records the take in demo-aborted.json, and exits 1.
 *  - "note": the on-demand exposure top-up did not take effect. The take goes on; its runs still end by a rule or at
 *    their time limits. */
export function onFailure(kind: WriteKind | "error", runsStarted: number): "stop" | "abort" | "note" {
  if (runsStarted === 0) return "stop";
  return kind === "breach" ? "note" : "abort";
}

/** When the demo stops waiting for verdicts: the rulebook's time limit plus VERDICT_GRACE_SEC after the last start. */
export function verdictDeadline(lastStartMs: number, timeLimitSec: number): number {
  return lastStartMs + (timeLimitSec + VERDICT_GRACE_SEC) * 1_000;
}
```

- [ ] **Step 4: Grant, startRun and opens through send.ts**

Replace `packages/bot/src/actions.ts` with:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createWalletClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  INDEXER_URL,
  MARGIN_BANK,
  OPERATOR_REGISTRY,
  ORDER_TYPE_IOC,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  basanosRegistryAbi,
  farFutureNs,
  marginBankAbi,
  perpPoolAbi,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { planOpenFromBook, readBookLevels } from "@basanos/core/book";
import { repoPath } from "@basanos/core/node";
import { grantCall, ownerOrderCall, startRunCall } from "@basanos/core/owner-tx";
import { jsonSafe } from "@basanos/referee";
import { effectOf, sendWrite, type AccountWrite, type SendResult, type Sender } from "./send";

export interface Preflight {
  account: Address;
  stt: bigint;
  sttOk: boolean;
  voucherClaimed: boolean;
  /** MarginBank getAccountState().unlockedCollateralBalance: the account's own deposited USDso not locked in a position. */
  unlockedCollateral: bigint;
  /** unlockedCollateral at or above what a demo run needs (DEMO_MIN_UNLOCKED unless the caller passes another need). */
  funded: boolean;
  flat: boolean;
  equity: bigint;
}

/** The least unlocked MarginBank margin a demo run needs: its DEMO_LEVERAGE_X (5x) size must clear the 0.00013 BTC
 *  pool minimum (about 1.9 USDso of equity) with room for costs. */
export const DEMO_MIN_UNLOCKED = 5n * 10n ** 18n;

/** Inferred return type: bound to CHAIN and the key's account. */
export function makeAccountWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type AccountWallet = ReturnType<typeof makeAccountWallet>;

/** Read-only: the bot uses the SDK for reads only (the voucher read in preflight). It never hands the SDK a key, so no
 *  SDK write can leave the bot (P6, 2026-11-12). */
export function makeMarkets(): SomniaMarkets {
  return new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
}

/** Binds send.ts to an account wallet, which signs locally, and the public client on the standard RPC (rpcHttp()),
 *  which gives the nonce, takes the raw transaction and returns the receipt. */
export function viemSender(wallet: AccountWallet, client: PublicClient): Sender {
  const address = wallet.account.address;
  return {
    address,
    pendingNonce: () => client.getTransactionCount({ address, blockTag: "pending" }),
    sign: async (tx) => wallet.signTransaction(await wallet.prepareTransactionRequest(tx)),
    sendRaw: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
    waitReceipt: (hash, timeout) => client.waitForTransactionReceipt({ hash, timeout }),
    receipt: (hash) => client.getTransactionReceipt({ hash }).catch(() => null),
  };
}

/** The latest nonce is read before the effect, so a write that lands between the two reads is seen, not missed. */
async function settle(client: PublicClient, account: Address, sent: SendResult, seen: () => Promise<boolean>): Promise<AccountWrite> {
  const latest = await client.getTransactionCount({ address: account, blockTag: "latest" });
  return { sent, effect: effectOf(sent, await seen(), latest) };
}

async function positionSize(client: PublicClient, account: Address): Promise<bigint> {
  const p = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getPosition", args: [account, BTC_POOL] });
  return p.size;
}

/** Reads only. Never claims a voucher: claim() reverts chain-wide (B14), so an account is ready when it is FUNDED,
 *  with its own wallet USDso deposited into its own MarginBank balance (spike:18 for A, spike:19 for B). */
export async function preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei: bigint = DEMO_MIN_UNLOCKED): Promise<Preflight> {
  const [stt, voucher, snap, state] = await Promise.all([
    client.getBalance({ address: account }),
    markets.client.getPerpVoucher(MARGIN_BANK, account),
    readSnapshot(client, [account], BTC_POOL),
    client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [account] }),
  ]);
  const a = snap.accounts[0];
  return {
    account,
    stt,
    sttOk: stt >= STT_WRITE_HEADROOM,
    voucherClaimed: voucher?.claimed ?? false,
    unlockedCollateral: state.unlockedCollateralBalance,
    funded: state.unlockedCollateralBalance >= needWei,
    flat: a ? a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0 : false,
    equity: a?.totalEquity ?? 0n,
  };
}

/** Why an account cannot start a demo run, or [] when it can. A voucher is never required. */
export function notReady(pf: Preflight): string[] {
  const p: string[] = [];
  if (!pf.sttOk) p.push(`STT ${pf.stt} is below the 0.6 write headroom (top up from the Tokyo faucet)`);
  if (!pf.funded) {
    p.push(
      `unlocked MarginBank margin is ${pf.unlockedCollateral} wei, below what a demo run needs; deposit the account's own wallet USDso first (deposit.ts: spike:18 for A, spike:19 for B)`,
    );
  }
  if (!pf.flat) p.push("the account is not flat (flatten it in the dreamDEX app first)");
  return p;
}

export async function readBook(client: PublicClient): Promise<BookParams> {
  const p = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
  return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
}

/** Grants the referee place + cancel on the BTC pool only, if not already granted (null: nothing sent). viem-direct
 *  (send.ts, P6); it counts only when the pool reports both selectors authorized. A grant is idempotent, so a re-run
 *  after a stop re-reads it first. */
export async function ensureGrant(client: PublicClient, wallet: AccountWallet, referee: Address): Promise<AccountWrite | null> {
  const owner = wallet.account.address;
  const has = async (selector: Hex) =>
    client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
  const granted = async () => (await has(PLACE_ORDER_FOR_SELECTOR)) && (await has(CANCEL_ORDER_FOR_SELECTOR));
  if (await granted()) return null;
  const selectors = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR];
  const sent = await sendWrite(viemSender(wallet, client), "grant", grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, selectors));
  return settle(client, owner, sent, granted);
}

export function runIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], registry: Address): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") return ev.args.runId;
    } catch {
      // another registry event
    }
  }
  return null;
}

/** The account itself enrolls (msg.sender == account); the registry reads its start equity in the same tx. viem-direct
 *  (send.ts, P6). The run is read back from activeRunOf, so it counts once the registry holds it, receipt or not. */
export async function startRunAs(
  client: PublicClient,
  wallet: AccountWallet,
  registry: Address,
  rulebookId: Hex,
): Promise<AccountWrite & { runId: bigint | null }> {
  const account = wallet.account.address;
  const activeRun = async () => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [account] });
  const before = await activeRun();
  const sent = await sendWrite(viemSender(wallet, client), "startRun", startRunCall(registry, account, rulebookId));
  let after = before;
  const w = await settle(client, account, sent, async () => {
    after = await activeRun();
    return after !== 0n && after !== before;
  });
  return { ...w, runId: w.effect === "done" ? after : null };
}

/** Extra size so the account's notional strictly exceeds targetX x equity (the on-demand exposure breach). */
export function breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint {
  const oneBase = 10n ** BigInt(baseDecimals);
  const abs = currentSize < 0n ? -currentSize : currentSize;
  const targetNotional = equity * BigInt(targetX);
  const current = (abs * mark) / oneBase;
  const neededNotional = targetNotional > current ? targetNotional - current : 0n;
  const qty = alignUp((neededNotional * oneBase) / mark + 1n, book.lotSize);
  return qty < book.minQuantity ? book.minQuantity : qty;
}

/** An opening IOC capped from the book (best ask + 20 bps to buy, best bid - 20 bps to sell), never from the mark:
 *  the BTC-PERP book trades about 19 bps above the mark, so a mark + 20 bps buy does not fill (P5, 2026-11-12).
 *  viem-direct (send.ts, P6): it took effect only if the account's position size moved. An open is never re-sent. */
export async function openIoc(
  client: PublicClient,
  wallet: AccountWallet,
  isBid: boolean,
  quantity: bigint,
  label: string = isBid ? "open long" : "open short",
): Promise<AccountWrite> {
  const account = wallet.account.address;
  const params = await readBook(client);
  const levels = await readBookLevels(client, BTC_POOL);
  if (!levels) throw new Error("the BTC-PERP book could not be read; no order was sent");
  const plan = planOpenFromBook(isBid, quantity, levels, params);
  const before = await positionSize(client, account);
  const order = ownerOrderCall(BTC_POOL, isBid, plan.price, plan.quantity, ORDER_TYPE_IOC, farFutureNs());
  const sent = await sendWrite(viemSender(wallet, client), label, order);
  return settle(client, account, sent, async () => (await positionSize(client, account)) !== before);
}

export const DEMO_TAKES = "docs/evidence/demo-takes.json";

/** Takes that aborted after a run started (P6b). Kept apart from DEMO_TAKES, which check-rehearsal and the money-shot
 *  check judge: an aborted take's runs end FAIL TimeLimit without a close, and must not fail a later good take. */
export const DEMO_ABORTED = "docs/evidence/demo-aborted.json";

export function appendDemoTake(take: Record<string, unknown>, path: string = repoPath(DEMO_TAKES)): number {
  const all = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
  const n = all.length + 1;
  all.push(jsonSafe({ take: n, ...take }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
  return n;
}
```

- [ ] **Step 5: The demo and the bot stop or abort explicitly**

Replace `packages/bot/src/demo.ts` with:
```ts
// The demo runner. Primary: both builder-operated accounts take Tokyo Sprint · Demo with opposite positions at
// DEMO_LEVERAGE_X (5x; rules judge closeable equity, spec §5). Fallback (--one-account, only if account B cannot be
// funded): account A takes two runs in sequence. Run 1 is a FAIL on demand: a 5x long, then size past the 15x
// exposure cap. Run 2 is the PASS attempt: 5x (--pass-side long|short),
// held until the referee locks the target or a rule ends it. A PASS is not guaranteed with one account, which is why
// the two-account demo is primary. Accounts must be FUNDED (own USDso deposited, spike:18 / spike:19); no voucher.
// The referee daemon (packages/referee/src/cli.ts start) must already be running in another terminal.
// Every account write (grant, startRun, opens) is viem-direct (send.ts, P6) and read back from the chain before the
// take goes on. When one does not take effect, or anything throws (onFailure, P6b): before the take has started a run
// it stops, and a re-run starts over; once a run has started the take aborts. Nothing is re-sent and no run is voided:
// the referee ends each run by a rule or at its time limit, the demo waits for every verdict, checks the accounts are
// flat, records the take in docs/evidence/demo-aborted.json (never demo-takes.json) and exits 1.
import type { Address, Hex } from "viem";
import { BTC_POOL, RULE_NAMES, RUN_STATUS, basanosRegistryAbi, explorerTx, quantityForLeverage, readSnapshot, rulebookId, type BookParams } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, type TxRecord } from "@basanos/referee";
import {
  DEMO_ABORTED,
  appendDemoTake,
  breachQuantity,
  ensureGrant,
  makeAccountWallet,
  makeMarkets,
  notReady,
  openIoc,
  preflight,
  readBook,
  startRunAs,
  type AccountWallet,
} from "./actions";
import { VERDICT_GRACE_SEC, describeWrite, onFailure, verdictDeadline, type AccountWrite, type WriteKind } from "./send";

loadDotEnv();
const argv = process.argv.slice(2);
const manualA = argv.includes("--a-manual");
const oneAccount = argv.includes("--one-account");
const passSide = argv[argv.indexOf("--pass-side") + 1] === "short" ? "short" : "long";
const waitMin = Number(argv[argv.indexOf("--wait-min") + 1] ?? "10") || 10;
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");
const rb = loadRulebook("tokyo-sprint-demo");
const id: Hex = rulebookId(rb);
const markets = makeMarkets();
const mode = oneAccount ? "one-account" : "two-account";
const txs: TxRecord[] = [];
const notes: string[] = [];
const started: { runId: bigint; account: Address }[] = [];
let lastStartMs = 0;
const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

say(
  oneAccount
    ? "Basanos demo (one-account fallback): account A is a burner operated by the builder; run 1 FAIL by exposure, run 2 the PASS attempt."
    : "Basanos demo: both challenge accounts are burners operated by the builder (A human-driven, B scripted).",
);
interface Account {
  name: string;
  wallet: AccountWallet;
  address: Address;
}
const accounts: Account[] = (oneAccount ? (["ACCOUNT_A_PK"] as const) : (["ACCOUNT_A_PK", "ACCOUNT_B_PK"] as const)).map((name) => {
  const wallet = makeAccountWallet(requirePrivateKey(name), rpcHttp());
  return { name, wallet, address: wallet.account.address };
});

class WriteFailed extends Error {
  constructor(
    readonly kind: WriteKind,
    message: string,
  ) {
    super(message);
  }
}

/** Keeps the write's receipt, and throws unless the write took effect on-chain. */
function check(kind: WriteKind, w: AccountWrite | null): void {
  if (!w) return;
  if (w.sent.tx) txs.push(w.sent.tx);
  if (w.effect !== "done") throw new WriteFailed(kind, describeWrite(w));
}

const statusOf = async (runId: bigint) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
type Run = Awaited<ReturnType<typeof statusOf>>;
const label = (r: Run | undefined) => (r ? `${RUN_STATUS[r.status] ?? r.status}${r.rule ? `/${RULE_NAMES[r.rule]}` : ""}` : "?");
const activeRunOf = async (account: Address) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [account] });

async function startRun(a: Account): Promise<bigint> {
  const { runId, ...w } = await startRunAs(client, a.wallet, registry, id);
  check("start", w);
  if (runId === null) throw new WriteFailed("start", describeWrite(w));
  started.push({ runId, account: a.address });
  lastStartMs = Date.now();
  say(`${a.name} run ${runId} on ${rb.label}: ${w.sent.tx?.explorer ?? explorerTx(w.sent.hash)}`);
  return runId;
}

/** Polls every 2 s until every run has left Active; null once `until` passes with one still Active. */
async function waitVerdicts(runIds: readonly bigint[], until: number, onTick?: (rs: Run[]) => Promise<void>): Promise<Run[] | null> {
  for (;;) {
    const rs = await Promise.all(runIds.map((r) => statusOf(r)));
    say(`runs ${runIds.join(", ")}: ${rs.map((r) => label(r)).join(" | ")}`);
    if (rs.every((r) => r.status !== 1)) return rs;
    if (Date.now() > until) return null;
    if (onTick) await onTick(rs);
    await sleep(2_000);
  }
}

async function flatAll(addresses: readonly Address[], waitMs: number): Promise<boolean> {
  const unique = [...new Set(addresses)];
  const until = Date.now() + waitMs;
  for (;;) {
    const s = await readSnapshot(client, unique, BTC_POOL);
    if (s.accounts.every((a) => a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0)) return true;
    if (Date.now() > until) return false;
    await sleep(3_000);
  }
}

/** The on-demand exposure breach: size past the 15x cap. If it does not take effect it is noted, never re-sent, and
 *  the take goes on (onFailure "note"). */
async function topUp(a: Account, book: BookParams): Promise<boolean> {
  const s = await readSnapshot(client, [a.address], BTC_POOL);
  const p = s.accounts[0];
  if (!p || p.size === 0n) return false;
  try {
    check("breach", await openIoc(client, a.wallet, p.size > 0n, breachQuantity(p.size, p.totalEquity, 16, s.markPrice, 8, book), "exposure top-up"));
    return true;
  } catch (e) {
    if (onFailure("breach", started.length) !== "note") throw e;
    const why = e instanceof Error ? e.message : String(e);
    notes.push(`exposure top-up did not take effect: ${why}`);
    say(`note: the exposure top-up did not take effect (${why}); nothing is re-sent and the runs go on`);
    return false;
  }
}

function runRows(final: readonly (Run | undefined)[]) {
  return started.map((r, i) => ({ runId: r.runId, account: r.account, status: RUN_STATUS[final[i]?.status ?? 0], rule: RULE_NAMES[final[i]?.rule ?? 0] }));
}

async function twoAccountTake(): Promise<void> {
  const [accA, accB] = accounts;
  if (!accA || !accB) throw new Error("two accounts expected");
  for (const a of accounts) await startRun(a);
  const book = await readBook(client);
  const snap = await readSnapshot(client, accounts.map((a) => a.address), BTC_POOL);
  const qtyB = quantityForLeverage(snap.accounts[1]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, snap.markPrice, 8, book);
  check("open", await openIoc(client, accB.wallet, false, qtyB));
  say(`B short ${qtyB} at ${DEMO_LEVERAGE_X}x`);
  if (manualA) {
    say(`A: open the long from the Basanos terminal now (${DEMO_LEVERAGE_X}x).`);
  } else {
    const qtyA = quantityForLeverage(snap.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, snap.markPrice, 8, book);
    check("open", await openIoc(client, accA.wallet, true, qtyA));
    say(`A long ${qtyA} at ${DEMO_LEVERAGE_X}x`);
  }
  const openedAt = Date.now();
  let tried = false;
  let breached = false;
  const final = await waitVerdicts(
    started.map((r) => r.runId),
    verdictDeadline(lastStartMs, rb.timeLimitSec),
    async (rs) => {
      if (tried || Date.now() - openedAt <= waitMin * 60_000 || rs[1]?.status !== 1) return;
      tried = true; // one attempt only
      say("market still: exposure breach on B (FAIL on demand); A resolves or hits its time limit");
      breached = await topUp(accB, book);
    },
  );
  if (!final) throw new Error(`a run is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after the last start; check the referee terminal`);
  const flat = await flatAll(started.map((r) => r.account), 120_000);
  const take = appendDemoTake({ at: new Date().toISOString(), mode, rulebook: { id, label: rb.label }, runs: runRows(final), breachedOnDemand: breached, flatAfter: flat, notes, txs });
  say(`take ${take} recorded in docs/evidence/demo-takes.json`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!flat) {
    say("STOP: an account still holds a position after its verdict; check the referee terminal");
    process.exit(1);
  }
}

async function oneAccountTake(): Promise<void> {
  const [accA] = accounts;
  if (!accA) throw new Error("account A expected");
  const book = await readBook(client);
  // Run 1: FAIL on demand by exposure.
  const r1 = await startRun(accA);
  const s1 = await readSnapshot(client, [accA.address], BTC_POOL);
  check("open", await openIoc(client, accA.wallet, true, quantityForLeverage(s1.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, s1.markPrice, 8, book)));
  if (await topUp(accA, book)) say("run 1: size added past the 15x exposure cap (FAIL on demand)");
  const v1 = await waitVerdicts([r1], verdictDeadline(lastStartMs, rb.timeLimitSec));
  if (!v1) throw new Error(`run 1 is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after its start; check the referee terminal`);
  if (!(await flatAll([accA.address], 5 * 60_000))) throw new Error("account A is not flat 5 min after run 1's verdict");
  // Run 2: the PASS attempt.
  const r2 = await startRun(accA);
  say(`run 2 (${r2}): ${passSide} ${DEMO_LEVERAGE_X}x`);
  const s2 = await readSnapshot(client, [accA.address], BTC_POOL);
  check("open", await openIoc(client, accA.wallet, passSide === "long", quantityForLeverage(s2.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, s2.markPrice, 8, book)));
  const v2 = await waitVerdicts([r2], verdictDeadline(lastStartMs, rb.timeLimitSec));
  if (!v2) throw new Error(`run 2 is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after its start; check the referee terminal`);
  const flat = await flatAll([accA.address], 120_000);
  const rows = runRows([...v1, ...v2]);
  const take = appendDemoTake({
    at: new Date().toISOString(),
    mode,
    rulebook: { id, label: rb.label },
    runs: rows.map((r, i) => (i === 1 ? { ...r, side: passSide } : r)),
    breachedOnDemand: true,
    flatAfter: flat,
    notes,
    txs,
  });
  say(`take ${take} recorded in docs/evidence/demo-takes.json (one-account fallback)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!flat) {
    say("STOP: account A still holds a position after its verdict; check the referee terminal");
    process.exit(1);
  }
}

/** P6b, once the take has started a run: nothing is re-sent and no run is voided. The referee ends each run by a rule
 *  or at its time limit; the demo waits for the verdicts, checks the accounts, records the take apart, and exits 1. */
async function abortTake(reason: string): Promise<never> {
  const ids = started.map((r) => r.runId);
  say(`STOP: take aborted: ${reason}`);
  say(
    `Nothing is re-sent and no run is voided. The referee keeps judging run(s) ${ids.join(", ")} and ends each by a rule or at ` +
      `its ${rb.timeLimitSec} s time limit, closing any position first. Keep the referee running until this exits.`,
  );
  const final = await waitVerdicts(ids, verdictDeadline(lastStartMs, rb.timeLimitSec));
  const flat = await flatAll(started.map((r) => r.account), 120_000);
  const stillActive: string[] = [];
  for (const a of accounts) {
    const r = await activeRunOf(a.address);
    if (r !== 0n) stillActive.push(`${a.name} run ${r}`);
  }
  const n = appendDemoTake(
    { at: new Date().toISOString(), mode, rulebook: { id, label: rb.label }, aborted: reason, runs: runRows(final ?? []), flatAfter: flat, stillActive, notes, txs },
    repoPath(DEMO_ABORTED),
  );
  say(`aborted take ${n} recorded in ${DEMO_ABORTED} (not demo-takes.json, which check-rehearsal judges)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!final || stillActive.length > 0) say(`STOP: still Active after the time limit + ${VERDICT_GRACE_SEC} s: ${stillActive.join(", ") || ids.join(", ")}; check the referee terminal`);
  if (!flat) say("STOP: an account still holds a position after its verdict; check the referee terminal");
  process.exit(1);
}

try {
  // Every account passes preflight before anything is sent.
  for (const a of accounts) {
    const pf = await preflight(client, markets, a.address);
    say(`${a.name} ${a.address}: stt ${pf.stt} unlocked margin ${pf.unlockedCollateral} flat ${pf.flat} equity ${pf.equity}`);
    const problems = notReady(pf);
    if (problems.length > 0) {
      say(`STOP: ${a.name} is not ready: ${problems.join("; ")}. No voucher is ever claimed here.`);
      process.exit(1);
    }
  }
  for (const a of accounts) {
    const g = await ensureGrant(client, a.wallet, referee);
    check("grant", g);
    if (g) say(`${a.name} granted the referee place + cancel on BTC-PERP: ${g.sent.tx?.explorer ?? explorerTx(g.sent.hash)}`);
  }
  if (oneAccount) await oneAccountTake();
  else await twoAccountTake();
  process.exit(0);
} catch (e) {
  const reason = e instanceof Error ? e.message : String(e);
  const step = onFailure(e instanceof WriteFailed ? e.kind : "error", started.length);
  if (step === "stop") {
    say(`STOP: ${reason}. The take started no run, so nothing needs cleaning up, and nothing was re-sent. Re-run demo.ts once the cause is fixed.`);
    process.exit(1);
  }
  await abortTake(reason);
}
```

Replace `packages/bot/src/bot.ts` with:
```ts
// The scripted challenger (account B). It signs as itself; the referee's grant is the only delegation. Every write is
// viem-direct (send.ts, P6) and read back from the chain; a write that does not take effect stops the bot, and nothing
// is re-sent (P6b).
import { BTC_POOL, explorerTx, readSnapshot, rulebookId, quantityForLeverage } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { breachQuantity, ensureGrant, makeAccountWallet, makeMarkets, notReady, openIoc, preflight, readBook, startRunAs } from "./actions";
import { describeWrite, type AccountWrite } from "./send";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = rest.indexOf(name);
  return i >= 0 && rest[i + 1] ? (rest[i + 1] as string) : fallback;
};
const pk = requirePrivateKey("ACCOUNT_B_PK");
const wallet = makeAccountWallet(pk, rpcHttp());
const account = wallet.account.address;
const client = makePublicClient(rpcHttp());
const markets = makeMarkets();
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");

/** Prints the write with its link; exits 1 unless it took effect on-chain. */
function took(w: AccountWrite | null, ifNot: string): void {
  if (!w) return;
  console.log(`${describeWrite(w)} ${w.sent.tx?.explorer ?? explorerTx(w.sent.hash)}`);
  if (w.effect === "done") return;
  console.error(`STOP: ${w.sent.label} did not take effect; nothing is re-sent. ${ifNot}`);
  process.exit(1);
}

if (cmd === "start") {
  const name = opt("--rulebook", "tokyo-sprint-demo") as keyof typeof RULEBOOK_FILES;
  const side = opt("--side", "short");
  const leverage = Number(opt("--leverage", String(DEMO_LEVERAGE_X)));
  const pf = await preflight(client, markets, account);
  const problems = notReady(pf);
  if (problems.length > 0) {
    console.error(`bot preflight failed: ${problems.join("; ")}`);
    process.exit(1);
  }
  took(await ensureGrant(client, wallet, referee), "No run was started; re-run once the cause is fixed (the grant is read first).");
  const start = await startRunAs(client, wallet, registry, rulebookId(loadRulebook(name)));
  took(start, "Re-run once the cause is fixed (the registry refuses a second active run).");
  console.log(`run ${start.runId} started`);
  const snap = await readSnapshot(client, [], BTC_POOL);
  const qty = quantityForLeverage(pf.equity, leverage, snap.markPrice, 8, await readBook(client));
  took(await openIoc(client, wallet, side === "long", qty), `Run ${start.runId} stays with the referee, which ends it by a rule or at its time limit.`);
  process.exit(0);
} else if (cmd === "breach") {
  const leverage = Number(opt("--leverage", "16"));
  const snap = await readSnapshot(client, [account], BTC_POOL);
  const a = snap.accounts[0];
  if (!a || a.size === 0n) {
    console.error("bot has no position to extend");
    process.exit(1);
  }
  const add = breachQuantity(a.size, a.totalEquity, leverage, snap.markPrice, 8, await readBook(client));
  took(await openIoc(client, wallet, a.size > 0n, add, "exposure top-up"), "The run goes on.");
  console.log(`exposure breach: +${add}`);
  process.exit(0);
} else {
  console.error(`usage: bot.ts start [--rulebook <name>] [--side short|long] [--leverage ${DEMO_LEVERAGE_X}] | breach [--leverage 16]`);
  process.exit(2);
}
```

- [ ] **Step 6: Type-check (the demo runs live in referee:10 and ship:3)**
Run: `npm run typecheck -w @basanos/bot`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 7: Run the whole bot suite**
Run: `npm test -w @basanos/bot`
Expected: no failed tests (`17 passed`).

- [ ] **Step 8: Run the new test (the gate)**
Run: `npm test -w @basanos/bot -- test/send.test.ts`
Expected: PASS — `6 passed`.

- [ ] **Step 9: Commit (kernel-performed — no agent runs this)**
Message: `fix(bot): account writes go viem-direct and are read back from the chain; a failed take aborts without re-sending (P6)`

---

### Task 18: Demo v2 — the demo rulebook and leverage chosen from a replay of real history; the first demo kept as v1 (P7)

**Files:**
- Create: `rulebooks/tokyo-sprint-demo-v1.json`
- Modify: `rulebooks/tokyo-sprint-demo.json`
- Modify: `packages/core/src/node.ts`
- Modify: `packages/core/src/demo-math.ts`
- Modify: `packages/core/test/demo-closeable.test.ts`
- Modify: `packages/bot/src/demo-check.ts`
- Modify: `packages/bot/test/demo-cost.test.ts`
- Modify: `packages/referee/src/cli.ts`
- Modify: `packages/referee/src/register-rulebook.ts`
- Modify: `apps/web/src/lib/rulebooks.ts`
- Modify: `apps/web/test/order.test.tsx`
- Modify: `packages/ship/src/snapshot-run.ts`
- Test: `packages/core/test/demo-v2.test.ts`
- Test: `apps/web/test/rulebooks-v1.test.ts`

**Depends on:** Task 2, Task 7, Task 9, Task 10, Task 11, Task 13, Task 15, spike:Task 1, spike:Task 3, contracts:Task 8, contracts:Task 10, web:Task 4, web:Task 11, ship:Task 1
**Effort:** medium
**Model tier:** standard
**Provides:** `rulebooks/tokyo-sprint-demo.json (demo v2: profitTargetBps 50, dailyLossBps 150, trailingDrawdownBps 200, maxExposureX 15, minDurationSec 60, timeLimitSec 1200; registered by referee:22)`, `rulebooks/tokyo-sprint-demo-v1.json (the first registered demo, byte-identical: id 0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757)`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string; "tokyo-sprint-demo-v1": string }`, `DEMO_LEVERAGE_X = 10`, `RETIRED_RULEBOOKS: readonly Rulebook[] (the first demo, v1, kept so its runs resolve)`, `rulebookById(id: Hex): Rulebook | null (current and retired rulebooks)`, `CLI: npx tsx packages/referee/src/register-rulebook.ts <tokyo-sprint|tokyo-sprint-demo|tokyo-sprint-demo-v1> (owner = REFEREE_PK; updates deployments/hideki.json and names each entry after the rulebook file that holds its id)`, `CLI: npx tsx packages/bot/src/demo-check.ts [--equity <USDso>] -> PASS demo-check, or FAIL: wait for a tighter book and re-run (never a rulebook change; the parameters come from the replay)`, `the referee CLI, the web app and the featured-run snapshot resolve runs on demo v1 as well as demo v2`
**Requires:** `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string }`, `rulebookId(rb: Rulebook): Hex`, `parseRulebook(raw: unknown): Rulebook`, `interface Rulebook`, `DEMO_LEVERAGE_X = 5`, `demoCost(buyAverage: bigint, sellAverage: bigint, leverageX: number, targetBps: number): { spreadBps: number; equityBps: number; ok: boolean }`, `roundTripEquityBps(oneWayCostBps: number, leverageX: number): number`, `parseTape(raw: unknown): TapePoint[]`, `simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint }`, `registerArgs(rb: Rulebook): RegisterArgs`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `RULEBOOKS: readonly Rulebook[]`, `rulebookById(id: Hex): Rulebook | null`, `Ticket(props: { equity: bigint; mark: bigint; busy: boolean; defaultLeverage?: number; onOrder: (isBid: boolean, quantity: bigint) => void })`, `buildFeatured(input: FeaturedInput): FeaturedRun`

Why (architect P7, 2026-11-12; guide diagnosis B19; spec §5): the rehearsal's two runs both FAILED DailyLoss.
- **The cause:** at 5× the demo's 0.50% equity band is 10 bps of BTC price, which BTC crosses in tens of seconds, with the target equal to the floor.
- **The replay** (referee:19's tool, run by the architect over blocks 47,994,246 to 48,426,246: 12 hours, one sample a second, 43,201 samples, `docs/evidence/demo-replay.json`):
  - An opposite pair opened in the same block every 60 s and judged by the real evaluator at every sample.
  - Demo v1 at 5× saw at least one PASS in **64.7%** of 705 windows and both FAIL in 35.3%.
  - **Demo v2 at 10×** saw at least one PASS in **95.6%** of 700 windows and both FAIL in 4.4%, with closes 3 s after the verdict and a 10 bps lock buffer. The first PASS came at a median of 226 s (p90 703 s), and 0.6% of locks were refused.
  - The same set at 7 s closes gives 94.9%. A 900 s limit gives 91.2%, and 5× gives 69.7%. v1's 0.50% floors at 10× give 60.7%: at 10×, a 5 bps whipsaw kills both sides.
  - The replay reproduces the rehearsal itself: B judged −52.92 bps (actual −52.9), realized −59.08 at 7 s (actual −57.8); A judged −54.46 (−54.8), realized −65.52 (−65.7).
- **Demo v2:**
  - Keeps the +0.50% target, the 60 s minimum and the 15× exposure cap.
  - Widens the daily-loss floor to 1.5% and the trailing floor to 2%, and the time limit to 1,200 s.
  - Runs at `DEMO_LEVERAGE_X` = 10, where the target is a 5 bps price move.
- **Unchanged:** the standard `tokyo-sprint` rulebook.
- **New id:** the change gives the demo a new id, which referee:22 registers (owner, about 0.0043 STT).
- **Demo v1:** the first demo stays byte-identical in `rulebooks/tokyo-sprint-demo-v1.json`, so its id (runs 1 and 2) still resolves in the referee, the web app (`RETIRED_RULEBOOKS`) and the featured-run snapshot.
- **Registration bookkeeping:** register-rulebook names each recorded entry after the file that holds its id, so `deployments/hideki.json` ends with `tokyo-sprint-demo-v1` and `tokyo-sprint-demo`.
- **demo-check** no longer recommends raising the target. At 10× a wide spread is a moment, not a parameter: the replay's round trip has a median of 1.57 bps of notional and a p90 of 2.39, and the check fails about 7% of the time (wait and re-run).
- **Tests that pinned 5× move to 10×:** core `demo-closeable`, bot `demo-cost`, web `order`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/demo-v2.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEMO_LEVERAGE_X } from "../src/demo-math";
import { RULEBOOK_FILES, loadRulebook } from "../src/node";
import { rulebookId } from "../src/rulebook";

// The first demo rulebook as registered on Hideki (deployments/hideki.json, 2026-11-11): runs 1 and 2 use it.
const DEMO_V1_ID = "0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757";

describe("demo v2 (architect P7, 2026-11-12: parameters from a replay of real history)", () => {
  it("keeps the first registered demo byte-identical, so its id still resolves the rehearsal's runs", () => {
    expect(RULEBOOK_FILES["tokyo-sprint-demo-v1"]).toBe("rulebooks/tokyo-sprint-demo-v1.json");
    expect(rulebookId(loadRulebook("tokyo-sprint-demo-v1"))).toBe(DEMO_V1_ID);
  });
  it("keeps the +0.50% target, widens the floors and the time limit, and runs at 10x", () => {
    const v1 = loadRulebook("tokyo-sprint-demo-v1");
    const v2 = loadRulebook("tokyo-sprint-demo");
    expect(v2.label).toBe(v1.label);
    expect([v2.profitTargetBps, v2.dailyLossBps, v2.trailingDrawdownBps, v2.maxExposureX, v2.minDurationSec, v2.timeLimitSec]).toEqual([50, 150, 200, 15, 60, 1200]);
    expect([v1.profitTargetBps, v1.dailyLossBps, v1.trailingDrawdownBps, v1.timeLimitSec]).toEqual([50, 50, 75, 900]);
    expect(rulebookId(v2)).not.toBe(DEMO_V1_ID);
    expect(DEMO_LEVERAGE_X).toBe(10);
    expect(DEMO_LEVERAGE_X).toBeLessThan(v2.maxExposureX);
  });
});
```

`apps/web/test/rulebooks-v1.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { rulebookId } from "@basanos/core";
import { RETIRED_RULEBOOKS, RULEBOOKS, rulebookById } from "../src/lib/rulebooks";

describe("retired rulebooks still resolve (architect P7)", () => {
  it("offers the standard and demo v2, and still shows the rehearsal's runs on demo v1 with v1's own numbers", () => {
    expect(RULEBOOKS).toHaveLength(2);
    expect(RULEBOOKS[1]?.dailyLossBps).toBe(150);
    const v1 = rulebookById("0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757");
    expect(v1?.dailyLossBps).toBe(50);
    expect(v1?.timeLimitSec).toBe(900);
    expect(RETIRED_RULEBOOKS.map((r) => rulebookId(r))).toEqual(["0x59e9390389b835396b7e3ea6e0f4cd8cf144e0d1bca17aa99ba4fd335df60757"]);
    expect(rulebookById(rulebookId(RULEBOOKS[1]!))?.timeLimitSec).toBe(1200);
    expect(rulebookById("0x0000000000000000000000000000000000000000000000000000000000000000")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/core -- test/demo-v2.test.ts`
Expected: FAIL — `2 failed (2)`: there is no `tokyo-sprint-demo-v1` rulebook yet and `DEMO_LEVERAGE_X` is 5.

- [ ] **Step 3: Keep the first demo as v1 and write demo v2**

`rulebooks/tokyo-sprint-demo-v1.json`:
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

Replace `rulebooks/tokyo-sprint-demo.json` with:
```json
{
  "schema": "basanos.rulebook/1",
  "name": "Tokyo Sprint",
  "variant": "demo",
  "label": "Tokyo Sprint · Demo",
  "chainId": 50383,
  "market": { "symbol": "BTC-PERP", "pool": "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0", "baseDecimals": 8 },
  "profitTargetBps": 50,
  "dailyLossBps": 150,
  "trailingDrawdownBps": 200,
  "maxExposureX": 15,
  "minDurationSec": 60,
  "timeLimitSec": 1200,
  "oracleSymbol": "BTC/USDC:PERP",
  "voidOn": ["flow", "foreignMarket", "grantRevoked"]
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

/** `tokyo-sprint-demo` is the current demo rulebook (v2 since architect P7, 2026-11-12). `tokyo-sprint-demo-v1` is the
 *  first registered demo, kept byte-identical so its id (and the rehearsal's runs 1 and 2) still resolve. */
export const RULEBOOK_FILES = {
  "tokyo-sprint": "rulebooks/tokyo-sprint.json",
  "tokyo-sprint-demo": "rulebooks/tokyo-sprint-demo.json",
  "tokyo-sprint-demo-v1": "rulebooks/tokyo-sprint-demo-v1.json",
} as const;

export function loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook {
  return parseRulebook(JSON.parse(readFileSync(repoPath(RULEBOOK_FILES[name]), "utf8")));
}
```

- [ ] **Step 4: Run the demo at 10x**

Replace `packages/core/src/demo-math.ts` with:
```ts
import type { Address } from "viem";
import { quantityForLeverage } from "./close";
import { evaluate, initRunState, type FailRule } from "./evaluate";
import type { Rulebook } from "./rulebook";
import type { AccountSnapshot } from "./snapshot";

export interface TapePoint {
  block: bigint;
  ts: bigint;
  mark: bigint;
}

/** Tape JSON (bigints as strings); millisecond timestamps are converted to seconds. */
export function parseTape(raw: unknown): TapePoint[] {
  const points = ((raw as { points?: unknown[] }).points ?? []) as { block: string; ts: string; mark: string }[];
  return points.map((p) => {
    const ts = BigInt(p.ts);
    return { block: BigInt(p.block), ts: ts > 10_000_000_000n ? ts / 1000n : ts, mark: BigInt(p.mark) };
  });
}

export interface SimOptions {
  leverageX: number;
  startEquity: bigint;
  lotSize: bigint;
  entryCostBps: number;
  exitCostBps: number;
}

export interface SimSide {
  side: "long" | "short";
  outcome: "target" | "fail" | "unresolved";
  rule: FailRule | null;
  atTs: bigint | null;
}

const ACCOUNT: Address = "0x000000000000000000000000000000000000dEaD";

function simulateSide(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions, qty: bigint, sign: 1n | -1n): SimSide {
  const side = sign === 1n ? "long" : "short";
  const first = tape[0];
  if (!first) return { side, outcome: "unresolved", rule: null, atTs: null };
  const oneBase = 10n ** BigInt(rb.market.baseDecimals);
  const entryNotional = (qty * first.mark) / oneBase;
  const entryCost = (entryNotional * BigInt(Math.round(o.entryCostBps * 100))) / 1_000_000n;
  let state = initRunState(first.ts, o.startEquity);
  for (const p of tape) {
    const pnl = (sign * qty * (p.mark - first.mark)) / oneBase;
    const total = o.startEquity - entryCost + pnl;
    const acct: AccountSnapshot = {
      account: ACCOUNT,
      equityOk: true,
      equity: total,
      lockedCollateral: 0n,
      totalEquity: total,
      activePools: [rb.market.pool],
      size: sign * qty,
    };
    const ev = evaluate(rb, state, acct, { timestamp: p.ts, markOk: true, markPrice: p.mark });
    state = ev.state;
    if (ev.verdict.kind === "fail") return { side, outcome: "fail", rule: ev.verdict.rule, atTs: p.ts };
    if (ev.verdict.kind === "target") {
      const exitCost = (((qty * p.mark) / oneBase) * BigInt(Math.round(o.exitCostBps * 100))) / 1_000_000n;
      const lockedEquity = total - exitCost;
      if (lockedEquity * 10_000n >= o.startEquity * BigInt(10_000 + rb.profitTargetBps)) {
        return { side, outcome: "target", rule: null, atTs: p.ts };
      }
    }
  }
  return { side, outcome: "unresolved", rule: null, atTs: null };
}

/** Two opposite accounts opened at the first tape point, judged by the real evaluator; a pass counts only once the lock's close cost still clears the target. */
export function simulateTape(rb: Rulebook, tape: readonly TapePoint[], o: SimOptions): { long: SimSide; short: SimSide; quantity: bigint } {
  const first = tape[0];
  const quantity = first
    ? quantityForLeverage(o.startEquity, o.leverageX, first.mark, rb.market.baseDecimals, { tickSize: 1n, minQuantity: 0n, lotSize: o.lotSize })
    : 0n;
  return { long: simulateSide(rb, tape, o, quantity, 1n), short: simulateSide(rb, tape, o, quantity, -1n), quantity };
}

/** Fill cost against the mark, in bps of notional (positive = worse than the mark). */
export function costBpsVsMark(isBid: boolean, reference: bigint, average: bigint): number {
  const diff = isBid ? average - reference : reference - average;
  return Number((diff * 1_000_000n) / reference) / 100;
}

/** A round trip (entry + lock close) costs 2 x one-way notional bps x leverage in equity bps. */
export function roundTripEquityBps(oneWayCostBps: number, leverageX: number): number {
  return 2 * oneWayCostBps * leverageX;
}

/** Spec §5: the round trip may use at most half the demo target; never below the registered 50 bps. */
export function recommendDemoTargetBps(roundTripEqBps: number): number {
  return Math.max(50, Math.ceil((2 * roundTripEqBps) / 25) * 25);
}

/** Demo leverage (architect P7, 2026-11-12; P5 had set 5x). Rules judge closeable equity, so opening costs the spread
 *  x leverage at once: a median 1.57 bps round trip is about 16 equity bps at 10x, inside the demo v2 rulebook's 150
 *  bps daily-loss floor. The leverage was chosen with demo v2 from a replay of 12 hours of on-chain mark and book
 *  history (docs/evidence/demo-replay.json): at 10x the +0.50% target is a 5 bps price move, and an opposite pair opened
 *  in the same block saw at least one PASS in 95.6% of 700 windows (64.7% for demo v1 at 5x). */
export const DEMO_LEVERAGE_X = 10;

/** What a closeable-equity run pays at entry, in bps of notional: buying at the ask side and being valued at the bid
 *  side (or the reverse). The demo-cost input since P5; costBpsVsMark measured the mark-to-book basis instead. */
export function roundTripSpreadBps(buyAverage: bigint, sellAverage: bigint): number {
  const mid = (buyAverage + sellAverage) / 2n;
  if (mid <= 0n) throw new Error("roundTripSpreadBps: prices must be positive");
  return Number(((buyAverage - sellAverage) * 1_000_000n) / mid) / 100;
}
```

Replace `packages/core/test/demo-closeable.test.ts` with:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_LEVERAGE_X, parseTape, roundTripEquityBps, roundTripSpreadBps, simulateTape } from "../src/demo-math";
import { loadRulebook, repoPath } from "../src/node";

const E18 = 10n ** 18n;

describe("the demo at closeable equity (P5 ruling 2026-11-12)", () => {
  it("measures the round trip as the spread between the two sides, not the distance from the mark", () => {
    expect(roundTripSpreadBps(73_043_800n * 10n ** 15n, 73_042_200n * 10n ** 15n)).toBe(0.21);
    expect(roundTripSpreadBps(100_036n * E18, 100_000n * E18)).toBe(3.59);
    expect(() => roundTripSpreadBps(0n, 0n)).toThrow(/positive/);
  });
  it("runs at 10x (P7), where the median replayed round trip costs well under half the demo target", () => {
    expect(DEMO_LEVERAGE_X).toBe(10);
    expect(roundTripEquityBps(1.57 / 2, DEMO_LEVERAGE_X)).toBeCloseTo(15.7, 6);
    expect(roundTripEquityBps(1.57 / 2, DEMO_LEVERAGE_X)).toBeLessThanOrEqual(50 / 2);
  });
  it("resolves both opposite accounts on the recorded tape at 10x on demo v2 with a 3.6 bps round trip paid at entry", () => {
    const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
    const demo = loadRulebook("tokyo-sprint-demo");
    const r = simulateTape(demo, tape, { leverageX: DEMO_LEVERAGE_X, startEquity: 50n * E18, lotSize: 1_000n, entryCostBps: 3.6, exitCostBps: 0 });
    expect(r.quantity).toBeGreaterThanOrEqual(13_000n);
    expect([r.long.outcome, r.short.outcome].sort()).toEqual(["fail", "target"]);
  });
});
```

Replace `packages/bot/src/demo-check.ts` with:
```ts
// Decides whether the book is fit for a demo take right now (spec §5). Read-only. The demo parameters themselves come
// from the replay of real history (architect P7, docs/evidence/demo-replay.json), so a FAIL here means "wait for a
// tighter book and re-run", never "change the rulebook": a wide spread is a moment, not a parameter.
// Rules judge closeable equity (P5 ruling, 2026-11-12), so a run pays the spread between the two sides of the book at
// entry and nothing more at the close: the cost is the buy average minus the sell average for the demo size, both
// walked from ONE book read (one block), at DEMO_LEVERAGE_X. (The distance from the mark is the mark-to-book basis, about 19 bps on 2026-11-12, and is
// not a cost any more.) Sizes from the demo accounts' real equity (or --equity <USDso>), never from a fixed 1,000
// USDso, and checks the size against the pool's minimum order (0.00013 BTC on BTC-PERP).
import { readFileSync } from "node:fs";
import { BTC_POOL, readSnapshot } from "@basanos/core";
import { averageFill, readBookLevels } from "@basanos/core/book";
import { DEMO_LEVERAGE_X, parseTape, simulateTape } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "@basanos/referee";
import { readBook } from "./actions";
import { demoCost, demoEquity, demoSize } from "./sizing";

loadDotEnv();
const rb = loadRulebook("tokyo-sprint-demo");
const flagAt = process.argv.indexOf("--equity");
const equityFlag = flagAt >= 0 ? (process.argv[flagAt + 1] ?? "") : null;
const client = makePublicClient(rpcHttp());
const book = await readBook(client);
const accounts = equityFlag === null ? [requireAddress("ACCOUNT_A_ADDRESS"), requireAddress("ACCOUNT_B_ADDRESS")] : [];
const snap = await readSnapshot(client, accounts, BTC_POOL);
let equity: bigint | null;
try {
  equity = demoEquity(equityFlag, snap.accounts.map((a) => a.totalEquity));
} catch (e) {
  console.log(`FAIL demo-check: ${(e as Error).message}`);
  process.exit(1);
}
if (equity === null) {
  console.log("FAIL demo-check: accounts A and B hold no equity yet; fund them, or pass --equity <USDso> (for example --equity 50)");
  process.exit(1);
}
const size = demoSize(equity, DEMO_LEVERAGE_X, snap.markPrice, rb.market.baseDecimals, book);
if (size.problem) {
  console.log(`FAIL demo-check: ${size.problem}`);
  process.exit(1);
}
const qty = size.qty;
const levels = await readBookLevels(client, BTC_POOL);
const buyAverage = levels ? averageFill(true, qty, levels) : null;
const sellAverage = levels ? averageFill(false, qty, levels) : null;
if (buyAverage === null || sellAverage === null) {
  console.log(`FAIL demo-check: the book is too thin to fill the demo size ${qty} on both sides; retry when the book refills, or lower the demo leverage`);
  process.exit(1);
}
const cost = demoCost(buyAverage, sellAverage, DEMO_LEVERAGE_X, rb.profitTargetBps);
const tape = parseTape(JSON.parse(readFileSync(repoPath("packages/core/test/fixtures/btc-tape.json"), "utf8")));
const sim = simulateTape(rb, tape, { leverageX: DEMO_LEVERAGE_X, startEquity: equity, lotSize: book.lotSize, entryCostBps: cost.spreadBps, exitCostBps: 0 });
const tapeOk = sim.long.outcome === "target" || sim.short.outcome === "target";
console.log(
  `demo size ${qty} (${DEMO_LEVERAGE_X}x on ${equity} wei of equity, ${equityFlag === null ? "the smaller live equity of A and B" : "from --equity"}); ` +
    `round trip ${cost.spreadBps} bps of notional at block ${levels?.blockNumber} (buy average ${buyAverage}, sell average ${sellAverage})`,
);
console.log(`round trip ${cost.equityBps} equity bps vs half target ${rb.profitTargetBps / 2}: ${cost.ok ? "ok" : "too costly"}`);
console.log(`tape with costs: long ${sim.long.outcome}, short ${sim.short.outcome}`);
if (cost.ok && tapeOk) {
  console.log("PASS demo-check");
  process.exit(0);
}
console.log(
  `FAIL demo-check: ${cost.ok ? "the tape does not resolve" : `the round trip is ${cost.spreadBps} bps of notional right now`}; ` +
    "wait a few minutes for a tighter book and re-run (do not edit or re-register the rulebook)",
);
process.exit(1);
```

Replace `packages/bot/test/demo-cost.test.ts` with:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { demoCost } from "../src/sizing";

const E15 = 10n ** 15n;
const source = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("the demo at closeable equity (P5 ruling 2026-11-12; 10x since P7)", () => {
  it("charges the quoted spread once, at the demo leverage; a spread too wide for 10x waits for a tighter book", () => {
    expect(DEMO_LEVERAGE_X).toBe(10);
    expect(demoCost(73_043_800n * E15, 73_042_200n * E15, DEMO_LEVERAGE_X, 50)).toEqual({ spreadBps: 0.21, equityBps: 2.1, ok: true });
    expect(demoCost(73_053_500n * E15, 73_042_000n * E15, DEMO_LEVERAGE_X, 50)).toEqual({ spreadBps: 1.57, equityBps: 15.7, ok: true });
    expect(demoCost(73_068_000n * E15, 73_042_000n * E15, DEMO_LEVERAGE_X, 50)).toEqual({ spreadBps: 3.55, equityBps: 35.5, ok: false });
  });
  it("sizes every demo order at DEMO_LEVERAGE_X and opens from the book, not the mark", () => {
    for (const file of ["demo.ts", "bot.ts", "demo-check.ts"]) {
      expect(source(file), file).toContain("DEMO_LEVERAGE_X");
      expect(source(file), file).not.toMatch(/\b12x\b|, 12, |"12"/);
    }
    expect(source("actions.ts")).toContain("planOpenFromBook(isBid, quantity, levels, params)");
    expect(source("actions.ts")).not.toContain("planOpen(");
    expect(source("demo-check.ts")).not.toContain("costBpsVsMark");
  });
});
```

Replace `apps/web/test/order.test.tsx` with:
```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { iocPrice, type AccountSnapshot } from "@basanos/core";
import { closeableEquity, type BookSides } from "@basanos/core/book";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { Ticket } from "../src/components/Ticket";
import { BTC_BOOK_PARAMS, judgedNow, ticketOrder } from "../src/lib/order";

const E18 = 10n ** 18n;
const MARK = 72_800n * E18;
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
// The measured book (guide, 2026-11-12): best bid +19 bps and best ask +21 bps above the mark.
const BOOK: BookSides = { bids: [{ price: px(19), quantity: 1_373_000n }], asks: [{ price: px(21), quantity: 1_373_000n }] };
const acct = (total: bigint, size: bigint, equityOk = true): AccountSnapshot => ({
  account: "0x00000000000000000000000000000000000000a1",
  equityOk,
  equity: total,
  lockedCollateral: 0n,
  totalEquity: total,
  activePools: [],
  size,
});

describe("the terminal's market order (P5)", () => {
  it("caps the IOC from the book, 20 bps past the best opposite level, never from the mark", () => {
    expect(ticketOrder(true, 342_000n, BOOK)).toEqual({ isBid: true, quantity: 342_000n, price: iocPrice(true, px(21), BTC_BOOK_PARAMS.tickSize, 20) });
    expect(ticketOrder(false, 342_000n, BOOK).price).toBe(iocPrice(false, px(19), BTC_BOOK_PARAMS.tickSize, 20));
    expect(() => ticketOrder(true, 342_000n, null)).toThrow(/book could not be read/);
  });
  it("shows the equity the referee judges: closeable when holding, marked when flat", () => {
    expect(judgedNow(acct(50n * E18, 0n), MARK, null)).toBe(50n * E18);
    expect(judgedNow(acct(50n * E18, 342_000n), MARK, BOOK)).toBe(closeableEquity(50n * E18, 342_000n, MARK, BOOK, 8));
    expect(judgedNow(acct(50n * E18, 342_000n), MARK, null)).toBeNull();
    expect(judgedNow(acct(50n * E18, 0n, false), MARK, BOOK)).toBeNull();
    expect(judgedNow(undefined, MARK, BOOK)).toBeNull();
  });
  it("opens the ticket at the demo leverage", () => {
    const onOrder = vi.fn();
    render(<Ticket equity={1_000n * E18} mark={74_500n * E18} busy={false} defaultLeverage={DEMO_LEVERAGE_X} onOrder={onOrder} />);
    fireEvent.click(screen.getByRole("button", { name: "Buy / long" }));
    expect(onOrder).toHaveBeenCalledWith(true, 13_422_000n);
  });
});
```

- [ ] **Step 5: Resolve demo v1 runs everywhere a run's rulebook is looked up**

Replace `packages/referee/src/cli.ts` with:
```ts
import { decodeEventLog, getAddress, type Hex } from "viem";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { BTC_POOL, CHAIN, HIDEKI_ADDRESSES, INDEXER_URL, ORACLE_DEPOSIT, basanosRegistryAbi, rulebookId } from "@basanos/core";
import { RULEBOOK_FILES, flag, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp, rpcWss } from "@basanos/core/node";
import { chainCloseIO, makePublicClient, makeRefereeWallet } from "./chain";
import { runDaemon } from "./daemon";
import { readActiveRuns, rulebookIndex } from "./runs";
import { makeRegistryWriter } from "./writer";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
// Every registered rulebook it may meet: the standard, the current demo (v2) and the first demo (v1, still registered).
const rulebooks = [loadRulebook("tokyo-sprint"), loadRulebook("tokyo-sprint-demo"), loadRulebook("tokyo-sprint-demo-v1")];

if (cmd === "start") {
  const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
  const markets = new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
  await runDaemon({
    client,
    wss: rpcWss(),
    registry,
    rulebooks,
    closeIO: chainCloseIO(client, wallet, BTC_POOL),
    writer: makeRegistryWriter(wallet, client, registry, flag("ORACLE_ENABLED") ? ORACLE_DEPOSIT : 0n),
    markets,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
} else if (cmd === "enroll") {
  const target = rest[0];
  const name = opt("--rulebook") as keyof typeof RULEBOOK_FILES | undefined;
  if (!target || !name || !(name in RULEBOOK_FILES)) {
    console.error("usage: cli.ts enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo>");
    process.exit(2);
  }
  const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
  const hash = await wallet.writeContract({
    address: registry,
    abi: basanosRegistryAbi,
    functionName: "startRun",
    args: [getAddress(target), rulebookId(loadRulebook(name))],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  let runId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") runId = ev.args.runId;
    } catch {
      // not a registry event
    }
  }
  console.log(runId === null ? `enroll failed: ${hash}` : `enrolled run ${runId} (${hash})`);
  process.exit(runId === null ? 1 : 0);
} else if (cmd === "status") {
  const runs = await readActiveRuns(client, registry, rulebookIndex(rulebooks));
  if (runs.length === 0) console.log("no active runs");
  for (const r of runs) console.log(`run ${r.runId}: ${r.account} on ${r.rulebook.label}, start equity ${r.startEquity} at block ${r.startBlock}`);
  process.exit(0);
} else {
  console.error("usage: cli.ts start | enroll <account> --rulebook <name> | status");
  process.exit(2);
}
```

Replace `packages/referee/src/register-rulebook.ts` with:
```ts
// Owner-only (REFEREE_PK): registers a rulebook file's id and contract-checked fields, and records it in
// deployments/hideki.json. Used for a new demo variant (architect P7: demo v2). Each recorded entry is named after the
// rulebook file whose id it holds, so the first demo's entry reads tokyo-sprint-demo-v1 once v2 takes its file name.
import { readFileSync, writeFileSync } from "node:fs";
import type { Hex } from "viem";
import { basanosRegistryAbi, registerArgs, rulebookId } from "@basanos/core";
import { RULEBOOK_FILES, loadDotEnv, loadRulebook, repoPath, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, makeRefereeWallet } from "./chain";

loadDotEnv();
const name = process.argv[2] as keyof typeof RULEBOOK_FILES | undefined;
if (!name || !(name in RULEBOOK_FILES)) {
  console.error(`usage: register-rulebook.ts <${Object.keys(RULEBOOK_FILES).join("|")}>`);
  process.exit(2);
}
const fileNameOf = (id: Hex): string | undefined =>
  (Object.keys(RULEBOOK_FILES) as (keyof typeof RULEBOOK_FILES)[]).find((n) => rulebookId(loadRulebook(n)).toLowerCase() === id.toLowerCase());
const registry = requireAddress("REGISTRY_ADDRESS");
const client = makePublicClient(rpcHttp());
const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
const args = registerArgs(loadRulebook(name));
const existing = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRulebook", args: [args[0]] });
if (existing.exists) {
  console.log(`rulebook ${name} (${args[0]}) is already registered`);
  process.exit(0);
}
const tx = await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "registerRulebook", args: [...args] });
const receipt = await client.waitForTransactionReceipt({ hash: tx });
const depPath = repoPath("deployments/hideki.json");
const dep = JSON.parse(readFileSync(depPath, "utf8")) as { rulebooks: { name: string; id: Hex; tx: Hex; status: string; gasUsed: string }[] };
dep.rulebooks = dep.rulebooks.map((r) => ({ ...r, name: fileNameOf(r.id) ?? r.name }));
dep.rulebooks.push({ name, id: args[0], tx, status: receipt.status, gasUsed: receipt.gasUsed.toString() });
writeFileSync(depPath, `${JSON.stringify(dep, null, 2)}\n`);
console.log(`registered ${name} ${args[0]} (${receipt.status}) ${tx}`);
process.exit(receipt.status === "success" ? 0 : 1);
```

Replace `apps/web/src/lib/rulebooks.ts` with:
```ts
import type { Hex } from "viem";
import { parseRulebook, rulebookId, type Rulebook } from "@basanos/core";
import standard from "../../../../rulebooks/tokyo-sprint.json";
import demo from "../../../../rulebooks/tokyo-sprint-demo.json";
import demoV1 from "../../../../rulebooks/tokyo-sprint-demo-v1.json";

/** The rulebooks a challenger can take today: the standard and the current demo (v2 since architect P7). */
export const RULEBOOKS: readonly Rulebook[] = [parseRulebook(standard), parseRulebook(demo)];

/** Registered rulebooks no longer offered, kept so their runs still resolve: the first demo (v1, the rehearsal's runs). */
export const RETIRED_RULEBOOKS: readonly Rulebook[] = [parseRulebook(demoV1)];

export function rulebookById(id: Hex): Rulebook | null {
  return [...RULEBOOKS, ...RETIRED_RULEBOOKS].find((rb) => rulebookId(rb).toLowerCase() === id.toLowerCase()) ?? null;
}
```

Replace `packages/ship/src/snapshot-run.ts` with:
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
const rb = [loadRulebook("tokyo-sprint"), loadRulebook("tokyo-sprint-demo"), loadRulebook("tokyo-sprint-demo-v1")].find(
  (r) => rulebookId(r).toLowerCase() === run.rulebookId.toLowerCase(),
);
if (!rb) throw new Error(`run ${runId} uses a rulebook that is not in rulebooks/`);
const stored = readRunsEvidence()[runId.toString()];
const verdictTx = ((stored?.verdictTx as { hash?: Hex } | undefined)?.hash ?? null) as Hex | null;
const featured = buildFeatured({ registry, runId, run, rulebook: rb, closeTxs, verdictTx });
mkdirSync(dirname(repoPath(FEATURED_PATH)), { recursive: true });
writeFileSync(repoPath(FEATURED_PATH), `${JSON.stringify(jsonSafe(featured), null, 2)}\n`);
console.log(`featured run ${runId}: ${featured.status}${featured.rule ? ` (${featured.rule})` : ""} -> ${FEATURED_PATH}`);
process.exit(0);
```

- [ ] **Step 6: Type-check the five workspaces it touches**
Run: `npm run typecheck -w @basanos/core`
Run: `npm run typecheck -w @basanos/bot`
Run: `npm run typecheck -w @basanos/referee`
Run: `npm run typecheck -w @basanos/web`
Run: `npm run typecheck -w @basanos/ship`
Expected: each exits 0 with no `error TS` lines.

- [ ] **Step 7: Run their suites**
Run: `npm test -w @basanos/core`
Run: `npm test -w @basanos/bot`
Run: `npm test -w @basanos/referee`
Run: `npm test -w @basanos/web`
Run: `npm test -w @basanos/ship`
Expected: no failed tests (core `75 passed`, bot `17 passed`, referee `24 passed`, web `39 passed`, ship `11 passed`).

- [ ] **Step 8: Run the new test (the gate)**
Run: `npm test -w @basanos/core -- test/demo-v2.test.ts`
Expected: PASS — `2 passed`.

- [ ] **Step 9: Commit (kernel-performed — no agent runs this)**
Message: `feat(demo): demo v2 - +0.50% target, 1.5%/2% floors, 20 min, 10x, chosen from a 12 h replay; the first demo kept as v1 (P7)`

---

### Task 19: The demo replay — real mark and book history through the evaluator, for any candidate demo parameters (P7)

**Files:**
- Create: `packages/bot/src/replay.ts`
- Create: `packages/bot/src/demo-replay.ts`
- Test: `packages/bot/test/replay.test.ts`

**Depends on:** Task 1, Task 3, Task 13, Task 18, Task 20, spike:Task 1, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6
**Effort:** low
**Model tier:** standard
**Provides:** `interface Sample { block: bigint; timestamp: bigint; markOk: boolean; mark: bigint; book: BookSides }`, `parseSample(line: string): Sample`, `interface ReplayOptions { leverageX: number; startEquity: bigint; latencySec: number; lockBufferBps: number; entryDelaySec: number; params: BookParams; baseDecimals: number }`, `replaySide(rb: Rulebook, samples: readonly Sample[], entry: number, isLong: boolean, o: ReplayOptions): SideResult | null`, `replayPair(rb: Rulebook, samples: readonly Sample[], entry: number, o: ReplayOptions): PairResult | null`, `summarize(rb: Rulebook, pairs: readonly PairResult[]): ReplaySummary`, `CLI: npx tsx packages/bot/src/demo-replay.ts collect --from <block> --to <block> [--step 10] [--out <file>] | run --history <file> [--every 60] [--out <file>] (read-only; writes docs/evidence/demo-replay.json)`
**Requires:** `averageFill(isBid: boolean, quantity: bigint, book: BookSides): bigint | null`, `closeableEquity(totalEquity: bigint, size: bigint, mark: bigint, book: BookSides, baseDecimals: number): bigint | null`, `interface BookSides { bids: readonly BookLevel[]; asks: readonly BookLevel[] } (best level first: bids descending, asks ascending)`, `evaluate(rb: Rulebook, state: RunState, acct: AccountSnapshot, market: MarketView): Evaluation (judges closeable equity when market.book is given; omitted, at the mark)`, `initRunState(startTime: bigint, startEquity: bigint): RunState`, `interface AccountSnapshot { account: Address; equityOk: boolean; equity: bigint; lockedCollateral: bigint; totalEquity: bigint; activePools: Address[]; size: bigint }`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `rulebookId(rb: Rulebook): Hex`, `interface Rulebook`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `repoPath(rel: string): string`, `BTC_POOL`, `MULTICALL3`, `multicall3Abi`, `perpPoolAbi`, `jsonSafe(value: unknown): unknown`, `DEMO_LEVERAGE_X = 10`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string; "tokyo-sprint-demo-v1": string }`, `LOCK_BUFFER_BPS = 10`

Why (architect P7, 2026-11-12; spec §5): the guide asked for demo parameters grounded in data. The chain serves historical `getMarkPrice` and `getBookLevels`, so a block range can be replayed for free, read-only.
- **`collect`** samples one Multicall3 read per sample at past blocks: timestamp, mark and 10 levels of each side. It sends batched JSON-RPC, takes about 6 minutes for 12 hours at one sample a second, and is resumable.
- **`run`** replays an opposite pair opened in the same block every 60 s through the core evaluator on closeable equity:
  - a FAIL closed, and a PASS locked, `latencySec` after the verdict at the book of that later sample;
  - a lock only once closeable equity clears the target by `lockBufferBps`, and refused when the close realizes less than the target.
- **The candidates** compared in the P7 ruling: demo v1 as rehearsed, demo v2 at 10× (chosen), and its neighbours. `run` writes `docs/evidence/demo-replay.json`.
- **The architect's run is committed with the P7 ruling:** blocks 47,994,246 to 48,426,246, 43,201 samples; demo v2 at 10× gives at least one PASS in 95.6% of 700 windows.
- **Validation:** the replay reproduces the rehearsal's two FAILs within 1.3 bps of the judged equity.
- **Not modeled:** funding (fees are 0 on BTC-PERP).
- **No gate:** the history is read live, so no gate runs it. The unit test pins the mechanics on synthetic tapes.

- [ ] **Step 1: Write the failing test**

`packages/bot/test/replay.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { loadRulebook } from "@basanos/core/node";
import { after, parseSample, replayPair, replaySide, summarize, type ReplayOptions, type Sample } from "../src/replay";

const E18 = 10n ** 18n;
const demo = loadRulebook("tokyo-sprint-demo");
const o: ReplayOptions = {
  leverageX: 10,
  startEquity: 50n * E18,
  latencySec: 3,
  lockBufferBps: 10,
  entryDelaySec: 3,
  params: { tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n },
  baseDecimals: 8,
};
// One sample a second; the book sits 19 bps (bids) and 21 bps (asks) above the mark, as measured on 2026-11-12.
function tape(markBps: (sec: number) => number, seconds = 1_300): Sample[] {
  const out: Sample[] = [];
  for (let s = 0; s <= seconds; s++) {
    const mark = (72_000n * E18 * BigInt(Math.round(1_000_000 + markBps(s) * 100))) / 1_000_000n;
    const at = (bps: bigint) => (mark * (10_000n + bps)) / 10_000n;
    out.push({ block: 1_000n + BigInt(s) * 10n, timestamp: 5_000n + BigInt(s), markOk: true, mark, book: { bids: [{ price: at(19n), quantity: 10n ** 8n }], asks: [{ price: at(21n), quantity: 10n ** 8n }] } });
  }
  return out;
}

describe("the demo replay (architect P7)", () => {
  it("reads the collector's lines and finds the sample a delay later by block", () => {
    const s = parseSample('{"b":"100","t":"7","ok":true,"m":"5","bid":[["6","1"]],"ask":[["7","2"]]}');
    expect(s).toEqual({ block: 100n, timestamp: 7n, markOk: true, mark: 5n, book: { bids: [{ price: 6n, quantity: 1n }], asks: [{ price: 7n, quantity: 2n }] } });
    const t = tape(() => 0, 20);
    expect(after(t, 2, 3)).toBe(5);
    expect(after(t, 18, 5)).toBe(-1);
  });
  it("passes the long and fails the short in a steady rally, closing each at the book 3 s after its verdict", () => {
    const t = tape((s) => s * 0.05);
    const p = replayPair(demo, t, 0, o)!;
    expect(p.long.outcome).toBe("pass");
    expect(p.long.atSec).toBeGreaterThanOrEqual(demo.minDurationSec);
    expect(p.long.realizedBps!).toBeGreaterThanOrEqual(demo.profitTargetBps);
    expect(p.short.outcome).toBe("fail");
    expect(p.short.rule).toBe("DailyLoss");
    expect(p.short.realizedBps!).toBeLessThanOrEqual(-demo.dailyLossBps);
    expect(summarize(demo, [p])).toMatchObject({ windows: 1, pAnyPass: 1, pOnePassOneFailNatural: 1, pBothFail: 0, pRefused: 0 });
  });
  it("refuses a lock whose close slips back under the target, and waits for the buffer before locking", () => {
    // A long bought at the ask and valued at the bid starts 2 bps of price down, so at 10x the +0.50% target needs the
    // mark 7 bps up. Here it jumps 7.5 bps at 60 s (closeable +0.55%) and falls 2 bps a second: the close 3 s later
    // realizes under the target.
    const spike = tape((s) => (s < 60 ? 0 : 7.5 - (s - 60) * 2));
    expect(replaySide(demo, spike, 0, true, { ...o, lockBufferBps: 0 })).toMatchObject({ outcome: "refused", rule: "PassRefused" });
    // Held at 7.4 bps (closeable +0.54%): without a buffer it locks and passes; with 10 bps it never locks.
    const shy = tape((s) => (s < 60 ? 0 : 7.4));
    expect(replaySide(demo, shy, 0, true, { ...o, lockBufferBps: 0 })!.outcome).toBe("pass");
    expect(replaySide(demo, shy, 0, true, o)).toMatchObject({ outcome: "fail", rule: "TimeLimit" });
  });
  it("fails both sides of a still market at the time limit", () => {
    const p = replayPair(demo, tape(() => 0), 0, o)!;
    expect([p.long.rule, p.short.rule]).toEqual(["TimeLimit", "TimeLimit"]);
    expect(summarize(demo, [p]).pBothFail).toBe(1);
    expect(replayPair(demo, tape(() => 0, 100), 0, o)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/bot -- test/replay.test.ts`
Expected: FAIL — `Cannot find module '../src/replay'`.

- [ ] **Step 3: The replay**

`packages/bot/src/replay.ts`:
```ts
// Demo parameters from real history (architect P7, 2026-11-12). The chain serves historical getMarkPrice and
// getBookLevels, so a recorded block range can be replayed through the real evaluator: an opposite pair opened in the
// same block, both judged on closeable equity at every sample, a FAIL closed and a PASS locked `latencySec` after the
// verdict at the book of that later sample. Pure: demo-replay.ts collects the samples and prints the summary.
import { BTC_POOL, quantityForLeverage, type AccountSnapshot, type BookParams, type Rulebook } from "@basanos/core";
import { averageFill, closeableEquity, type BookLevel, type BookSides } from "@basanos/core/book";
import { evaluate, initRunState, type FailRule } from "@basanos/core/evaluate";

/** One recorded block: its timestamp (seconds), the mark and both sides of the book. */
export interface Sample {
  block: bigint;
  timestamp: bigint;
  markOk: boolean;
  mark: bigint;
  book: BookSides;
}

/** Ledger blocks are 100 ms apart on Hideki (hidekiTestnet.blockTime), so a delay in seconds is ten blocks a second. */
export const BLOCKS_PER_SEC = 10n;

/** One line of the collector's JSONL: {"b","t","ok","m","bid":[[price,qty]…],"ask":[[price,qty]…]}. */
export function parseSample(line: string): Sample {
  const r = JSON.parse(line) as { b: string; t: string; ok: boolean; m: string; bid: [string, string][]; ask: [string, string][] };
  const lv = (xs: [string, string][]): BookLevel[] => xs.map(([p, q]) => ({ price: BigInt(p), quantity: BigInt(q) }));
  return { block: BigInt(r.b), timestamp: BigInt(r.t), markOk: r.ok, mark: BigInt(r.m), book: { bids: lv(r.bid), asks: lv(r.ask) } };
}

export interface ReplayOptions {
  leverageX: number;
  startEquity: bigint;
  /** Seconds from a verdict to the close that executes it (the referee's breach-to-close latency). */
  latencySec: number;
  /** The referee locks a PASS only when closeable equity clears the target by this many equity bps (P7). */
  lockBufferBps: number;
  /** Seconds between startRun and the pair's opens (the run's clock starts first). */
  entryDelaySec: number;
  params: BookParams;
  baseDecimals: number;
}

export type SideOutcome = "pass" | "fail" | "refused" | "open";

export interface SideResult {
  outcome: SideOutcome;
  /** The rule that failed it, "PassRefused" when the lock's close slipped under the target, or null. */
  rule: FailRule | "PassRefused" | null;
  /** Seconds from startRun to the verdict's close (the PASS or the FAIL), or to the end of the replay. */
  atSec: number;
  /** Closeable equity the verdict was judged on, and what the close realized, in equity bps of the start. */
  judgedBps: number | null;
  realizedBps: number | null;
}

export interface PairResult {
  entryBlock: bigint;
  long: SideResult;
  short: SideResult;
}

const bps = (equity: bigint, start: bigint): number => Number(((equity - start) * 1_000_000n) / start) / 100;

/** The sample `sec` seconds after index i (by block number), or -1 past the end. */
export function after(samples: readonly Sample[], i: number, sec: number): number {
  const target = (samples[i]?.block ?? 0n) + BigInt(Math.round(sec * 10));
  for (let k = i; k < samples.length; k++) if ((samples[k]?.block ?? 0n) >= target) return k;
  return -1;
}

/** One side of the pair, opened at sample `entry` with an IOC walked through that block's book, judged at every later
 *  sample by the real evaluator until a verdict or the time limit. */
export function replaySide(rb: Rulebook, samples: readonly Sample[], entry: number, isLong: boolean, o: ReplayOptions): SideResult | null {
  const open = samples[entry];
  if (!open || !open.markOk) return null;
  const qty = quantityForLeverage(o.startEquity, o.leverageX, open.mark, o.baseDecimals, o.params);
  if (qty < o.params.minQuantity) return null;
  const avg = averageFill(isLong, qty, open.book);
  if (avg === null) return null;
  const size = isLong ? qty : -qty;
  const one = 10n ** BigInt(o.baseDecimals);
  const startTime = open.timestamp - BigInt(o.entryDelaySec);
  let state = initRunState(startTime, o.startEquity);
  const marked = (s: Sample) => o.startEquity + (size * (s.mark - avg)) / one;
  const closeAt = (j: number): { realized: bigint | null; k: number } => {
    const k = after(samples, j, o.latencySec);
    const s = k < 0 ? undefined : samples[k];
    return { realized: s ? closeableEquity(marked(s), size, s.mark, s.book, o.baseDecimals) : null, k };
  };
  const sec = (k: number) => Number((samples[k]?.timestamp ?? startTime) - startTime);
  for (let j = entry + 1; j < samples.length; j++) {
    const s = samples[j]!;
    const total = marked(s);
    const acct: AccountSnapshot = { account: "0x0000000000000000000000000000000000000001", equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: [BTC_POOL], size };
    const ev = evaluate(rb, state, acct, { timestamp: s.timestamp, markOk: s.markOk, markPrice: s.mark, book: s.book });
    state = ev.state;
    const v = ev.verdict;
    if (v.kind === "fail") {
      const { realized, k } = closeAt(j);
      return { outcome: "fail", rule: v.rule, atSec: sec(k < 0 ? j : k), judgedBps: ev.judgedEquity === null ? null : bps(ev.judgedEquity, o.startEquity), realizedBps: realized === null ? null : bps(realized, o.startEquity) };
    }
    if (v.kind === "target" && ev.judgedEquity !== null && ev.judgedEquity * 10_000n >= o.startEquity * BigInt(10_000 + rb.profitTargetBps + o.lockBufferBps)) {
      const { realized, k } = closeAt(j);
      const passed = realized !== null && realized * 10_000n >= o.startEquity * BigInt(10_000 + rb.profitTargetBps);
      return {
        outcome: passed ? "pass" : "refused",
        rule: passed ? null : "PassRefused",
        atSec: sec(k < 0 ? j : k),
        judgedBps: bps(ev.judgedEquity, o.startEquity),
        realizedBps: realized === null ? null : bps(realized, o.startEquity),
      };
    }
  }
  return { outcome: "open", rule: null, atSec: sec(samples.length - 1), judgedBps: null, realizedBps: null };
}

/** The opposite pair the demo opens in the same block: A long, B short. null when either side cannot open there or
 *  the replay ends before the time limit. */
export function replayPair(rb: Rulebook, samples: readonly Sample[], entry: number, o: ReplayOptions): PairResult | null {
  const lastNeeded = after(samples, entry, rb.timeLimitSec + o.latencySec + 2);
  if (lastNeeded < 0) return null;
  const long = replaySide(rb, samples, entry, true, o);
  const short = replaySide(rb, samples, entry, false, o);
  if (!long || !short) return null;
  return { entryBlock: samples[entry]!.block, long, short };
}

export interface ReplaySummary {
  windows: number;
  /** P(at least one PASS): with the demo's FAIL on demand (an exposure breach on the other account once one PASSES),
   *  this is also P(one PASS + one FAIL). */
  pAnyPass: number;
  /** P(one PASS + one FAIL) with no FAIL on demand: the two runs left to the market. */
  pOnePassOneFailNatural: number;
  pBothPass: number;
  pBothFail: number;
  /** Locks whose close slipped under the target (counted as no PASS). */
  pRefused: number;
  medianFirstPassSec: number | null;
  p90FirstPassSec: number | null;
  /** How far a FAIL's realized loss went past the daily-loss floor, in equity bps (median and worst). */
  medianFailOvershootBps: number | null;
  worstFailOvershootBps: number | null;
}

const quantile = (xs: number[], q: number): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? null;
};
const share = (n: number, d: number): number => (d === 0 ? 0 : Math.round((n / d) * 1000) / 1000);

export function summarize(rb: Rulebook, pairs: readonly PairResult[]): ReplaySummary {
  const n = pairs.length;
  let any = 0, natural = 0, both = 0, refused = 0;
  const firstPass: number[] = [];
  const overshoot: number[] = [];
  for (const p of pairs) {
    const passes = [p.long, p.short].filter((s) => s.outcome === "pass");
    if (passes.length > 0) {
      any += 1;
      firstPass.push(Math.min(...passes.map((s) => s.atSec)));
    }
    if (passes.length === 2) both += 1;
    if (passes.length === 1) natural += 1;
    for (const s of [p.long, p.short]) {
      if (s.outcome === "refused") refused += 1;
      if (s.outcome === "fail" && s.rule === "DailyLoss" && s.realizedBps !== null) overshoot.push(-s.realizedBps - rb.dailyLossBps);
    }
  }
  return {
    windows: n,
    pAnyPass: share(any, n),
    pOnePassOneFailNatural: share(natural, n),
    pBothPass: share(both, n),
    pBothFail: share(n - any, n),
    pRefused: share(refused, 2 * n),
    medianFirstPassSec: quantile(firstPass, 0.5),
    p90FirstPassSec: quantile(firstPass, 0.9),
    medianFailOvershootBps: quantile(overshoot, 0.5),
    worstFailOvershootBps: overshoot.length ? Math.max(...overshoot) : null,
  };
}
```

- [ ] **Step 4: The collector and the candidate table**

`packages/bot/src/demo-replay.ts`:
```ts
// Demo parameters from real history (architect P7, 2026-11-12). Read-only and free: the chain serves historical
// getMarkPrice and getBookLevels, so a block range is sampled through Multicall3 at past blocks and replayed through the
// real evaluator (replay.ts).
//   collect --from <block> --to <block> [--step 10] [--out <file>]  samples every `step` blocks (10 = 1 s) into JSONL;
//                                                                   resumable; default out under node_modules/.cache
//   run --history <file> [--every 60] [--out <file>]                 replays an opposite pair opened every `every`
//                                                                   seconds for each candidate, prints the table and
//                                                                   writes docs/evidence/demo-replay.json
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decodeFunctionResult, encodeFunctionData, type Hex } from "viem";
import { BTC_POOL, MULTICALL3, multicall3Abi, perpPoolAbi, rulebookId, type Rulebook } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { loadRulebook, repoPath, rpcHttp } from "@basanos/core/node";
import { LOCK_BUFFER_BPS, jsonSafe } from "@basanos/referee";
import { parseSample, replayPair, summarize, type PairResult, type ReplayOptions, type Sample } from "./replay";

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const BOOK_PARAMS = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };
const DEPTH = 10n;

/** One Multicall3 read per sample: block timestamp, mark, and 10 levels of each side, all at the sample's block. */
export function sampleCall(): Hex {
  const calls = [
    { target: MULTICALL3, allowFailure: true, callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" }) },
    { target: BTC_POOL, allowFailure: true, callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "tryGetMarkPrice" }) },
    { target: BTC_POOL, allowFailure: true, callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "getBookLevels", args: [true, DEPTH] }) },
    { target: BTC_POOL, allowFailure: true, callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "getBookLevels", args: [false, DEPTH] }) },
  ];
  return encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] });
}

/** The JSONL line for one block, or null when any of the four reads failed there. */
export function sampleLine(block: bigint, result: Hex): string | null {
  const rs = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: result });
  if (rs.length !== 4 || !rs.every((r) => r.success)) return null;
  const ts = decodeFunctionResult({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp", data: rs[0]!.returnData });
  const [ok, mark] = decodeFunctionResult({ abi: perpPoolAbi, functionName: "tryGetMarkPrice", data: rs[1]!.returnData });
  const lv = (data: Hex) =>
    decodeFunctionResult({ abi: perpPoolAbi, functionName: "getBookLevels", data }).map((x) => [x.price.toString(), x.quantity.toString()]);
  return JSON.stringify({ b: block.toString(), t: ts.toString(), ok, m: mark.toString(), bid: lv(rs[2]!.returnData), ask: lv(rs[3]!.returnData) });
}

async function collect(): Promise<void> {
  const from = BigInt(opt("--from") ?? "0");
  const to = BigInt(opt("--to") ?? "0");
  const step = BigInt(opt("--step") ?? "10");
  if (from <= 0n || to < from || step <= 0n) throw new Error("collect needs --from <block> --to <block> [--step 10]");
  const out = opt("--out") ?? repoPath(`node_modules/.cache/basanos/replay-${from}-${to}.jsonl`);
  mkdirSync(dirname(out), { recursive: true });
  const done = new Set<string>();
  if (existsSync(out)) for (const line of readFileSync(out, "utf8").split("\n")) if (line) done.add(String((JSON.parse(line) as { b: string }).b));
  const blocks: bigint[] = [];
  for (let b = from; b <= to; b += step) if (!done.has(b.toString())) blocks.push(b);
  console.log(`${blocks.length} samples to read into ${out} (${done.size} already there)`);
  const data = sampleCall();
  const BATCH = 20;
  let next = 0;
  let written = 0;
  let failed = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next;
      next += BATCH;
      if (i >= blocks.length) return;
      const slice = blocks.slice(i, i + BATCH);
      const body = slice.map((b, k) => ({ jsonrpc: "2.0", id: k, method: "eth_call", params: [{ to: MULTICALL3, data }, `0x${b.toString(16)}`] }));
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const res = await fetch(rpcHttp(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          const replies = (await res.json()) as { id: number; result?: Hex }[];
          if (!Array.isArray(replies)) throw new Error("the RPC did not answer the batch");
          const lines: string[] = [];
          for (const r of replies) {
            const b = slice[r.id];
            const line = b !== undefined && r.result ? sampleLine(b, r.result) : null;
            if (line) lines.push(line);
            else failed += 1;
          }
          if (lines.length) appendFileSync(out, `${lines.join("\n")}\n`);
          written += lines.length;
          break;
        } catch (e) {
          if (attempt === 4) {
            failed += slice.length;
            console.log(`batch at block ${slice[0]} failed: ${(e as Error).message.slice(0, 120)}`);
          }
          await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
        }
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, () => worker()));
  console.log(`collected ${written} samples, ${failed} failed -> ${out}`);
}

interface Candidate {
  label: string;
  rulebook: Rulebook;
  options: ReplayOptions;
}

/** The candidates the P7 ruling compared: the first demo as rehearsed, the chosen demo v2 at 10x, and its neighbours. */
export function candidates(): Candidate[] {
  const v1 = loadRulebook("tokyo-sprint-demo-v1");
  const v2 = loadRulebook("tokyo-sprint-demo");
  const o = (leverageX: number, latencySec: number, lockBufferBps: number): ReplayOptions => ({
    leverageX,
    startEquity: 50n * 10n ** 18n,
    latencySec,
    lockBufferBps,
    entryDelaySec: 3,
    params: BOOK_PARAMS,
    baseDecimals: 8,
  });
  const vary = (p: Partial<Rulebook>): Rulebook => ({ ...v2, ...p });
  return [
    { label: "demo v1 at 5x, closes 7 s after the verdict (the rehearsal)", rulebook: v1, options: o(5, 7, 0) },
    { label: "demo v2 at 10x, closes 3 s after the verdict (chosen)", rulebook: v2, options: o(DEMO_LEVERAGE_X, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 10x, closes 7 s after the verdict", rulebook: v2, options: o(DEMO_LEVERAGE_X, 7, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 10x, 900 s time limit", rulebook: vary({ timeLimitSec: 900 }), options: o(DEMO_LEVERAGE_X, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 5x", rulebook: v2, options: o(5, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 8x", rulebook: v2, options: o(8, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 at 12x", rulebook: v2, options: o(12, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 with a +0.40% target at 10x", rulebook: vary({ profitTargetBps: 40 }), options: o(DEMO_LEVERAGE_X, 3, LOCK_BUFFER_BPS) },
    { label: "demo v2 with v1's floors (0.50% daily, 0.75% trailing) at 10x", rulebook: vary({ dailyLossBps: 50, trailingDrawdownBps: 75 }), options: o(DEMO_LEVERAGE_X, 3, LOCK_BUFFER_BPS) },
  ];
}

export function replayAll(samples: readonly Sample[], everySec: number, list: readonly Candidate[] = candidates()) {
  return list.map((c) => {
    const pairs: PairResult[] = [];
    for (let i = 0; i < samples.length; i += everySec) {
      const p = replayPair(c.rulebook, samples, i, c.options);
      if (p) pairs.push(p);
    }
    const r = c.rulebook;
    return {
      label: c.label,
      rulebookId: rulebookId(r),
      rulebook: { profitTargetBps: r.profitTargetBps, dailyLossBps: r.dailyLossBps, trailingDrawdownBps: r.trailingDrawdownBps, maxExposureX: r.maxExposureX, minDurationSec: r.minDurationSec, timeLimitSec: r.timeLimitSec },
      leverageX: c.options.leverageX,
      latencySec: c.options.latencySec,
      lockBufferBps: c.options.lockBufferBps,
      summary: summarize(r, pairs),
    };
  });
}

async function run(): Promise<void> {
  const file = opt("--history");
  if (!file || !existsSync(file)) throw new Error("run needs --history <file.jsonl> (from collect)");
  const everySec = Number(opt("--every") ?? "60");
  const samples = readFileSync(file, "utf8").split("\n").filter(Boolean).map(parseSample).sort((a, b) => (a.block < b.block ? -1 : 1));
  const first = samples[0];
  const last = samples.at(-1);
  if (!first || !last) throw new Error("the history file is empty");
  const rows = replayAll(samples, everySec);
  for (const r of rows) {
    const s = r.summary;
    console.log(
      `${r.label}: ${s.windows} windows, P(at least one PASS) ${s.pAnyPass}, P(one PASS + one FAIL, no FAIL on demand) ${s.pOnePassOneFailNatural}, ` +
        `P(both FAIL) ${s.pBothFail}, refused locks ${s.pRefused}, first PASS median ${s.medianFirstPassSec} s (p90 ${s.p90FirstPassSec} s)`,
    );
  }
  const out = opt("--out") ?? repoPath("docs/evidence/demo-replay.json");
  const evidence = {
    evidence: "demo-replay",
    writtenAt: new Date().toISOString(),
    history: { fromBlock: first.block, toBlock: last.block, fromTime: first.timestamp, toTime: last.timestamp, samples: samples.length, stepBlocks: samples[1] ? samples[1].block - first.block : 0n },
    method:
      "An opposite pair (A long, B short, 50 USDso each) opened in the same block every `everySec` seconds of the history, each IOC walked through that block's book; " +
      "both runs judged at every sample by the core evaluator on closeable equity; a FAIL closed and a PASS locked `latencySec` after the verdict at the book of that later sample; " +
      "a lock only once closeable equity clears the target by `lockBufferBps`, and refused when the close realizes less than the target. With the demo's FAIL on demand " +
      "(the other run pushed past the exposure cap once one PASSES), P(at least one PASS) is also P(one PASS + one FAIL). Funding and fees are not modeled (fees are 0 on BTC-PERP).",
    everySec,
    candidates: rows,
    chosen: rows[1]?.label ?? null,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(jsonSafe(evidence), null, 2)}\n`);
  console.log(`wrote ${out}`);
}

const isMain = process.argv[1]?.endsWith("demo-replay.ts") ?? false;
if (isMain) {
  if (cmd === "collect") await collect();
  else if (cmd === "run") await run();
  else {
    console.error("usage: demo-replay.ts collect --from <block> --to <block> [--step 10] [--out <file>] | run --history <file> [--every 60] [--out <file>]");
    process.exit(2);
  }
  process.exit(0);
}
```

- [ ] **Step 5: Type-check**
Run: `npm run typecheck -w @basanos/bot`
Expected: exits 0 with no `error TS` lines.

- [ ] **Step 6: Run the whole bot suite**
Run: `npm test -w @basanos/bot`
Expected: no failed tests.

- [ ] **Step 7: Optional, read-only: reproduce the architect's numbers (about 7 minutes, no key)**
Run: `npx tsx packages/bot/src/demo-replay.ts collect --from 47994246 --to 48426246 --step 10`
Run: `npx tsx packages/bot/src/demo-replay.ts run --history node_modules/.cache/basanos/replay-47994246-48426246.jsonl`
Expected: the second line reads `demo v2 at 10x, closes 3 s after the verdict (chosen): 700 windows, P(at least one PASS) 0.956`. Do not commit the rewritten `docs/evidence/demo-replay.json` unless it is identical apart from `writtenAt`.

- [ ] **Step 8: Run the new test (the gate)**
Run: `npm test -w @basanos/bot -- test/replay.test.ts`
Expected: PASS — `4 passed`.

- [ ] **Step 9: Commit (kernel-performed — no agent runs this)**
Message: `feat(bot): demo replay - real mark and book history through the evaluator, for candidate demo parameters (P7)`

---

### Task 20: The closer — closes capped from the book and sent in one round trip from the push; the PASS lock with a buffer (P7)

**Files:**
- Modify: `packages/core/src/book.ts`
- Modify: `packages/referee/src/close.ts`
- Modify: `packages/referee/src/chain.ts`
- Modify: `packages/referee/src/writer.ts`
- Modify: `packages/referee/src/lock.ts`
- Modify: `packages/referee/src/engine.ts`
- Modify: `packages/referee/src/daemon.ts`
- Modify: `packages/referee/src/cli.ts`
- Test: `packages/referee/test/closer.test.ts`

**Depends on:** Task 3, Task 4, Task 5, Task 6, Task 7, Task 13, Task 14, Task 18, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6, contracts:Task 8
**Effort:** medium
**Model tier:** top
**Provides:** `planCloseFromBook(size: bigint, mark: bigint, book: BookSides | null, params: BookParams, slippageBps: number): OrderPlan | null (best ask + slippage to buy, best bid - slippage to sell; the mark ladder as fallback, the more permissive limit wins)`, `interface FirstClose { size: bigint; mark: bigint; book: BookSides | null }`, `flatten(io: CloseIO, account: Address, first?: FirstClose): Promise<CloseResult> (with first: the first close planned from the push and sent before any read, the sweep after it)`, `interface CloseIO { openOrderIds; cancel; position; book; placeClose; levels?(): Promise<BookSides | null> }`, `interface FastSender { address: Address; warm(): Promise<void>; send(to: Address, data: Hex, gas: bigint, value?: bigint): Promise<Hex>; resync(): Promise<void> }`, `fastSender(io: SenderIO, nowMs?: () => number): FastSender (nonce tracked locally, fees cached; one eth_sendRawTransaction per send)`, `makeFastSender(client: PublicClient, wallet: RefereeWallet): FastSender`, `readBookParams(client: PublicClient, pool: Address): Promise<BookParams>`, `chainCloseIO(client: PublicClient, sender: FastSender, pool: Address, params: BookParams): CloseIO`, `makeRegistryWriter(sender: FastSender, client: PublicClient, registry: Address, oracleValue: bigint): RegistryWriter`, `LOCK_BUFFER_BPS = 10`, `lockClears(judged: bigint | null, startEquity: bigint, targetBps: number, bufferBps?: number): boolean`, `interface PushSeen { blockNumber: bigint; judged: bigint | null; size: bigint; mark: bigint; book: BookRead | null }`, `interface EngineRun { run: TrackedRun; state: RunState; phase: RunPhase; exposureX: number | null; lastTotal: bigint | null; lastPush: PushSeen | null }`, `the referee daemon: FAIL and PASS closes planned from the push and sent in one round trip; the PASS lock from the push's closeable equity plus LOCK_BUFFER_BPS (no SDK quote); DaemonDeps without markets`
**Requires:** `planClose(size: bigint, mark: bigint, book: BookParams, slippageBps: number): OrderPlan | null`, `CLOSE_SLIPPAGE_STEPS_BPS = [20, 50, 100]`, `interface OrderPlan { isBid: boolean; quantity: bigint; price: bigint }`, `interface BookParams { tickSize: bigint; minQuantity: bigint; lotSize: bigint }`, `interface BookSides { bids: readonly BookLevel[]; asks: readonly BookLevel[] } (best level first: bids descending, asks ascending)`, `interface BookRead extends BookSides { blockNumber: bigint }`, `readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth?: number): Promise<BookRead | null>`, `fillableAt(isBid: boolean, limit: bigint, book: BookSides): bigint`, `flatten(io: CloseIO, account: Address): Promise<CloseResult>`, `interface CloseIO { openOrderIds(account: Address): Promise<readonly bigint[]>; cancel(account: Address, orderId: bigint): Promise<TxRecord>; position(account: Address): Promise<{ size: bigint; mark: bigint }>; book(): Promise<BookParams>; placeClose(account: Address, plan: OrderPlan): Promise<TxRecord> }`, `clearsTarget(predicted: bigint | null, startEquity: bigint, targetBps: number): boolean`, `chainCloseIO(client: PublicClient, wallet: RefereeWallet, pool: Address): CloseIO`, `makeRefereeWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`, `makePublicClient(url: string): PublicClient`, `makeRegistryWriter(wallet: RefereeWallet, client: PublicClient, registry: Address, oracleValue: bigint): RegistryWriter`, `interface RegistryWriter { recordFail(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]): Promise<TxRecord>; recordPass(runId: bigint): Promise<TxRecord>; recordVoid(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex): Promise<TxRecord> }`, `failArgs(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[])`, `voidArgs(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex)`, `class Engine { paused; track(run): boolean; get(runId): EngineRun | undefined; watchedAccounts(): Address[]; retain(activeRunIds: readonly bigint[]): bigint[]; pause(); resume(); finish(runId); release(runId); onSnapshot(snap): Action[]; onAccountLog(account, topic0, txHash, snap): Action[] }`, `interface EngineRun { run: TrackedRun; state: RunState; phase: RunPhase; exposureX: number | null; lastTotal: bigint | null }`, `type Action = { kind: "fail"; runId: bigint; account: Address; rule: FailRule; breach: BreachRead; judged: JudgedRead | null } | { kind: "lock"; runId: bigint; account: Address } | { kind: "void"; runId: bigint; account: Address; reason: "Flow" | "ForeignMarket"; txHash: Hex | null }`, `runDaemon(d: DaemonDeps): Promise<void>`, `interface TrackedRun { runId: bigint; account: Address; rulebookId: Hex; rulebook: Rulebook; startTime: bigint; startEquity: bigint; startBlock: bigint }`, `txRecord(label: string, receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint }): TxRecord`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_IOC = 2`, `farFutureNs(nowMs?: number): bigint`, `perpPoolAbi`, `CHAIN (hidekiTestnet, id 50383)`, `BTC_POOL`, `ORACLE_DEPOSIT = 30_900_000_000_000_000n`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `interface Snapshot { blockNumber: bigint; timestamp: bigint; pool: Address; markOk: boolean; markPrice: bigint; accounts: AccountSnapshot[] }`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `flag(name: "ORACLE_ENABLED", env?: NodeJS.ProcessEnv): boolean`, `rpcWss(env?: NodeJS.ProcessEnv): string`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string; "tokyo-sprint-demo-v1": string }`

Why (architect P7, 2026-11-12; guide diagnosis B19; spec §8):
- **The first rung reverted.** In the rehearsal, B's first close, an IOC buy at mark + 20 bps, reverted because the book sat about 20 bps above the mark. The 50 bps rung filled about 4 s later.
  - `planCloseFromBook` caps a close like an open: best ask + 20 bps to buy back a short, best bid − 20 bps to sell a long.
  - The mark ladder stays as the fallback. With no book it is used alone; otherwise the more permissive limit wins.
  - Retries read the position and the book again, at 50 and 100 bps.
- **The latency.** The breach-to-close gap was 7.7 s for B (block 48,411,444 to 48,411,521) and 7.1 s for A. The architect's probe (2026-11-12, read-only) found why:
  - A round trip from the operator's machine is about 0.38 to 0.40 s, with 4.5 s outliers.
  - The old path made seven sequential RPCs before the close left: open orders, book parameters, position, chain id, nonce, fees, send. The push itself arrives within about 0.6 s of its block.
- **The fix.** The close is now planned from the push's own position, mark and book of the breach block, and sent at once. The resting-order sweep follows the close.
  - All referee writes go through one fast sender: the nonce tracked locally, the fees cached (refreshed in the background every 60 s), a local signature (4.7 ms) and one `eth_sendRawTransaction`.
  - Expected: about 1.1 s from the breach block to the close block, against the ≤ 3 s target.
  - A failed send forgets the nonce. Each idle refresh adopts the chain's pending nonce when it is ahead (another tool used the key).
  - Registry writes estimate gas (a refused verdict fails before sending) with 30% headroom.
- **The PASS lock.** It no longer asks the SDK for a quote. It locks from the closeable equity of the push that raised the target, and only once that clears the target by `LOCK_BUFFER_BPS` = 10.
  - Reason: the registry checks the realized equity after the close, and a lock whose close slips under the target strands the account flat until the time limit.
  - In the replay (demo v2, 10×, closes 3 s after the verdict) the buffer kept refused locks at 0.6% with no loss of PASS odds.
- **Read-only check, 2026-11-12:** from the referee's public address, the book-capped first-rung close for the 10× demo size simulated OK against the live book in 3 of 3 samples, on both sides.
- **Unchanged:** the old `flatten(io, account)` (cancel first) and `close.test.ts` still hold.

- [ ] **Step 1: Write the failing test**

`packages/referee/test/closer.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { Address, Hex } from "viem";
import { planClose, rulebookId, type OrderPlan, type Snapshot } from "@basanos/core";
import { fillableAt, planCloseFromBook, type BookRead, type BookSides } from "@basanos/core/book";
import { loadRulebook } from "@basanos/core/node";
import { flatten, type CloseIO } from "../src/close";
import { fastSender, type SenderIO } from "../src/chain";
import { Engine } from "../src/engine";
import { LOCK_BUFFER_BPS, lockClears } from "../src/lock";
import type { TrackedRun } from "../src/runs";
import type { TxRecord } from "../src/tx";

const E18 = 10n ** 18n;
const A: Address = "0x00000000000000000000000000000000000000a1";
const PARAMS = { tickSize: E18 / 10n, minQuantity: 13_000n, lotSize: 1_000n };
// Run 2's breach block (48,411,444): mark 71,417.785, the book about 19-21 bps above it.
const MARK = 71_417_785n * 10n ** 15n;
const px = (bps: number): bigint => (MARK * BigInt(1_000_000 + bps * 100)) / 1_000_000n;
const ABOVE: BookSides = { bids: [{ price: px(19), quantity: 2_800_000n }], asks: [{ price: px(21), quantity: 2_800_000n }] };
const BELOW: BookSides = { bids: [{ price: px(-21), quantity: 2_800_000n }], asks: [{ price: px(-19), quantity: 2_800_000n }] };
const rec = (label: string, status: "success" | "reverted" = "success"): TxRecord => ({ label, hash: `0x${"0".repeat(64)}` as Hex, status, gasUsed: 1n, costWei: 1n, explorer: "" });

describe("closes are capped from the book, the mark ladder as the fallback (P7b)", () => {
  it("buys back a short above the best ask, where the old mark + 20 bps cap could not fill", () => {
    const plan = planCloseFromBook(-350_000n, MARK, ABOVE, PARAMS, 20) as OrderPlan;
    expect(plan.isBid).toBe(true);
    expect(fillableAt(true, plan.price, ABOVE)).toBeGreaterThanOrEqual(350_000n);
    expect(fillableAt(true, planClose(-350_000n, MARK, PARAMS, 20)!.price, ABOVE)).toBe(0n);
  });
  it("takes the more permissive limit on each side and either skew, and the ladder alone without a book", () => {
    const ladderSell = planClose(350_000n, MARK, PARAMS, 20)!;
    expect(planCloseFromBook(350_000n, MARK, ABOVE, PARAMS, 20)).toEqual(ladderSell);
    expect(planCloseFromBook(350_000n, MARK, BELOW, PARAMS, 20)!.price).toBeLessThan(ladderSell.price);
    expect(fillableAt(false, planCloseFromBook(350_000n, MARK, BELOW, PARAMS, 20)!.price, BELOW)).toBeGreaterThanOrEqual(350_000n);
    expect(planCloseFromBook(-350_000n, MARK, BELOW, PARAMS, 20)).toEqual(planClose(-350_000n, MARK, PARAMS, 20));
    expect(planCloseFromBook(-350_000n, MARK, null, PARAMS, 20)).toEqual(planClose(-350_000n, MARK, PARAMS, 20));
    expect(planCloseFromBook(-350_000n, MARK, { bids: [], asks: [] }, PARAMS, 20)).toEqual(planClose(-350_000n, MARK, PARAMS, 20));
    expect(planCloseFromBook(500n, MARK, ABOVE, PARAMS, 20)).toBeNull();
  });
});

function fakeIO(start: bigint, book: BookSides, fills: (plan: OrderPlan, size: bigint) => bigint) {
  let size = start;
  const log: string[] = [];
  const io: CloseIO = {
    openOrderIds: async () => (log.push("orders"), [] as bigint[]),
    cancel: async () => rec("cancel"),
    position: async () => (log.push("position"), { size, mark: MARK }),
    book: async () => PARAMS,
    levels: async () => (log.push("levels"), book),
    placeClose: async (_a, plan) => {
      log.push(`close:${plan.isBid ? "buy" : "sell"}:${plan.quantity}`);
      const after = fills(plan, size);
      const filled = after !== size;
      size = after;
      return rec("close", filled ? "success" : "reverted");
    },
  };
  return { io, log };
}

describe("the first close leaves before any read (P7b latency)", () => {
  it("plans the first close from the push and sweeps after it", async () => {
    const { io, log } = fakeIO(-350_000n, ABOVE, (plan, size) => (fillableAt(true, plan.price, ABOVE) >= plan.quantity ? 0n : size));
    const r = await flatten(io, A, { size: -350_000n, mark: MARK, book: ABOVE });
    expect(log[0]).toBe("close:buy:350000");
    expect(log.slice(1)).toEqual(["orders", "position", "orders", "position"]);
    expect(r).toMatchObject({ flat: true, attempts: 1, notes: [] });
  });
  it("retries from a fresh read and a fresh book when the first close does not fill", async () => {
    let first = true;
    const { io, log } = fakeIO(-350_000n, ABOVE, (_plan, size) => {
      if (first) {
        first = false;
        return size;
      }
      return 0n;
    });
    const r = await flatten(io, A, { size: -350_000n, mark: MARK, book: null });
    expect(log).toEqual(["close:buy:350000", "orders", "position", "levels", "close:buy:350000", "position", "orders", "position"]);
    expect(r).toMatchObject({ flat: true, attempts: 2 });
    expect(r.notes).toEqual(["close attempt 1 at 20 bps reverted"]);
  });
});

let chainNonce = 7;
function senderIO(over: Partial<SenderIO> = {}) {
  chainNonce = 7;
  const sent: { nonce: number }[] = [];
  const io = {
    address: A,
    pendingNonce: vi.fn(async () => chainNonce),
    fees: vi.fn(async () => ({ maxFeePerGas: 12n, maxPriorityFeePerGas: 1n })),
    sign: vi.fn(async (tx: { nonce: number }) => {
      sent.push({ nonce: tx.nonce });
      return `0x${tx.nonce.toString(16).padStart(2, "0")}` as Hex;
    }),
    sendRaw: vi.fn(async (raw: Hex) => raw),
    ...over,
  };
  return { io, sent };
}

describe("the fast sender: one round trip per send (P7b latency)", () => {
  it("tracks the nonce locally and caches the fees after warm()", async () => {
    const { io, sent } = senderIO();
    const s = fastSender(io);
    await s.warm();
    for (let i = 0; i < 3; i++) await s.send(A, "0x", 10_000_000n);
    expect(sent.map((x) => x.nonce)).toEqual([7, 8, 9]);
    expect(io.pendingNonce).toHaveBeenCalledTimes(1);
    expect(io.fees).toHaveBeenCalledTimes(1);
  });
  it("forgets the nonce after a failed send, and a resync only ever moves it forward", async () => {
    let fail = true;
    const { io, sent } = senderIO({
      sendRaw: vi.fn(async (raw: Hex) => {
        if (fail) {
          fail = false;
          throw new Error("timed out");
        }
        return raw;
      }),
    });
    const s = fastSender(io);
    await expect(s.send(A, "0x", 1n)).rejects.toThrow(/timed out/);
    await s.send(A, "0x", 1n);
    expect(io.pendingNonce).toHaveBeenCalledTimes(2);
    chainNonce = 20;
    await s.resync();
    await s.send(A, "0x", 1n);
    chainNonce = 3;
    await s.resync();
    await s.send(A, "0x", 1n);
    expect(sent.map((x) => x.nonce)).toEqual([7, 7, 20, 21]);
  });
  it("refreshes stale fees in the background without delaying a send", async () => {
    let now = 0;
    const { io } = senderIO();
    const s = fastSender(io, () => now);
    await s.warm();
    now = 61_000;
    await s.send(A, "0x", 1n);
    expect(io.fees).toHaveBeenCalledTimes(2);
  });
});

describe("the PASS lock (P7)", () => {
  it("locks only 10 bps past the target, from the closeable equity of the push that raised it", () => {
    expect(LOCK_BUFFER_BPS).toBe(10);
    expect(lockClears(10_059n * E18, 10_000n * E18, 50)).toBe(false);
    expect(lockClears(10_060n * E18, 10_000n * E18, 50)).toBe(true);
    expect(lockClears(null, 10_000n * E18, 50)).toBe(false);
  });
  it("keeps that push on the run while the lock acts", () => {
    const demo = loadRulebook("tokyo-sprint-demo");
    const run: TrackedRun = { runId: 1n, account: A, rulebookId: rulebookId(demo), rulebook: demo, startTime: 1_000n, startEquity: 50n * E18, startBlock: 100n };
    const e = new Engine();
    e.track(run);
    const snap = (dt: bigint, total: bigint, size: bigint): Snapshot => ({
      blockNumber: 100n + dt,
      timestamp: 1_000n + dt,
      pool: demo.market.pool,
      markOk: true,
      markPrice: MARK,
      accounts: [{ account: A, equityOk: true, equity: total, lockedCollateral: 0n, totalEquity: total, activePools: [demo.market.pool], size }],
    });
    const book = (dt: bigint): BookRead => ({ blockNumber: 100n + dt, ...ABOVE });
    // A long whose closeable equity (bids +19 bps over the mark) clears +0.5% after the 60 s minimum.
    const total = 50n * E18 + (60n * E18) / 100n;
    expect(e.onSnapshot(snap(61n, total, 70_000n), book(61n))).toEqual([{ kind: "lock", runId: 1n, account: A }]);
    const seen = e.get(1n)?.lastPush;
    expect(seen).toMatchObject({ blockNumber: 161n, size: 70_000n, mark: MARK });
    expect(seen?.judged).toBeGreaterThan(total);
    e.onSnapshot(snap(62n, 50n * E18, 70_000n), book(62n));
    expect(e.get(1n)?.lastPush?.blockNumber).toBe(161n);
  });
});
```

- [ ] **Step 2: Run to confirm it fails**
Run: `npm test -w @basanos/referee -- test/closer.test.ts`
Expected: FAIL — `planCloseFromBook` and `fastSender` do not exist yet.

- [ ] **Step 3: Plan closes from the book**

Replace `packages/core/src/book.ts` with:
```ts
// Closeable equity and book-capped opens (spec §5; architect ruling P5, 2026-11-12). The BTC-PERP book trades about
// 19 bps above the on-chain mark (guide measurement, 2026-11-12), so equity marked at the mark misstates what an
// account would hold if it flattened: a long reads low by about the basis x its notional, a short reads high. The
// rules judge closeable equity instead: the marked equity revalued from the mark to the book levels that would fill
// the close (bids for a long, asks for a short), read in the same block. Opening IOCs are capped from the book too,
// since a cap of mark + 20 bps sits below the whole ask side and never fills.
import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { multicall3Abi, perpPoolAbi } from "./abi";
import { alignDown, alignUp, planClose, type BookParams, type OrderPlan } from "./close";
import { MULTICALL3 } from "./config";

export interface BookLevel {
  price: bigint;
  quantity: bigint;
}

/** Best level first on each side: bids descending, asks ascending (PerpPool.getBookLevels order). */
export interface BookSides {
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
}

export interface BookRead extends BookSides {
  blockNumber: bigint;
}

/** Levels read per side. 20 levels held 3.3 BTC of bids and 42 BTC of asks on 2026-11-12, against a demo position of
 *  about 0.003 BTC and at most about 0.03 BTC for 40x of a 50 USDso account. */
export const BOOK_DEPTH = 20;

/** How far past the best opposite level an opening IOC may fill. The IOC fills at the book's prices; this only caps
 *  the slippage. */
export const OPEN_MARGIN_BPS = 20;

interface Row {
  success: boolean;
  returnData: Hex;
}

/** One Multicall3 call: the block number and both sides of the book, read in the same block. */
export function bookCall(pool: Address, depth: number = BOOK_DEPTH): { to: Address; data: Hex } {
  const side = (isBid: boolean) => ({
    target: pool,
    allowFailure: true,
    callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "getBookLevels", args: [isBid, BigInt(depth)] }),
  });
  const calls = [
    { target: MULTICALL3, allowFailure: true, callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getBlockNumber" }) },
    side(true),
    side(false),
  ];
  return { to: MULTICALL3, data: encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls] }) };
}

/** The decoded book, or null when the block number or either side could not be read. */
export function decodeBook(result: Hex): BookRead | null {
  const rows = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: result }) as readonly Row[];
  const [blockRow, bidRow, askRow] = rows;
  if (!blockRow?.success || !bidRow?.success || !askRow?.success) return null;
  const blockNumber = decodeFunctionResult({ abi: multicall3Abi, functionName: "getBlockNumber", data: blockRow.returnData });
  const levels = (row: Row): BookLevel[] =>
    decodeFunctionResult({ abi: perpPoolAbi, functionName: "getBookLevels", data: row.returnData }).map((l) => ({ price: l.price, quantity: l.quantity }));
  return { blockNumber, bids: levels(bidRow), asks: levels(askRow) };
}

/** Both sides of the book at `blockNumber` (default: latest); null when the read fails. */
export async function readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth: number = BOOK_DEPTH): Promise<BookRead | null> {
  const call = bookCall(pool, depth);
  try {
    const res = await client.call({ to: call.to, data: call.data, ...(blockNumber === undefined ? {} : { blockNumber }) });
    return res.data ? decodeBook(res.data) : null;
  } catch {
    return null;
  }
}

/** The marked equity revalued from the mark to the levels that would fill a close of `size` (signed, raw base units):
 *  a long sells into the bids, a short buys from the asks. Flat returns totalEquity. null when the levels read cannot
 *  fill the whole close (the position cannot be priced from this book). */
export function closeableEquity(totalEquity: bigint, size: bigint, mark: bigint, book: BookSides, baseDecimals: number): bigint | null {
  if (size === 0n) return totalEquity;
  const long = size > 0n;
  let left = long ? size : -size;
  let diff = 0n;
  for (const level of long ? book.bids : book.asks) {
    if (left === 0n) break;
    const q = level.quantity < left ? level.quantity : left;
    diff += (level.price - mark) * q;
    left -= q;
  }
  if (left > 0n) return null;
  const adjust = diff / 10n ** BigInt(baseDecimals);
  return long ? totalEquity + adjust : totalEquity - adjust;
}

/** The average price an IOC of `quantity` would fill at, walking the opposite side (asks for a buy, bids for a sell);
 *  null when the levels read cannot fill it. */
export function averageFill(isBid: boolean, quantity: bigint, book: BookSides): bigint | null {
  if (quantity <= 0n) return null;
  let left = quantity;
  let cost = 0n;
  for (const level of isBid ? book.asks : book.bids) {
    if (left === 0n) break;
    const q = level.quantity < left ? level.quantity : left;
    cost += level.price * q;
    left -= q;
  }
  return left > 0n ? null : cost / quantity;
}

/** Quantity an IOC at `limit` can take from the opposite side: asks at or below a buy limit, bids at or above a sell limit. */
export function fillableAt(isBid: boolean, limit: bigint, book: BookSides): bigint {
  let total = 0n;
  for (const level of isBid ? book.asks : book.bids) {
    if (isBid ? level.price > limit : level.price < limit) break;
    total += level.quantity;
  }
  return total;
}

/** An opening IOC capped from the book: best ask + marginBps (rounded up to the tick) to buy, best bid - marginBps
 *  (rounded down) to sell. Throws when the quantity is below the pool minimum or the opposite side is empty. */
export function planOpenFromBook(isBid: boolean, quantity: bigint, book: BookSides, params: BookParams, marginBps: number = OPEN_MARGIN_BPS): OrderPlan {
  const q = alignDown(quantity, params.lotSize);
  if (q < params.minQuantity) throw new Error(`planOpenFromBook: quantity ${q} is below minQuantity ${params.minQuantity}`);
  const best = (isBid ? book.asks : book.bids)[0];
  if (!best) throw new Error(`planOpenFromBook: the book has no ${isBid ? "asks" : "bids"} to open against`);
  const m = BigInt(marginBps);
  const price = isBid ? alignUp((best.price * (10_000n + m)) / 10_000n, params.tickSize) : alignDown((best.price * (10_000n - m)) / 10_000n, params.tickSize);
  return { isBid, quantity: q, price };
}

/** The IOC that closes `size` (signed), capped from the book like an open (architect P7, 2026-11-12): best ask +
 *  slippageBps to buy back a short, best bid - slippageBps to sell a long, rounded to the tick. The mark ladder
 *  (planClose) stays the fallback: with no book, or no level on the closing side, it is used alone, and otherwise the
 *  more permissive of the two limits wins (higher to buy, lower to sell). An IOC fills at the book's prices, so the cap
 *  only bounds slippage. The rehearsal's first close of a short, a buy at mark + 20 bps, reverted under a book about 19
 *  bps above the mark. */
export function planCloseFromBook(size: bigint, mark: bigint, book: BookSides | null, params: BookParams, slippageBps: number): OrderPlan | null {
  const ladder = planClose(size, mark, params, slippageBps);
  if (!ladder || !book) return ladder;
  const best = (ladder.isBid ? book.asks : book.bids)[0];
  if (!best) return ladder;
  const s = BigInt(slippageBps);
  if (ladder.isBid) {
    const fromBook = alignUp((best.price * (10_000n + s)) / 10_000n, params.tickSize);
    return { ...ladder, price: fromBook > ladder.price ? fromBook : ladder.price };
  }
  const fromBook = alignDown((best.price * (10_000n - s)) / 10_000n, params.tickSize);
  return { ...ladder, price: fromBook < ladder.price ? fromBook : ladder.price };
}
```

- [ ] **Step 4: Send the first close before any read; sweep after it**

Replace `packages/referee/src/close.ts` with:
```ts
import type { Address } from "viem";
import { CLOSE_SLIPPAGE_STEPS_BPS, type BookParams, type OrderPlan } from "@basanos/core";
import { planCloseFromBook, type BookSides } from "@basanos/core/book";
import type { TxRecord } from "./tx";

export interface CloseIO {
  openOrderIds(account: Address): Promise<readonly bigint[]>;
  cancel(account: Address, orderId: bigint): Promise<TxRecord>;
  position(account: Address): Promise<{ size: bigint; mark: bigint }>;
  book(): Promise<BookParams>;
  placeClose(account: Address, plan: OrderPlan): Promise<TxRecord>;
  /** Both sides of the book now (P7): retries are capped from it. Absent or null, the mark ladder alone is used. */
  levels?(): Promise<BookSides | null>;
}

/** What the push that raised the verdict already holds (architect P7): the position, the mark and the book of the
 *  breach block. With it the first close is planned and sent before any read. */
export interface FirstClose {
  size: bigint;
  mark: bigint;
  book: BookSides | null;
}

export interface CloseResult {
  flat: boolean;
  finalSize: bigint;
  attempts: number;
  txs: TxRecord[];
  notes: string[];
}

/** Spec §8 close protocol (R4), cut to one round trip before the first close (architect P7, 2026-11-12).
 *  - With `first` (the push's own reads): the first IOC is planned from that block's book and sent at once. The
 *    resting-order sweep follows it: a resting order can change the position only after the close, so the sweep and
 *    the read-back that follow catch it.
 *  - Without `first`: cancel first, as before, then close the fresh position.
 *  - Every retry reads the position and the book again; at most CLOSE_SLIPPAGE_STEPS_BPS.length attempts in all, each
 *    capped from the book with the mark ladder as the fallback; a final sweep and read-back. */
export async function flatten(io: CloseIO, account: Address, first?: FirstClose): Promise<CloseResult> {
  const txs: TxRecord[] = [];
  const notes: string[] = [];
  const sweep = async (label: string): Promise<void> => {
    for (const id of await io.openOrderIds(account)) txs.push({ ...(await io.cancel(account, id)), label });
  };
  const params = await io.book();
  let attempts = 0;
  const attempt = async (plan: OrderPlan, slippage: number): Promise<void> => {
    attempts += 1;
    const r = await io.placeClose(account, plan);
    txs.push({ ...r, label: "close" });
    if (r.status === "reverted") notes.push(`close attempt ${attempts} at ${slippage} bps reverted`);
  };
  let steps: readonly number[] = CLOSE_SLIPPAGE_STEPS_BPS;
  if (first && first.size !== 0n) {
    const step = CLOSE_SLIPPAGE_STEPS_BPS[0];
    const plan = planCloseFromBook(first.size, first.mark, first.book, params, step);
    if (plan) await attempt(plan, step);
    else notes.push(`residual ${first.size} is below one lot`);
    steps = CLOSE_SLIPPAGE_STEPS_BPS.slice(1);
  }
  await sweep(first ? "sweep" : "cancel");
  for (const slippage of steps) {
    const pos = await io.position(account);
    if (pos.size === 0n) break;
    const levels = io.levels ? await io.levels() : null;
    const plan = planCloseFromBook(pos.size, pos.mark, levels, params, slippage);
    if (!plan) {
      notes.push(`residual ${pos.size} is below one lot`);
      break;
    }
    await attempt(plan, slippage);
  }
  await sweep("sweep");
  const final = await io.position(account);
  return { flat: final.size === 0n, finalSize: final.size, attempts, txs, notes };
}
```

- [ ] **Step 5: One fast sender for every referee write**

Replace `packages/referee/src/chain.ts` with:
```ts
import { createPublicClient, createWalletClient, encodeFunctionData, http, zeroAddress, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN, ORDER_GAS, ORDER_TYPE_IOC, farFutureNs, perpPoolAbi, readSnapshot, type BookParams } from "@basanos/core";
import { readBookLevels } from "@basanos/core/book";
import type { CloseIO } from "./close";
import { txRecord } from "./tx";

export function makePublicClient(url: string): PublicClient {
  return createPublicClient({ chain: CHAIN, transport: http(url) }) as unknown as PublicClient;
}

/** Inferred return type: bound to CHAIN and the referee's account. */
export function makeRefereeWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type RefereeWallet = ReturnType<typeof makeRefereeWallet>;

/** How long cached fees are trusted before a refresh (they are refreshed in the background when stale). */
export const FEE_TTL_MS = 60_000;

export interface Fees {
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

/** The chain calls the fast sender needs; makeFastSender binds them to viem, tests fake them. */
export interface SenderIO {
  address: Address;
  pendingNonce(): Promise<number>;
  fees(): Promise<Fees>;
  sign(tx: { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number } & Fees): Promise<Hex>;
  sendRaw(raw: Hex): Promise<Hex>;
}

/** The referee's sends in one round trip (architect P7, 2026-11-12). A close used to cost seven sequential RPCs at about
 *  0.4 s each before it left (open orders, book parameters, position, chain id, nonce, fees, send): 7.7 s from the
 *  breach block to the first close in the rehearsal. Here the nonce is tracked locally and the fees are cached, so a
 *  send is a local signature and one eth_sendRawTransaction. All of the referee's writes go through one sender, in the
 *  daemon's one action queue, so nonces never race. A failed send forgets the nonce; `resync()` adopts the chain's
 *  pending nonce when it is ahead (a transaction sent by another tool with the same key). */
export interface FastSender {
  address: Address;
  /** Fetches the nonce and the fees ahead of the first send. */
  warm(): Promise<void>;
  send(to: Address, data: Hex, gas: bigint, value?: bigint): Promise<Hex>;
  resync(): Promise<void>;
}

export function fastSender(io: SenderIO, nowMs: () => number = Date.now): FastSender {
  let next: number | null = null;
  let fees: { at: number; value: Fees } | null = null;
  let inflight = 0;
  const loadFees = async (): Promise<Fees> => {
    const value = await io.fees();
    fees = { at: nowMs(), value };
    return value;
  };
  const currentFees = async (): Promise<Fees> => {
    if (!fees) return loadFees();
    if (nowMs() - fees.at > FEE_TTL_MS) void loadFees().catch(() => undefined);
    return fees.value;
  };
  return {
    address: io.address,
    warm: async () => {
      const [n] = await Promise.all([io.pendingNonce(), loadFees()]);
      next = next === null ? n : Math.max(next, n);
    },
    send: async (to, data, gas, value = 0n) => {
      inflight += 1;
      try {
        if (next === null) next = await io.pendingNonce();
        const nonce = next;
        next += 1;
        try {
          return await io.sendRaw(await io.sign({ to, data, value, gas, nonce, ...(await currentFees()) }));
        } catch (e) {
          next = null;
          throw e;
        }
      } finally {
        inflight -= 1;
      }
    },
    resync: async () => {
      if (inflight > 0) return;
      const n = await io.pendingNonce();
      if (inflight === 0) next = next === null ? n : Math.max(next, n);
    },
  };
}

/** Binds the fast sender to the referee's wallet (local signing) and the public client (standard RPC). Fees: the
 *  chain's estimate, with maxFeePerGas doubled for headroom; a transaction pays the base fee plus the tip, not the cap. */
export function makeFastSender(client: PublicClient, wallet: RefereeWallet): FastSender {
  const address = wallet.account.address;
  return fastSender({
    address,
    pendingNonce: () => client.getTransactionCount({ address, blockTag: "pending" }),
    fees: async () => {
      const f = await client.estimateFeesPerGas();
      return { maxFeePerGas: f.maxFeePerGas * 2n, maxPriorityFeePerGas: f.maxPriorityFeePerGas };
    },
    sign: (tx) => wallet.account.signTransaction({ ...tx, chainId: CHAIN.id, type: "eip1559" }),
    sendRaw: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
  });
}

export async function readBookParams(client: PublicClient, pool: Address): Promise<BookParams> {
  const p = await client.readContract({ address: pool, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
  return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
}

/** The close protocol's chain I/O. The pool's tick, minimum and lot are read once at start (they do not change), and
 *  every write goes through the fast sender. */
export function chainCloseIO(client: PublicClient, sender: FastSender, pool: Address, params: BookParams): CloseIO {
  return {
    // The pool answers getOwnOpenOrders for msg.sender: read as the owner via eth_call `from`, never through Multicall3.
    openOrderIds: (account) => client.readContract({ address: pool, abi: perpPoolAbi, functionName: "getOwnOpenOrders", account }),
    cancel: async (account, orderId) => {
      const hash = await sender.send(pool, encodeFunctionData({ abi: perpPoolAbi, functionName: "cancelOrderFor", args: [account, orderId] }), ORDER_GAS);
      return txRecord("cancel", await client.waitForTransactionReceipt({ hash }));
    },
    position: async (account) => {
      const snap = await readSnapshot(client, [account], pool);
      return { size: snap.accounts[0]?.size ?? 0n, mark: snap.markPrice };
    },
    book: async () => params,
    levels: () => readBookLevels(client, pool),
    placeClose: async (account, plan) => {
      const data = encodeFunctionData({
        abi: perpPoolAbi,
        functionName: "placeOrderFor",
        args: [account, plan.isBid, 0n, plan.price, plan.quantity, farFutureNs(), ORDER_TYPE_IOC, 0, zeroAddress, 0n],
      });
      const hash = await sender.send(pool, data, ORDER_GAS);
      return txRecord("close", await client.waitForTransactionReceipt({ hash }));
    },
  };
}
```

Replace `packages/referee/src/writer.ts` with:
```ts
import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { RULE_NAMES, basanosRegistryAbi } from "@basanos/core";
import type { FailRule } from "@basanos/core/evaluate";
import type { FastSender } from "./chain";
import type { BreachRead } from "./engine";
import { txRecord, type TxRecord } from "./tx";

export const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

export function ruleIndex(rule: FailRule): number {
  const i = RULE_NAMES.indexOf(rule);
  if (i <= 0) throw new Error(`unknown rule ${rule}`);
  return i;
}

export function voidIndex(reason: "Flow" | "ForeignMarket"): number {
  return reason === "Flow" ? 1 : 2;
}

export function failArgs(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]) {
  return [runId, ruleIndex(rule), { ...breach }, evidenceHash, [...closeTxs]] as const;
}

export function voidArgs(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex) {
  return [runId, voidIndex(reason), txHash ?? ZERO_HASH, evidenceHash] as const;
}

export interface RegistryWriter {
  recordFail(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]): Promise<TxRecord>;
  recordPass(runId: bigint): Promise<TxRecord>;
  recordVoid(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex): Promise<TxRecord>;
}

/** oracleValue is ORACLE_DEPOSIT when ORACLE_ENABLED=true (cut-order switch), else 0n; only PASS and FAIL carry it.
 *  Every write goes through the referee's one fast sender (P7), so its nonces never collide with the closes; the gas
 *  is estimated (a refused verdict reverts here, before anything is sent) with 30% headroom. */
export function makeRegistryWriter(sender: FastSender, client: PublicClient, registry: Address, oracleValue: bigint): RegistryWriter {
  const write = async (label: string, data: Hex, value: bigint): Promise<TxRecord> => {
    const gas = (await client.estimateGas({ account: sender.address, to: registry, data, value })) * 13n / 10n;
    const hash = await sender.send(registry, data, gas, value);
    const r = txRecord(label, await client.waitForTransactionReceipt({ hash }));
    if (r.status !== "success") throw new Error(`${label} reverted: ${r.explorer}`);
    return r;
  };
  return {
    recordFail: async (runId, rule, breach, evidenceHash, closeTxs) =>
      write("recordFail", encodeFunctionData({ abi: basanosRegistryAbi, functionName: "recordFail", args: failArgs(runId, rule, breach, evidenceHash, closeTxs) }), oracleValue),
    recordPass: async (runId) => write("recordPass", encodeFunctionData({ abi: basanosRegistryAbi, functionName: "recordPass", args: [runId] }), oracleValue),
    recordVoid: async (runId, reason, txHash, evidenceHash) =>
      write("recordVoid", encodeFunctionData({ abi: basanosRegistryAbi, functionName: "recordVoid", args: voidArgs(runId, reason, txHash, evidenceHash) }), 0n),
  };
}
```

- [ ] **Step 6: Lock from the push with a buffer**

Replace `packages/referee/src/lock.ts` with:
```ts
/** The subset of the SDK's PerpCloseQuote the lock needs (client.quotePerpClose, SDK 0.33.0). */
export type CloseQuoteLike =
  | { priceable: false }
  | { priceable: true; isBid: boolean; quantity: bigint; referencePrice: bigint; averagePrice: bigint | null; fillableSize: bigint };

/** Equity after closing at the quoted average instead of the mark; null if the close cannot be priced or fully filled. */
export function predictClosedEquity(totalEquity: bigint, quote: CloseQuoteLike, baseDecimals: number): bigint | null {
  if (!quote.priceable) return null;
  if (quote.quantity === 0n) return totalEquity;
  if (quote.averagePrice === null || quote.fillableSize < quote.quantity) return null;
  const diff = quote.isBid ? quote.averagePrice - quote.referencePrice : quote.referencePrice - quote.averagePrice;
  return totalEquity - (diff * quote.quantity) / 10n ** BigInt(baseDecimals);
}

export function clearsTarget(predicted: bigint | null, startEquity: bigint, targetBps: number): boolean {
  return predicted !== null && predicted * 10_000n >= startEquity * BigInt(10_000 + targetBps);
}

/** How far past the target closeable equity must be before the referee locks a PASS (architect P7, 2026-11-12). The
 *  lock closes the position and the registry then checks the realized equity against the registered target, so the
 *  move between the verdict and the close must not take it back under. In the replay of 12 hours of history (demo v2
 *  at 10x, closes 3 s after the verdict) a 10 bps buffer kept refused locks under 1% at no cost in PASS odds. It is a
 *  referee execution margin, like close slippage; the rulebook's target is unchanged and stays the registry's check. */
export const LOCK_BUFFER_BPS = 10;

/** Lock from the closeable equity of the push that raised the target (the same block's book), not from a new quote. */
export function lockClears(judged: bigint | null, startEquity: bigint, targetBps: number, bufferBps: number = LOCK_BUFFER_BPS): boolean {
  return clearsTarget(judged, startEquity, targetBps + bufferBps);
}
```

Replace `packages/referee/src/engine.ts` with:
```ts
import type { Address, Hex } from "viem";
import type { AccountSnapshot, Snapshot } from "@basanos/core";
import type { BookRead } from "@basanos/core/book";
import { classifyMarginBankLog } from "@basanos/core/classify";
import { evaluate, initRunState, type FailRule, type RunState } from "@basanos/core/evaluate";
import type { TrackedRun } from "./runs";

export interface BreachRead {
  blockNumber: bigint;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  positionSize: bigint;
  markOk: boolean;
  markPrice: bigint;
}

/** What a snapshot rule judged (spec §5): the closeable equity and the book it was revalued at, read in the breach
 *  block (book null: valued at the mark). Kept in the run evidence beside the stored reads. */
export interface JudgedRead {
  equity: bigint;
  book: BookRead | null;
}

export type Action =
  | { kind: "fail"; runId: bigint; account: Address; rule: FailRule; breach: BreachRead; judged: JudgedRead | null }
  | { kind: "lock"; runId: bigint; account: Address }
  | { kind: "void"; runId: bigint; account: Address; reason: "Flow" | "ForeignMarket"; txHash: Hex | null };

export type RunPhase = "watching" | "acting" | "done";

/** The last judged push for a run (architect P7): the closeable equity the rules judged and the position, mark and book
 *  of that block. A run stops being judged once it acts, so for a lock this is the push that raised the target: the
 *  daemon locks from it and plans the first close from it, without another read. */
export interface PushSeen {
  blockNumber: bigint;
  judged: bigint | null;
  size: bigint;
  mark: bigint;
  book: BookRead | null;
}

export interface EngineRun {
  run: TrackedRun;
  state: RunState;
  phase: RunPhase;
  exposureX: number | null;
  lastTotal: bigint | null;
  lastPush: PushSeen | null;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

export function breachRead(snap: Snapshot, acct: AccountSnapshot): BreachRead {
  return {
    blockNumber: snap.blockNumber,
    equityOk: acct.equityOk,
    equity: acct.equity,
    lockedCollateral: acct.lockedCollateral,
    positionSize: acct.size,
    markOk: snap.markOk,
    markPrice: snap.markPrice,
  };
}

export class Engine {
  private readonly runs = new Map<string, EngineRun>();
  private pausedFlag = false;

  get paused(): boolean {
    return this.pausedFlag;
  }

  track(run: TrackedRun): boolean {
    const key = run.runId.toString();
    if (this.runs.has(key)) return false;
    this.runs.set(key, { run, state: initRunState(run.startTime, run.startEquity), phase: "watching", exposureX: null, lastTotal: null, lastPush: null });
    return true;
  }

  get(runId: bigint): EngineRun | undefined {
    return this.runs.get(runId.toString());
  }

  watchedAccounts(): Address[] {
    const out: Address[] = [];
    for (const r of this.runs.values()) {
      if (r.phase !== "done" && !out.some((a) => same(a, r.run.account))) out.push(r.run.account);
    }
    return out;
  }

  /** Finishes tracked runs that are no longer active on-chain (e.g. voidRevoked by anyone); returns the ids still live. */
  retain(activeRunIds: readonly bigint[]): bigint[] {
    const live = new Set(activeRunIds.map((id) => id.toString()));
    for (const [key, r] of this.runs) if (!live.has(key) && r.phase === "watching") r.phase = "done";
    return [...this.runs.values()].filter((r) => r.phase !== "done").map((r) => r.run.runId);
  }

  pause(): void {
    this.pausedFlag = true;
  }

  resume(): void {
    this.pausedFlag = false;
  }

  finish(runId: bigint): void {
    const r = this.get(runId);
    if (r) r.phase = "done";
  }

  release(runId: bigint): void {
    const r = this.get(runId);
    if (r && r.phase === "acting") r.phase = "watching";
  }

  /** Judges every watched run on one snapshot. `book` is the book in the same block: rules then judge closeable
   *  equity, and null pauses runs with an open position. Omitted, equity is valued at the mark. */
  onSnapshot(snap: Snapshot, book?: BookRead | null): Action[] {
    if (this.pausedFlag) return [];
    const actions: Action[] = [];
    for (const r of this.runs.values()) {
      if (r.phase !== "watching") continue;
      const acct = snap.accounts.find((a) => same(a.account, r.run.account));
      if (!acct) continue;
      const ev = evaluate(r.run.rulebook, r.state, acct, {
        timestamp: snap.timestamp,
        markOk: snap.markOk,
        markPrice: snap.markPrice,
        ...(book === undefined ? {} : { book }),
      });
      r.state = ev.state;
      r.exposureX = ev.exposureX;
      if (acct.equityOk) r.lastTotal = acct.totalEquity;
      r.lastPush = { blockNumber: snap.blockNumber, judged: ev.judgedEquity, size: acct.size, mark: snap.markPrice, book: book ?? null };
      const v = ev.verdict;
      if (v.kind === "fail") {
        r.phase = "acting";
        const judged = ev.judgedEquity === null ? null : { equity: ev.judgedEquity, book: book ?? null };
        actions.push({ kind: "fail", runId: r.run.runId, account: r.run.account, rule: v.rule, breach: breachRead(snap, acct), judged });
      } else if (v.kind === "void") {
        r.phase = "acting";
        actions.push({ kind: "void", runId: r.run.runId, account: r.run.account, reason: "ForeignMarket", txHash: null });
      } else if (v.kind === "target") {
        r.phase = "acting";
        actions.push({ kind: "lock", runId: r.run.runId, account: r.run.account });
      }
    }
    return actions;
  }

  onAccountLog(account: Address, topic0: Hex | undefined, txHash: Hex | null, snap: Snapshot | null): Action[] {
    const r = [...this.runs.values()].find((x) => x.phase === "watching" && same(x.run.account, account));
    if (!r) return [];
    const cls = classifyMarginBankLog(topic0);
    if (cls === "flow") {
      r.phase = "acting";
      return [{ kind: "void", runId: r.run.runId, account: r.run.account, reason: "Flow", txHash }];
    }
    if (cls === "liquidation") {
      r.phase = "acting";
      const acct = snap?.accounts.find((a) => same(a.account, account));
      const breach: BreachRead =
        snap && acct
          ? breachRead(snap, acct)
          : { blockNumber: snap?.blockNumber ?? 0n, equityOk: false, equity: 0n, lockedCollateral: 0n, positionSize: 0n, markOk: false, markPrice: 0n };
      return [{ kind: "fail", runId: r.run.runId, account: r.run.account, rule: "Liquidated", breach, judged: null }];
    }
    // A trading log carries no book, so it is not judged here: the price-feed watch pushes the snapshot and the book
    // of the same block within about a second, and judges closeable equity (spec §5).
    return [];
  }
}
```

Replace `packages/referee/src/daemon.ts` with:
```ts
import { pad, type Address, type Hex, type PublicClient } from "viem";
import {
  BTC_POOL,
  MARGIN_BANK,
  PRICE_FEED_SCHEDULER,
  decodeSnapshot,
  readSnapshot,
  snapshotCall,
  startWatch,
  type Rulebook,
  type Snapshot,
  type WatchHandle,
} from "@basanos/core";
import { bookCall, decodeBook, readBookLevels, type BookRead } from "@basanos/core/book";
import { flatten, type CloseIO } from "./close";
import { Engine, type Action } from "./engine";
import { attachVerdictTx, writeRunEvidence } from "./evidence";
import { LOCK_BUFFER_BPS, lockClears } from "./lock";
import { readActiveRuns, rulebookIndex } from "./runs";
import type { TxRecord } from "./tx";
import type { RegistryWriter } from "./writer";

export interface DaemonDeps {
  client: PublicClient;
  wss: string;
  registry: Address;
  rulebooks: readonly Rulebook[];
  closeIO: CloseIO;
  writer: RegistryWriter;
  /** The referee's fast sender (P7): its nonce is re-read on each idle refresh, in case another tool used the key. */
  sender?: { resync(): Promise<void> };
  log: (line: string) => void;
  pollMs?: number;
}

interface Gap {
  atMs: number;
  reason: string;
  lastBlock: string;
  resumedAtBlock: string | null;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

async function retry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1_000 * (i + 1)));
    }
  }
  throw last;
}

export async function runDaemon(d: DaemonDeps): Promise<void> {
  const engine = new Engine();
  const index = rulebookIndex(d.rulebooks);
  const gaps: Gap[] = [];
  const connected = new Set<number>();
  let watches: WatchHandle[] = [];
  let watchedKey = "";
  let lastSnap: Snapshot | null = null;
  let queue: Promise<void> = Promise.resolve();

  const enqueue = (actions: Action[]): void => {
    for (const a of actions) {
      queue = queue
        .then(() => act(a))
        .catch((e: unknown) => {
          d.log(`action error on run ${a.runId}: ${(e as Error).message}`);
          engine.release(a.runId);
        });
    }
  };

  // Rules judge closeable equity (spec §5), so every judged snapshot comes with the book of the same block; a missing
  // book pauses runs with an open position until the next push.
  const onSnap = (snap: Snapshot, book: BookRead | null): void => {
    lastSnap = snap;
    enqueue(engine.onSnapshot(snap, book));
  };

  const bookOf = (raw: Hex | undefined, block: bigint): BookRead | null => {
    try {
      const book = raw ? decodeBook(raw) : null;
      return book && book.blockNumber === block ? book : null;
    } catch {
      return null;
    }
  };

  const findFlowTx = async (account: Address, block: bigint): Promise<Hex | null> => {
    const tag = `0x${block.toString(16)}` as Hex;
    for (const topics of [[null, pad(account)], [null, null, pad(account)]]) {
      const logs = (await d.client.request({
        method: "eth_getLogs",
        params: [{ address: MARGIN_BANK, topics: topics as Hex[], fromBlock: tag, toBlock: tag }],
      })) as { transactionHash: Hex }[];
      const first = logs[0];
      if (first) return first.transactionHash;
    }
    return null;
  };

  const resumeAtHead = async (): Promise<void> => {
    const accounts = engine.watchedAccounts();
    if (accounts.length === 0) {
      engine.resume();
      return;
    }
    const snap = await readSnapshot(d.client, accounts, BTC_POOL);
    const gap = gaps.at(-1);
    if (gap && gap.resumedAtBlock === null) gap.resumedAtBlock = snap.blockNumber.toString();
    engine.resume();
    d.log(`resumed at block ${snap.blockNumber} after a gap; re-evaluating at head`);
    onSnap(snap, await readBookLevels(d.client, BTC_POOL, snap.blockNumber));
  };

  const resubscribe = (): void => {
    for (const w of watches) w.close();
    watches = [];
    connected.clear();
    const accounts = engine.watchedAccounts();
    watchedKey = accounts.map((a) => a.toLowerCase()).sort().join(",");
    if (accounts.length === 0) return;
    const call = snapshotCall(accounts, BTC_POOL);
    const topics = accounts.map((a) => pad(a));
    const decode = (results: Hex[]): Snapshot | null => {
      const raw = results[0];
      return raw ? decodeSnapshot(raw, accounts, BTC_POOL) : null;
    };
    const handlers = (i: number, onPush: (results: Hex[], logTopics: Hex[]) => void) => ({
      onPush: (p: { simulationResults: Hex[]; topics: Hex[] }) => onPush(p.simulationResults, p.topics),
      onConnected: ({ reconnects }: { reconnects: number }) => {
        connected.add(i);
        if (reconnects > 0 && connected.size === 3) void resumeAtHead().catch((e: unknown) => d.log(`resume error: ${(e as Error).message}`));
      },
      onGap: ({ atMs, reason }: { atMs: number; reason: string }) => {
        connected.delete(i);
        if (!engine.paused) {
          engine.pause();
          gaps.push({ atMs, reason, lastBlock: lastSnap ? lastSnap.blockNumber.toString() : "none", resumedAtBlock: null });
          d.log(`gap (${reason}): judging paused`);
        }
      },
    });
    watches.push(
      startWatch(
        d.wss,
        { address: PRICE_FEED_SCHEDULER, ethCalls: [call, bookCall(BTC_POOL)], pushChangesOnly: true },
        handlers(0, (results) => {
          const s = decode(results);
          if (s) onSnap(s, bookOf(results[1], s.blockNumber));
        }),
      ),
    );
    for (const position of [1, 2] as const) {
      const filterTopics = position === 1 ? [null, topics] : [null, null, topics];
      watches.push(
        startWatch(
          d.wss,
          { address: MARGIN_BANK, topics: filterTopics, ethCalls: [call] },
          handlers(position, (results, logTopics) => {
            const s = decode(results);
            if (s) lastSnap = s;
            const t = logTopics[position];
            const account = accounts.find((a) => t !== undefined && same(pad(a), t));
            if (account) enqueue(engine.onAccountLog(account, logTopics[0], null, s));
          }),
        ),
      );
    }
  };

  const act = async (a: Action): Promise<void> => {
    const er = engine.get(a.runId);
    if (!er) return;
    const rb = er.run.rulebook;
    const base = {
      runId: a.runId,
      account: a.account,
      rulebook: { name: rb.name, variant: rb.variant, label: rb.label, id: er.run.rulebookId },
      startBlock: er.run.startBlock,
      startEquity: er.run.startEquity,
      gaps: gaps.map((g) => ({ ...g })),
    };
    if (a.kind === "void") {
      const txHash = a.txHash ?? (lastSnap ? await findFlowTx(a.account, lastSnap.blockNumber) : null);
      const hash = writeRunEvidence(a.runId, { ...base, verdict: "VOIDED", reason: a.reason, flowTx: txHash });
      const tx = await retry(() => d.writer.recordVoid(a.runId, a.reason, txHash, hash));
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} VOIDED (${a.reason}) ${tx.explorer}`);
      return;
    }
    if (a.kind === "fail") {
      d.log(`run ${a.runId} breach ${a.rule} at block ${a.breach.blockNumber}: closing from the breach block's book, then cancelling`);
      // The first close is planned from the push itself (position, mark, book of the breach block) and sent at once (P7).
      const close = await flatten(d.closeIO, a.account, { size: a.breach.positionSize, mark: a.breach.markPrice, book: a.judged?.book ?? null });
      for (const t of close.txs) d.log(`  ${t.label} ${t.status} ${t.explorer}`);
      const hash = writeRunEvidence(a.runId, { ...base, verdict: "FAILED", rule: a.rule, breach: a.breach, judged: a.judged, close });
      const tx: TxRecord = await retry(() => d.writer.recordFail(a.runId, a.rule, a.breach, hash, close.txs.map((t) => t.hash)));
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} FAILED (${a.rule}) ${tx.explorer}`);
      return;
    }
    // The lock (P7): from the closeable equity of the push that raised the target, with LOCK_BUFFER_BPS of room so the
    // move before the close cannot take the realized equity back under the registered target; then the first close is
    // planned from that same push. No new quote, no read before the close.
    const seen = er.lastPush;
    if (!seen || !lockClears(seen.judged, er.run.startEquity, rb.profitTargetBps)) {
      engine.release(a.runId);
      return;
    }
    d.log(`run ${a.runId} target reached (closeable equity ${seen.judged} at block ${seen.blockNumber}, ${LOCK_BUFFER_BPS} bps past the target): locking`);
    const close = await flatten(d.closeIO, a.account, { size: seen.size, mark: seen.mark, book: seen.book });
    for (const t of close.txs) d.log(`  ${t.label} ${t.status} ${t.explorer}`);
    try {
      const tx = await d.writer.recordPass(a.runId);
      writeRunEvidence(a.runId, { ...base, verdict: "PASSED", lock: { blockNumber: seen.blockNumber, judgedEquity: seen.judged, bufferBps: LOCK_BUFFER_BPS }, close });
      attachVerdictTx(a.runId, tx);
      engine.finish(a.runId);
      d.log(`run ${a.runId} PASSED ${tx.explorer}`);
    } catch (e) {
      d.log(`run ${a.runId} recordPass refused (${(e as Error).message.slice(0, 160)}); the run continues`);
      engine.release(a.runId);
    }
  };

  const refresh = async (): Promise<void> => {
    if (d.sender) await d.sender.resync();
    const runs = await readActiveRuns(d.client, d.registry, index);
    for (const r of runs) if (engine.track(r)) d.log(`tracking run ${r.runId}: ${r.account} on ${r.rulebook.label}`);
    engine.retain(runs.map((r) => r.runId));
    const key = engine.watchedAccounts().map((a) => a.toLowerCase()).sort().join(",");
    if (key !== watchedKey) {
      resubscribe();
      // fresh sockets report reconnects === 0, so a pause from an earlier gap would otherwise never lift
      if (engine.paused) void resumeAtHead().catch((e: unknown) => d.log(`resume error: ${(e as Error).message}`));
    }
  };

  await refresh();
  setInterval(() => {
    void refresh().catch((e: unknown) => d.log(`refresh error: ${(e as Error).message}`));
  }, d.pollMs ?? 5_000);
  d.log(`referee watching registry ${d.registry}`);
  await new Promise<never>(() => undefined);
}
```

Replace `packages/referee/src/cli.ts` with:
```ts
import { decodeEventLog, getAddress, type Hex } from "viem";
import { BTC_POOL, ORACLE_DEPOSIT, basanosRegistryAbi, rulebookId } from "@basanos/core";
import { RULEBOOK_FILES, flag, loadDotEnv, loadRulebook, requireAddress, requirePrivateKey, rpcHttp, rpcWss } from "@basanos/core/node";
import { chainCloseIO, makeFastSender, makePublicClient, makeRefereeWallet, readBookParams } from "./chain";
import { runDaemon } from "./daemon";
import { readActiveRuns, rulebookIndex } from "./runs";
import { makeRegistryWriter } from "./writer";

loadDotEnv();
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
// Every registered rulebook it may meet: the standard, the current demo (v2) and the first demo (v1, still registered).
const rulebooks = [loadRulebook("tokyo-sprint"), loadRulebook("tokyo-sprint-demo"), loadRulebook("tokyo-sprint-demo-v1")];

if (cmd === "start") {
  const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
  // One sender for every referee write (P7): nonce tracked locally, fees cached, both fetched now, before any breach.
  const sender = makeFastSender(client, wallet);
  await sender.warm();
  const params = await readBookParams(client, BTC_POOL);
  await runDaemon({
    client,
    wss: rpcWss(),
    registry,
    rulebooks,
    closeIO: chainCloseIO(client, sender, BTC_POOL, params),
    writer: makeRegistryWriter(sender, client, registry, flag("ORACLE_ENABLED") ? ORACLE_DEPOSIT : 0n),
    sender,
    log: (line) => console.log(`${new Date().toISOString()} ${line}`),
  });
} else if (cmd === "enroll") {
  const target = rest[0];
  const name = opt("--rulebook") as keyof typeof RULEBOOK_FILES | undefined;
  if (!target || !name || !(name in RULEBOOK_FILES)) {
    console.error("usage: cli.ts enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo>");
    process.exit(2);
  }
  const wallet = makeRefereeWallet(requirePrivateKey("REFEREE_PK"), rpcHttp());
  const hash = await wallet.writeContract({
    address: registry,
    abi: basanosRegistryAbi,
    functionName: "startRun",
    args: [getAddress(target), rulebookId(loadRulebook(name))],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  let runId: bigint | null = null;
  for (const log of receipt.logs) {
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") runId = ev.args.runId;
    } catch {
      // not a registry event
    }
  }
  console.log(runId === null ? `enroll failed: ${hash}` : `enrolled run ${runId} (${hash})`);
  process.exit(runId === null ? 1 : 0);
} else if (cmd === "status") {
  const runs = await readActiveRuns(client, registry, rulebookIndex(rulebooks));
  if (runs.length === 0) console.log("no active runs");
  for (const r of runs) console.log(`run ${r.runId}: ${r.account} on ${r.rulebook.label}, start equity ${r.startEquity} at block ${r.startBlock}`);
  process.exit(0);
} else {
  console.error("usage: cli.ts start | enroll <account> --rulebook <name> | status");
  process.exit(2);
}
```

- [ ] **Step 7: Type-check (the referee runs live in referee:22 and ship:3)**
Run: `npm run typecheck -w @basanos/core`
Run: `npm run typecheck -w @basanos/referee`
Run: `npm run typecheck -w @basanos/bot`
Expected: each exits 0 with no `error TS` lines.

- [ ] **Step 8: Run the whole referee suite**
Run: `npm test -w @basanos/referee`
Expected: no failed tests (`33 passed`).

- [ ] **Step 9: Run the new test (the gate)**
Run: `npm test -w @basanos/referee -- test/closer.test.ts`
Expected: PASS — `9 passed`.

- [ ] **Step 10: Commit (kernel-performed — no agent runs this)**
Message: `fix(referee): closes capped from the book and sent in one round trip from the push; the PASS lock with a 10 bps buffer (P7)`

---

### Task 21: The demo take — both runs start together, the pair opens in the same block, the FAIL on demand comes right after the first PASS (P7)

**Files:**
- Create: `packages/bot/src/take.ts`
- Create: `packages/referee/src/check-pass.ts`
- Modify: `packages/bot/src/send.ts`
- Modify: `packages/bot/src/actions.ts`
- Modify: `packages/bot/src/demo.ts`
- Test: `packages/bot/test/take.test.ts`
- Test: `packages/referee/test/check-pass.test.ts`

**Depends on:** Task 3, Task 6, Task 8, Task 12, Task 13, Task 15, Task 16, Task 17, Task 18, spike:Task 1, spike:Task 2, spike:Task 3, spike:Task 4, spike:Task 6, contracts:Task 8
**Effort:** medium
**Model tier:** top
**Provides:** `interface PreparedWrite { label: string; raw: Hex; hash: Hex; nonce: number }`, `prepareWrite(s: Sender, label: string, call: UnsignedCall): Promise<PreparedWrite>`, `submitWrite(s: Sender, p: PreparedWrite, waitMs?: number): Promise<SendResult>`, `interface PairLeg { wallet: AccountWallet; isBid: boolean; quantity: bigint }`, `openPair(client: PublicClient, legs: readonly PairLeg[]): Promise<AccountWrite[]> (one book read; both IOCs signed first, then sent back to back)`, `waitForPosition(client: PublicClient, account: Address, untilMs: number, pollMs?: number): Promise<bigint | null>`, `breachTarget(statuses: readonly TakeStatus[], alreadyBreached: boolean): number | null`, `summarizePassTake(rows: readonly PassTakeRow[]): { ok: boolean; passRunId: bigint | null; problems: string[] }`, `CLI: npx tsx packages/referee/src/check-pass.ts -> writes docs/evidence/rehearsal-pass.json, prints PASS pass-take (take <n>: run <id> PASSED with its certificate, one FAILED)`, `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--one-account [--pass-side long|short]] (two funded accounts; both runs start together and the pair opens in the same block, or B right after a human A's long with --a-manual; the FAIL on demand once one run PASSES; writes viem-direct and read back; a take that fails after a run started aborts into docs/evidence/demo-aborted.json, exit 1)`
**Requires:** `sendWrite(s: Sender, label: string, call: UnsignedCall, waitMs?: number): Promise<SendResult> (signs at the pending nonce with ORDER_GAS, sends the raw transaction once, takes the receipt by the hash known before the send; never re-sends)`, `interface Sender { address: Address; pendingNonce(): Promise<number>; sign(tx: SignedTx): Promise<Hex>; sendRaw(raw: Hex): Promise<unknown>; waitReceipt(hash: Hex, timeoutMs: number): Promise<Receipt>; receipt(hash: Hex): Promise<Receipt | null> }`, `type SendResult = { outcome: "landed"; label: string; hash: Hex; nonce: number; tx: TxRecord; reason: null } | { outcome: "unknown"; label: string; hash: Hex; nonce: number; tx: null; reason: string }`, `effectOf(sent: SendResult, seen: boolean, latestNonce: number): Effect`, `interface AccountWrite { sent: SendResult; effect: Effect }`, `describeWrite(w: AccountWrite): string`, `onFailure(kind: WriteKind | "error", runsStarted: number): "stop" | "abort" | "note"`, `verdictDeadline(lastStartMs: number, timeLimitSec: number): number`, `viemSender(wallet: AccountWallet, client: PublicClient): Sender (signs locally; nonce, raw send and receipt on the standard RPC)`, `DEMO_ABORTED = "docs/evidence/demo-aborted.json"`, `openIoc(client: PublicClient, wallet: AccountWallet, isBid: boolean, quantity: bigint, label?: string): Promise<AccountWrite> (capped from the book; viem-direct; done only if the position size moved; never re-sent)`, `ensureGrant(client: PublicClient, wallet: AccountWallet, referee: Address): Promise<AccountWrite | null> (viem-direct; done only when both selectors read authorized)`, `startRunAs(client: PublicClient, wallet: AccountWallet, registry: Address, rulebookId: Hex): Promise<AccountWrite & { runId: bigint | null }> (viem-direct; the run read back from activeRunOf)`, `type AccountWallet = ReturnType<typeof makeAccountWallet>`, `RECEIPT_WAIT_MS = 60_000`, `breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`, `readBook(client: PublicClient): Promise<BookParams>`, `appendDemoTake(take: Record<string, unknown>, path?: string): number`, `makeAccountWallet(pk: Hex, url: string) (viem WalletClient bound to CHAIN and the key's account)`, `preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei?: bigint): Promise<Preflight>`, `notReady(pf: Preflight): string[]`, `planOpenFromBook(isBid: boolean, quantity: bigint, book: BookSides, params: BookParams, marginBps?: number): OrderPlan`, `readBookLevels(client: PublicClient, pool: Address, blockNumber?: bigint, depth?: number): Promise<BookRead | null>`, `ownerOrderCall(pool: Address, isBid: boolean, price: bigint, quantity: bigint, orderType: number, expireTimestampNs: bigint): UnsignedCall`, `ownerTx(call: UnsignedCall, nonce: number, gas: bigint): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number }`, `interface UnsignedCall { to: Address; data: Hex; value: bigint }`, `DEMO_LEVERAGE_X = 10`, `RULEBOOK_FILES: { "tokyo-sprint": string; "tokyo-sprint-demo": string; "tokyo-sprint-demo-v1": string }`, `jsonSafe(value: unknown): unknown`, `makePublicClient(url: string): PublicClient`, `basanosRegistryAbi (as const, generated from the forge artifact)`, `RUN_STATUS = ["None", "Active", "Passed", "Failed", "Voided"]`, `RULE_NAMES = ["None", "DailyLoss", "TrailingDrawdown", "MaxExposure", "TimeLimit", "Liquidated"]`, `BTC_POOL`, `ORDER_GAS = 10_000_000n`, `ORDER_TYPE_IOC = 2`, `farFutureNs(nowMs?: number): bigint`, `loadDotEnv(path?: string): boolean`, `loadRulebook(name: keyof typeof RULEBOOK_FILES): Rulebook`, `requireAddress(name: AddressName, env?: NodeJS.ProcessEnv): Address`, `requirePrivateKey(name: SecretName, env?: NodeJS.ProcessEnv): Hex`, `rpcHttp(env?: NodeJS.ProcessEnv): string`, `repoPath(rel: string): string`, `readSnapshot(client: PublicClient, accounts: readonly Address[], pool: Address, blockNumber?: bigint): Promise<Snapshot>`, `quantityForLeverage(equity: bigint, leverageX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint`

Why (architect P7, 2026-11-12; guide diagnosis B19; spec §9):
- **Staggered entries.** Opposite positions only anti-correlate if they enter at the same moment. In the rehearsal B's start came 13 s after A's and the opens were 13 s apart, inside a whipsaw, so both lost. In ship:3's `--a-manual` recording a human opens A at any time.
- **The fix:**
  - Both runs now start together (`Promise.all`), and the pair opens only after both have started.
  - `openPair` caps both IOCs from ONE book read, signs both first (`prepareWrite`), then sends both back to back (`submitWrite`), so they land in the same block or the next.
  - With `--a-manual`, B opens its short as soon as A's long is seen (`waitForPosition`, every 250 ms).
  - Each open still counts only if its position moved, and nothing is re-sent (P6b).
- **The second leg.** The replay gives at least one PASS in 95.6% of windows, but the other run's own verdict is a coin flip. So once one run PASSES, `breachTarget` names the other, still Active, and the demo pushes it past the 15× exposure cap: a deterministic FAIL (MaxExposure) that the referee closes like any breach.
- **The old 10-minute "market still" breach and `--wait-min` are gone:** an early FAIL does not make the PASS more likely.
- **The new gate.** The PASS path (the referee's lock, the registry's recordPass checks, the certificate mint) has never run on-chain. `check-pass` is the gate for rehearsal take 2 (referee:22): the latest take must be one PASSED run whose certificate (`ownerOf(runId)`) is held by its own account, and one FAILED run.

- [ ] **Step 1: Write the failing tests**

`packages/bot/test/take.test.ts`:
```ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { keccak256, type Address, type Hex } from "viem";
import { BTC_POOL, ORDER_GAS, ORDER_TYPE_IOC } from "@basanos/core";
import { ownerOrderCall } from "@basanos/core/owner-tx";
import { prepareWrite, submitWrite, type Receipt, type Sender } from "../src/send";
import { breachTarget } from "../src/take";

const source = (rel: string) => readFileSync(new URL(`../src/${rel}`, import.meta.url), "utf8");

describe("the FAIL on demand comes right after the first PASS (P7)", () => {
  it("pushes the run still Active once the other has PASSED, once", () => {
    expect(breachTarget(["Passed", "Active"], false)).toBe(1);
    expect(breachTarget(["Active", "Passed"], false)).toBe(0);
    expect(breachTarget(["Passed", "Active"], true)).toBeNull();
    expect(breachTarget(["Active", "Active"], false)).toBeNull();
    expect(breachTarget(["Failed", "Active"], false)).toBeNull();
    expect(breachTarget(["Passed", "Failed"], false)).toBeNull();
  });
});

describe("the opposite pair enters together (P7)", () => {
  it("signs both opens first, then sends both before either receipt comes back", async () => {
    const order: string[] = [];
    const release: (() => void)[] = [];
    const sender = (name: string, nonce: number): Sender => {
      const raw = `0x${name.charCodeAt(0).toString(16)}` as Hex;
      return {
        address: "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1" as Address,
        pendingNonce: async () => nonce,
        sign: vi.fn(async (tx) => {
          order.push(`sign ${name} gas ${tx.gas}`);
          return raw;
        }),
        sendRaw: async () => {
          order.push(`send ${name}`);
          return keccak256(raw);
        },
        waitReceipt: (hash) =>
          new Promise<Receipt>((resolve) => {
            order.push(`wait ${name}`);
            release.push(() => resolve({ transactionHash: hash, status: "success", gasUsed: 1n, effectiveGasPrice: 1n }));
          }),
        receipt: async () => null,
      };
    };
    const call = ownerOrderCall(BTC_POOL, true, 72_000n * 10n ** 18n, 700_000n, ORDER_TYPE_IOC, 3_371_163_205_000_000_000n);
    const a = sender("A", 6);
    const b = sender("B", 2);
    const prepared = await Promise.all([prepareWrite(a, "open long", call), prepareWrite(b, "open short", call)]);
    expect(prepared.map((p) => p.nonce)).toEqual([6, 2]);
    const done = Promise.all([submitWrite(a, prepared[0]!), submitWrite(b, prepared[1]!)]);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual([`sign A gas ${ORDER_GAS}`, `sign B gas ${ORDER_GAS}`, "send A", "send B", "wait A", "wait B"]);
    for (const r of release) r();
    expect((await done).map((s) => s.outcome)).toEqual(["landed", "landed"]);
  });
  it("starts both runs before the pair opens, follows a human A, and breaches only after a PASS", () => {
    const demo = source("demo.ts");
    expect(demo).toContain("await Promise.all(accounts.map((a) => startRun(a)));");
    expect(demo).toContain("openPair(client, [");
    expect(demo).toContain("waitForPosition(client, accA.address, until)");
    expect(demo).toContain("breachTarget(");
    expect(demo).not.toContain("--wait-min");
    expect(demo).not.toContain("market still");
  });
});
```

`packages/referee/test/check-pass.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import type { Address } from "viem";
import { summarizePassTake, type PassTakeRow } from "../src/check-pass";

const A: Address = "0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1";
const B: Address = "0x1609F6ABE3aD29B45D1F2fdd15a15d17AbB326aD";
const pass: PassTakeRow = { runId: 3n, account: A, status: 2, rule: 0, holder: A };
const fail: PassTakeRow = { runId: 4n, account: B, status: 3, rule: 3, holder: null };

describe("the PASS take's gate (P7)", () => {
  it("wants one PASSED run with its certificate on its own account and one FAILED run", () => {
    expect(summarizePassTake([pass, fail])).toEqual({ ok: true, passRunId: 3n, problems: [] });
    expect(summarizePassTake([{ ...pass, holder: null }, fail]).problems).toEqual(["run 3 PASSED but has no certificate"]);
    expect(summarizePassTake([{ ...pass, holder: B }, fail]).problems[0]).toMatch(/held by/);
    expect(summarizePassTake([{ ...pass, status: 3 }, fail]).ok).toBe(false);
    expect(summarizePassTake([pass]).problems).toContain("the latest take has 1 runs, not 2");
  });
});
```

- [ ] **Step 2: Run to confirm they fail**
Run: `npm test -w @basanos/bot -- test/take.test.ts`
Run: `npm test -w @basanos/referee -- test/check-pass.test.ts`
Expected: FAIL — `Cannot find module '../src/take'` and `Cannot find module '../src/check-pass'`.

- [ ] **Step 3: Prepare and submit writes separately**

Replace `packages/bot/src/send.ts` with:
```ts
// How a challenge account's own writes reach the chain (P6, 2026-11-12). viem-direct, as spike:14 does for account A:
// the transaction is signed locally with ORDER_GAS and an explicit pending nonce, sent once with
// eth_sendRawTransaction to the standard RPC (rpcHttp()), and its receipt is taken from the public client. Signing
// first gives the hash before the send, so a send that fails or times out can still be looked up.
// The SDK's send path (eth_sendRawTransactionSync on send.hideki…) ended "outcome unknown" with nothing on-chain twice:
// the voucher claim (2026-11-11) and B's grant in the first rehearsal (2026-11-12). No bot write uses it.
// Nothing here re-sends. Whether a write took effect is read back from the chain (effectOf), never assumed from the
// send call: a grant is idempotent, but an open is not, and a blind re-send could double a position.
import { keccak256, type Address, type Hex } from "viem";
import { ORDER_GAS } from "@basanos/core";
import { ownerTx, type UnsignedCall } from "@basanos/core/owner-tx";
import { txRecord, type TxRecord } from "@basanos/referee";

/** How long a send waits for its receipt before its outcome counts as unknown. Hideki blocks are about 0.1 s apart. */
export const RECEIPT_WAIT_MS = 60_000;

/** After the last run starts, how long past the rulebook's time limit the demo waits for the verdicts. */
export const VERDICT_GRACE_SEC = 300;

export type Receipt = Parameters<typeof txRecord>[1];
export type SignedTx = ReturnType<typeof ownerTx>;

/** The chain calls one send makes. viemSender() in actions.ts binds them to an account wallet and the public client;
 *  tests fake them. */
export interface Sender {
  address: Address;
  pendingNonce(): Promise<number>;
  sign(tx: SignedTx): Promise<Hex>;
  sendRaw(raw: Hex): Promise<unknown>;
  waitReceipt(hash: Hex, timeoutMs: number): Promise<Receipt>;
  receipt(hash: Hex): Promise<Receipt | null>;
}

/** A write that reached a receipt (success or reverted), or one whose outcome is not known yet. */
export type SendResult =
  | { outcome: "landed"; label: string; hash: Hex; nonce: number; tx: TxRecord; reason: null }
  | { outcome: "unknown"; label: string; hash: Hex; nonce: number; tx: null; reason: string };

const short = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split("\n")[0]?.slice(0, 160) ?? "";

/** A signed write not yet sent: its hash is known before the send. */
export interface PreparedWrite {
  label: string;
  raw: Hex;
  hash: Hex;
  nonce: number;
}

/** Signs `call` at the pending nonce with ORDER_GAS. Nothing is sent. */
export async function prepareWrite(s: Sender, label: string, call: UnsignedCall): Promise<PreparedWrite> {
  const nonce = await s.pendingNonce();
  const raw = await s.sign(ownerTx(call, nonce, ORDER_GAS));
  return { label, raw, hash: keccak256(raw), nonce };
}

/** Signs `call` at the pending nonce with ORDER_GAS, sends it once, and waits for its receipt by the hash known before
 *  the send. A failed send still waits, since a timed-out send may have reached the node. Never re-sends. */
export async function sendWrite(s: Sender, label: string, call: UnsignedCall, waitMs: number = RECEIPT_WAIT_MS): Promise<SendResult> {
  return submitWrite(s, await prepareWrite(s, label, call), waitMs);
}

/** Sends a prepared write once and waits for its receipt (P7): the demo signs both opens first, then submits them
 *  together, so the opposite pair enters in the same block or the next. */
export async function submitWrite(s: Sender, p: PreparedWrite, waitMs: number = RECEIPT_WAIT_MS): Promise<SendResult> {
  const { label, raw, hash, nonce } = p;
  let reason = "";
  try {
    await s.sendRaw(raw);
  } catch (e) {
    reason = `send failed: ${short(e)}`;
  }
  try {
    return { outcome: "landed", label, hash, nonce, tx: txRecord(label, await s.waitReceipt(hash, waitMs)), reason: null };
  } catch (e) {
    if (!reason) reason = `no receipt within ${waitMs / 1000} s: ${short(e)}`;
  }
  const late = await s.receipt(hash);
  if (late) return { outcome: "landed", label, hash, nonce, tx: txRecord(label, late), reason: null };
  return { outcome: "unknown", label, hash, nonce, tx: null, reason };
}

export type Effect = "done" | "not-done" | "unknown";

/** Whether a write took effect, from the chain (P6b). `seen` is the effect itself, read back after the send: both
 *  grant selectors authorized, the account's active run, or its position size moving. Unseen, the write did not
 *  happen if it has a receipt (it reverted) or its nonce was used by another transaction; otherwise its outcome is
 *  unknown and it may still land. */
export function effectOf(sent: SendResult, seen: boolean, latestNonce: number): Effect {
  if (seen) return "done";
  if (sent.outcome === "landed" || latestNonce > sent.nonce) return "not-done";
  return "unknown";
}

/** One account write and what it did on-chain. */
export interface AccountWrite {
  sent: SendResult;
  effect: Effect;
}

export function describeWrite(w: AccountWrite): string {
  const how = w.sent.outcome === "landed" ? `receipt ${w.sent.tx.status}` : w.sent.reason;
  return `${w.sent.label}: ${w.effect} (${how}; tx ${w.sent.hash}, nonce ${w.sent.nonce})`;
}

export type WriteKind = "grant" | "start" | "open" | "breach";

/** What a demo take does when a write does not take effect, or anything else throws (P6b):
 *  - "stop": the take has started no run, so there is nothing to clean up. The demo exits 1, and a re-run starts
 *    over: the grant and the active run are read before anything is sent, so nothing is sent twice.
 *  - "abort": the take has started a run. Nothing is re-sent and no run is voided: a void is the referee's verdict on
 *    a flow, a foreign market or a revoked grant, and none of those happened. Revoking the grant to force one would
 *    also leave the referee unable to close an open that lands late. The referee keeps judging and ends each run by a
 *    rule or at its time limit (FAIL TimeLimit), closing any position first. The demo waits for every verdict, checks
 *    the accounts are flat, records the take in demo-aborted.json, and exits 1.
 *  - "note": the on-demand exposure top-up did not take effect. The take goes on; its runs still end by a rule or at
 *    their time limits. */
export function onFailure(kind: WriteKind | "error", runsStarted: number): "stop" | "abort" | "note" {
  if (runsStarted === 0) return "stop";
  return kind === "breach" ? "note" : "abort";
}

/** When the demo stops waiting for verdicts: the rulebook's time limit plus VERDICT_GRACE_SEC after the last start. */
export function verdictDeadline(lastStartMs: number, timeLimitSec: number): number {
  return lastStartMs + (timeLimitSec + VERDICT_GRACE_SEC) * 1_000;
}
```

- [ ] **Step 4: Open the pair together, and follow a human A**

Replace `packages/bot/src/actions.ts` with:
```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createWalletClient, decodeEventLog, http, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { SomniaMarkets } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  CHAIN,
  HIDEKI_ADDRESSES,
  INDEXER_URL,
  MARGIN_BANK,
  OPERATOR_REGISTRY,
  ORDER_TYPE_IOC,
  PLACE_ORDER_FOR_SELECTOR,
  STT_WRITE_HEADROOM,
  alignUp,
  basanosRegistryAbi,
  farFutureNs,
  marginBankAbi,
  perpPoolAbi,
  readSnapshot,
  type BookParams,
} from "@basanos/core";
import { planOpenFromBook, readBookLevels } from "@basanos/core/book";
import { repoPath } from "@basanos/core/node";
import { grantCall, ownerOrderCall, startRunCall } from "@basanos/core/owner-tx";
import { jsonSafe } from "@basanos/referee";
import { effectOf, prepareWrite, sendWrite, submitWrite, type AccountWrite, type SendResult, type Sender } from "./send";

export interface Preflight {
  account: Address;
  stt: bigint;
  sttOk: boolean;
  voucherClaimed: boolean;
  /** MarginBank getAccountState().unlockedCollateralBalance: the account's own deposited USDso not locked in a position. */
  unlockedCollateral: bigint;
  /** unlockedCollateral at or above what a demo run needs (DEMO_MIN_UNLOCKED unless the caller passes another need). */
  funded: boolean;
  flat: boolean;
  equity: bigint;
}

/** The least unlocked MarginBank margin a demo run needs: its DEMO_LEVERAGE_X (10x since P7) size must clear the
 *  0.00013 BTC pool minimum (about 0.95 USDso of equity) with room for costs. */
export const DEMO_MIN_UNLOCKED = 5n * 10n ** 18n;

/** Inferred return type: bound to CHAIN and the key's account. */
export function makeAccountWallet(pk: Hex, url: string) {
  return createWalletClient({ account: privateKeyToAccount(pk), chain: CHAIN, transport: http(url) });
}

export type AccountWallet = ReturnType<typeof makeAccountWallet>;

/** Read-only: the bot uses the SDK for reads only (the voucher read in preflight). It never hands the SDK a key, so no
 *  SDK write can leave the bot (P6, 2026-11-12). */
export function makeMarkets(): SomniaMarkets {
  return new SomniaMarkets({ chain: CHAIN, indexerUrl: INDEXER_URL, addresses: HIDEKI_ADDRESSES });
}

/** Binds send.ts to an account wallet, which signs locally, and the public client on the standard RPC (rpcHttp()),
 *  which gives the nonce, takes the raw transaction and returns the receipt. */
export function viemSender(wallet: AccountWallet, client: PublicClient): Sender {
  const address = wallet.account.address;
  return {
    address,
    pendingNonce: () => client.getTransactionCount({ address, blockTag: "pending" }),
    sign: async (tx) => wallet.signTransaction(await wallet.prepareTransactionRequest(tx)),
    sendRaw: (raw) => client.sendRawTransaction({ serializedTransaction: raw }),
    waitReceipt: (hash, timeout) => client.waitForTransactionReceipt({ hash, timeout }),
    receipt: (hash) => client.getTransactionReceipt({ hash }).catch(() => null),
  };
}

/** The latest nonce is read before the effect, so a write that lands between the two reads is seen, not missed. */
async function settle(client: PublicClient, account: Address, sent: SendResult, seen: () => Promise<boolean>): Promise<AccountWrite> {
  const latest = await client.getTransactionCount({ address: account, blockTag: "latest" });
  return { sent, effect: effectOf(sent, await seen(), latest) };
}

async function positionSize(client: PublicClient, account: Address): Promise<bigint> {
  const p = await client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getPosition", args: [account, BTC_POOL] });
  return p.size;
}

/** Reads only. Never claims a voucher: claim() reverts chain-wide (B14), so an account is ready when it is FUNDED,
 *  with its own wallet USDso deposited into its own MarginBank balance (spike:18 for A, spike:19 for B). */
export async function preflight(client: PublicClient, markets: SomniaMarkets, account: Address, needWei: bigint = DEMO_MIN_UNLOCKED): Promise<Preflight> {
  const [stt, voucher, snap, state] = await Promise.all([
    client.getBalance({ address: account }),
    markets.client.getPerpVoucher(MARGIN_BANK, account),
    readSnapshot(client, [account], BTC_POOL),
    client.readContract({ address: MARGIN_BANK, abi: marginBankAbi, functionName: "getAccountState", args: [account] }),
  ]);
  const a = snap.accounts[0];
  return {
    account,
    stt,
    sttOk: stt >= STT_WRITE_HEADROOM,
    voucherClaimed: voucher?.claimed ?? false,
    unlockedCollateral: state.unlockedCollateralBalance,
    funded: state.unlockedCollateralBalance >= needWei,
    flat: a ? a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0 : false,
    equity: a?.totalEquity ?? 0n,
  };
}

/** Why an account cannot start a demo run, or [] when it can. A voucher is never required. */
export function notReady(pf: Preflight): string[] {
  const p: string[] = [];
  if (!pf.sttOk) p.push(`STT ${pf.stt} is below the 0.6 write headroom (top up from the Tokyo faucet)`);
  if (!pf.funded) {
    p.push(
      `unlocked MarginBank margin is ${pf.unlockedCollateral} wei, below what a demo run needs; deposit the account's own wallet USDso first (deposit.ts: spike:18 for A, spike:19 for B)`,
    );
  }
  if (!pf.flat) p.push("the account is not flat (flatten it in the dreamDEX app first)");
  return p;
}

export async function readBook(client: PublicClient): Promise<BookParams> {
  const p = await client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "getOrderBookParameters" });
  return { tickSize: p.tickSize, minQuantity: p.minQuantity, lotSize: p.lotSize };
}

/** Grants the referee place + cancel on the BTC pool only, if not already granted (null: nothing sent). viem-direct
 *  (send.ts, P6); it counts only when the pool reports both selectors authorized. A grant is idempotent, so a re-run
 *  after a stop re-reads it first. */
export async function ensureGrant(client: PublicClient, wallet: AccountWallet, referee: Address): Promise<AccountWrite | null> {
  const owner = wallet.account.address;
  const has = async (selector: Hex) =>
    client.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [owner, referee, selector] });
  const granted = async () => (await has(PLACE_ORDER_FOR_SELECTOR)) && (await has(CANCEL_ORDER_FOR_SELECTOR));
  if (await granted()) return null;
  const selectors = [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR];
  const sent = await sendWrite(viemSender(wallet, client), "grant", grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, selectors));
  return settle(client, owner, sent, granted);
}

export function runIdFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], registry: Address): bigint | null {
  for (const log of logs) {
    if (log.address.toLowerCase() !== registry.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: basanosRegistryAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (ev.eventName === "RunStarted") return ev.args.runId;
    } catch {
      // another registry event
    }
  }
  return null;
}

/** The account itself enrolls (msg.sender == account); the registry reads its start equity in the same tx. viem-direct
 *  (send.ts, P6). The run is read back from activeRunOf, so it counts once the registry holds it, receipt or not. */
export async function startRunAs(
  client: PublicClient,
  wallet: AccountWallet,
  registry: Address,
  rulebookId: Hex,
): Promise<AccountWrite & { runId: bigint | null }> {
  const account = wallet.account.address;
  const activeRun = async () => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [account] });
  const before = await activeRun();
  const sent = await sendWrite(viemSender(wallet, client), "startRun", startRunCall(registry, account, rulebookId));
  let after = before;
  const w = await settle(client, account, sent, async () => {
    after = await activeRun();
    return after !== 0n && after !== before;
  });
  return { ...w, runId: w.effect === "done" ? after : null };
}

/** Extra size so the account's notional strictly exceeds targetX x equity (the on-demand exposure breach). */
export function breachQuantity(currentSize: bigint, equity: bigint, targetX: number, mark: bigint, baseDecimals: number, book: BookParams): bigint {
  const oneBase = 10n ** BigInt(baseDecimals);
  const abs = currentSize < 0n ? -currentSize : currentSize;
  const targetNotional = equity * BigInt(targetX);
  const current = (abs * mark) / oneBase;
  const neededNotional = targetNotional > current ? targetNotional - current : 0n;
  const qty = alignUp((neededNotional * oneBase) / mark + 1n, book.lotSize);
  return qty < book.minQuantity ? book.minQuantity : qty;
}

/** An opening IOC capped from the book (best ask + 20 bps to buy, best bid - 20 bps to sell), never from the mark:
 *  the BTC-PERP book trades about 19 bps above the mark, so a mark + 20 bps buy does not fill (P5, 2026-11-12).
 *  viem-direct (send.ts, P6): it took effect only if the account's position size moved. An open is never re-sent. */
export async function openIoc(
  client: PublicClient,
  wallet: AccountWallet,
  isBid: boolean,
  quantity: bigint,
  label: string = isBid ? "open long" : "open short",
): Promise<AccountWrite> {
  const account = wallet.account.address;
  const params = await readBook(client);
  const levels = await readBookLevels(client, BTC_POOL);
  if (!levels) throw new Error("the BTC-PERP book could not be read; no order was sent");
  const plan = planOpenFromBook(isBid, quantity, levels, params);
  const before = await positionSize(client, account);
  const order = ownerOrderCall(BTC_POOL, isBid, plan.price, plan.quantity, ORDER_TYPE_IOC, farFutureNs());
  const sent = await sendWrite(viemSender(wallet, client), label, order);
  return settle(client, account, sent, async () => (await positionSize(client, account)) !== before);
}

/** One leg of an opposite pair: the account, its side and its size. */
export interface PairLeg {
  wallet: AccountWallet;
  isBid: boolean;
  quantity: bigint;
}

/** Opens an opposite pair together (architect P7, 2026-11-12). Opposite positions only anti-correlate if they enter
 *  at the same moment: in the rehearsal the two opens landed 13 s apart, inside a whipsaw, and both lost. Both IOCs are
 *  capped from ONE book read, both are signed first, then both are sent back to back, so they land in the same block or
 *  the next. Each leg counts only if its position moved (P6b); nothing is re-sent. */
export async function openPair(client: PublicClient, legs: readonly PairLeg[]): Promise<AccountWrite[]> {
  const params = await readBook(client);
  const levels = await readBookLevels(client, BTC_POOL);
  if (!levels) throw new Error("the BTC-PERP book could not be read; no order was sent");
  const ready = await Promise.all(
    legs.map(async (leg) => {
      const plan = planOpenFromBook(leg.isBid, leg.quantity, levels, params);
      const account = leg.wallet.account.address;
      const sender = viemSender(leg.wallet, client);
      const before = await positionSize(client, account);
      const order = ownerOrderCall(BTC_POOL, leg.isBid, plan.price, plan.quantity, ORDER_TYPE_IOC, farFutureNs());
      return { account, sender, before, prepared: await prepareWrite(sender, leg.isBid ? "open long" : "open short", order) };
    }),
  );
  const sent = await Promise.all(ready.map((r) => submitWrite(r.sender, r.prepared)));
  return Promise.all(ready.map(async (r, i) => settle(client, r.account, sent[i]!, async () => (await positionSize(client, r.account)) !== r.before)));
}

/** The --a-manual follower (P7): polls the account's position every `pollMs` until it is open, so the scripted side opens
 *  right after the human's fill. Returns the size, or null once `untilMs` passes. */
export async function waitForPosition(client: PublicClient, account: Address, untilMs: number, pollMs = 250): Promise<bigint | null> {
  for (;;) {
    const size = await positionSize(client, account);
    if (size !== 0n) return size;
    if (Date.now() > untilMs) return null;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

export const DEMO_TAKES = "docs/evidence/demo-takes.json";

/** Takes that aborted after a run started (P6b). Kept apart from DEMO_TAKES, which check-rehearsal and the money-shot
 *  check judge: an aborted take's runs end FAIL TimeLimit without a close, and must not fail a later good take. */
export const DEMO_ABORTED = "docs/evidence/demo-aborted.json";

export function appendDemoTake(take: Record<string, unknown>, path: string = repoPath(DEMO_TAKES)): number {
  const all = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]) : [];
  const n = all.length + 1;
  all.push(jsonSafe({ take: n, ...take }));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(all, null, 2)}\n`);
  return n;
}
```

- [ ] **Step 5: The FAIL on demand after the first PASS**

`packages/bot/src/take.ts`:
```ts
// The demo take's second leg (architect P7, 2026-11-12). The replay of 12 hours of real history (demo v2 at 10x, an
// opposite pair opened in the same block) gives at least one PASS in about 95% of windows, but the other run's own
// verdict is a coin flip. So once one run has PASSED, the demo pushes the other, still Active, past the exposure cap: a
// deterministic FAIL (MaxExposure) that the referee closes like any breach. The take is then one PASS and one FAIL.
import { RUN_STATUS } from "@basanos/core";

export type TakeStatus = (typeof RUN_STATUS)[number];

/** The index of the run to push past the exposure cap: the one still Active once another has PASSED; null otherwise
 *  (no PASS yet, nothing left Active, or the breach already sent). */
export function breachTarget(statuses: readonly TakeStatus[], alreadyBreached: boolean): number | null {
  if (alreadyBreached) return null;
  const passed = statuses.indexOf("Passed");
  if (passed < 0) return null;
  const other = statuses.findIndex((s, i) => i !== passed && s === "Active");
  return other < 0 ? null : other;
}
```

Replace `packages/bot/src/demo.ts` with:
```ts
// The demo runner. Primary: both builder-operated accounts take Tokyo Sprint · Demo (demo v2) with opposite positions
// at DEMO_LEVERAGE_X (10x; rules judge closeable equity, spec §5). Architect P7, 2026-11-12, from a replay of 12 hours
// of real history: both runs start together, and the pair opens in the same block (openPair: one book read, both IOCs
// signed first, sent back to back), or, with --a-manual, B opens as soon as A's long is seen. Once one run PASSES, the
// other, still Active, is pushed past the 15x exposure cap: a FAIL on demand (take.ts). Fallback (--one-account, only
// if account B cannot be funded): account A takes two runs in sequence. Run 1 is a FAIL on demand: a long, then size
// past the cap. Run 2 is the PASS attempt (--pass-side long|short), held until the referee locks the target or a rule
// ends it. A PASS is not guaranteed with one account, which is why the two-account demo is primary. Accounts must be
// FUNDED (own USDso deposited, spike:18 / spike:19); no voucher. The referee daemon (packages/referee/src/cli.ts start)
// must already be running in another terminal.
// Every account write (grant, startRun, opens) is viem-direct (send.ts, P6) and read back from the chain before the
// take goes on. When one does not take effect, or anything throws (onFailure, P6b): before the take has started a run
// it stops, and a re-run starts over; once a run has started the take aborts. Nothing is re-sent and no run is voided:
// the referee ends each run by a rule or at its time limit, the demo waits for every verdict, checks the accounts are
// flat, records the take in docs/evidence/demo-aborted.json (never demo-takes.json) and exits 1.
import type { Address, Hex } from "viem";
import { BTC_POOL, RULE_NAMES, RUN_STATUS, basanosRegistryAbi, explorerTx, quantityForLeverage, readSnapshot, rulebookId, type BookParams } from "@basanos/core";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { loadDotEnv, loadRulebook, repoPath, requireAddress, requirePrivateKey, rpcHttp } from "@basanos/core/node";
import { makePublicClient, type TxRecord } from "@basanos/referee";
import {
  DEMO_ABORTED,
  appendDemoTake,
  breachQuantity,
  ensureGrant,
  makeAccountWallet,
  makeMarkets,
  notReady,
  openIoc,
  openPair,
  preflight,
  readBook,
  startRunAs,
  waitForPosition,
  type AccountWallet,
} from "./actions";
import { VERDICT_GRACE_SEC, describeWrite, onFailure, verdictDeadline, type AccountWrite, type WriteKind } from "./send";
import { breachTarget } from "./take";

loadDotEnv();
const argv = process.argv.slice(2);
const manualA = argv.includes("--a-manual");
const oneAccount = argv.includes("--one-account");
const passSide = argv[argv.indexOf("--pass-side") + 1] === "short" ? "short" : "long";
const client = makePublicClient(rpcHttp());
const registry = requireAddress("REGISTRY_ADDRESS");
const referee = requireAddress("REFEREE_ADDRESS");
const rb = loadRulebook("tokyo-sprint-demo");
const id: Hex = rulebookId(rb);
const markets = makeMarkets();
const mode = oneAccount ? "one-account" : "two-account";
const txs: TxRecord[] = [];
const notes: string[] = [];
const started: { runId: bigint; account: Address }[] = [];
let lastStartMs = 0;
const say = (line: string) => console.log(`${new Date().toISOString()} ${line}`);
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

say(
  oneAccount
    ? "Basanos demo (one-account fallback): account A is a burner operated by the builder; run 1 FAIL by exposure, run 2 the PASS attempt."
    : "Basanos demo: both challenge accounts are burners operated by the builder (A human-driven, B scripted).",
);
interface Account {
  name: string;
  wallet: AccountWallet;
  address: Address;
}
const accounts: Account[] = (oneAccount ? (["ACCOUNT_A_PK"] as const) : (["ACCOUNT_A_PK", "ACCOUNT_B_PK"] as const)).map((name) => {
  const wallet = makeAccountWallet(requirePrivateKey(name), rpcHttp());
  return { name, wallet, address: wallet.account.address };
});

class WriteFailed extends Error {
  constructor(
    readonly kind: WriteKind,
    message: string,
  ) {
    super(message);
  }
}

/** Keeps the write's receipt, and throws unless the write took effect on-chain. */
function check(kind: WriteKind, w: AccountWrite | null): void {
  if (!w) return;
  if (w.sent.tx) txs.push(w.sent.tx);
  if (w.effect !== "done") throw new WriteFailed(kind, describeWrite(w));
}

const statusOf = async (runId: bigint) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
type Run = Awaited<ReturnType<typeof statusOf>>;
const label = (r: Run | undefined) => (r ? `${RUN_STATUS[r.status] ?? r.status}${r.rule ? `/${RULE_NAMES[r.rule]}` : ""}` : "?");
const activeRunOf = async (account: Address) => client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [account] });

async function startRun(a: Account): Promise<bigint> {
  const { runId, ...w } = await startRunAs(client, a.wallet, registry, id);
  check("start", w);
  if (runId === null) throw new WriteFailed("start", describeWrite(w));
  started.push({ runId, account: a.address });
  lastStartMs = Date.now();
  say(`${a.name} run ${runId} on ${rb.label}: ${w.sent.tx?.explorer ?? explorerTx(w.sent.hash)}`);
  return runId;
}

/** Polls every 2 s until every run has left Active; null once `until` passes with one still Active. */
async function waitVerdicts(runIds: readonly bigint[], until: number, onTick?: (rs: Run[]) => Promise<void>): Promise<Run[] | null> {
  for (;;) {
    const rs = await Promise.all(runIds.map((r) => statusOf(r)));
    say(`runs ${runIds.join(", ")}: ${rs.map((r) => label(r)).join(" | ")}`);
    if (rs.every((r) => r.status !== 1)) return rs;
    if (Date.now() > until) return null;
    if (onTick) await onTick(rs);
    await sleep(2_000);
  }
}

async function flatAll(addresses: readonly Address[], waitMs: number): Promise<boolean> {
  const unique = [...new Set(addresses)];
  const until = Date.now() + waitMs;
  for (;;) {
    const s = await readSnapshot(client, unique, BTC_POOL);
    if (s.accounts.every((a) => a.size === 0n && a.lockedCollateral === 0n && a.activePools.length === 0)) return true;
    if (Date.now() > until) return false;
    await sleep(3_000);
  }
}

/** The on-demand exposure breach: size past the 15x cap. If it does not take effect it is noted, never re-sent, and
 *  the take goes on (onFailure "note"). */
async function topUp(a: Account, book: BookParams): Promise<boolean> {
  const s = await readSnapshot(client, [a.address], BTC_POOL);
  const p = s.accounts[0];
  if (!p || p.size === 0n) return false;
  try {
    check("breach", await openIoc(client, a.wallet, p.size > 0n, breachQuantity(p.size, p.totalEquity, 16, s.markPrice, 8, book), "exposure top-up"));
    return true;
  } catch (e) {
    if (onFailure("breach", started.length) !== "note") throw e;
    const why = e instanceof Error ? e.message : String(e);
    notes.push(`exposure top-up did not take effect: ${why}`);
    say(`note: the exposure top-up did not take effect (${why}); nothing is re-sent and the runs go on`);
    return false;
  }
}

function runRows(final: readonly (Run | undefined)[]) {
  return started.map((r, i) => ({ runId: r.runId, account: r.account, status: RUN_STATUS[final[i]?.status ?? 0], rule: RULE_NAMES[final[i]?.rule ?? 0] }));
}

async function twoAccountTake(): Promise<void> {
  const [accA, accB] = accounts;
  if (!accA || !accB) throw new Error("two accounts expected");
  // Both runs start together, and the pair opens only once both have started (P7).
  await Promise.all(accounts.map((a) => startRun(a)));
  started.sort((x, y) => accounts.findIndex((a) => a.address === x.account) - accounts.findIndex((a) => a.address === y.account));
  const book = await readBook(client);
  const snap = await readSnapshot(client, accounts.map((a) => a.address), BTC_POOL);
  const qtyA = quantityForLeverage(snap.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, snap.markPrice, 8, book);
  const qtyB = quantityForLeverage(snap.accounts[1]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, snap.markPrice, 8, book);
  const until = verdictDeadline(lastStartMs, rb.timeLimitSec);
  if (manualA) {
    say(`A: open the long from the Basanos terminal now (${DEMO_LEVERAGE_X}x); B opens its short as soon as A's long is seen.`);
    const sizeA = await waitForPosition(client, accA.address, until);
    if (sizeA === null) throw new Error("account A opened no position before the time limit");
    check("open", await openIoc(client, accB.wallet, false, qtyB));
    say(`A long ${sizeA} seen; B short ${qtyB} at ${DEMO_LEVERAGE_X}x`);
  } else {
    const opens = await openPair(client, [
      { wallet: accA.wallet, isBid: true, quantity: qtyA },
      { wallet: accB.wallet, isBid: false, quantity: qtyB },
    ]);
    for (const w of opens) if (w.sent.tx) txs.push(w.sent.tx);
    const failed = opens.find((w) => w.effect !== "done");
    if (failed) throw new WriteFailed("open", opens.map((w) => describeWrite(w)).join("; "));
    say(`A long ${qtyA} and B short ${qtyB} at ${DEMO_LEVERAGE_X}x, sent together`);
  }
  // The FAIL on demand (take.ts): once one run PASSES, the other, still Active, is pushed past the exposure cap.
  let breached = false;
  const final = await waitVerdicts(started.map((r) => r.runId), until, async (rs) => {
    const i = breachTarget(rs.map((r) => RUN_STATUS[r.status] ?? "None"), breached);
    const target = i === null ? undefined : accounts[i];
    if (!target) return;
    breached = true;
    say(`a run PASSED: exposure breach on ${target.name} (FAIL on demand)`);
    await topUp(target, book);
  });
  if (!final) throw new Error(`a run is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after the last start; check the referee terminal`);
  const flat = await flatAll(started.map((r) => r.account), 120_000);
  const take = appendDemoTake({ at: new Date().toISOString(), mode, rulebook: { id, label: rb.label }, runs: runRows(final), breachedOnDemand: breached, flatAfter: flat, notes, txs });
  say(`take ${take} recorded in docs/evidence/demo-takes.json`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!flat) {
    say("STOP: an account still holds a position after its verdict; check the referee terminal");
    process.exit(1);
  }
}

async function oneAccountTake(): Promise<void> {
  const [accA] = accounts;
  if (!accA) throw new Error("account A expected");
  const book = await readBook(client);
  // Run 1: FAIL on demand by exposure.
  const r1 = await startRun(accA);
  const s1 = await readSnapshot(client, [accA.address], BTC_POOL);
  check("open", await openIoc(client, accA.wallet, true, quantityForLeverage(s1.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, s1.markPrice, 8, book)));
  if (await topUp(accA, book)) say("run 1: size added past the 15x exposure cap (FAIL on demand)");
  const v1 = await waitVerdicts([r1], verdictDeadline(lastStartMs, rb.timeLimitSec));
  if (!v1) throw new Error(`run 1 is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after its start; check the referee terminal`);
  if (!(await flatAll([accA.address], 5 * 60_000))) throw new Error("account A is not flat 5 min after run 1's verdict");
  // Run 2: the PASS attempt.
  const r2 = await startRun(accA);
  say(`run 2 (${r2}): ${passSide} ${DEMO_LEVERAGE_X}x`);
  const s2 = await readSnapshot(client, [accA.address], BTC_POOL);
  check("open", await openIoc(client, accA.wallet, passSide === "long", quantityForLeverage(s2.accounts[0]?.totalEquity ?? 0n, DEMO_LEVERAGE_X, s2.markPrice, 8, book)));
  const v2 = await waitVerdicts([r2], verdictDeadline(lastStartMs, rb.timeLimitSec));
  if (!v2) throw new Error(`run 2 is still Active ${rb.timeLimitSec + VERDICT_GRACE_SEC} s after its start; check the referee terminal`);
  const flat = await flatAll([accA.address], 120_000);
  const rows = runRows([...v1, ...v2]);
  const take = appendDemoTake({
    at: new Date().toISOString(),
    mode,
    rulebook: { id, label: rb.label },
    runs: rows.map((r, i) => (i === 1 ? { ...r, side: passSide } : r)),
    breachedOnDemand: true,
    flatAfter: flat,
    notes,
    txs,
  });
  say(`take ${take} recorded in docs/evidence/demo-takes.json (one-account fallback)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!flat) {
    say("STOP: account A still holds a position after its verdict; check the referee terminal");
    process.exit(1);
  }
}

/** P6b, once the take has started a run: nothing is re-sent and no run is voided. The referee ends each run by a rule
 *  or at its time limit; the demo waits for the verdicts, checks the accounts, records the take apart, and exits 1. */
async function abortTake(reason: string): Promise<never> {
  const ids = started.map((r) => r.runId);
  say(`STOP: take aborted: ${reason}`);
  say(
    `Nothing is re-sent and no run is voided. The referee keeps judging run(s) ${ids.join(", ")} and ends each by a rule or at ` +
      `its ${rb.timeLimitSec} s time limit, closing any position first. Keep the referee running until this exits.`,
  );
  const final = await waitVerdicts(ids, verdictDeadline(lastStartMs, rb.timeLimitSec));
  const flat = await flatAll(started.map((r) => r.account), 120_000);
  const stillActive: string[] = [];
  for (const a of accounts) {
    const r = await activeRunOf(a.address);
    if (r !== 0n) stillActive.push(`${a.name} run ${r}`);
  }
  const n = appendDemoTake(
    { at: new Date().toISOString(), mode, rulebook: { id, label: rb.label }, aborted: reason, runs: runRows(final ?? []), flatAfter: flat, stillActive, notes, txs },
    repoPath(DEMO_ABORTED),
  );
  say(`aborted take ${n} recorded in ${DEMO_ABORTED} (not demo-takes.json, which check-rehearsal judges)`);
  for (const t of txs) say(`  ${t.label} ${t.status} ${explorerTx(t.hash)}`);
  if (!final || stillActive.length > 0) say(`STOP: still Active after the time limit + ${VERDICT_GRACE_SEC} s: ${stillActive.join(", ") || ids.join(", ")}; check the referee terminal`);
  if (!flat) say("STOP: an account still holds a position after its verdict; check the referee terminal");
  process.exit(1);
}

try {
  // Every account passes preflight before anything is sent.
  for (const a of accounts) {
    const pf = await preflight(client, markets, a.address);
    say(`${a.name} ${a.address}: stt ${pf.stt} unlocked margin ${pf.unlockedCollateral} flat ${pf.flat} equity ${pf.equity}`);
    const problems = notReady(pf);
    if (problems.length > 0) {
      say(`STOP: ${a.name} is not ready: ${problems.join("; ")}. No voucher is ever claimed here.`);
      process.exit(1);
    }
  }
  for (const a of accounts) {
    const g = await ensureGrant(client, a.wallet, referee);
    check("grant", g);
    if (g) say(`${a.name} granted the referee place + cancel on BTC-PERP: ${g.sent.tx?.explorer ?? explorerTx(g.sent.hash)}`);
  }
  if (oneAccount) await oneAccountTake();
  else await twoAccountTake();
  process.exit(0);
} catch (e) {
  const reason = e instanceof Error ? e.message : String(e);
  const step = onFailure(e instanceof WriteFailed ? e.kind : "error", started.length);
  if (step === "stop") {
    say(`STOP: ${reason}. The take started no run, so nothing needs cleaning up, and nothing was re-sent. Re-run demo.ts once the cause is fixed.`);
    process.exit(1);
  }
  await abortTake(reason);
}
```

- [ ] **Step 6: The PASS take's gate**

`packages/referee/src/check-pass.ts`:
```ts
// The gate of the rehearsal's PASS take (architect P7, 2026-11-12): the latest take in docs/evidence/demo-takes.json is
// one PASSED run whose certificate is minted to its own account, and one FAILED run. The live PASS path (the referee's
// lock, the registry's recordPass checks, the certificate mint) had never run before this take. Read-only; writes
// docs/evidence/rehearsal-pass.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Address } from "viem";
import { RULE_NAMES, RUN_STATUS, basanosRegistryAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requireAddress, rpcHttp } from "@basanos/core/node";
import { makePublicClient } from "./chain";
import { jsonSafe } from "./evidence";

export interface PassTakeRow {
  runId: bigint;
  account: Address;
  status: number;
  rule: number;
  /** ownerOf(runId), or null when no certificate exists for the run. */
  holder: Address | null;
}

export function summarizePassTake(rows: readonly PassTakeRow[]): { ok: boolean; passRunId: bigint | null; problems: string[] } {
  const problems: string[] = [];
  const passed = rows.filter((r) => r.status === 2);
  const failed = rows.filter((r) => r.status === 3);
  if (rows.length !== 2) problems.push(`the latest take has ${rows.length} runs, not 2`);
  if (passed.length !== 1) problems.push(`${passed.length} PASSED runs in the latest take, not 1`);
  if (failed.length !== 1) problems.push(`${failed.length} FAILED runs in the latest take, not 1`);
  for (const p of passed) {
    if (p.holder === null) problems.push(`run ${p.runId} PASSED but has no certificate`);
    else if (p.holder.toLowerCase() !== p.account.toLowerCase()) problems.push(`run ${p.runId}'s certificate is held by ${p.holder}, not ${p.account}`);
  }
  return { ok: problems.length === 0, passRunId: passed[0]?.runId ?? null, problems };
}

const isMain = process.argv[1]?.endsWith("check-pass.ts") ?? false;
if (isMain) {
  loadDotEnv();
  const takesPath = repoPath("docs/evidence/demo-takes.json");
  const takes = existsSync(takesPath) ? (JSON.parse(readFileSync(takesPath, "utf8")) as { take: number; runs: { runId: string }[] }[]) : [];
  const last = takes.at(-1);
  if (!last) {
    console.log("FAIL pass-take (docs/evidence/demo-takes.json has no take; run the demo first)");
    process.exit(1);
  }
  const registry = requireAddress("REGISTRY_ADDRESS");
  const client = makePublicClient(rpcHttp());
  const rows: PassTakeRow[] = [];
  for (const r of last.runs) {
    const runId = BigInt(r.runId);
    const run = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
    let holder: Address | null = null;
    try {
      holder = await client.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "ownerOf", args: [runId] });
    } catch {
      holder = null;
    }
    rows.push({ runId, account: run.account, status: run.status, rule: run.rule, holder });
  }
  const s = summarizePassTake(rows);
  const out = {
    evidence: "rehearsal-pass",
    writtenAt: new Date().toISOString(),
    registry,
    take: last.take,
    passRunId: s.passRunId,
    runs: rows.map((r) => ({ ...r, statusName: RUN_STATUS[r.status], ruleName: RULE_NAMES[r.rule] })),
    problems: s.problems,
  };
  mkdirSync(dirname(repoPath("docs/evidence/rehearsal-pass.json")), { recursive: true });
  writeFileSync(repoPath("docs/evidence/rehearsal-pass.json"), `${JSON.stringify(jsonSafe(out), null, 2)}\n`);
  for (const p of s.problems) console.log(`FAIL ${p}`);
  console.log(s.ok ? `PASS pass-take (take ${last.take}: run ${s.passRunId} PASSED with its certificate, one FAILED)` : "FAIL pass-take");
  process.exit(s.ok ? 0 : 1);
}
```

- [ ] **Step 7: Type-check (the demo runs live in referee:22 and ship:3)**
Run: `npm run typecheck -w @basanos/bot`
Run: `npm run typecheck -w @basanos/referee`
Expected: each exits 0 with no `error TS` lines.

- [ ] **Step 8: Run the bot and referee suites**
Run: `npm test -w @basanos/bot`
Run: `npm test -w @basanos/referee`
Run: `npm test -w @basanos/referee -- test/check-pass.test.ts`
Expected: no failed tests; `check-pass.test.ts` shows `1 passed`.

- [ ] **Step 9: Run the new bot test (the gate)**
Run: `npm test -w @basanos/bot -- test/take.test.ts`
Expected: PASS — `3 passed`.

- [ ] **Step 10: Commit (kernel-performed — no agent runs this)**
Message: `feat(bot): both runs start together, the pair opens in the same block, the FAIL on demand follows the first PASS; check-pass gate (P7)`

---

### Task 22: LIVE — rehearsal take 2: demo v2 registered, the first live PASS and certificate

**Files:**
- Create: `docs/evidence/rehearsal-pass.json`
- Modify: `docs/evidence/demo-takes.json`
- Modify: `docs/evidence/runs.json`
- Modify: `deployments/hideki.json`

**Depends on:** Task 7, Task 10, Task 18, Task 19, Task 20, Task 21, spike:Task 18, spike:Task 19
**Effort:** medium
**Model tier:** top
**Provides:** `docs/evidence/rehearsal-pass.json (the first live PASS: passRunId, its certificate held by its own account, one FAILED run)`, `docs/evidence/demo-takes.json (rehearsal take 2 on demo v2: one PASS, one FAIL)`, `demo v2 registered on Hideki (deployments/hideki.json: tokyo-sprint-demo is v2, tokyo-sprint-demo-v1 the first demo)`
**Requires:** `CLI: npx tsx packages/referee/src/cli.ts start | enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo> | status`, `CLI: npx tsx packages/referee/src/register-rulebook.ts <tokyo-sprint|tokyo-sprint-demo|tokyo-sprint-demo-v1> (owner = REFEREE_PK; updates deployments/hideki.json and names each entry after the rulebook file that holds its id)`, `CLI: npx tsx packages/bot/src/demo-check.ts [--equity <USDso>] -> PASS demo-check, or FAIL: wait for a tighter book and re-run (never a rulebook change; the parameters come from the replay)`, `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--one-account [--pass-side long|short]] (two funded accounts; both runs start together and the pair opens in the same block, or B right after a human A's long with --a-manual; the FAIL on demand once one run PASSES; writes viem-direct and read back; a take that fails after a run started aborts into docs/evidence/demo-aborted.json, exit 1)`, `CLI: npx tsx packages/referee/src/check-pass.ts -> writes docs/evidence/rehearsal-pass.json, prints PASS pass-take (take <n>: run <id> PASSED with its certificate, one FAILED)`

**Human-gated (wallet).** This signs with `REFEREE_PK` (the demo v2 registration, about 0.0043 STT, then closes and verdicts) and with `ACCOUNT_A_PK` and `ACCOUNT_B_PK` (startRun, the two opens, the exposure top-up). Before it starts:
- A, B and the referee each hold at least 0.6 STT. After take 1, by the guide's figures, that is about 50.9, 0.96 and 1.55.
- Both accounts are flat and funded.
- No other tool uses `REFEREE_PK` while the referee runs.
- No voucher is ever claimed.

Why (architect P7, 2026-11-12): referee:10's two runs both FAILED, and the PASS path (the referee's lock, the registry's recordPass checks, the certificate mint) has never run on-chain. This take exercises it on demo v2, before the recorded money shot (ship:3). The replay gives this take about a 96% chance of one PASS, and the FAIL on demand then makes the other run a FAIL. The take ends when one run PASSES, a median of about 4 minutes, and takes at most 20 minutes.

**Oracle:** set `ORACLE_ENABLED=false` in `.env` for this take. A Price Oracle request sends 0.0309 STT per verdict, and about 98% of it is rebated to the registry. The registry's Majority-consensus request finalized Failed on 3 of 4 tries, so a reading is unlikely anyway (see `feedback/`). ship:3 sets it back to `true`.

- [ ] **Step 1: Register demo v2 (owner; before the referee starts, so its nonce is fresh)**
Run: `npx tsx packages/referee/src/register-rulebook.ts tokyo-sprint-demo`
Expected: `registered tokyo-sprint-demo 0x… (success) 0x…`. `deployments/hideki.json` now lists `tokyo-sprint-demo-v1` (the first demo's id) and `tokyo-sprint-demo` (v2).

- [ ] **Step 2: Check the book**
Run: `npx tsx packages/bot/src/demo-check.ts`
Expected: `PASS demo-check`. On a FAIL, wait a few minutes and re-run. Do not edit or re-register the rulebook.

- [ ] **Step 3: Start the referee (terminal 1, leave it running)**
Run: `npx tsx packages/referee/src/cli.ts start`
Expected: `referee watching registry 0x…`.

- [ ] **Step 4: Run one take (terminal 2)**
Run: `npx tsx packages/bot/src/demo.ts`
Expected:
- the disclosure line, then two `run <id> on Tokyo Sprint · Demo` lines;
- `A long … and B short … at 10x, sent together`, then `runs …` lines every 2 s;
- within 20 minutes (median about 4), terminal 1 shows `target reached (closeable equity … 10 bps past the target): locking`, the close tx and `PASSED`;
- terminal 2 then shows `a run PASSED: exposure breach on … (FAIL on demand)`, and terminal 1 shows the other run `FAILED (MaxExposure)`, unless a rule ended it first;
- the take ends `take <n> recorded in docs/evidence/demo-takes.json`.

Stop and report, with no second take without a new GO:
- on any `STOP:` line (as in referee:10);
- if both runs FAIL (about 4% of takes in the replay; the take is still recorded);
- on a referee `recordPass refused` line.

- [ ] **Step 5: Stop the referee and check the take (the gate)**

Stop terminal 1 with Ctrl+C.
Run: `npx tsx packages/referee/src/check-pass.ts`
Expected: PASS — `PASS pass-take (take <n>: run <id> PASSED with its certificate, one FAILED)`.

- [ ] **Step 6: Commit (kernel-performed — no agent runs this)**
Message: `docs(evidence): rehearsal take 2 - the first live PASS and certificate on Hideki (demo v2)`
