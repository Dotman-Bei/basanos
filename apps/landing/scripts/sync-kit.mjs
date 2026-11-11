// Copies exactly the four landing-only kit files and records their sha256 (the kit ships no licence file).
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIT = "C:\\Users\\bamig\\Documents\\VIBE CODE\\Hackathons\\.claude\\skills\\design-taste-frontend";
const FILES = [
  { from: "assets/system.js", to: "vendor/system.js" },
  { from: "assets/layout/layout.css", to: "vendor/layout/layout.css" },
  { from: "assets/layout/layout.js", to: "vendor/layout/layout.js" },
  { from: "assets/layout/demo.css", to: "vendor/layout/demo.css" },
];
const pkg = fileURLToPath(new URL("..", import.meta.url));
const files = FILES.map(({ from, to }) => {
  const dst = join(pkg, to);
  mkdirSync(dirname(dst), { recursive: true });
  copyFileSync(join(KIT, from), dst);
  return { from, to, sha256: createHash("sha256").update(readFileSync(dst)).digest("hex") };
});
writeFileSync(
  join(pkg, "vendor", "manifest.json"),
  `${JSON.stringify({ kit: KIT, version: "tasteskill 2.5.0", licence: "none shipped with the kit; review before the public flip", hero: "collage (assets/layout/hero-collage.html structure)", files }, null, 2)}\n`,
);
console.log(`synced ${files.length} landing kit files`);
