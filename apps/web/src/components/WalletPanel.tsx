import { useState } from "react";
import type { Hex } from "viem";
import { addressOf, createKey, forgetKey, importKey, loadKey, type KeyStore } from "../wallet/challengeWallet";

export function WalletPanel(props: { store: KeyStore; onChange: (key: Hex | null) => void }) {
  const [key, setKey] = useState<Hex | null>(() => loadKey(props.store));
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const set = (k: Hex | null) => {
    setKey(k);
    props.onChange(k);
  };
  return (
    <section className="panel" aria-labelledby="wallet-h">
      <h2 id="wallet-h" className="label">
        Testnet challenge wallet
      </h2>
      {key ? (
        <>
          <p className="mono">{addressOf(key)}</p>
          <p className="label">Held only in this browser tab. Fund it with 1 STT from the Tokyo faucet.</p>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={() => setShown(!shown)}>
              {shown ? "Hide key" : "Export key"}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                forgetKey(props.store);
                set(null);
              }}
            >
              Forget wallet
            </button>
          </div>
          {shown ? <p className="mono">{key}</p> : null}
        </>
      ) : (
        <>
          <div className="btn-row">
            <button type="button" className="btn btn--secondary" onClick={() => set(createKey(props.store))}>
              Create wallet
            </button>
          </div>
          <div className="field">
            <label htmlFor="paste-key">Paste a burner key</label>
            <input id="paste-key" type="password" autoComplete="off" value={paste} onChange={(e) => setPaste(e.target.value)} />
          </div>
          <div className="btn-row">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                try {
                  set(importKey(props.store, paste));
                  setPaste("");
                  setError(null);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Import
            </button>
          </div>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
