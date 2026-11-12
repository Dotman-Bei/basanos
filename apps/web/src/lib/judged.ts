import type { Address, PublicClient } from "viem";
import { closeableEquity, readBookLevels, type BookSides } from "@basanos/core/book";
import type { StoredRead } from "./replay";

/** A breach as the referee judged it (spec §5): the stored equity revalued at the book in the breach block. */
export interface JudgedView {
  /** Closeable equity in USDso wei; null when the read was unpriceable or the book could not price the position. */
  equity: bigint | null;
  /** false when the public RPC no longer serves the book at that block. */
  served: boolean;
}

export function judgedFromBook(read: StoredRead, book: BookSides | null): JudgedView {
  if (!book) return { equity: null, served: false };
  if (!read.equityOk || !read.markOk) return { equity: null, served: true };
  return { equity: closeableEquity(read.equity + read.lockedCollateral, read.positionSize, read.markPrice, book, 8), served: true };
}

/** Re-reads the book at the breach block and revalues the stored read at it. */
export async function replayJudged(client: PublicClient, pool: Address, read: StoredRead): Promise<JudgedView> {
  return judgedFromBook(read, await readBookLevels(client, pool, read.blockNumber));
}
