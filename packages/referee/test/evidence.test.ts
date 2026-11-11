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
