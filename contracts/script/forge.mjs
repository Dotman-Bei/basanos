// Runs forge with --root contracts; installs forge-std v1.16.2 into contracts/lib on first use.
// Usage: node contracts/script/forge.mjs <forge args...>
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const testSol = fileURLToPath(new URL("../lib/forge-std/src/Test.sol", import.meta.url));
if (!existsSync(testSol)) {
  const install = spawnSync("forge", ["install", "foundry-rs/forge-std@v1.16.2", "--no-git", "--root", root], { stdio: "inherit" });
  if (install.status !== 0) process.exit(install.status ?? 1);
}
const run = spawnSync("forge", [...process.argv.slice(2), "--root", root], { stdio: "inherit" });
process.exit(run.status ?? 1);
