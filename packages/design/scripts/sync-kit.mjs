// Copies exactly the kit files Basanos uses into packages/design/vendor and records their sha256.
// The kit is outside the repo and has no licence file: never copy more than this list.
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const KIT = "C:\\Users\\bamig\\Documents\\VIBE CODE\\Hackathons\\.claude\\skills\\design-taste-frontend";
export const FILES = [
  { from: "assets/system.css", to: "vendor/system.css" },
  { from: "assets/motion/motion.css", to: "vendor/motion/motion.css" },
  { from: "assets/motion/motion.js", to: "vendor/motion/motion.js" },
];
const pkg = fileURLToPath(new URL("..", import.meta.url));
const sha = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");
const files = FILES.map(({ from, to }) => {
  const src = join(KIT, from);
  const dst = join(pkg, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(src, dst);
  return { from, to, sha256: sha(dst) };
});
writeFileSync(
  join(pkg, "vendor", "manifest.json"),
  `${JSON.stringify({ kit: KIT, version: "tasteskill 2.5.0", licence: "none shipped with the kit; review before the public flip", files }, null, 2)}\n`,
);
console.log(`synced ${files.length} kit files`);
