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
