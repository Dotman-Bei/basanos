import {
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  getAddress,
  parseAbi,
  parseAbiParameters,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { ORACLE_DEPOSIT, explorerTx, operatorRegistryAbi, priceOracleAbi, somniaAgentsAbi, type AccountSnapshot } from "@basanos/core";

export interface TxRecord {
  label: string;
  hash: Hex;
  status: "success" | "reverted";
  gasUsed: bigint;
  costWei: bigint;
  explorer: string;
}

export function txRecord(
  label: string,
  receipt: { transactionHash: Hex; status: "success" | "reverted"; gasUsed: bigint; effectiveGasPrice: bigint },
): TxRecord {
  return {
    label,
    hash: receipt.transactionHash,
    status: receipt.status,
    gasUsed: receipt.gasUsed,
    costWei: receipt.gasUsed * receipt.effectiveGasPrice,
    explorer: explorerTx(receipt.transactionHash),
  };
}

export function sumCosts(txs: readonly TxRecord[]): bigint {
  return txs.reduce((acc, t) => acc + t.costWei, 0n);
}

export function isFlat(s: AccountSnapshot): boolean {
  return s.size === 0n && s.lockedCollateral === 0n && s.activePools.length === 0;
}

/** SomniaAgents ResponseStatus, in declaration order. */
export const ORACLE_STATUS = ["None", "Pending", "Success", "Failed", "TimedOut"] as const;

export function decodeOraclePrices(
  result: Hex,
  symbols: readonly string[],
): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[] {
  const [prices, numSources, lastUpdated] = decodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", data: result });
  return symbols.map((symbol, i) => ({
    symbol,
    price: prices[i] ?? 0n,
    numSources: numSources[i] ?? 0,
    lastUpdated: lastUpdated[i] ?? 0n,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Owner-side writes (account A). The default path signs locally with viem and sends eth_sendRawTransaction to the
// standard RPC (rpcHttp(), api.hideki…), with ORDER_GAS and an explicit nonce. The SDK's own send path
// (eth_sendRawTransactionSync on send.hideki…, which surfaced TransactionOutcomeUnknownError in the Step 3
// preflight) is an opt-in fallback behind --sdk-send. The SDK stays in use for reads.
// ---------------------------------------------------------------------------------------------------------------

/** How account A's own writes reach the chain; recorded in the evidence as `sendPath`. */
export type SendPath = "viem" | "sdk";

export function parseSendPath(argv: readonly string[]): SendPath {
  return argv.includes("--sdk-send") ? "sdk" : "viem";
}

/** An unsigned call: the same shape as the SDK's build verbs return (to, data, value). */
export interface UnsignedCall {
  to: Address;
  data: Hex;
  value: bigint;
}

/** Owner-side PerpPool order: the SDK 0.33.0 perpPoolWriteAbi signature, selector 0x4e978373 (present in the BTC
 *  pool's beacon implementation; a far resting bid simulates OK from an active account). */
export const ownerPoolAbi = parseAbi([
  "function placeOrder(bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k)",
]);

/** Raw placeOrder on the pool, with the arguments the SDK's placePerpOrder fills in (userData 0, no self-match option, no builder). */
export function ownerOrderCall(
  pool: Address,
  isBid: boolean,
  price: bigint,
  quantity: bigint,
  orderType: number,
  expireTimestampNs: bigint,
): UnsignedCall {
  return {
    to: pool,
    value: 0n,
    data: encodeFunctionData({
      abi: ownerPoolAbi,
      functionName: "placeOrder",
      args: [isBid, 0n, price, quantity, expireTimestampNs, orderType, 0, zeroAddress, 0n],
    }),
  };
}

/** The per-pool operator grant on the OperatorPermissionsRegistry (the SDK has no build verb for it). */
export function grantCall(registry: Address, pool: Address, operator: Address, selectors: readonly Hex[]): UnsignedCall {
  return {
    to: registry,
    value: 0n,
    data: encodeFunctionData({
      abi: operatorRegistryAbi,
      functionName: "setOperatorApprovalForPool",
      args: [pool, operator, [...selectors], true],
    }),
  };
}

/** The exact transaction account A signs on the viem path: a fixed gas limit and an explicit nonce. */
export function ownerTx(
  call: UnsignedCall,
  nonce: number,
  gas: bigint,
): { to: Address; data: Hex; value: bigint; gas: bigint; nonce: number } {
  return { to: call.to, data: call.data, value: call.value, gas, nonce };
}

// ---------------------------------------------------------------------------------------------------------------
// Price Oracle outcome from SomniaAgents logs. getRequest cannot report it: the platform deletes a request once it
// finalizes, and getRequest then reverts RequestNotFound (0x4ec726c7). Request 7773100 (2026-11-11) finalized one
// block after creation, so a getRequest poll only ever saw the revert.
// ---------------------------------------------------------------------------------------------------------------

/** topic0 of RequestFinalized(uint256 indexed requestId, uint8 status). */
export const REQUEST_FINALIZED_TOPIC: Hex = toEventSelector(getAbiItem({ abi: somniaAgentsAbi, name: "RequestFinalized" }));

/** topic0 of SomniaAgents' per-validator response event. It is not in the published ABI. Its topics are
 *  [topic0, requestId, validator] and its data is four words, the last being the validator's execution cost in wei
 *  (seen on requests 7773100 and 7773101). It carries no result bytes: prices reach only the callback. */
export const AGENT_RESPONSE_TOPIC: Hex = "0x1b44ed537f0ae64cca44e5a71b06bc838a30bbc5454ffdc2aee3844926264dfd";

export interface AgentLog {
  topics: readonly Hex[];
  data: Hex;
  transactionHash: Hex | null;
  blockNumber: bigint | null;
}

export interface ValidatorResponse {
  validator: Address;
  executionCostWei: bigint;
  words: bigint[];
  tx: Hex | null;
  block: bigint | null;
}

export interface OracleOutcome {
  /** An ORACLE_STATUS name, or "NotFinalized" while no RequestFinalized log for the request has been seen. */
  finalStatus: string;
  finalStatusCode: number | null;
  finalizeTx: Hex | null;
  finalizeBlock: bigint | null;
  validatorResponses: ValidatorResponse[];
}

export function oracleOutcomeFromLogs(logs: readonly AgentLog[], requestId: bigint): OracleOutcome {
  const out: OracleOutcome = { finalStatus: "NotFinalized", finalStatusCode: null, finalizeTx: null, finalizeBlock: null, validatorResponses: [] };
  for (const log of logs) {
    const [t0, t1, t2] = log.topics;
    if (!t0 || !t1 || BigInt(t1) !== requestId) continue;
    if (t0.toLowerCase() === REQUEST_FINALIZED_TOPIC.toLowerCase()) {
      const code = Number(BigInt(log.data));
      out.finalStatusCode = code;
      out.finalStatus = ORACLE_STATUS[code] ?? `status ${code}`;
      out.finalizeTx = log.transactionHash;
      out.finalizeBlock = log.blockNumber;
    } else if (t0.toLowerCase() === AGENT_RESPONSE_TOPIC && t2) {
      const words = (log.data.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
      out.validatorResponses.push({
        validator: getAddress(`0x${t2.slice(26)}`),
        executionCostWei: words[words.length - 1] ?? 0n,
        words,
        tx: log.transactionHash,
        block: log.blockNumber,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Oracle probes P1 / P2 (guide GO, 2026-11-11). P1 asks one symbol through the 4-argument createRequest (Majority
// consensus): the registry's exact path. P2 asks it through createAdvancedRequest with Threshold consensus (2 of 3,
// 30 s, 0.01 STT per validator): the call dreamDEX's PriceFeedScheduler makes every 5 blocks.
// ---------------------------------------------------------------------------------------------------------------

/** createAdvancedRequest, selector 0x9256632b. The types are confirmed by that selector and by the scheduler's call
 *  arguments (3, 2, 1, 30); it returns the request id (eth_call). The parameter names are ours. */
export const agentsAdvancedAbi = parseAbi([
  "function createAdvancedRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes payload, uint256 subcommitteeSize, uint256 threshold, uint8 consensusType, uint256 timeout) payable returns (uint256 requestId)",
]);

/** Threshold consensus as the PriceFeedScheduler uses it. consensusType 1 = Threshold (0 = Majority, the default). */
export const ADVANCED_REQUEST = {
  subcommitteeSize: 3n,
  threshold: 2n,
  consensusType: 1,
  timeoutSec: 30n,
  perAgentBudgetWei: 10_000_000_000_000_000n,
} as const;

/** Hard cap on what one probe may send: 0.1 STT. */
export const PROBE_MAX_WEI = 100_000_000_000_000_000n;

export type OracleEvidence = "g1d-oracle" | "g1d-probe-p1" | "g1d-probe-p2";

export interface ProbeArgs {
  dryRun: boolean;
  fromTx: Hex | null;
  symbols: string[];
  advanced: boolean;
  evidence: OracleEvidence;
}

/** No flags: the original G1(d) request (two symbols) into g1d-oracle. --symbols: P1 into g1d-probe-p1.
 *  --advanced: P2 into g1d-probe-p2 (one symbol, BTC/USDC:PERP, unless --symbols says otherwise). */
export function parseProbeArgs(argv: readonly string[]): ProbeArgs {
  const valueOf = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    if (i < 0) return null;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${flag} needs a value`);
    return v;
  };
  const fromTx = valueOf("--from-tx");
  if (fromTx !== null && !/^0x[0-9a-fA-F]{64}$/.test(fromTx)) throw new Error("--from-tx needs a 32-byte transaction hash");
  const list = valueOf("--symbols");
  const advanced = argv.includes("--advanced");
  const symbols =
    list !== null ? list.split(",").map((s) => s.trim()).filter((s) => s.length > 0) : advanced ? ["BTC/USDC:PERP"] : ["BTC/USDC:PERP", "BTC/USDC"];
  if (symbols.length === 0 || symbols.some((s) => !/^[A-Z0-9]+\/[A-Z0-9]+(:PERP)?$/.test(s))) {
    throw new Error(`--symbols must list symbols such as BTC/USDC:PERP (got ${list ?? "nothing"})`);
  }
  const evidence: OracleEvidence = advanced ? "g1d-probe-p2" : list !== null ? "g1d-probe-p1" : "g1d-oracle";
  return { dryRun: argv.includes("--dry-run"), fromTx: fromTx === null ? null : (fromTx as Hex), symbols, advanced, evidence };
}

/** What a request sends: Majority keeps the practical 0.0309 STT; Threshold funds 0.01 STT per validator over the floor. */
export function probeDeposit(floorWei: bigint, advanced: boolean): bigint {
  if (advanced) return floorWei + ADVANCED_REQUEST.perAgentBudgetWei * ADVANCED_REQUEST.subcommitteeSize;
  return floorWei >= ORACLE_DEPOSIT ? floorWei + 900_000_000_000_000n : ORACLE_DEPOSIT;
}

/** One node of a debug_traceTransaction callTracer result. */
export interface TraceCall {
  type?: string;
  to?: string;
  input?: Hex;
  calls?: TraceCall[];
}

/** The first call to `to` that carries data: SomniaAgents' callback inside the finalize transaction. */
export function findCallTo(node: TraceCall, to: Address): TraceCall | null {
  if ((node.to ?? "").toLowerCase() === to.toLowerCase() && (node.input ?? "0x").length > 10) return node;
  for (const k of node.calls ?? []) {
    const hit = findCallTo(k, to);
    if (hit) return hit;
  }
  return null;
}

const RESPONSE_T = "(address validator, bytes result, uint8 status, uint256 receipt, uint256 timestamp, uint256 executionCost)";
const REQUEST_T =
  "(uint256 id, address requester, address callbackAddress, bytes4 callbackSelector, address[] subcommittee, " +
  RESPONSE_T +
  "[] responses, uint256 responseCount, uint256 failureCount, uint256 threshold, uint256 createdAt, uint256 deadline, uint8 status, uint8 consensusType, uint256 remainingBudget, uint256 perAgentBudget)";

/** The callback's arguments as SomniaAgents sends them: (requestId, responses, status, details). */
export const ORACLE_CALLBACK_PARAMS = parseAbiParameters(`uint256 requestId, ${RESPONSE_T}[] responses, uint8 status, ${REQUEST_T} details`);

export interface OracleAnswer {
  validator: Address;
  status: number;
  result: Hex;
  prices: { price: bigint; numSources: number; lastUpdated: bigint }[] | null;
}

export interface OracleCallback {
  requestId: bigint;
  status: number;
  statusName: string;
  consensusType: number;
  threshold: bigint;
  failureCount: bigint;
  answers: OracleAnswer[];
  answersIdentical: boolean;
}

/** Decodes the callback input (selector + arguments), including each validator's getPrices answer. */
export function decodeOracleCallback(input: Hex): OracleCallback {
  const [requestId, responses, status, details] = decodeAbiParameters(ORACLE_CALLBACK_PARAMS, `0x${input.slice(10)}`);
  const answers: OracleAnswer[] = responses.map((r) => {
    let prices: OracleAnswer["prices"] = null;
    try {
      const [p, n, u] = decodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", data: r.result });
      prices = p.map((price, i) => ({ price, numSources: n[i] ?? 0, lastUpdated: u[i] ?? 0n }));
    } catch {
      prices = null;
    }
    return { validator: r.validator, status: r.status, result: r.result, prices };
  });
  const first = answers[0]?.result;
  return {
    requestId,
    status,
    statusName: ORACLE_STATUS[status] ?? `status ${status}`,
    consensusType: details.consensusType,
    threshold: details.threshold,
    failureCount: details.failureCount,
    answers,
    answersIdentical: first !== undefined && answers.every((a) => a.result === first),
  };
}

/** The consensus reading per symbol: only a Success callback yields one (taken from its first successful answer). */
export function symbolsFromCallback(
  cb: OracleCallback | null,
  symbols: readonly string[],
): { symbol: string; price: bigint; numSources: number; lastUpdated: bigint }[] {
  if (!cb || cb.status !== 2) return [];
  const first = cb.answers.find((a) => a.status === 2 && a.prices !== null);
  if (!first?.prices) return [];
  const prices = first.prices;
  return symbols.map((symbol, i) => ({
    symbol,
    price: prices[i]?.price ?? 0n,
    numSources: prices[i]?.numSources ?? 0,
    lastUpdated: prices[i]?.lastUpdated ?? 0n,
  }));
}
