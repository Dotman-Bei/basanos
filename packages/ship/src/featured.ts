import type { Address, Hex } from "viem";
import { RULE_NAMES, RUN_STATUS, explorerTx } from "@basanos/core";
import { DEMO_DISCLOSURE, TESTNET_NOTICE, TRUST_LINE, usd } from "./text";

export interface ReadOut {
  block: string;
  equity: string;
  equityRaw: string;
  size: string;
  mark: string;
}

export interface FeaturedRun {
  schema: "basanos.featured/1";
  chainId: 50383;
  registry: Address;
  runId: string;
  status: string;
  rule: string | null;
  rulebook: { label: string; id: Hex; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number };
  account: Address;
  start: ReadOut;
  breach: ReadOut | null;
  end: ReadOut;
  closeTxs: { hash: Hex; url: string }[];
  verdictTx: { hash: Hex; url: string } | null;
  oracle: { price: string; sources: number } | null;
  links: { verdict: string; certificate: string | null };
  trustLine: string;
  demoDisclosure: string;
  testnetNotice: string;
}

interface RawRead {
  blockNumber: bigint;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  positionSize: bigint;
  markOk: boolean;
  markPrice: bigint;
}

export interface FeaturedInput {
  registry: Address;
  runId: bigint;
  run: {
    account: Address;
    rulebookId: Hex;
    status: number;
    rule: number;
    start: RawRead;
    breach: RawRead;
    end: RawRead;
    oraclePrice: bigint;
    oracleSources: number;
    oracleDone: boolean;
  };
  rulebook: { label: string; profitTargetBps: number; dailyLossBps: number; trailingDrawdownBps: number; maxExposureX: number; minDurationSec: number; timeLimitSec: number };
  closeTxs: readonly Hex[];
  verdictTx: Hex | null;
}

const out = (r: RawRead): ReadOut => ({
  block: r.blockNumber.toString(),
  equity: usd(r.equity + r.lockedCollateral),
  equityRaw: (r.equity + r.lockedCollateral).toString(),
  size: r.positionSize.toString(),
  mark: usd(r.markPrice),
});

export const FEATURED_PATH = "docs/evidence/featured-run.json";

export function buildFeatured(i: FeaturedInput): FeaturedRun {
  const status = RUN_STATUS[i.run.status] ?? "Unknown";
  return {
    schema: "basanos.featured/1",
    chainId: 50383,
    registry: i.registry,
    runId: i.runId.toString(),
    status,
    rule: status === "Failed" ? (RULE_NAMES[i.run.rule] ?? null) : null,
    rulebook: { ...i.rulebook, id: i.run.rulebookId },
    account: i.run.account,
    start: out(i.run.start),
    breach: status === "Failed" ? out(i.run.breach) : null,
    end: out(i.run.end),
    closeTxs: i.closeTxs.map((hash) => ({ hash, url: explorerTx(hash) })),
    verdictTx: i.verdictTx ? { hash: i.verdictTx, url: explorerTx(i.verdictTx) } : null,
    oracle: i.run.oracleDone && i.run.oracleSources > 0 ? { price: usd(i.run.oraclePrice), sources: i.run.oracleSources } : null,
    links: { verdict: `/app/#/run/${i.runId}`, certificate: status === "Passed" ? `/app/#/cert/${i.runId}` : null },
    trustLine: TRUST_LINE,
    demoDisclosure: DEMO_DISCLOSURE,
    testnetNotice: TESTNET_NOTICE,
  };
}
