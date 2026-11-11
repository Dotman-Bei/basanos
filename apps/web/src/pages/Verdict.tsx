import { useEffect, useState } from "react";
import { basanosRegistryAbi } from "@basanos/core";
import { browserClient } from "../chain/client";
import { VerdictView, type VerdictData } from "../components/VerdictView";
import { REGISTRY } from "../config";
import { replayRead, type ReplayRow } from "../lib/replay";
import { rulebookById } from "../lib/rulebooks";

export function VerdictPage(props: { runId: bigint }) {
  const [data, setData] = useState<VerdictData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pool, setPool] = useState<`0x${string}` | null>(null);
  const [replay, setReplay] = useState<Record<"start" | "breach" | "end", ReplayRow[] | null>>({ start: null, breach: null, end: null });
  useEffect(() => {
    if (!REGISTRY) {
      setError("This build has no registry address set.");
      return;
    }
    const registry = REGISTRY;
    const c = browserClient();
    void (async () => {
      try {
        const run = await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [props.runId] });
        const closeTxs = await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getCloseTxs", args: [props.runId] });
        const params = await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRulebook", args: [run.rulebookId] });
        setPool(params.pool);
        setData({
          runId: props.runId,
          account: run.account,
          status: run.status,
          rule: run.rule,
          voidReason: run.voidReason,
          rulebookLabel: rulebookById(run.rulebookId)?.label ?? "Unpublished rulebook",
          rulebookId: run.rulebookId,
          rulebookJson: (() => {
            const rb = rulebookById(run.rulebookId);
            return rb ? JSON.stringify(rb, null, 2) : null;
          })(),
          start: run.start,
          breach: run.breach,
          end: run.end,
          closeTxs,
          oraclePrice: run.oraclePrice,
          oracleSources: run.oracleSources,
          oracleDone: run.oracleDone,
        });
      } catch (e) {
        setError((e as Error).message.slice(0, 200));
      }
    })();
  }, [props.runId]);
  if (error) return <p className="wrap error">{error}</p>;
  if (!data || !pool) return <p className="wrap label">Reading run {props.runId.toString()} from the registry…</p>;
  const onReplay = async () => {
    const c = browserClient();
    const [start, breach, end] = await Promise.all([
      replayRead(c, data.account, pool, data.start),
      data.status === 3 ? replayRead(c, data.account, pool, data.breach) : Promise.resolve(null),
      replayRead(c, data.account, pool, data.end),
    ]);
    setReplay({ start, breach, end });
  };
  return <VerdictView data={data} replay={replay} onReplay={() => void onReplay()} />;
}
