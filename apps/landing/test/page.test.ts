import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withOracleRow } from "../scripts/oracle-row";
import { renderPage, type FeaturedLike } from "../scripts/render";
import { findUnbacked } from "../scripts/truth";

const template = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
// A labelled test fixture ("sample": true): landing:3 runs before the real verdict exists. The real snapshot,
// src/featured-verdict.json, is landing:2's alone, and build.ts refuses this fixture (sample-guard.ts).
const f = JSON.parse(readFileSync(new URL("./fixtures/featured-sample.json", import.meta.url), "utf8")) as FeaturedLike;
const html = renderPage(withOracleRow(template, f), f);

describe("landing page", () => {
  it("declares the software kind and the dealt design", () => {
    expect(html).toContain('<html lang="en" data-type="software" data-radius="sharp" data-buttons="solid"');
    expect(html).toContain('<meta name="page-type" content="software">');
    expect(html).toContain('<meta name="site-kind" content="software">');
    expect(html).toContain('class="hero hero--collage"');
  });
  it("leads with the category, the two CTAs and a real verdict", () => {
    expect(html).toContain("<h1 id=\"hero-h\">Prop-firm challenges for dreamDEX perps traders</h1>");
    expect(html).toContain('href="/app/#/challenge"');
    expect(html).toContain(`href="${f.links.verdict}"`);
    expect(html).toContain(`Run ${f.runId}`);
  });
  it("has the three steps, replay, the testnet notice, the disclosure and the trust line", () => {
    for (const h of ["Rulebook, referee, verdict", "A real verdict from Somnia Tokyo testnet", "Replay any verdict", "Testnet only, paper USDso", "Basanos, the touchstone"]) {
      expect(html).toContain(h);
    }
    expect(html).toContain("Every certificate is chain-checked at mint; every verdict is replayable.");
    expect(html).toContain(f.testnetNotice);
    expect(html).toContain(f.demoDisclosure);
    expect(html.toLowerCase()).not.toContain("verifies every verdict");
    expect(html.toLowerCase()).not.toContain("trusted by");
    // The Price Oracle row appears only when the featured snapshot holds a real reading (truth by construction).
    const none = { ...f, oracle: null };
    expect(renderPage(withOracleRow(template, none), none)).not.toMatch(/Somnia Agents|Price Oracle/);
    const reading = { ...f, oracle: { price: "73,735.85", sources: 6 } };
    expect(renderPage(withOracleRow(template, reading), reading)).toContain("73,735.85 (6 sources)");
  });
  it("shows nothing the snapshot does not hold", () => {
    expect(findUnbacked(html, f)).toEqual([]);
  });
});
