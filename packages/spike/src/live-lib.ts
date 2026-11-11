import {
  decodeFunctionResult,
  encodeFunctionData,
  getAbiItem,
  getAddress,
  parseAbi,
  toEventSelector,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { explorerTx, operatorRegistryAbi, priceOracleAbi, somniaAgentsAbi, type AccountSnapshot } from "@basanos/core";

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
