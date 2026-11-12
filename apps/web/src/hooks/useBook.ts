import { useEffect, useState } from "react";
import { BTC_POOL } from "@basanos/core";
import { readBookLevels, type BookRead } from "@basanos/core/book";
import { browserClient } from "../chain/client";

/** The BTC-PERP book in the given block (the terminal shows the closeable equity the referee judges, spec §5). Keeps
 *  the last book while the next read is in flight. */
export function useBookAt(blockNumber: bigint | undefined): BookRead | null {
  const [book, setBook] = useState<BookRead | null>(null);
  useEffect(() => {
    if (blockNumber === undefined) return;
    let live = true;
    void readBookLevels(browserClient(), BTC_POOL, blockNumber).then((b) => {
      if (live && b) setBook(b);
    });
    return () => {
      live = false;
    };
  }, [blockNumber]);
  return book;
}
