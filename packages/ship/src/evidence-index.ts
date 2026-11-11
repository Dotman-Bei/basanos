// Writes docs/evidence/INDEX.md: every evidence file and the transaction links it holds, for judges.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

export function renderEvidenceIndex(items: readonly { title: string; path: string; links: readonly string[] }[]): string {
  const lines = ["# Basanos evidence index", "", "Every file below is committed evidence from Somnia Tokyo testnet (Hideki, 50383).", ""];
  for (const it of items) {
    lines.push(`## ${it.title}`, "", `[${it.path}](${it.path.replace("docs/evidence/", "")})`, "");
    for (const l of it.links) lines.push(`- ${l}`);
    lines.push("");
  }
  return lines.join("\n");
}

const isMain = process.argv[1]?.endsWith("evidence-index.ts") ?? false;
if (isMain) {
  const FILES: [string, string][] = [
    ["Referee close on a voucher account (G1 a)", "docs/evidence/g1a-close.json"],
    ["somnia_watch with the equity multicall (G1 b)", "docs/evidence/g1b-watch.json"],
    ["Replay horizon (G1 c)", "docs/evidence/g1c-history.json"],
    ["Price Oracle on Tokyo testnet (G1 d)", "docs/evidence/g1d-oracle.json"],
    ["Indexer reads (R1)", "docs/evidence/r1-indexer.json"],
    ["Registry previewStart vs the SDK (R5)", "docs/evidence/r5-preview.json"],
    ["Bytecode verification", "docs/evidence/verify.json"],
    ["Rehearsal (first real verdicts)", "docs/evidence/rehearsal.json"],
    ["Demo takes", "docs/evidence/demo-takes.json"],
    ["Per-run evidence bundles", "docs/evidence/runs.json"],
    ["Featured run", "docs/evidence/featured-run.json"],
  ];
  const items = FILES.filter(([, p]) => existsSync(repoPath(p))).map(([title, path]) => {
    const text = readFileSync(repoPath(path), "utf8");
    const links = [...new Set(text.match(/https:\/\/explorer\.testnet\.somnia\.network\/tokyo\/tx\/0x[0-9a-fA-F]{64}/g) ?? [])];
    return { title, path, links };
  });
  writeFileSync(repoPath("docs/evidence/INDEX.md"), renderEvidenceIndex(items));
  console.log(`wrote docs/evidence/INDEX.md (${items.length} files)`);
  process.exit(0);
}
