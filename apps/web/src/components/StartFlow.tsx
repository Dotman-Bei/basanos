import { useState } from "react";
import type { Hex } from "viem";
import { rulebookId } from "@basanos/core";
import { RULEBOOKS } from "../lib/rulebooks";

export function StartFlow(props: {
  claimed: boolean;
  granted: boolean;
  running: boolean;
  busy: boolean;
  onClaim: () => void;
  onGrant: () => void;
  onStart: (rulebookId: Hex) => void;
}) {
  const [choice, setChoice] = useState(1);
  const rb = RULEBOOKS[choice] ?? RULEBOOKS[0];
  if (props.running) return null;
  return (
    <section className="panel" aria-labelledby="start-h">
      <h2 id="start-h" className="label">
        Start a challenge
      </h2>
      <ol className="log">
        <li>1. Paper USDso: {props.claimed ? "claimed" : "not claimed yet (one claim per address)"}</li>
        <li>2. Referee grant (place and cancel on BTC-PERP only, never withdraw): {props.granted ? "granted" : "not granted"}</li>
        <li>3. Enroll: the registry reads your start equity itself</li>
      </ol>
      {!props.claimed ? (
        <button type="button" className="btn btn--primary" disabled={props.busy} onClick={props.onClaim}>
          Claim paper USDso
        </button>
      ) : !props.granted ? (
        <button type="button" className="btn btn--primary" disabled={props.busy} onClick={props.onGrant}>
          Grant the referee
        </button>
      ) : (
        <>
          <div className="field">
            <label htmlFor="rulebook">Rulebook</label>
            <select id="rulebook" value={choice} onChange={(e) => setChoice(Number(e.target.value))}>
              {RULEBOOKS.map((r, i) => (
                <option key={r.label} value={i}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn--primary" disabled={props.busy || !rb} onClick={() => rb && props.onStart(rulebookId(rb))}>
            Start the run
          </button>
        </>
      )}
    </section>
  );
}
