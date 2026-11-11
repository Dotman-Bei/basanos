# somnia_watch notifications carry no block number or transaction hash, and the docs do not say so
Severity: normal
Area: docs

## Steps to reproduce
1. Open a WebSocket to `wss://api.hideki.infra.testnet.somnia.network/ws`.
2. Send `eth_subscribe` with `["somnia_watch", { "address": "0x478769E1177C0773c43A593DCCc4Ad15F15F1394", "eth_calls": [{ "to": "0xcA11bde05977b3631167028862bE2a173976CA11", "data": "0x42cbb15c" }] }]`.
3. Read the keys of `params.result` in the pushes.

## Expected
Each push identifies the block (and ideally the transaction) of the matched log, like `eth_subscribe("logs")` notifications, or the reactivity docs state that it does not and recommend attaching `Multicall3.getBlockNumber()`.

## Actual
The push holds only `address`, `topics`, `data` and `simulationResults`; a consumer must attach a block-number `eth_call` to place the event, and must look up the transaction with `eth_getLogs` afterwards.

## Evidence
Re-run of steps 1 to 3 on 2026-11-11 (about 14:00 UTC), raw socket, one push printed as received:

```
subscribe -> {"jsonrpc":"2.0","id":1,"result":"0xb767b8"}
push params.result:
{"address":"0x478769e1177c0773c43a593dccc4ad15f15f1394","topics":["0x5c87c81b4945a78d177e7c3dfbc9a6eaa971757d39f3b93c514446b47b5a2e1a","0x000000000000000000000000af327764345c2f54c1f2bc3322d28e4f633793b9","0x00000000000000000000000074b05b9b8c8f180b53b7891018f3b254b3e658c9"],"data":"0x000000000000000000000000000000000000000000000002b4b4fe23daab0000","simulationResults":["0x0000000000000000000000000000000000000000000000000000000002d50ea6"]}
keys: address,topics,data,simulationResults
block from simulationResults[0]: 47517350
```

An earlier push run, also with no block number in the push (3 pushes printed, 2026-11-11 about 13:57 UTC): the Multicall3 result was `0x…02d4ff05` (block 47513349) for two different logs, then `0x…02d4ff06` (block 47513350). No push in either run had a `blockNumber`, `blockHash`, `transactionHash` or `logIndex` key.

Block numbers decoded from the attached snapshot call in `docs/evidence/g1b-watch.json` (our 30-second spike run, 2026-11-11T02:06:51Z; 117 price pushes and 1,168 account pushes; `equityDecoded: true`; `firstSnapshot` keys `blockNumber,timestamp,pool,markOk,markPrice,accounts`; first 8 of the 50 recorded):

```
47086887, 47086888, 47086894, 47086894, 47086892, 47086893, 47086897, 47086894
```

Those numbers come from the attached `eth_call`, because the push holds nothing to read them from. The SDK's `docs/REACTIVITY.md` (0.33.0) lists the payload as `{ address, topics, data, simulationResults }` and does not say that the block and tx hash are absent.

## Environment
SDK version 0.33.0 (raw JSON-RPC), network Somnia Tokyo testnet (Hideki, chain 50383), wallet address: read-only (no wallet needed)
