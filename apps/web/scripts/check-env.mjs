// Fails the build if any VITE_* variable name ends in _PK: Vite inlines VITE_* values into the public bundle.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function findSecretVars(env, envFileText) {
  const names = new Set(Object.keys(env).filter((k) => /^VITE_.*_PK$/.test(k)));
  for (const line of envFileText.split(/\r?\n/)) {
    const m = line.match(/^\s*(VITE_[A-Z0-9_]*_PK)\s*=/);
    if (m) names.add(m[1]);
  }
  return [...names].sort();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const dir = fileURLToPath(new URL("..", import.meta.url));
  const text = [".env", ".env.local", ".env.production"]
    .map((f) => `${dir}${f}`)
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, "utf8"))
    .join("\n");
  const bad = findSecretVars(process.env, text);
  if (bad.length > 0) {
    console.error(`refusing to build: ${bad.join(", ")} would be inlined into the public bundle`);
    process.exit(1);
  }
  console.log("check-env: no VITE_*_PK variables");
}
