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
