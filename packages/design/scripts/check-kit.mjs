// The vendored files must match the sha256 recorded at sync time, and tokens.css must carry the dealt palette.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("..", import.meta.url));
const problems = [];
const manifestPath = join(pkg, "vendor", "manifest.json");
if (!existsSync(manifestPath)) problems.push("vendor/manifest.json is missing (run npm run sync -w @basanos/design)");
else {
  const m = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (m.files.length !== 3) problems.push(`expected 3 vendored files, found ${m.files.length}`);
  for (const f of m.files) {
    const p = join(pkg, f.to);
    if (!existsSync(p)) problems.push(`${f.to} is missing`);
    else if (createHash("sha256").update(readFileSync(p)).digest("hex") !== f.sha256) problems.push(`${f.to} differs from the synced copy`);
  }
}
const tokens = readFileSync(join(pkg, "tokens.css"), "utf8");
for (const t of ["--p-accent: #256f82", "--p-bg: #dedad3", '"IBM Plex Sans"', '"IBM Plex Mono"']) {
  if (!tokens.includes(t)) problems.push(`tokens.css lacks ${t}`);
}
for (const p of problems) console.log(`FAIL ${p}`);
console.log(problems.length === 0 ? "PASS design kit" : "FAIL design kit");
process.exit(problems.length === 0 ? 0 : 1);
