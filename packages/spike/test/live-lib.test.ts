import { describe, expect, it } from "vitest";
import {
  decodeFunctionData,
  encodeAbiParameters,
  getAbiItem,
  toFunctionSelector,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  getAddress,
  pad,
  toHex,
  zeroAddress,
  type Hex,
} from "viem";
import { perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import {
  BTC_POOL,
  CANCEL_ORDER_FOR_SELECTOR,
  OPERATOR_REGISTRY,
  ORDER_GAS,
  ORACLE_DEPOSIT,
  ORDER_TYPE_LIMIT,
  PLACE_ORDER_FOR_SELECTOR,
  operatorRegistryAbi,
  priceOracleAbi,
  somniaAgentsAbi,
} from "@basanos/core";
import {
  AGENT_RESPONSE_TOPIC,
  ORACLE_CALLBACK_PARAMS,
  ORACLE_STATUS,
  PROBE_MAX_WEI,
  agentsAdvancedAbi,
  decodeOracleCallback,
  findCallTo,
  parseProbeArgs,
  probeDeposit,
  symbolsFromCallback,
  decodeOraclePrices,
  oracleOutcomeFromLogs,
  type AgentLog,
  grantCall,
  isFlat,
  ownerOrderCall,
  ownerTx,
  parseSendPath,
  sumCosts,
  txRecord,
} from "../src/live-lib";

describe("txRecord", () => {
  it("records cost as gasUsed x effectiveGasPrice with an explorer link", () => {
    const r = txRecord("close", { transactionHash: "0xab", status: "success", gasUsed: 3_000_000n, effectiveGasPrice: 6_000_000_000n });
    expect(r.costWei).toBe(18_000_000_000_000_000n);
    expect(r.explorer).toBe("https://explorer.testnet.somnia.network/tokyo/tx/0xab");
    expect(sumCosts([r, r])).toBe(36_000_000_000_000_000n);
  });
});

describe("isFlat", () => {
  it("needs no position, no locked collateral and no active pools", () => {
    const base = { account: "0x1" as const, equityOk: true, equity: 1n, lockedCollateral: 0n, totalEquity: 1n, activePools: [], size: 0n };
    expect(isFlat(base)).toBe(true);
    expect(isFlat({ ...base, size: 1n })).toBe(false);
    expect(isFlat({ ...base, lockedCollateral: 1n })).toBe(false);
    expect(isFlat({ ...base, activePools: ["0x2"] })).toBe(false);
  });
});

describe("oracle decoding", () => {
  it("names statuses in the SomniaAgents enum order", () => {
    expect(ORACLE_STATUS[2]).toBe("Success");
    expect(ORACLE_STATUS[4]).toBe("TimedOut");
  });
  it("pairs each symbol with its median, sources and update time", () => {
    const data = encodeFunctionResult({
      abi: priceOracleAbi,
      functionName: "getPrices",
      result: [[74_500n * 10n ** 18n, 0n], [3, 0], [1_794_326_598_000n, 0n]],
    });
    expect(decodeOraclePrices(data, ["BTC/USDC:PERP", "BTC/USDC"])).toEqual([
      { symbol: "BTC/USDC:PERP", price: 74_500n * 10n ** 18n, numSources: 3, lastUpdated: 1_794_326_598_000n },
      { symbol: "BTC/USDC", price: 0n, numSources: 0, lastUpdated: 0n },
    ]);
  });
});

describe("owner-side writes on the viem path", () => {
  it("encodes the raw placeOrder exactly as the SDK's perpPoolWriteAbi does", () => {
    const price = 66_000n * 10n ** 18n;
    const expiry = 3_371_163_205_000_000_000n;
    const c = ownerOrderCall(BTC_POOL, true, price, 13_000n, ORDER_TYPE_LIMIT, expiry);
    expect(c.to).toBe(BTC_POOL);
    expect(c.value).toBe(0n);
    expect(c.data.slice(0, 10)).toBe("0x4e978373");
    expect(c.data).toBe(
      encodeFunctionData({
        abi: perpPoolWriteAbi,
        functionName: "placeOrder",
        args: [true, 0n, price, 13_000n, expiry, ORDER_TYPE_LIMIT, 0, zeroAddress, 0n],
      }),
    );
  });
  it("grants the referee place and cancel on one pool through the registry", () => {
    const referee = "0xE358D82209ea9360F411A041C0200adc385877eb";
    const c = grantCall(OPERATOR_REGISTRY, BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR]);
    expect(c.to).toBe(OPERATOR_REGISTRY);
    expect(c.data.slice(0, 10)).toBe("0x7bbc67e6");
    const d = decodeFunctionData({ abi: operatorRegistryAbi, data: c.data });
    expect(d.functionName).toBe("setOperatorApprovalForPool");
    expect(d.args).toEqual([BTC_POOL, referee, [PLACE_ORDER_FOR_SELECTOR, CANCEL_ORDER_FOR_SELECTOR], true]);
  });
  it("signs with ORDER_GAS and an explicit nonce, and keeps the SDK send opt-in", () => {
    expect(ownerTx({ to: BTC_POOL, data: "0x4e978373", value: 0n }, 7, ORDER_GAS)).toEqual({
      to: BTC_POOL,
      data: "0x4e978373",
      value: 0n,
      gas: 10_000_000n,
      nonce: 7,
    });
    expect(parseSendPath(["node", "skeleton-close.ts"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--dry-run"])).toBe("viem");
    expect(parseSendPath(["node", "skeleton-close.ts", "--sdk-send"])).toBe("sdk");
  });
});

describe("oracle outcome from SomniaAgents logs", () => {
  const id = 7_773_100n;
  const finalized = (requestId: bigint, status: number): AgentLog => ({
    topics: encodeEventTopics({ abi: somniaAgentsAbi, eventName: "RequestFinalized", args: { requestId } }) as Hex[],
    data: encodeAbiParameters([{ type: "uint8" }], [status]),
    transactionHash: "0x851a",
    blockNumber: 47_437_498n,
  });
  const response = (requestId: bigint, validator: Hex, cost: bigint): AgentLog => ({
    topics: [AGENT_RESPONSE_TOPIC, pad(toHex(requestId), { size: 32 }), pad(validator, { size: 32 })],
    data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [1n, 0n, 0n, cost]),
    transactionHash: "0x4789",
    blockNumber: 47_437_498n,
  });
  const validator: Hex = "0x92d237dea7eb9d37e1b303da586f4b83956df6ad";
  it("reads one request's final status and each validator's cost, ignoring other requests", () => {
    const out = oracleOutcomeFromLogs(
      [response(id, validator, 166_000_000_000_000n), response(id + 1n, validator, 1n), finalized(id + 1n, 2), finalized(id, 3)],
      id,
    );
    expect(out.finalStatus).toBe("Failed");
    expect(out.finalStatusCode).toBe(3);
    expect(out.finalizeTx).toBe("0x851a");
    expect(out.finalizeBlock).toBe(47_437_498n);
    expect(out.validatorResponses).toHaveLength(1);
    expect(out.validatorResponses[0]?.validator).toBe(getAddress(validator));
    expect(out.validatorResponses[0]?.executionCostWei).toBe(166_000_000_000_000n);
  });
  it("reports NotFinalized until the request's RequestFinalized log appears", () => {
    const out = oracleOutcomeFromLogs([response(id, validator, 5n), finalized(id + 1n, 2)], id);
    expect(out.finalStatus).toBe("NotFinalized");
    expect(out.finalizeTx).toBeNull();
    expect(out.validatorResponses).toHaveLength(1);
  });
});

describe("oracle probes P1 / P2", () => {
  const E18 = 10n ** 18n;
  it("picks the request and the evidence file from the flags", () => {
    expect(parseProbeArgs(["node", "oracle-probe.ts"])).toEqual({ dryRun: false, fromTx: null, symbols: ["BTC/USDC:PERP", "BTC/USDC"], advanced: false, evidence: "g1d-oracle" });
    expect(parseProbeArgs(["node", "oracle-probe.ts", "--symbols", "BTC/USDC:PERP", "--dry-run"])).toEqual({ dryRun: true, fromTx: null, symbols: ["BTC/USDC:PERP"], advanced: false, evidence: "g1d-probe-p1" });
    expect(parseProbeArgs(["node", "oracle-probe.ts", "--advanced"])).toEqual({ dryRun: false, fromTx: null, symbols: ["BTC/USDC:PERP"], advanced: true, evidence: "g1d-probe-p2" });
    expect(() => parseProbeArgs(["node", "oracle-probe.ts", "--symbols", "btc"])).toThrow(/--symbols/);
    expect(() => parseProbeArgs(["node", "oracle-probe.ts", "--from-tx", "0x12"])).toThrow(/--from-tx/);
  });
  it("funds Majority with the practical deposit and Threshold with 0.01 STT per validator, under a 0.1 STT cap", () => {
    expect(probeDeposit(30_000_000_000_000_000n, false)).toBe(ORACLE_DEPOSIT);
    expect(probeDeposit(30_000_000_000_000_000n, true)).toBe(60_000_000_000_000_000n);
    expect(probeDeposit(30_000_000_000_000_000n, true) <= PROBE_MAX_WEI).toBe(true);
    expect(toFunctionSelector(getAbiItem({ abi: agentsAdvancedAbi, name: "createAdvancedRequest" }))).toBe("0x9256632b");
  });
  const answer = (validator: Hex, prices: bigint[], sources: number[], updated: bigint[], status = 2) => ({
    validator,
    result: encodeFunctionResult({ abi: priceOracleAbi, functionName: "getPrices", result: [prices, sources, updated] }),
    status,
    receipt: 0n,
    timestamp: 0n,
    executionCost: 0n,
  });
  const callbackInput = (status: number, consensusType: number, responses: ReturnType<typeof answer>[]): Hex =>
    `0x00000000${encodeAbiParameters(ORACLE_CALLBACK_PARAMS, [
      7_773_100n,
      responses,
      status,
      {
        id: 7_773_100n,
        requester: "0xE358D82209ea9360F411A041C0200adc385877eb",
        callbackAddress: "0xE358D82209ea9360F411A041C0200adc385877eb",
        callbackSelector: "0x00000000",
        subcommittee: responses.map((r) => r.validator),
        responses,
        responseCount: BigInt(responses.length),
        failureCount: 0n,
        threshold: 2n,
        createdAt: 1n,
        deadline: 901n,
        status,
        consensusType,
        remainingBudget: 0n,
        perAgentBudget: 300_000_000_000_000n,
      },
    ]).slice(2)}`;
  const v1: Hex = "0x92d237DEa7eb9d37E1B303DA586f4B83956df6AD";
  const v2: Hex = "0xc400f086fDB3AA5b0A565DFc8988FB6Fe2511850";
  const v3: Hex = "0xd47dAa55Bd8f40fFf358Ad139Dd8549704DC842E";
  it("decodes every validator's answer and shows why Majority failed on request 7773100", () => {
    const input = callbackInput(3, 0, [
      answer(v1, [73_976n * E18, 74_010n * E18], [7, 6], [1_794_397_884_091n, 1_794_397_884_077n]),
      answer(v2, [73_976n * E18, 74_008n * E18], [7, 7], [1_794_397_884_091n, 1_794_397_884_059n]),
      answer(v3, [73_976n * E18, 74_011n * E18], [7, 6], [1_794_397_884_091n, 1_794_397_884_006n]),
    ]);
    const trace = { type: "CALL", to: "0x7407cb35a17d511d1bd32dd726adb8d5344ecbe3", calls: [{ type: "CALL", to: v1.toLowerCase() }, { type: "CALL", to: "0xe358d82209ea9360f411a041c0200adc385877eb", input }] };
    const call = findCallTo(trace, "0xE358D82209ea9360F411A041C0200adc385877eb");
    expect(call?.input).toBe(input);
    const cb = decodeOracleCallback(input);
    expect(cb.statusName).toBe("Failed");
    expect(cb.consensusType).toBe(0);
    expect(cb.answers).toHaveLength(3);
    expect(cb.answers[0]?.prices?.[0]).toEqual({ price: 73_976n * E18, numSources: 7, lastUpdated: 1_794_397_884_091n });
    expect(cb.answersIdentical).toBe(false);
    expect(symbolsFromCallback(cb, ["BTC/USDC:PERP", "BTC/USDC"])).toEqual([]);
  });
  it("reports the consensus reading only when the callback status is Success", () => {
    const same = answer(v1, [73_976n * E18], [7], [1_794_397_884_091n]);
    const cb = decodeOracleCallback(callbackInput(2, 0, [same, { ...same, validator: v2 }, { ...same, validator: v3 }]));
    expect(cb.answersIdentical).toBe(true);
    expect(symbolsFromCallback(cb, ["BTC/USDC:PERP"])).toEqual([{ symbol: "BTC/USDC:PERP", price: 73_976n * E18, numSources: 7, lastUpdated: 1_794_397_884_091n }]);
    expect(symbolsFromCallback(null, ["BTC/USDC:PERP"])).toEqual([]);
  });
});
