import { describe, expect, it } from "vitest";
import { checkFeedbackText } from "../src/check-feedback";
import { moneyShotOk } from "../src/check-money-shot";
import { renderEvidenceIndex } from "../src/evidence-index";
import { buildFeatured } from "../src/featured";
import { DEMO_DISCLOSURE, FORBIDDEN_CLAIMS, TRUST_LINE } from "../src/text";
import { buildPosts } from "../src/x-posts";

const E18 = 10n ** 18n;
const read = (equity: bigint, block: bigint) => ({ blockNumber: block, equityOk: true, equity, lockedCollateral: 0n, positionSize: 0n, markOk: true, markPrice: 74_500n * E18 });
const featured = buildFeatured({
  registry: "0x00000000000000000000000000000000000000f0",
  runId: 3n,
  run: {
    account: "0x00000000000000000000000000000000000000a1",
    rulebookId: `0x${"11".repeat(32)}`,
    status: 2,
    rule: 0,
    start: read(1_000n * E18, 100n),
    breach: read(0n, 0n),
    end: read(1_006n * E18, 900n),
    oraclePrice: 74_510n * E18,
    oracleSources: 3,
    oracleDone: true,
  },
  rulebook: { label: "Tokyo Sprint · Demo", profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 },
  closeTxs: [`0x${"aa".repeat(32)}`],
  verdictTx: `0x${"bb".repeat(32)}`,
});

describe("buildFeatured", () => {
  it("formats the run from chain values and carries the trust line and disclosure", () => {
    expect(featured.status).toBe("Passed");
    expect(featured.rule).toBeNull();
    expect(featured.start.equity).toBe("1,000.00");
    expect(featured.end.equity).toBe("1,006.00");
    expect(featured.breach).toBeNull();
    expect(featured.links).toEqual({ verdict: "/app/#/run/3", certificate: "/app/#/cert/3" });
    expect(featured.closeTxs[0]?.url).toBe(`https://explorer.testnet.somnia.network/tokyo/tx/0x${"aa".repeat(32)}`);
    expect(featured.trustLine).toBe(TRUST_LINE);
    expect(featured.demoDisclosure).toBe(DEMO_DISCLOSURE);
    expect(featured.oracle).toEqual({ price: "74,510.00", sources: 3 });
  });
});

describe("buildPosts", () => {
  it("writes three posts that tag @DreamDEXSomnia, fit 280 characters and say nothing forbidden", () => {
    const posts = buildPosts(featured, "https://basanos.vercel.app");
    expect(posts).toHaveLength(3);
    for (const p of posts) {
      expect(p).toContain("@DreamDEXSomnia");
      expect(p.length).toBeLessThanOrEqual(280);
      for (const bad of FORBIDDEN_CLAIMS) expect(p.toLowerCase()).not.toContain(bad);
    }
    expect(posts.some((p) => p.includes(TRUST_LINE))).toBe(true);
    expect(posts.some((p) => p.includes("operated by the builder"))).toBe(true);
    expect(posts[0]).toContain("https://basanos.vercel.app/app/#/run/3");
  });
  it("leaves a marked placeholder when the site URL is not known yet", () => {
    expect(buildPosts(featured, null)[0]).toContain("TBD-post-build:vercel-url");
  });
});

describe("checks", () => {
  it("accepts a take with one PASS and one FAIL only", () => {
    expect(moneyShotOk({ runs: [{ status: "Passed" }, { status: "Failed" }] })).toBe(true);
    expect(moneyShotOk({ runs: [{ status: "Failed" }, { status: "Failed" }] })).toBe(false);
  });
  it("validates the event's feedback template", () => {
    const good = [
      "# The SDK's Hideki constants omit the operator registry",
      "Severity: normal",
      "Area: SDK",
      "",
      "## Steps to reproduce",
      "1. Read SOMNIA_HIDEKI_TESTNET_ADDRESSES.",
      "",
      "## Expected",
      "It names the OperatorPermissionsRegistry.",
      "",
      "## Actual",
      "It has no operatorPermissionsRegistry key.",
      "",
      "## Evidence",
      "Output: undefined",
      "",
      "## Environment",
      "SDK version 0.33.0, network Somnia Tokyo testnet (Hideki 50383), wallet address: read-only (no wallet)",
    ].join("\n");
    expect(checkFeedbackText("a.md", good)).toEqual([]);
    expect(checkFeedbackText("b.md", good.replace("Severity: normal", "Severity: low"))).not.toEqual([]);
    expect(checkFeedbackText("c.md", good.replace("## Evidence\nOutput: undefined\n", "## Evidence\n"))).not.toEqual([]);
  });
  it("renders an evidence index with links", () => {
    const md = renderEvidenceIndex([{ title: "Referee close", path: "docs/evidence/g1a-close.json", links: ["https://x/tx/1"] }]);
    expect(md).toContain("# Basanos evidence index");
    expect(md).toContain("[docs/evidence/g1a-close.json](g1a-close.json)");
    expect(md).toContain("https://x/tx/1");
  });
});
