import { describe, expect, it } from "vitest";
import { SAMPLE_MARKER, sampleInBuild } from "../src/sample";

describe("the deploy carries no sample fixture", () => {
  it("pins the marker landing:3 uses and finds it in any built or served page", () => {
    expect(SAMPLE_MARKER).toBe("BASANOS-SAMPLE-FIXTURE");
    expect(sampleInBuild({ "https://x.vercel.app/": "<h1>Run 3: PASSED</h1>", "https://x.vercel.app/app/": '<div id="root"></div>' })).toEqual([]);
    expect(sampleInBuild({ "site/basanos/index.html": "<small>Tokyo Sprint · Demo (BASANOS-SAMPLE-FIXTURE)</small>" })).toEqual([
      "site/basanos/index.html carries the sample marker BASANOS-SAMPLE-FIXTURE (a test fixture, not a real verdict)",
    ]);
  });
});
