import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withOracleRow } from "../scripts/oracle-row";
import { renderPage, type FeaturedLike } from "../scripts/render";
import { SAMPLE_MARKER, sampleProblems } from "../scripts/sample-guard";

const template = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
const sample = JSON.parse(readFileSync(new URL("./fixtures/featured-sample.json", import.meta.url), "utf8")) as FeaturedLike & { sample?: boolean };
const app = fileURLToPath(new URL("..", import.meta.url));

function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? filesUnder(p) : [p];
  });
}

describe("the sample fixture can never ship", () => {
  it("refuses the labelled fixture and any page rendered from it", () => {
    expect(SAMPLE_MARKER).toBe("BASANOS-SAMPLE-FIXTURE");
    expect(sample.sample).toBe(true);
    expect(sampleProblems(sample)).toContain('the featured snapshot is marked "sample": true (a test fixture, not a real verdict)');
    const html = renderPage(withOracleRow(template, sample), sample);
    expect(html).toContain(SAMPLE_MARKER);
    expect(sampleProblems({}, html)).toEqual([`the built page carries the sample marker ${SAMPLE_MARKER}`]);
  });
  it("accepts a real snapshot and the page built from it", () => {
    const real = JSON.parse(JSON.stringify(sample).split(SAMPLE_MARKER).join("real run")) as FeaturedLike & { sample?: boolean };
    delete real.sample;
    expect(sampleProblems(real, renderPage(withOracleRow(template, real), real))).toEqual([]);
  });
  it("keeps the fixture under test/ only: nothing in src/ or vendor/ is a sample", () => {
    const shipped = [...filesUnder(join(app, "src")), ...filesUnder(join(app, "vendor"))];
    expect(shipped.length).toBeGreaterThan(0);
    for (const file of shipped.filter((f) => /\.(json|html|css|js|ts)$/.test(f))) {
      const text = readFileSync(file, "utf8");
      expect(text.includes(SAMPLE_MARKER), file).toBe(false);
      expect(/"sample"\s*:\s*true/.test(text), file).toBe(false);
    }
  });
});
