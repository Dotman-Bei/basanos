import { useEffect, useState } from "react";
import { RUN_STATUS, basanosRegistryAbi } from "@basanos/core";
import { browserClient } from "../chain/client";
import { TRUST_LINE } from "../components/VerdictView";
import { REGISTRY } from "../config";
import { routeHref } from "../routes";

export function Home() {
  const [runs, setRuns] = useState<{ runId: bigint; status: number }[]>([]);
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
        setRuns([]);
      }
    })();
  }, []);
  return (
    <div className="wrap">
      <h1 className="figure">Recent verdicts</h1>
      <p>{TRUST_LINE}</p>
      <p className="label">Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.</p>
      <ul className="log">
        {runs.map((r) => (
          <li key={r.runId.toString()}>
            <a className="link" href={routeHref({ name: "run", runId: r.runId })}>
              Run {r.runId.toString()}: {RUN_STATUS[r.status] ?? "Unknown"}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
