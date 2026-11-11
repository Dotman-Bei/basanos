import { useEffect, useState } from "react";
import type { Address } from "viem";
import { BTC_POOL, basanosRegistryAbi, readSnapshot, type Snapshot } from "@basanos/core";
import { browserClient } from "../chain/client";
import { REGISTRY } from "../config";

export function useAccountSnapshot(address: Address | null): Snapshot | null {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  useEffect(() => {
    if (!address) return;
    let live = true;
    const tick = async () => {
      try {
        const s = await readSnapshot(browserClient(), [address], BTC_POOL);
        if (live) setSnap(s);
      } catch {
        // keep the last snapshot; the next tick retries
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1_500);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [address]);
  return snap;
}

export type RegistryRun = Awaited<ReturnType<typeof readRun>>;

export async function readRun(runId: bigint) {
  if (!REGISTRY) throw new Error("VITE_REGISTRY_ADDRESS is not set at build time");
  return browserClient().readContract({ address: REGISTRY, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] });
}

export function useActiveRun(account: Address | null): { runId: bigint; run: RegistryRun } | null {
  const [state, setState] = useState<{ runId: bigint; run: RegistryRun } | null>(null);
  useEffect(() => {
    if (!account || !REGISTRY) return;
    const registry = REGISTRY;
    let live = true;
    const tick = async () => {
      try {
        const runId = await browserClient().readContract({ address: registry, abi: basanosRegistryAbi, functionName: "activeRunOf", args: [account] });
        if (!live) return;
        if (runId === 0n) setState(null);
        else setState({ runId, run: await readRun(runId) });
      } catch {
        // retried on the next tick
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 3_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [account]);
  return state;
}
