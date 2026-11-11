import { useState } from "react";
import { quantityForLeverage } from "@basanos/core";

const BOOK = { tickSize: 10n ** 17n, minQuantity: 13_000n, lotSize: 1_000n };

export function Ticket(props: { equity: bigint; mark: bigint; busy: boolean; onOrder: (isBid: boolean, quantity: bigint) => void }) {
  const [leverage, setLeverage] = useState(12);
  const qty = props.mark > 0n ? quantityForLeverage(props.equity, leverage, props.mark, 8, BOOK) : 0n;
  return (
    <section className="panel" aria-labelledby="ticket-h">
      <h2 id="ticket-h" className="label">
        BTC-PERP ticket (market, IOC)
      </h2>
      <div className="field">
        <label htmlFor="lev">Leverage (x equity)</label>
        <input id="lev" type="number" min={1} max={15} value={leverage} onChange={(e) => setLeverage(Number(e.target.value))} />
      </div>
      <p className="label">Size: {(Number(qty) / 1e8).toFixed(5)} BTC</p>
      <div className="btn-row">
        <button type="button" className="btn btn--primary" disabled={props.busy || qty === 0n} onClick={() => props.onOrder(true, qty)}>
          Buy / long
        </button>
        <button type="button" className="btn btn--secondary" disabled={props.busy || qty === 0n} onClick={() => props.onOrder(false, qty)}>
          Sell / short
        </button>
      </div>
    </section>
  );
}
