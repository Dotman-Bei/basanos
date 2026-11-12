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
