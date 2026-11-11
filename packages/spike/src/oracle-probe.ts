// G1(d) and the oracle probes P1 / P2, all from the referee EOA (callback = the EOA itself).
//   no flags                  the original G1(d) request: BTC/USDC:PERP + BTC/USDC, 4-argument createRequest -> g1d-oracle
//   --symbols BTC/USDC:PERP   P1: one symbol, 4-argument createRequest (Majority), the registry's exact path -> g1d-probe-p1
//   --advanced                P2: createAdvancedRequest, Threshold 2 of 3, 30 s, 0.06 STT (BTC/USDC:PERP) -> g1d-probe-p2
//   --dry-run                 reads only and prints what would be sent
//   --from-tx <hash>          rebuilds the evidence from an earlier request (no key, no send); the flags pick the file
// The outcome comes from SomniaAgents logs (RequestFinalized and the per-validator response events), never from
// getRequest: the platform deletes a request once it finalizes. Each validator's answer is decoded from the callback
// SomniaAgents makes inside the finalize transaction (debug_traceTransaction), so the evidence shows what was
// returned and whether the answers were identical (Majority needs byte-identical answers).
import { writeFileSync } from "node:fs";
import { decodeEventLog, decodeFunctionData, encodeFunctionData, pad, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ORACLE_AGENT_ID, SOMNIA_AGENTS, priceOracleAbi, somniaAgentsAbi } from "@basanos/core";
import { loadDotEnv, repoPath, requirePrivateKey } from "@basanos/core/node";
import { checkEvidence, toJsonSafe, writeEvidence } from "./evidence";
import {
  ADVANCED_REQUEST,
  AGENT_RESPONSE_TOPIC,
  PROBE_MAX_WEI,
  REQUEST_FINALIZED_TOPIC,
  agentsAdvancedAbi,
  decodeOracleCallback,
  findCallTo,
  oracleOutcomeFromLogs,
  parseProbeArgs,
  probeDeposit,
  symbolsFromCallback,
  txRecord,
  type AgentLog,
  type OracleCallback,
  type OracleOutcome,
  type ProbeArgs,
  type TraceCall,
} from "./live-lib";
import { publicClient, walletFor } from "./rpc";

loadDotEnv();
let args: ProbeArgs;
try {
  args = parseProbeArgs(process.argv);
} catch (e) {
  console.error(`oracle-probe: ${(e as Error).message}`);
  process.exit(1);
}
const client = publicClient();
const LOG_WINDOW = 1_000n; // eth_getLogs answers at most 1,000 blocks per call on Hideki
const REBUILD_SPAN = 3_000n; // a rebuild scans this many blocks after the request (it finalizes within a few)
const agentsAbi = [...somniaAgentsAbi, ...agentsAdvancedAbi] as const;
const consensusLabel = args.advanced
  ? `Threshold ${ADVANCED_REQUEST.threshold} of ${ADVANCED_REQUEST.subcommitteeSize}, ${ADVANCED_REQUEST.timeoutSec} s (createAdvancedRequest)`
  : "Majority (4-argument createRequest)";

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

/** The validators' answers, from the callback inside the finalize transaction; null if the trace is not served. */
async function callbackOf(finalizeTx: Hex | null, callback: Address): Promise<OracleCallback | null> {
  if (finalizeTx === null) return null;
  try {
    const trace = (await client.request({ method: "debug_traceTransaction", params: [finalizeTx, { tracer: "callTracer" }] } as never)) as TraceCall;
    const call = findCallTo(trace, callback);
    return call?.input ? decodeOracleCallback(call.input) : null;
  } catch {
    return null;
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

async function record(
  mode: "live" | "from-tx",
  receipt: Receipt,
  sent: { requester: Address; agentId: bigint; callback: Address; callbackSelector: Hex; payload: Hex; value: bigint; floor: bigint | null; call: string },
  created: { requestId: bigint; perAgentBudget: bigint; subcommittee: readonly Address[] },
  outcome: OracleOutcome,
): Promise<never> {
  const cb = await callbackOf(outcome.finalizeTx, sent.callback);
  const symbolsAsked = payloadOf(sent.payload).symbols ?? args.symbols;
  const data = {
    mode,
    probe: args.evidence === "g1d-oracle" ? null : args.evidence === "g1d-probe-p1" ? "P1" : "P2",
    request: sent.call,
    consensus: cb ? (cb.consensusType === 1 ? "Threshold" : cb.consensusType === 0 ? "Majority" : `type ${cb.consensusType}`) : consensusLabel,
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
    answers: cb ? cb.answers.map((a) => ({ validator: a.validator, status: a.status, prices: a.prices })) : null,
    answersIdentical: cb ? cb.answersIdentical : null,
    answersSource: cb ? "the callback in the finalize transaction (debug_traceTransaction)" : "trace not served",
    // The consensus reading: only a Success callback yields one.
    symbols: symbolsFromCallback(cb, symbolsAsked),
    tx: txRecord("createRequest", receipt),
  };
  if (args.evidence === "g1d-oracle") {
    writeEvidence("g1d-oracle", data);
  } else {
    const body = { evidence: args.evidence, writtenAt: new Date().toISOString(), ...data };
    writeFileSync(repoPath(`docs/evidence/${args.evidence}.json`), `${JSON.stringify(toJsonSafe(body), null, 2)}\n`);
  }
  console.log(
    `oracle-probe: request ${created.requestId} -> ${outcome.finalStatus} (${outcome.validatorResponses.length} validator responses` +
      `${outcome.finalizeTx ? `; finalized in ${outcome.finalizeTx}` : ""})`,
  );
  console.log(cb ? `answers: ${cb.answers.length} decoded, identical: ${cb.answersIdentical}` : "answers: trace not served");
  for (const s of data.symbols) console.log(`  ${s.symbol}: ${s.price} (${s.numSources} sources)`);
  if (args.evidence !== "g1d-oracle") {
    // The probe's own gate: the strict G1(d) rule applied to this file.
    const problems = checkEvidence("g1d-oracle", toJsonSafe(data) as Record<string, unknown>).map((p) => p.replace(/^g1d-oracle/, args.evidence));
    for (const p of problems) console.log(`FAIL ${p}`);
    if (problems.length === 0) console.log(`PASS ${args.evidence}`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
  process.exit(outcome.finalizeTx === null ? 1 : 0);
}

if (args.fromTx) {
  // Rebuild from an earlier createRequest / createAdvancedRequest transaction: reads only, no key.
  const hash = args.fromTx;
  const [tx, receipt] = await Promise.all([client.getTransaction({ hash }), client.getTransactionReceipt({ hash })]);
  if (tx.to?.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) {
    console.error(`oracle-probe: ${hash} is not a SomniaAgents transaction`);
    process.exit(1);
  }
  const call = decodeFunctionData({ abi: agentsAbi, data: tx.input });
  if (call.functionName !== "createRequest" && call.functionName !== "createAdvancedRequest") {
    console.error(`oracle-probe: ${hash} calls ${call.functionName}, not a request`);
    process.exit(1);
  }
  const [agentId, callback, callbackSelector, payload] = call.args as unknown as [bigint, Address, Hex, Hex];
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
  await record(
    "from-tx",
    receipt,
    { requester: tx.from, agentId, callback, callbackSelector, payload, value: tx.value, floor, call: call.functionName },
    created,
    outcome,
  );
}

const refereePk = requirePrivateKey("REFEREE_PK");
const referee: Address = privateKeyToAccount(refereePk).address;
const wallet = walletFor(refereePk);
const payload = encodeFunctionData({ abi: priceOracleAbi, functionName: "getPrices", args: [args.symbols, 18] });
const floor = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequestDeposit" });
const value = probeDeposit(floor, args.advanced);
console.log(
  `oracle-probe: ${args.evidence}, symbols ${args.symbols.join(", ")}, consensus ${consensusLabel}; floor ${floor} wei, sending ${value} wei from ${referee}`,
);
if (value > PROBE_MAX_WEI) {
  console.error(`oracle-probe: STOP — ${value} wei is above the ${PROBE_MAX_WEI} wei probe cap`);
  process.exit(1);
}
if (args.dryRun) {
  console.log("dry-run: no transaction sent");
  process.exit(0);
}
const hash = args.advanced
  ? await wallet.writeContract({
      address: SOMNIA_AGENTS,
      abi: agentsAdvancedAbi,
      functionName: "createAdvancedRequest",
      args: [
        ORACLE_AGENT_ID,
        referee,
        "0x00000000",
        payload,
        ADVANCED_REQUEST.subcommitteeSize,
        ADVANCED_REQUEST.threshold,
        ADVANCED_REQUEST.consensusType,
        ADVANCED_REQUEST.timeoutSec,
      ],
      value,
    })
  : await wallet.writeContract({
      address: SOMNIA_AGENTS,
      abi: somniaAgentsAbi,
      functionName: "createRequest",
      args: [ORACLE_AGENT_ID, referee, "0x00000000", payload],
      value,
    });
const receipt = await client.waitForTransactionReceipt({ hash });
const created = createdFrom(receipt);
if (!created) {
  const failed = { mode: "live", requestId: "none", finalStatus: "NoRequestCreated", symbols: [], tx: txRecord("createRequest", receipt) };
  if (args.evidence === "g1d-oracle") writeEvidence("g1d-oracle", failed);
  else writeFileSync(repoPath(`docs/evidence/${args.evidence}.json`), `${JSON.stringify(toJsonSafe({ evidence: args.evidence, ...failed }), null, 2)}\n`);
  console.log(`oracle-probe: no RequestCreated in ${hash}`);
  process.exit(1);
}
const outcome = await waitForOutcome(created.requestId, receipt.blockNumber, Date.now() + 180_000);
await record(
  "live",
  receipt,
  {
    requester: referee,
    agentId: ORACLE_AGENT_ID,
    callback: referee,
    callbackSelector: "0x00000000",
    payload,
    value,
    floor,
    call: args.advanced ? "createAdvancedRequest" : "createRequest",
  },
  created,
  outcome,
);
