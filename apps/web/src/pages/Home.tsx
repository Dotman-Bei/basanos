import { useEffect, useState } from "react";
import { RUN_STATUS, basanosRegistryAbi } from "@basanos/core";
import { browserClient } from "../chain/client";
import { TRUST_LINE } from "../components/VerdictView";
import { REGISTRY } from "../config";
import { routeHref } from "../routes";

// Plain empty states (docs/design/frontend.md): say what is there and what will be, in plain words, never a bare
// heading. A failed read is not "no verdicts", so it says so.
export const READING_TEXT = "Reading the registry…";
export const NO_RUNS_TEXT = "No verdicts yet. A verdict appears here when a challenge run ends.";
export const NO_REGISTRY_TEXT = "This build has no registry address set.";
export const READ_FAILED_TEXT = "The registry could not be read right now. Reload to try again.";

export function RunList(props: { runs: { runId: bigint; status: number }[] | null }) {
  if (props.runs === null) return <p className="label">{READING_TEXT}</p>;
  if (props.runs.length === 0) return <p className="label">{NO_RUNS_TEXT}</p>;
  return (
    <ul className="log">
      {props.runs.map((r) => (
        <li key={r.runId.toString()}>
          <a className="link" href={routeHref({ name: "run", runId: r.runId })}>
            Run {r.runId.toString()}: {RUN_STATUS[r.status] ?? "Unknown"}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Home() {
  const [runs, setRuns] = useState<{ runId: bigint; status: number }[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!REGISTRY) return;
    const registry = REGISTRY;
    const c = browserClient();
    void (async () => {
      try {
        const count = await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "runCount" });
        const ids: bigint[] = [];
        for (let id = count; id > 0n && ids.length < 12; id--) ids.push(id);
        const rows = await Promise.all(
          ids.map(async (runId) => ({ runId, status: (await c.readContract({ address: registry, abi: basanosRegistryAbi, functionName: "getRun", args: [runId] })).status })),
        );
        setRuns(rows);
      } catch {
        setFailed(true);
      }
    })();
  }, []);
  return (
    <div className="wrap">
      <h1 className="figure">Recent verdicts</h1>
      <p>{TRUST_LINE}</p>
      <p className="label">Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.</p>
      {!REGISTRY ? <p className="label">{NO_REGISTRY_TEXT}</p> : failed ? <p className="label">{READ_FAILED_TEXT}</p> : <RunList runs={runs} />}
    </div>
  );
}
