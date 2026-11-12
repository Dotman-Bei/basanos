import { useEffect, useState } from "react";
import { basanosRegistryAbi } from "@basanos/core";
import { browserClient } from "../chain/client";
import { VerdictView, type VerdictData } from "../components/VerdictView";
import { REGISTRY } from "../config";
import { replayJudged, type JudgedView } from "../lib/judged";
import { replayRead, type ReplayRow } from "../lib/replay";
import { rulebookById } from "../lib/rulebooks";
import { routeHref } from "../routes";

/** A run id the registry never issued reads back as an empty record (status None, zero account). */
export function runMissing(run: { status: number; account: string }): boolean {
  return run.status === 0 && /^0x0{40}$/i.test(run.account);
}

/** The plain empty state for a missing run (docs/design/frontend.md), instead of an empty verdict. */
export function RunNotFound(props: { runId: bigint }) {
  const id = props.runId.toString();
  return (
    <div className="wrap">
      <h1 className="figure">Run {id} not found</h1>
      <p>
        No run {id} is in the registry. <a className="link" href={routeHref({ name: "home" })}>See the recent verdicts</a>.
      </p>
    </div>
  );
}

export function VerdictPage(props: { runId: bigint }) {
  const [data, setData] = useState<VerdictData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [pool, setPool] = useState<`0x${string}` | null>(null);
  const [replay, setReplay] = useState<Record<"start" | "breach" | "end", ReplayRow[] | null>>({ start: null, breach: null, end: null });
  const [breachJudged, setBreachJudged] = useState<JudgedView | null>(null);
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
        if (runMissing(run)) {
          setMissing(true);
          return;
        }
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
  if (missing) return <RunNotFound runId={props.runId} />;
  if (!data || !pool) return <p className="wrap label">Reading run {props.runId.toString()} from the registry…</p>;
  const onReplay = async () => {
    const c = browserClient();
    const [start, breach, end, judged] = await Promise.all([
      replayRead(c, data.account, pool, data.start),
      data.status === 3 ? replayRead(c, data.account, pool, data.breach) : Promise.resolve(null),
      replayRead(c, data.account, pool, data.end),
      data.status === 3 ? replayJudged(c, pool, data.breach) : Promise.resolve(null),
    ]);
    setReplay({ start, breach, end });
    setBreachJudged(judged);
  };
  return <VerdictView data={data} replay={replay} onReplay={() => void onReplay()} breachJudged={breachJudged} />;
}
