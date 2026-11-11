import { getAddress, toEventSelector, type Address, type PublicClient } from "viem";
import { MARGIN_BANK } from "@basanos/core";

const POSITION_UPDATED = toEventSelector(
  "event PositionUpdated(address indexed account, address indexed perpPool, int128 newSize, uint128 avgEntryPrice, int256 realizedPnl, int256 entryFundingIndex)",
);

export function pickMostFrequent(accounts: readonly Address[]): Address | null {
  const counts = new Map<Address, number>();
  for (const a of accounts) counts.set(a, (counts.get(a) ?? 0) + 1);
  let best: Address | null = null;
  let bestN = 0;
  for (const [a, n] of counts) {
    if (n > bestN) {
      best = a;
      bestN = n;
    }
  }
  return best;
}

/** A recently trading account, from MarginBank PositionUpdated logs (eth_getLogs ranges are capped at 1,000 blocks). */
export async function findActiveAccount(client: PublicClient, windows = 20): Promise<Address> {
  const head = await client.getBlockNumber();
  const seen: Address[] = [];
  for (let w = 0; w < windows && seen.length === 0; w++) {
    const toBlock = head - BigInt(w) * 1_000n;
    const fromBlock = toBlock - 999n;
    const logs = await client.request({
      method: "eth_getLogs",
      params: [{ address: MARGIN_BANK, topics: [POSITION_UPDATED], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }],
    });
    for (const log of logs as { topics: string[] }[]) {
      const t = log.topics[1];
      if (t) seen.push(getAddress(`0x${t.slice(26)}`));
    }
  }
  const best = pickMostFrequent(seen);
  if (!best) throw new Error("findActiveAccount: no PositionUpdated logs in the scanned windows");
  return best;
}
