// Runs the frontend kit's checkers in place (the kit path contains a space; arguments are passed as arrays).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const KIT = "C:\\Users\\bamig\\Documents\\VIBE CODE\\Hackathons\\.claude\\skills\\design-taste-frontend";
const page = fileURLToPath(new URL("../dist/index.html", import.meta.url));
const shots = fileURLToPath(new URL("../shots/", import.meta.url));
// landing:3's sample guard first: a sample snapshot, or a page built from one, never reaches the checkers or a deploy.
const guard = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./check-sample.ts", import.meta.url))], { stdio: "inherit" });
if (guard.status !== 0) {
  console.log("FAIL landing checkers: the featured snapshot or the built page is a sample (see above)");
  process.exit(1);
}
const runs = [
  ["consistency", [`${KIT}\\scripts\\consistency.mjs`, page, "--widths", "1440,1024,820,768,390", "--rhythm-widths", "1440,820,768,390", "--page", "software", "--category", "Prop-firm challenges for dreamDEX perps", "--primary", "Take a challenge"]],
  ["layout check", [`${KIT}\\assets\\layout\\check.mjs`, "--url", page, "--sizes", "1440x900,1024x768,820x1180,768x1024,390x844", "--shots", `${shots}layout`]],
  ["perf", [`${KIT}\\scripts\\perf.mjs`, page]],
  ["shoot 1440", [`${KIT}\\scripts\\shoot.mjs`, "--url", page, "--w", "1440", "--out", `${shots}1440.png`]],
  ["shoot 390", [`${KIT}\\scripts\\shoot.mjs`, "--url", page, "--w", "390", "--out", `${shots}390.png`]],
];
const failed = [];
for (const [name, args] of runs) {
  console.log(`--- ${name}`);
  const r = spawnSync("node", args, { stdio: "inherit" });
  if (r.status !== 0) failed.push(name);
}
console.log(failed.length === 0 ? "PASS landing checkers" : `FAIL landing checkers: ${failed.join(", ")}`);
process.exit(failed.length === 0 ? 0 : 1);
