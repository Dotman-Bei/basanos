# Perps docs list 21 markets and BTC at 20x (5% IM); the live Hideki pool list has more markets and BTC at 2.5% IM
Severity: normal
Area: docs

## Steps to reproduce
1. Open the dreamDEX trader docs page `trading/perps-testnet` and read the markets table (21 rows; BTC-PERP "20x, 5% / 2.5%").
2. Run `client.listPerpMarkets()` with `@somnia-chain/markets-sdk@0.33.0` against Hideki and count the rows; read BTC's `initialMarginBps`.

## Expected
The documented market list and margin parameters match the live markets, or the page says which subset it shows.

## Actual
The live list and BTC's initial margin differ from the table (see Evidence). The Somnia SDK perps page still says only BTC and ETH perps are live.

## Evidence
Step 2, run on 2026-11-11 (about 14:00 UTC):

```
$ node --input-type=module -e "import { SomniaMarkets } from '@somnia-chain/markets-sdk'; import { hidekiTestnet } from '@somnia-chain/markets-sdk/chains'; const m = new SomniaMarkets({ chain: hidekiTestnet, indexerUrl: 'https://hideki-dev.smk.somnia.host/v1/graphql' }); const p = await m.client.listPerpMarkets(); const b = p.find((x) => x.baseSymbol === 'BTC'); console.log(JSON.stringify({ count: p.length, btcInitialMarginBps: b?.initialMarginBps })); process.exit(0)"
{"count":40,"btcInitialMarginBps":250}
```

Step 1, from the server-rendered page `https://app.testnet.dreamdex.io/docs/trading/perps-testnet` fetched the same day (table rows containing `-PERP`, then the same symbols compared with the live list):

```
table rows with *-PERP: 21
|BTC-PERP|20x|5% / 2.5%|0.1|0.00013 BTC|246.81545 BTC|Yes|
|ETH-PERP|20x|5% / 2.5%|0.01|0.004 ETH|3,995.6125 ETH|Yes|
listPerpMarkets(): 40 markets
live symbols not in docs table: LOADTEST LOADTEST LOADTEST LOADTEST LOADTEST WTI XAG XAU GOOGL TSLA HYNX MSTR MRVL LITE INTC HOOD COIN AMD ADLT
docs symbols not in live list: (none)
matching initial margin: 9, mismatching: 12
BTC: docs 5% (500 bps), live 250 bps
ETH: docs 5% (500 bps), live 250 bps
HYPE: docs 5% (500 bps), live 250 bps
SOL: docs 5% (500 bps), live 250 bps
1000PEPE: docs 20% (2000 bps), live 1000 bps
LIT: docs 20% (2000 bps), live 1000 bps
PUMP: docs 20% (2000 bps), live 1000 bps
TAO: docs 20% (2000 bps), live 1000 bps
VVV: docs 20% (2000 bps), live 1000 bps
WLD: docs 20% (2000 bps), live 1000 bps
ZEC: docs 20% (2000 bps), live 1000 bps
ZRO: docs 20% (2000 bps), live 1000 bps
```

The page's own caption reads "These figures are read from the live markets and can be retuned at any time". The SDK page is `docs/PERPS.md` in `@somnia-chain/markets-sdk@0.33.0`, line 3: "Perps are live on testnet: `BTC/USDso:USDso` and `ETH/USDso:USDso`, backed by …".

## Environment
SDK version 0.33.0, network Somnia Tokyo testnet (Hideki, chain 50383), wallet address: read-only (no wallet needed)
