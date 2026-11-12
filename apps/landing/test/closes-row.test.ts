import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withOracleRow } from "../scripts/oracle-row";
import { renderPage, type FeaturedLike } from "../scripts/render";
import { findUnbacked } from "../scripts/truth";

const template = readFileSync(new URL("../src/page.html", import.meta.url), "utf8");
// The labelled test fixture, not src/featured-verdict.json: ship:3 replaces that snapshot with the money shot.
const base = JSON.parse(readFileSync(new URL("./fixtures/featured-sample.json", import.meta.url), "utf8")) as FeaturedLike;
const CLOSE = "0x911cf71f696e4479ff82ff65ce70261e4c9e54da81a4f5d3392c5f27ebe5f283";
// Run 1 on Hideki: a FAIL with one referee close.
const fail: FeaturedLike = {
  ...base,
  runId: "1",
  status: "Failed",
  rule: "DailyLoss",
  closeTxs: [{ hash: CLOSE, url: `https://explorer.testnet.somnia.network/tokyo/tx/${CLOSE}` }],
  links: { verdict: "/app/#/run/1", certificate: null },
};
// Run 3 on Hideki: a PASS, for which the registry records no close.
const pass: FeaturedLike = { ...base, runId: "3", status: "Passed", rule: null, breach: null, closeTxs: [], links: { verdict: "/app/#/run/3", certificate: "/app/#/cert/3" } };
const page = (f: FeaturedLike) => renderPage(withOracleRow(template, f), f);

describe("the landing's closes row (P8)", () => {
  it("names a FAIL's first referee close, as before", () => {
    expect(page(fail)).toContain(`<div><dt>Referee closes</dt><dd>1, first <a class="link" href="https://explorer.testnet.somnia.network/tokyo/tx/${CLOSE}">0x911c…f283</a></dd></div>`);
  });
  it("names a PASS's certificate instead of a close count of 0", () => {
    const html = page(pass);
    expect(html).toContain('<div><dt>Certificate</dt><dd>Soulbound, held by the account: <a class="link" href="/app/#/cert/3">certificate #3</a></dd></div>');
    expect(html).not.toContain("Referee closes");
    expect(html).not.toMatch(/\b0, first\b/);
    expect(findUnbacked(html, pass)).toEqual([]);
  });
  it("says none were recorded when a run has neither a close nor a certificate", () => {
    expect(page({ ...fail, closeTxs: [] })).toContain('<div><dt>Referee closes</dt><dd>None recorded: <a class="link" href="/app/#/run/1">see the verdict</a></dd></div>');
  });
});
