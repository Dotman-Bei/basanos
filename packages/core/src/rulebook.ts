import { isAddress, keccak256, toBytes, type Address, type Hex } from "viem";

export interface Rulebook {
  schema: "basanos.rulebook/1";
  name: string;
  variant: "standard" | "demo";
  label: string;
  chainId: number;
  market: { symbol: string; pool: Address; baseDecimals: number };
  profitTargetBps: number;
  dailyLossBps: number;
  trailingDrawdownBps: number;
  maxExposureX: number;
  minDurationSec: number;
  timeLimitSec: number;
  oracleSymbol: string;
  voidOn: string[];
}

/** JSON with object keys sorted recursively, no whitespace, bigints as decimal strings. */
export function canonicalJson(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function rulebookId(rb: Rulebook): Hex {
  return keccak256(toBytes(canonicalJson(rb)));
}

function need<T>(ok: boolean, field: string, value: T): T {
  if (!ok) throw new Error(`rulebook field ${field} is missing or invalid`);
  return value;
}

export function parseRulebook(raw: unknown): Rulebook {
  const r = raw as Record<string, unknown>;
  const m = (r.market ?? {}) as Record<string, unknown>;
  const int = (k: string): number => need(Number.isInteger(r[k]) && (r[k] as number) >= 0, k, r[k] as number);
  return {
    schema: need(r.schema === "basanos.rulebook/1", "schema", "basanos.rulebook/1"),
    name: need(typeof r.name === "string", "name", r.name as string),
    variant: need(r.variant === "standard" || r.variant === "demo", "variant", r.variant as "standard" | "demo"),
    label: need(typeof r.label === "string", "label", r.label as string),
    chainId: int("chainId"),
    market: {
      symbol: need(typeof m.symbol === "string", "market.symbol", m.symbol as string),
      pool: need(typeof m.pool === "string" && isAddress(m.pool, { strict: false }), "market.pool", m.pool as Address),
      baseDecimals: need(Number.isInteger(m.baseDecimals), "market.baseDecimals", m.baseDecimals as number),
    },
    profitTargetBps: int("profitTargetBps"),
    dailyLossBps: int("dailyLossBps"),
    trailingDrawdownBps: int("trailingDrawdownBps"),
    maxExposureX: int("maxExposureX"),
    minDurationSec: int("minDurationSec"),
    timeLimitSec: int("timeLimitSec"),
    oracleSymbol: need(typeof r.oracleSymbol === "string", "oracleSymbol", r.oracleSymbol as string),
    voidOn: need(Array.isArray(r.voidOn), "voidOn", r.voidOn as string[]),
  };
}
