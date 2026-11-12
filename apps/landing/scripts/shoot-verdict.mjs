// Builds the app for the featured run's registry, serves it with vite preview, and shoots /app/#/run/<id> with the kit's shoot.mjs.
// Usage: node apps/landing/scripts/shoot-verdict.mjs <runId> <registryAddress> <refereeAddress>
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const [runId, registry, referee] = process.argv.slice(2);
if (!runId || !registry || !referee) {
  console.error("usage: shoot-verdict.mjs <runId> <registry> <referee>");
  process.exit(2);
}
const KIT = "C:\\Users\\bamig\\Documents\\VIBE CODE\\Hackathons\\.claude\\skills\\design-taste-frontend";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = fileURLToPath(new URL("../src/img/verdict.png", import.meta.url));
const env = { ...process.env, VITE_REGISTRY_ADDRESS: registry, VITE_REFEREE_ADDRESS: referee };
const build = spawnSync("npm", ["run", "build", "-w", "@basanos/web"], { cwd: root, env, stdio: "inherit", shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);
const preview = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", "4317", "--strictPort"], { cwd: `${root}apps/web`, env, shell: true });
await new Promise((r) => setTimeout(r, 4_000));
const shot = spawnSync(
  "node",
  [`${KIT}\\scripts\\shoot.mjs`, "--url", `http://127.0.0.1:4317/app/#/run/${runId}`, "--w", "1440", "--h", "900", "--wait", "6000", "--out", out, "--no-tiles"],
  { stdio: "inherit" },
);
preview.kill();
spawnSync("taskkill", ["/pid", String(preview.pid), "/t", "/f"], { stdio: "ignore" });
console.log(shot.status === 0 ? `saved ${out}` : "shoot failed");
process.exit(shot.status ?? 1);
