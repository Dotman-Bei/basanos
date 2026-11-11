import { checkEvidence, readEvidence, type EvidenceName } from "./evidence";

const NAMES: EvidenceName[] = ["g1a-close", "g1b-watch", "g1c-history", "g1d-oracle", "r1-indexer", "tape"];
const asked = process.argv.slice(2) as EvidenceName[];
if (asked.length === 0 || asked.some((n) => !NAMES.includes(n))) {
  console.error(`usage: check-evidence <${NAMES.join("|")}>...`);
  process.exit(2);
}
let failed = 0;
for (const name of asked) {
  const problems = checkEvidence(name, readEvidence(name));
  if (problems.length === 0) {
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    for (const p of problems) console.log(`FAIL ${p}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
