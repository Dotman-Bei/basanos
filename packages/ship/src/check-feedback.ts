// Validates every feedback/*.md against the event's template (pack event.md §3).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { repoPath } from "@basanos/core/node";

const HEADINGS = ["## Steps to reproduce", "## Expected", "## Actual", "## Evidence", "## Environment"];

export function checkFeedbackText(name: string, text: string): string[] {
  const p: string[] = [];
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith("# ")) p.push(`${name}: line 1 must be "# <short title>"`);
  if (!lines.some((l) => /^Severity: (critical|major|normal)$/.test(l))) p.push(`${name}: Severity must be critical, major or normal`);
  if (!lines.some((l) => /^Area: (API|SDK|docs|app|contracts)$/.test(l))) p.push(`${name}: Area must be API, SDK, docs, app or contracts`);
  let at = -1;
  for (const h of HEADINGS) {
    const i = lines.indexOf(h);
    if (i <= at) p.push(`${name}: missing or out-of-order heading ${h}`);
    at = Math.max(at, i);
  }
  const section = (h: string): string => {
    const i = lines.indexOf(h);
    if (i < 0) return "";
    const next = lines.findIndex((l, j) => j > i && l.startsWith("## "));
    return lines.slice(i + 1, next < 0 ? undefined : next).join("\n").trim();
  };
  if (section("## Evidence").length === 0) p.push(`${name}: Evidence is empty`);
  const env = section("## Environment");
  if (!env.includes("Somnia Tokyo testnet")) p.push(`${name}: Environment must name Somnia Tokyo testnet`);
  if (!/SDK version/.test(env)) p.push(`${name}: Environment must give the SDK version`);
  return p;
}

const isMain = process.argv[1]?.endsWith("check-feedback.ts") ?? false;
if (isMain) {
  const dir = repoPath("feedback");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")) : [];
  const problems = files.flatMap((f) => checkFeedbackText(f, readFileSync(`${dir}/${f}`, "utf8")));
  if (files.length === 0) problems.push("feedback/ holds no items");
  for (const x of problems) console.log(`FAIL ${x}`);
  console.log(problems.length === 0 ? `PASS feedback (${files.length} items)` : "FAIL feedback");
  process.exit(problems.length === 0 ? 0 : 1);
}
