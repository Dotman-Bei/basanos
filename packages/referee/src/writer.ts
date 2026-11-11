import type { Address, Hex, PublicClient } from "viem";
import { RULE_NAMES, basanosRegistryAbi } from "@basanos/core";
import type { FailRule } from "@basanos/core/evaluate";
import type { RefereeWallet } from "./chain";
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

/** oracleValue is ORACLE_DEPOSIT when ORACLE_ENABLED=true (cut-order switch), else 0n; only PASS and FAIL carry it. */
export function makeRegistryWriter(wallet: RefereeWallet, client: PublicClient, registry: Address, oracleValue: bigint): RegistryWriter {
  const done = async (label: string, hash: Hex): Promise<TxRecord> => {
    const r = txRecord(label, await client.waitForTransactionReceipt({ hash }));
    if (r.status !== "success") throw new Error(`${label} reverted: ${r.explorer}`);
    return r;
  };
  return {
    recordFail: async (runId, rule, breach, evidenceHash, closeTxs) =>
      done(
        "recordFail",
        await wallet.writeContract({
          address: registry,
          abi: basanosRegistryAbi,
          functionName: "recordFail",
          args: failArgs(runId, rule, breach, evidenceHash, closeTxs),
          value: oracleValue,
        }),
      ),
    recordPass: async (runId) =>
      done("recordPass", await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "recordPass", args: [runId], value: oracleValue })),
    recordVoid: async (runId, reason, txHash, evidenceHash) =>
      done(
        "recordVoid",
        await wallet.writeContract({ address: registry, abi: basanosRegistryAbi, functionName: "recordVoid", args: voidArgs(runId, reason, txHash, evidenceHash) }),
      ),
  };
}
