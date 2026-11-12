import { encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { RULE_NAMES, basanosRegistryAbi } from "@basanos/core";
import type { FailRule } from "@basanos/core/evaluate";
import type { FastSender } from "./chain";
import type { BreachRead } from "./engine";
import { txRecord, type TxRecord } from "./tx";

export const ZERO_HASH: Hex = `0x${"0".repeat(64)}`;

export function ruleIndex(rule: FailRule): number {
  const i = RULE_NAMES.indexOf(rule);
  if (i <= 0) throw new Error(`unknown rule ${rule}`);
  return i;
}

export function voidIndex(reason: "Flow" | "ForeignMarket"): number {
  return reason === "Flow" ? 1 : 2;
}

export function failArgs(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]) {
  return [runId, ruleIndex(rule), { ...breach }, evidenceHash, [...closeTxs]] as const;
}

export function voidArgs(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex) {
  return [runId, voidIndex(reason), txHash ?? ZERO_HASH, evidenceHash] as const;
}

export interface RegistryWriter {
  recordFail(runId: bigint, rule: FailRule, breach: BreachRead, evidenceHash: Hex, closeTxs: readonly Hex[]): Promise<TxRecord>;
  recordPass(runId: bigint): Promise<TxRecord>;
  recordVoid(runId: bigint, reason: "Flow" | "ForeignMarket", txHash: Hex | null, evidenceHash: Hex): Promise<TxRecord>;
}

/** oracleValue is ORACLE_DEPOSIT when ORACLE_ENABLED=true (cut-order switch), else 0n; only PASS and FAIL carry it.
 *  Every write goes through the referee's one fast sender (P7), so its nonces never collide with the closes; the gas
 *  is estimated (a refused verdict reverts here, before anything is sent) with 30% headroom. */
export function makeRegistryWriter(sender: FastSender, client: PublicClient, registry: Address, oracleValue: bigint): RegistryWriter {
  const write = async (label: string, data: Hex, value: bigint): Promise<TxRecord> => {
    const gas = (await client.estimateGas({ account: sender.address, to: registry, data, value })) * 13n / 10n;
    const hash = await sender.send(registry, data, gas, value);
    const r = txRecord(label, await client.waitForTransactionReceipt({ hash }));
    if (r.status !== "success") throw new Error(`${label} reverted: ${r.explorer}`);
    return r;
  };
  return {
    recordFail: async (runId, rule, breach, evidenceHash, closeTxs) =>
      write("recordFail", encodeFunctionData({ abi: basanosRegistryAbi, functionName: "recordFail", args: failArgs(runId, rule, breach, evidenceHash, closeTxs) }), oracleValue),
    recordPass: async (runId) => write("recordPass", encodeFunctionData({ abi: basanosRegistryAbi, functionName: "recordPass", args: [runId] }), oracleValue),
    recordVoid: async (runId, reason, txHash, evidenceHash) =>
      write("recordVoid", encodeFunctionData({ abi: basanosRegistryAbi, functionName: "recordVoid", args: voidArgs(runId, reason, txHash, evidenceHash) }), 0n),
  };
}
