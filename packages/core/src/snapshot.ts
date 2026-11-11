import { decodeFunctionResult, encodeFunctionData, type Address, type Hex, type PublicClient } from "viem";
import { marginBankAbi, multicall3Abi, perpPoolAbi } from "./abi";
import { MARGIN_BANK, MULTICALL3 } from "./config";

export interface AccountSnapshot {
  account: Address;
  equityOk: boolean;
  equity: bigint;
  lockedCollateral: bigint;
  totalEquity: bigint;
  activePools: Address[];
  size: bigint;
}

export interface Snapshot {
  blockNumber: bigint;
  timestamp: bigint;
  pool: Address;
  markOk: boolean;
  markPrice: bigint;
  accounts: AccountSnapshot[];
}

interface Row {
  success: boolean;
  returnData: Hex;
}

function calls(accounts: readonly Address[], pool: Address) {
  const head = [
    { target: MULTICALL3, allowFailure: true, callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getBlockNumber" }) },
    {
      target: MULTICALL3,
      allowFailure: true,
      callData: encodeFunctionData({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" }),
    },
    { target: pool, allowFailure: true, callData: encodeFunctionData({ abi: perpPoolAbi, functionName: "tryGetMarkPrice" }) },
  ];
  const perAccount = accounts.flatMap((account) => [
    {
      target: MARGIN_BANK,
      allowFailure: true,
      callData: encodeFunctionData({ abi: marginBankAbi, functionName: "tryGetAccountEquity", args: [account] }),
    },
    {
      target: MARGIN_BANK,
      allowFailure: true,
      callData: encodeFunctionData({ abi: marginBankAbi, functionName: "getAccountState", args: [account] }),
    },
    {
      target: MARGIN_BANK,
      allowFailure: true,
      callData: encodeFunctionData({ abi: marginBankAbi, functionName: "getPosition", args: [account, pool] }),
    },
  ]);
  return [...head, ...perAccount];
}

/** One Multicall3 call: usable as a somnia_watch eth_call or as a head/historical read. */
export function snapshotCall(accounts: readonly Address[], pool: Address): { to: Address; data: Hex } {
  return { to: MULTICALL3, data: encodeFunctionData({ abi: multicall3Abi, functionName: "aggregate3", args: [calls(accounts, pool)] }) };
}

export function decodeSnapshot(result: Hex, accounts: readonly Address[], pool: Address): Snapshot {
  const rows = decodeFunctionResult({ abi: multicall3Abi, functionName: "aggregate3", data: result }) as readonly Row[];
  const expected = 3 + accounts.length * 3;
  if (rows.length !== expected) throw new Error(`snapshot: expected ${expected} rows, got ${rows.length}`);
  const row = (i: number): Row => rows[i] as Row;
  const blockNumber = row(0).success
    ? (decodeFunctionResult({ abi: multicall3Abi, functionName: "getBlockNumber", data: row(0).returnData }) as bigint)
    : 0n;
  const timestamp = row(1).success
    ? (decodeFunctionResult({ abi: multicall3Abi, functionName: "getCurrentBlockTimestamp", data: row(1).returnData }) as bigint)
    : 0n;
  let markOk = false;
  let markPrice = 0n;
  if (row(2).success) {
    const [okMark, price] = decodeFunctionResult({ abi: perpPoolAbi, functionName: "tryGetMarkPrice", data: row(2).returnData });
    markOk = okMark;
    markPrice = price;
  }
  const out: AccountSnapshot[] = accounts.map((account, i) => {
    const base = 3 + i * 3;
    const eqRow = row(base);
    const stRow = row(base + 1);
    const posRow = row(base + 2);
    let equityOk = false;
    let equity = 0n;
    if (eqRow.success) {
      const [okEq, value] = decodeFunctionResult({ abi: marginBankAbi, functionName: "tryGetAccountEquity", data: eqRow.returnData });
      equityOk = okEq;
      equity = value;
    }
    let lockedCollateral = 0n;
    let activePools: Address[] = [];
    if (stRow.success) {
      const st = decodeFunctionResult({ abi: marginBankAbi, functionName: "getAccountState", data: stRow.returnData });
      lockedCollateral = st.lockedCollateral;
      activePools = [...st.activePerpPools];
    } else {
      equityOk = false;
    }
    let size = 0n;
    if (posRow.success) {
      const pos = decodeFunctionResult({ abi: marginBankAbi, functionName: "getPosition", data: posRow.returnData });
      size = pos.size;
    }
    return { account, equityOk, equity, lockedCollateral, totalEquity: equityOk ? equity + lockedCollateral : 0n, activePools, size };
  });
  return { blockNumber, timestamp, pool, markOk, markPrice, accounts: out };
}

export async function readSnapshot(
  client: PublicClient,
  accounts: readonly Address[],
  pool: Address,
  blockNumber?: bigint,
): Promise<Snapshot> {
  const call = snapshotCall(accounts, pool);
  const res = await client.call({ to: call.to, data: call.data, ...(blockNumber === undefined ? {} : { blockNumber }) });
  if (!res.data) throw new Error("snapshot: the multicall returned no data");
  return decodeSnapshot(res.data, accounts, pool);
}
