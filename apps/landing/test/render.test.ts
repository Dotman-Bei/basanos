import { describe, expect, it } from "vitest";
import { pageVars, renderPage, type FeaturedLike } from "../scripts/render";
import { findUnbacked } from "../scripts/truth";

const H = (c: string) => `0x${c.repeat(64)}`;
const f: FeaturedLike = {
  runId: "3",
  status: "Passed",
  rule: null,
  rulebook: { label: "Tokyo Sprint · Demo", profitTargetBps: 50, dailyLossBps: 50, trailingDrawdownBps: 75, maxExposureX: 15, minDurationSec: 60, timeLimitSec: 900 },
  start: { block: "46900100", equity: "1,000.00" },
  end: { block: "46900950", equity: "1,006.00" },
  breach: null,
  closeTxs: [{ hash: H("a"), url: `https://explorer.testnet.somnia.network/tokyo/tx/${H("a")}` }],
  verdictTx: { hash: H("b"), url: `https://explorer.testnet.somnia.network/tokyo/tx/${H("b")}` },
  oracle: { price: "74,510.00", sources: 3 },
  links: { verdict: "/app/#/run/3", certificate: "/app/#/cert/3" },
  account: "0x00000000000000000000000000000000000000a1",
  registry: "0x00000000000000000000000000000000000000f0",
  trustLine: "Every certificate is chain-checked at mint; every verdict is replayable.",
  demoDisclosure: "Both demo accounts are burners operated by the builder: one human-driven, one scripted.",
  testnetNotice: "Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.",
};

describe("pageVars", () => {
  it("derives every page value from the snapshot", () => {
    const v = pageVars(f);
    expect(v.runId).toBe("3");
    expect(v.headline).toBe("PASSED");
    expect(v.targetPct).toBe("+0.50%");
    expect(v.dailyPct).toBe("-0.50%");
    expect(v.trailingPct).toBe("-0.75%");
    expect(v.verdictHref).toBe("/app/#/run/3");
    expect(v.closeTxShort).toBe("0xaaaa…aaaa");
    expect(v.timeLimitMin).toBe("15");
  });
});

describe("renderPage", () => {
  it("replaces every slot and refuses an unknown one", () => {
    expect(renderPage("<h1>Run {{runId}}: {{headline}}</h1>", f)).toBe("<h1>Run 3: PASSED</h1>");
    expect(() => renderPage("<p>{{nope}}</p>", f)).toThrow(/nope/);
  });
});

describe("findUnbacked", () => {
  it("accepts hashes, figures, blocks and the run id from the snapshot", () => {
    const html = renderPage("<p>Run {{runId}} {{endEquity}} block {{endBlock}} <a href='{{closeTxUrl}}'>{{closeTxShort}}</a></p>", f);
    expect(findUnbacked(html, f)).toEqual([]);
  });
  it("flags anything the snapshot does not hold", () => {
    expect(findUnbacked(`<p>${H("c")} 2,000.00 block 47000001 Run 9</p>`, f)).toEqual([
      `hash ${H("c")}`,
      "figure 2,000.00",
      "block 47000001",
      "run 9",
    ]);
  });
});
