import type { FeaturedLike } from "./render";

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v.toLowerCase());
  else if (typeof v === "number") out.push(String(v));
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** Every hash, money figure, block number and run id in the page must come from the featured snapshot. */
export function findUnbacked(html: string, f: FeaturedLike): string[] {
  const allowed = strings(f);
  const has = (s: string) => allowed.some((a) => a.includes(s.toLowerCase()));
  const problems: string[] = [];
  for (const m of html.matchAll(/0x[0-9a-fA-F]{4,}/g)) if (!has(m[0])) problems.push(`hash ${m[0]}`);
  for (const m of html.matchAll(/\b\d{1,3}(?:,\d{3})*\.\d{2}\b(?!%)/g)) if (!has(m[0])) problems.push(`figure ${m[0]}`);
  for (const m of html.matchAll(/\b\d{7,}\b/g)) if (!has(m[0])) problems.push(`block ${m[0]}`);
  for (const m of html.matchAll(/\bRun (\d+)\b/g)) if (m[1] !== f.runId) problems.push(`run ${m[1]}`);
  return [...new Set(problems)];
}
