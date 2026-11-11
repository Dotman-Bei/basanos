// G1(d): one Price Oracle request on Tokyo testnet from the referee EOA (callback = the EOA itself), sending
// 0.0309 STT, the practical deposit (never the bare floor).
// The outcome is read from SomniaAgents logs (RequestFinalized and the per-validator response events), never from
// getRequest: the platform deletes a request once it finalizes, and getRequest then reverts RequestNotFound
// (0x4ec726c7). That is why the first run recorded "Pending" for a request that had finalized Failed.
// --dry-run reads only. --from-tx <hash> rebuilds the evidence from an earlier createRequest transaction: it loads
// no key and sends nothing.
import { decodeEventLog, decodeFunctionData, encodeFunctionData, pad, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ORACLE_AGENT_ID, ORACLE_DEPOSIT, SOMNIA_AGENTS, priceOracleAbi, somniaAgentsAbi } from "@basanos/core";
import { loadDotEnv, requirePrivateKey } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import {
  AGENT_RESPONSE_TOPIC,
  REQUEST_FINALIZED_TOPIC,
  oracleOutcomeFromLogs,
  txRecord,
  type AgentLog,
  type OracleOutcome,
} from "./live-lib";
import { publicClient, walletFor } from "./rpc";

loadDotEnv();
const dryRun = process.argv.includes("--dry-run");
const fromTxAt = process.argv.indexOf("--from-tx");
const fromTx = fromTxAt >= 0 ? process.argv[fromTxAt + 1] : undefined;
if (fromTxAt >= 0 && (!fromTx || !/^0x[0-9a-fA-F]{64}$/.test(fromTx))) {
  console.error("oracle-probe: --from-tx needs a 32-byte transaction hash");
  process.exit(1);
}
const client = publicClient();
const SYMBOLS = ["BTC/USDC:PERP", "BTC/USDC"] as const;
const LOG_WINDOW = 1_000n; // eth_getLogs answers at most 1,000 blocks per call on Hideki
const REBUILD_SPAN = 3_000n; // a rebuild scans this many blocks after the request (it finalizes within a few)

type Receipt = Awaited<ReturnType<typeof client.waitForTransactionReceipt>>;

/** SomniaAgents logs for one request (RequestFinalized or a validator response), in 1,000-block windows. */
async function agentLogs(requestId: bigint, fromBlock: bigint, toBlock: bigint): Promise<AgentLog[]> {
  const out: AgentLog[] = [];
  for (let from = fromBlock; from <= toBlock; from += LOG_WINDOW) {
    const to = from + LOG_WINDOW - 1n < toBlock ? from + LOG_WINDOW - 1n : toBlock;
    const raw = await client.request({
      method: "eth_getLogs",
      params: [
        {
          address: SOMNIA_AGENTS,
          fromBlock: toHex(from),
          toBlock: toHex(to),
          topics: [[REQUEST_FINALIZED_TOPIC, AGENT_RESPONSE_TOPIC], pad(toHex(requestId), { size: 32 })],
        },
      ],
    });
    for (const l of raw) {
      out.push({ topics: l.topics, data: l.data, transactionHash: l.transactionHash, blockNumber: l.blockNumber === null ? null : BigInt(l.blockNumber) });
    }
  }
  return out;
}

/** Polls the logs from the request's block until it finalizes or the deadline passes. */
async function waitForOutcome(requestId: bigint, fromBlock: bigint, untilMs: number): Promise<OracleOutcome> {
  const logs: AgentLog[] = [];
  let scanned = fromBlock - 1n;
  for (;;) {
    const head = await client.getBlockNumber();
    if (head > scanned) {
      logs.push(...(await agentLogs(requestId, scanned + 1n, head)));
      scanned = head;
    }
    const outcome = oracleOutcomeFromLogs(logs, requestId);
    if (outcome.finalizeTx !== null || Date.now() > untilMs) return outcome;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

function createdFrom(receipt: Receipt): { requestId: bigint; perAgentBudget: bigint; subcommittee: readonly Address[] } | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: somniaAgentsAbi, data: log.data, topics: log.topics });
      if (ev.eventName === "RequestCreated") {
        return { requestId: ev.args.requestId, perAgentBudget: ev.args.perAgentBudget, subcommittee: ev.args.subcommittee };
      }
    } catch {
      // another SomniaAgents event
    }
  }
  return null;
}

function payloadOf(payload: Hex): { selector: Hex; symbols: readonly string[] | null; decimals: number | null } {
  try {
    const d = decodeFunctionData({ abi: priceOracleAbi, data: payload });
    return { selector: payload.slice(0, 10) as Hex, symbols: d.args[0], decimals: d.args[1] };
  } catch {
    return { selector: payload.slice(0, 10) as Hex, symbols: null, decimals: null };
  }
}

function record(
  mode: "live" | "from-tx",
  receipt: Receipt,
  sent: { requester: Address; agentId: bigint; callback: Address; callbackSelector: Hex; payload: Hex; value: bigint; floor: bigint | null },
  created: { requestId: bigint; perAgentBudget: bigint; subcommittee: readonly Address[] },
  outcome: OracleOutcome,
): never {
  writeEvidence("g1d-oracle", {
    mode,
    requestId: created.requestId,
    agentId: sent.agentId,
    requester: sent.requester,
    callback: sent.callback.toLowerCase() === sent.requester.toLowerCase() ? "referee EOA" : sent.callback,
    callbackSelector: sent.callbackSelector,
    payload: payloadOf(sent.payload),
    depositFloorWei: sent.floor,
    sentWei: sent.value,
    perAgentBudget: created.perAgentBudget,
    subcommittee: created.subcommittee,
    finalStatus: outcome.finalStatus,
    finalStatusCode: outcome.finalStatusCode,
    finalizeTx: outcome.finalizeTx,
    finalizeBlock: outcome.finalizeBlock,
    responses: outcome.validatorResponses.length,
    validatorResponses: outcome.validatorResponses,
    validatorCostWei: outcome.validatorResponses.reduce((a, r) => a + r.executionCostWei, 0n),
    outcomeSource: "SomniaAgents logs: RequestFinalized and the per-validator response events",
    // Prices reach only the callback; the logs carry none, so no symbol is reported from them.
    symbols: [],
    tx: txRecord("createRequest", receipt),
  });
  console.log(
    `oracle-probe: request ${created.requestId} -> ${outcome.finalStatus} (${outcome.validatorResponses.length} validator responses` +
      `${outcome.finalizeTx ? `; finalized in ${outcome.finalizeTx}` : ""})`,
  );
  process.exit(outcome.finalizeTx === null ? 1 : 0);
}

if (fromTx) {
  // Rebuild from an earlier createRequest transaction: reads only, no key.
  const hash = fromTx as Hex;
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  if (tx.to?.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) {
    console.error(`oracle-probe: ${hash} is not a SomniaAgents transaction`);
    process.exit(1);
  }
  const call = decodeFunctionData({ abi: somniaAgentsAbi, data: tx.input });
  if (call.functionName !== "createRequest") {
    console.error(`oracle-probe: ${hash} calls ${call.functionName}, not createRequest`);
    process.exit(1);
  }
  const [agentId, callback, callbackSelector, payload] = call.args;
  const created = createdFrom(receipt);
  if (!created) {
    console.error(`oracle-probe: ${hash} emitted no RequestCreated`);
    process.exit(1);
  }
  let floor: bigint | null = null;
  try {
    floor = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequestDeposit", blockNumber: receipt.blockNumber - 1n });
  } catch {
    floor = null; // that block's state is no longer served
  }
  const head = await client.getBlockNumber();
  const last = receipt.blockNumber + REBUILD_SPAN < head ? receipt.blockNumber + REBUILD_SPAN : head;
  const outcome = oracleOutcomeFromLogs(await agentLogs(created.requestId, receipt.blockNumber, last), created.requestId);
  record("from-tx", receipt, { requester: tx.from, agentId, callback, callbackSelector, payload, value: tx.value, floor }, created, outcome);
}

const refereePk = requirePrivateKey("REFEREE_PK");
const referee: Address = privateKeyToAccount(refereePk).address;
const wallet = walletFor(refereePk);
const payload = encodeFunctionData({ abi: priceOracleAbi, functionName: "getPrices", args: [[...SYMBOLS], 18] });
const floor = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequestDeposit" });
const value = floor >= ORACLE_DEPOSIT ? floor + 900_000_000_000_000n : ORACLE_DEPOSIT;
console.log(`oracle-probe: floor ${floor} wei, sending ${value} wei from ${referee}`);
if (dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}
const hash = await wallet.writeContract({
  address: SOMNIA_AGENTS,
  abi: somniaAgentsAbi,
  functionName: "createRequest",
  args: [ORACLE_AGENT_ID, referee, "0x00000000", payload],
  value,
});
const receipt = await client.waitForTransactionReceipt({ hash });
const created = createdFrom(receipt);
if (!created) {
  writeEvidence("g1d-oracle", { mode: "live", requestId: "none", finalStatus: "NoRequestCreated", symbols: [], tx: txRecord("createRequest", receipt) });
  process.exit(1);
}
const outcome = await waitForOutcome(created.requestId, receipt.blockNumber, Date.now() + 180_000);
record(
  "live",
  receipt,
  { requester: referee, agentId: ORACLE_AGENT_ID, callback: referee, callbackSelector: "0x00000000", payload, value, floor },
  created,
  outcome,
);
