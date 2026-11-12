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

**Depends on:** Task 7, Task 8, Task 9, Task 11, Task 12, contracts:Task 10, contracts:Task 11, spike:Task 11, spike:Task 18, spike:Task 19
**Effort:** medium
**Model tier:** top
**Provides:** `docs/evidence/rehearsal.json (first real verdict runs: firstVerdictRunId, runs with statusName, ruleName, closeTxs)`, `docs/evidence/runs.json (per-run evidence bundles + evidenceHash + verdictTx)`, `docs/evidence/demo-takes.json (demo takes with run ids and tx hashes)`
**Requires:** `CLI: npx tsx packages/referee/src/cli.ts start | enroll <account> --rulebook <tokyo-sprint|tokyo-sprint-demo> | status`, `CLI: npx tsx packages/bot/src/demo.ts [--a-manual] [--wait-min 10] [--one-account [--pass-side long|short]] (two funded accounts by default; --one-account is the A-only fallback)`, `CLI: npx tsx packages/bot/src/demo-check.ts [--equity <USDso>] -> PASS demo-check, or FAIL with a recommended demo target (sizes from A's and B's live equity; checks the pool minimum)`, `CLI: npx tsx packages/referee/src/register-rulebook.ts <tokyo-sprint|tokyo-sprint-demo> (owner = REFEREE_PK; updates deployments/hideki.json)`, `CLI: npx tsx packages/referee/src/check-rehearsal.ts -> writes docs/evidence/rehearsal.json, prints PASS rehearsal`, `deployments/hideki.json (registry address, deploy block, rulebook ids)`

**Human-gated.** This signs real transactions with `REFEREE_PK` (closes and verdicts, plus 0.0309 STT per PASS or FAIL verdict for the Price Oracle, mostly rebated; set `ORACLE_ENABLED=true` in `.env` first), `ACCOUNT_A_PK` and `ACCOUNT_B_PK` (grant, `startRun`, orders). Needed first:
- all three burners topped up to about 1 STT from the Tokyo faucet;
- `REGISTRY_ADDRESS` and `REFEREE_ADDRESS` set in `.env`;
- both accounts flat, each funded: its own USDso deposited in its own MarginBank balance (spike:18, spike:19; no voucher).

No voucher is ever claimed. `rulebooks/tokyo-sprint-demo.json` and `deployments/hideki.json` change only if step 1 fails.

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
- two `run <id> on Tokyo Sprint · Demo` lines, then `runs …` status lines every 2 s;
- within about 15 minutes, both runs leave `Active`. Terminal 1 shows the referee's `breach … cancelling and closing`, its close tx links, then `FAILED (DailyLoss)` or `PASSED`. The take ends with `take 1 recorded in docs/evidence/demo-takes.json`.

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
