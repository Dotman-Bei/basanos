import { decodeFunctionResult, type Hex } from "viem";
import { explorerTx, priceOracleAbi, type AccountSnapshot } from "@basanos/core";

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
