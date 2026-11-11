import type { Address, Hex } from "viem";
import { RULE_NAMES, RUN_STATUS, VOID_REASONS, explorerTx } from "@basanos/core";
import { formatUsdso, shortHash } from "../lib/format";
import type { ReplayRow, StoredRead } from "../lib/replay";
import { routeHref } from "../routes";

export const TRUST_LINE = "Every certificate is chain-checked at mint; every verdict is replayable.";

/** Shown when a verdict has no recorded Price Oracle reading (the registry asks at each verdict, best-effort, inside try). */
export const ORACLE_NO_READING_LINE = "No Price Oracle reading was recorded for this verdict.";

export interface VerdictData {
  runId: bigint;
  account: Address;
  status: number;
  rule: number;
  voidReason: number;
  rulebookLabel: string;
  rulebookId: Hex;
  rulebookJson: string | null;
  start: StoredRead;
  breach: StoredRead;
  end: StoredRead;
  closeTxs: readonly Hex[];
  oraclePrice: bigint;
  oracleSources: number;
  oracleDone: boolean;
}

const MATCH_TEXT: Record<ReplayRow["match"], string> = {
  exact: "matches",
  "within-tolerance": "matches within 10 bps (end of block vs inside the transaction)",
  differs: "differs",
  "not-served": "stored on-chain; state no longer served by the public RPC",
};

function heading(d: VerdictData): string {
  const status = RUN_STATUS[d.status] ?? "Unknown";
  if (status === "Failed") return `FAILED — ${RULE_NAMES[d.rule] ?? "rule"}`;
  if (status === "Voided") return `VOID — ${VOID_REASONS[d.voidReason] ?? "reason"}`;
  return status.toUpperCase();
}

function ReadBlock(props: { title: string; who: string; read: StoredRead; rows: ReplayRow[] | null }) {
  return (
    <section className="panel">
      <h2 className="label">
        {props.title} — block {props.read.blockNumber.toString()} ({props.who})
      </h2>
      <dl className="kv">
        <dt>Equity</dt>
        <dd className="mono">{props.read.equityOk ? `${formatUsdso(props.read.equity + props.read.lockedCollateral)} USDso` : "unpriceable"}</dd>
        <dt>Position size</dt>
        <dd className="mono">{props.read.positionSize.toString()}</dd>
        <dt>Mark</dt>
        <dd className="mono">{props.read.markOk ? formatUsdso(props.read.markPrice) : "no fresh mark"}</dd>
      </dl>
      {props.rows ? (
        <ul className="log">
          {props.rows.map((r) => (
            <li key={r.field}>
              <span className="mono">{r.call}</span>: {MATCH_TEXT[r.match]}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function VerdictView(props: { data: VerdictData; replay: Record<"start" | "breach" | "end", ReplayRow[] | null>; onReplay: () => void }) {
  const d = props.data;
  const passed = d.status === 2;
  const failed = d.status === 3;
  return (
    <div className="wrap">
      <p className="label">Run {d.runId.toString()}</p>
      <h1 className="figure">{heading(d)}</h1>
      <p>
        <span className={`state ${passed ? "state--passed" : failed ? "state--failed" : ""}`}>{d.rulebookLabel}</span>
      </p>
      <p>{TRUST_LINE}</p>
      {passed ? (
        <p>
          <a className="link" href={routeHref({ name: "cert", runId: d.runId })}>
            View the certificate
          </a>
        </p>
      ) : null}
      <div className="btn-row">
        <button type="button" className="btn btn--primary" onClick={props.onReplay}>
          Replay at the pinned blocks
        </button>
      </div>
      <div className="app-grid">
        <div className="app-col-8">
          <ReadBlock title="Start" who="read by the registry in the transaction" read={d.start} rows={props.replay.start} />
          {failed ? <ReadBlock title="Breach" who="attested by the referee" read={d.breach} rows={props.replay.breach} /> : null}
          <ReadBlock title="End" who="read by the registry in the transaction" read={d.end} rows={props.replay.end} />
        </div>
        <div className="app-col-4">
          <section className="panel">
            <h2 className="label">Account</h2>
            <p className="mono">{d.account}</p>
            <h2 className="label">Rulebook id</h2>
            <p className="mono">{d.rulebookId}</p>
            {d.rulebookJson ? (
              <details>
                <summary className="label">Rulebook JSON (its id is the keccak256 of this canonical JSON)</summary>
                <pre className="mono">{d.rulebookJson}</pre>
              </details>
            ) : null}
          </section>
          {d.closeTxs.length > 0 ? (
            <section className="panel">
              <h2 className="label">Referee close transactions</h2>
              <ul className="log">
                {d.closeTxs.map((h) => (
                  <li key={h}>
                    <a className="link mono" href={explorerTx(h)} target="_blank" rel="noreferrer">
                      {shortHash(h)}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="panel">
            <h2 className="label">Price Oracle cross-check</h2>
            <p className="mono">
              {d.oracleDone && d.oracleSources > 0
                ? `${formatUsdso(d.oraclePrice)} (${d.oracleSources} sources) vs mark ${formatUsdso(d.end.markPrice)}`
                : ORACLE_NO_READING_LINE}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
