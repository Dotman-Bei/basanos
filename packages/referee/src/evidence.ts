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
