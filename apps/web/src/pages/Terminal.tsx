import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { BTC_POOL, CANCEL_ORDER_FOR_SELECTOR, ORDER_TYPE_IOC, PLACE_ORDER_FOR_SELECTOR, VOUCHER_DISTRIBUTOR, explorerTx, perpPoolAbi } from "@basanos/core";
import { readBookLevels } from "@basanos/core/book";
import { DEMO_LEVERAGE_X } from "@basanos/core/demo-math";
import { initRunState } from "@basanos/core/evaluate";
import { claimVoucherCall, grantRefereeCall, placeOrderCall, startRunCall, voucherAbi } from "../chain/calls";
import { browserClient, sendCall } from "../chain/client";
import { RailsChart } from "../components/RailsChart";
import { StartFlow } from "../components/StartFlow";
import { Ticket } from "../components/Ticket";
import { WalletPanel } from "../components/WalletPanel";
import { REFEREE, REGISTRY } from "../config";
import { useBookAt } from "../hooks/useBook";
import { useAccountSnapshot, useActiveRun } from "../hooks/useChain";
import { formatUsdso, shortHash } from "../lib/format";
import { judgedNow, ticketOrder } from "../lib/order";
import { computeRails } from "../lib/rails";
import { rulebookById } from "../lib/rulebooks";
import { routeHref } from "../routes";
import { addressOf, loadKey } from "../wallet/challengeWallet";

const FAUCET = "https://explorer.testnet.somnia.network/tokyo/faucet";

export function Terminal() {
  const registry = REGISTRY;
  const referee = REFEREE;
  const [key, setKey] = useState<Hex | null>(() => loadKey(window.sessionStorage));
  const address: Address | null = key ? addressOf(key) : null;
  const snap = useAccountSnapshot(address);
  const active = useActiveRun(address);
  const [claimed, setClaimed] = useState(false);
  const [granted, setGranted] = useState(false);
  const [stt, setStt] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ label: string; hash: Hex; status: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<bigint[]>([]);
  const acct = snap?.accounts[0];
  const levels = useBookAt(snap?.blockNumber);
  // The referee judges closeable equity (spec §5): the position valued at the book prices that would close it now.
  const judged = snap ? judgedNow(acct, snap.markPrice, levels) : null;

  useEffect(() => {
    if (!address || !referee) return;
    const c = browserClient();
    void Promise.all([
      c.readContract({ address: VOUCHER_DISTRIBUTOR, abi: voucherAbi, functionName: "isClaimed", args: [address] }),
      c.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [address, referee, PLACE_ORDER_FOR_SELECTOR] }),
      c.readContract({ address: BTC_POOL, abi: perpPoolAbi, functionName: "isOperatorAuthorized", args: [address, referee, CANCEL_ORDER_FOR_SELECTOR] }),
      c.getBalance({ address }),
    ])
      .then(([cl, p, x, bal]) => {
        setClaimed(cl);
        setGranted(p && x);
        setStt(bal);
      })
      .catch(() => undefined);
  }, [address, referee, log.length]);

  useEffect(() => {
    if (judged !== null && active) setPoints((ps) => [...ps.slice(-299), judged]);
  }, [judged, active]);

  const run = async (label: string, fn: () => Promise<{ hash: Hex; status: string }>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      setLog((l) => [{ label, ...r }, ...l]);
    } catch (e) {
      setError((e as Error).message.slice(0, 240));
    } finally {
      setBusy(false);
    }
  };

  const rb = active ? rulebookById(active.run.rulebookId) : null;
  const rails =
    active && rb
      ? computeRails(rb, { ...initRunState(active.run.startTime, active.run.start.equity), hwm: points.reduce((m, p) => (p > m ? p : m), active.run.start.equity) })
      : null;

  return (
    <div className="wrap">
      <h1 className="figure">Challenge terminal</h1>
      {!registry || !referee ? <p className="error">This build has no registry or referee address set.</p> : null}
      <div className="app-grid">
        <div className="app-col-4">
          <WalletPanel store={window.sessionStorage} onChange={setKey} />
          {key && registry && referee && address ? (
            <StartFlow
              claimed={claimed}
              granted={granted}
              running={active !== null}
              busy={busy}
              onClaim={() => void run("claim paper USDso", () => sendCall(key, claimVoucherCall()))}
              onGrant={() => void run("grant the referee", () => sendCall(key, grantRefereeCall(referee)))}
              onStart={(id) => void run("start the run", () => sendCall(key, startRunCall(registry, address, id)))}
            />
          ) : null}
          {key && active && snap && acct ? (
            <Ticket
              equity={acct.totalEquity}
              mark={snap.markPrice}
              defaultLeverage={DEMO_LEVERAGE_X}
              busy={busy}
              onOrder={(isBid, qty) =>
                void run(isBid ? "buy / long" : "sell / short", async () => {
                  const plan = ticketOrder(isBid, qty, await readBookLevels(browserClient(), BTC_POOL));
                  return sendCall(key, placeOrderCall(isBid, plan.price, plan.quantity, ORDER_TYPE_IOC));
                })
              }
            />
          ) : null}
        </div>
        <div className="app-col-8">
          <section className="panel" aria-labelledby="status-h">
            <h2 id="status-h" className="label">
              Account
            </h2>
            <dl className="kv">
              <dt>Closeable equity (what the referee judges)</dt>
              <dd className="figure">{judged !== null ? `${formatUsdso(judged)} USDso` : "—"}</dd>
              <dt>Equity at the mark</dt>
              <dd>{acct?.equityOk ? `${formatUsdso(acct.totalEquity)} USDso` : "—"}</dd>
              <dt>STT for gas</dt>
              <dd>
                {stt === null ? "—" : `${formatUsdso(stt)} STT`}{" "}
                <a className="link" href={FAUCET} target="_blank" rel="noreferrer">
                  Tokyo faucet
                </a>
              </dd>
              <dt>Paper USDso voucher</dt>
              <dd>{address ? (claimed ? "claimed" : "not claimed (one claim per address)") : "—"}</dd>
              <dt>Run</dt>
              <dd>
                {active ? (
                  <a className="link" href={routeHref({ name: "run", runId: active.runId })}>
                    Run {active.runId.toString()} on {rb?.label ?? "an unknown rulebook"}
                  </a>
                ) : (
                  "No active run"
                )}
              </dd>
            </dl>
          </section>
          {rails ? <RailsChart rails={rails} points={points} /> : null}
          <section className="panel" aria-labelledby="log-h">
            <h2 id="log-h" className="label">
              Transactions
            </h2>
            {error ? (
              <p role="alert" className="error">
                {error}
              </p>
            ) : null}
            <ul className="log">
              {log.map((t) => (
                <li key={t.hash}>
                  {t.label}: {t.status}{" "}
                  <a className="link mono" href={explorerTx(t.hash)} target="_blank" rel="noreferrer">
                    {shortHash(t.hash)}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
