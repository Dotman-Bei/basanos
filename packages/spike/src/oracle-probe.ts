// G1(d): one Price Oracle request on Tokyo testnet from the referee EOA (callback = the EOA itself),
// read back through getRequest. Sends 0.0309 STT, the practical deposit (never the bare floor).
import { decodeEventLog, encodeFunctionData, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ORACLE_AGENT_ID, ORACLE_DEPOSIT, SOMNIA_AGENTS, priceOracleAbi, somniaAgentsAbi } from "@basanos/core";
import { loadDotEnv, requirePrivateKey } from "@basanos/core/node";
import { writeEvidence } from "./evidence";
import { ORACLE_STATUS, decodeOraclePrices, txRecord } from "./live-lib";
import { publicClient, walletFor } from "./rpc";

loadDotEnv();
const dryRun = process.argv.includes("--dry-run");
const refereePk = requirePrivateKey("REFEREE_PK");
const referee: Address = privateKeyToAccount(refereePk).address;
const client = publicClient();
const wallet = walletFor(refereePk);
const SYMBOLS = ["BTC/USDC:PERP", "BTC/USDC"] as const;
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
let requestId: bigint | null = null;
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== SOMNIA_AGENTS.toLowerCase()) continue;
  try {
    const ev = decodeEventLog({ abi: somniaAgentsAbi, data: log.data, topics: log.topics });
    if (ev.eventName === "RequestCreated") requestId = ev.args.requestId;
  } catch {
    // another SomniaAgents event
  }
}
if (requestId === null) {
  writeEvidence("g1d-oracle", { requestId: "none", finalStatus: "NoRequestCreated", symbols: [], tx: txRecord("createRequest", receipt) });
  process.exit(1);
}
let status = 1;
let symbols: ReturnType<typeof decodeOraclePrices> = [];
let responses = 0;
const deadline = Date.now() + 180_000;
let readError: string | null = null;
while (Date.now() < deadline) {
  try {
    const req = await client.readContract({ address: SOMNIA_AGENTS, abi: somniaAgentsAbi, functionName: "getRequest", args: [requestId] });
    status = req.status;
    responses = req.responses.length;
    if (status >= 2) {
      const success = req.responses.find((r) => r.status === 2);
      if (success) symbols = decodeOraclePrices(success.result, SYMBOLS);
      break;
    }
  } catch (e) {
    readError = (e as Error).message.slice(0, 400);
  }
  await new Promise((r) => setTimeout(r, 3_000));
}
writeEvidence("g1d-oracle", {
  requestId,
  agentId: ORACLE_AGENT_ID,
  callback: "referee EOA",
  depositFloorWei: floor,
  sentWei: value,
  finalStatus: ORACLE_STATUS[status] ?? `status ${status}`,
  readError,
  responses,
  symbols,
  tx: txRecord("createRequest", receipt),
});
console.log(`oracle-probe: request ${requestId} -> ${ORACLE_STATUS[status] ?? status}`);
for (const s of symbols) console.log(`  ${s.symbol}: price ${s.price} (${s.numSources} sources)`);
process.exit(0);
