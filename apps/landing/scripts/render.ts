export interface FeaturedLike {
  runId: string;
  status: string;
  rule: string | null;
  rulebook: { label: string; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number };
  start: { block: string; equity: string };
  end: { block: string; equity: string };
  breach: { block: string; equity: string } | null;
  closeTxs: { hash: string; url: string }[];
  verdictTx: { hash: string; url: string } | null;
  oracle: { price: string; sources: number } | null;
  links: { verdict: string; certificate: string | null };
  account: string;
  registry: string;
  trustLine: string;
  demoDisclosure: string;
  testnetNotice: string;
}

const pct = (bps: number, sign: "+" | "-") => `${sign}${(bps / 100).toFixed(2)}%`;
const short = (h: string) => (h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h);

/** Every value the page shows, derived from the featured snapshot only. */
export function pageVars(f: FeaturedLike): Record<string, string> {
  const failed = f.status === "Failed";
  const close = f.closeTxs[0];
  // A PASS records no close (the registry reads the end state itself), so its closes row names the certificate instead.
  const cert = f.status === "Passed" ? f.links.certificate : null;
  return {
    runId: f.runId,
    label: f.rulebook.label,
    headline: failed ? `FAILED — ${f.rule ?? "rule"}` : f.status.toUpperCase(),
    statusWord: f.status.toLowerCase(),
    startEquity: f.start.equity,
    endEquity: f.end.equity,
    startBlock: f.start.block,
    endBlock: f.end.block,
    targetPct: pct(f.rulebook.profitTargetBps, "+"),
    dailyPct: pct(f.rulebook.dailyLossBps, "-"),
    trailingPct: pct(f.rulebook.trailingDrawdownBps, "-"),
    exposureX: String(f.rulebook.maxExposureX),
    minDurationSec: String(f.rulebook.minDurationSec),
    timeLimitMin: String(Math.round(f.rulebook.timeLimitSec / 60)),
    closeCount: String(f.closeTxs.length),
    closeTxShort: close ? short(close.hash) : "none",
    closeTxUrl: close ? close.url : f.links.verdict,
    closeRowLabel: cert ? "Certificate" : "Referee closes",
    closeRowLead: cert ? "Soulbound, held by the account:" : close ? `${f.closeTxs.length}, first` : "None recorded:",
    closeRowHref: cert ?? (close ? close.url : f.links.verdict),
    closeRowLink: cert ? `certificate #${f.runId}` : close ? short(close.hash) : "see the verdict",
    verdictTxShort: f.verdictTx ? short(f.verdictTx.hash) : "pending",
    verdictTxUrl: f.verdictTx ? f.verdictTx.url : f.links.verdict,
    oracleLine: f.oracle ? `${f.oracle.price} (${f.oracle.sources} sources)` : "no reading recorded",
    resultLine: failed ? `Referee closed the position in ${f.closeTxs.length} transaction(s)` : f.links.certificate ? "Certificate minted to the account" : "Verdict recorded",
    verdictHref: f.links.verdict,
    certHref: f.links.certificate ?? f.links.verdict,
    accountShort: short(f.account),
    registryShort: short(f.registry),
    trustLine: f.trustLine,
    demoDisclosure: f.demoDisclosure,
    testnetNotice: f.testnetNotice,
  };
}

export function renderPage(template: string, f: FeaturedLike): string {
  const vars = pageVars(f);
  return template.replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === undefined) throw new Error(`unknown template slot {{${key}}}`);
    return v;
  });
}
