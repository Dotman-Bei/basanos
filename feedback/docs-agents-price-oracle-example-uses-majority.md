# The "Invoking from Solidity" examples ask for prices through the 4-argument createRequest (Majority consensus), which the Price Oracle's answers rarely satisfy
Severity: normal
Area: docs

## Steps to reproduce
1. Open https://docs.somnia.network/agents/somnia-agents/invoking-agents/from-solidity (read on 2026-11-12).
   - Its multiple-callbacks example requests a price through the 4-argument form, with an agent id it names `PRICE_AGENT_ID` but does not define on the page: `platform.createRequest{value: msg.value}(PRICE_AGENT_ID, address(this), this.handlePriceResponse.selector, payload)`.
   - Its basic example, a contract named `PriceOracle`, does the same with JSON API Request.
   - The callbacks decode a single "consensus value". The page's own comment reads "With Majority consensus, at least `threshold` successful responses share one result".
2. Open https://docs.somnia.network/agents/somnia-agents/invoking-agents/custom-consensus.
   - It says Majority is the default and needs byte-identical results, and that Majority breaks down when validators are expected to return different values.
   - For price feeds it recommends Threshold consensus (`createAdvancedRequest`).
3. Open https://docs.somnia.network/agents/somnia-agents/base-agents/price-oracle.
   - `getPrices` returns, per validator, `prices`, `numSources` and `lastUpdated` (unix milliseconds).
   - The page says different validators can return slightly different prices, and recommends Threshold consensus with aggregation in the callback.
4. Check what this does on Somnia Tokyo testnet (Hideki, chain 50383). This is read-only; no wallet is needed. For each request id below:
   - Find its `RequestFinalized` log on SomniaAgents `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3` with `eth_getLogs`: topic0 `0x65db1ef5b3bcd84fe4fb8dbbe1cadc9fe6643bb261ab2e01d65c281c3d466af2`, topic1 the request id as a 32-byte word.
   - Trace that transaction with `debug_traceTransaction` and the `callTracer`.
   - Decode the callback's input as `(uint256 requestId, Response[] responses, uint8 status, Request details)`, and each response's `result` as `getPrices`' return.

## Expected
Either of these:
- The invoking examples that request prices use `createAdvancedRequest` with `ConsensusType.Threshold`, as the Price Oracle and Custom consensus pages advise.
- Or the 4-argument `createRequest` is documented next to those examples as Majority-only, with a warning that Price Oracle answers are rarely byte-identical.

## Actual
The examples teach the 4-argument form for prices. On Tokyo testnet, 3 of our 4 such requests for `BTC/USDC:PERP` finalized **Failed** (status 3), although all three validators answered Success each time. Their answers differ in the source count and the millisecond timestamp, and sometimes in the price.

## Evidence
Decoded on 2026-11-12 with the steps above (prices at 18 decimals, as requested):

| request | finalize tx (block) | the three Success answers | status |
|---|---|---|---|
| 7773100 (two symbols) | `0x851aaa04f95533ccabd87e11e3398b09eb85dfe9d709f393223126a3c9582301` (47,437,498) | `BTC/USDC:PERP` identical: 73,976.65, 7 sources, `lastUpdated` 1794397884091. `BTC/USDC` differs: 74,010.77 (6 sources, …077) / 74,008.55 (7, …059) / 74,011.48 (6, …006) | Failed |
| 7968086 | `0xd3065e2692bf98f5950a84aff335ea016f8053a444c643d95d6471814b5fa74a` (48,411,974) | 71,300.85 (7 sources, …760) / 71,297.35 (6, …755) / 71,307.85 (6, …760) | Failed |
| 7968013 | `0xe4d6459267bcd394d782cd7e9cf0449293a7e915c4ca586e8239cb23f2f53c26` (48,411,613) | the same price, 71,414.35, from all three, but 6 / 7 / 7 sources and `lastUpdated` …965 / …967 / …974 | Failed |

- **The only success:** request 7782661 (one symbol, 2026-11-11), where two of three validators happened to answer byte-identically (about 73,735.85, 6 sources).
- **Consensus and threshold:** each callback's `details` shows `consensusType` 0 (Majority) and `threshold` 2.
- **For comparison:** dreamDEX's PriceFeedScheduler, on the same chain, uses `createAdvancedRequest` with Threshold consensus (3 validators, threshold 2, 30 s), and its requests succeed every 5 blocks.
- **Our own part:** we copied the 4-argument pattern into our verdict registry. A verdict never depends on the oracle, so our verdict pages say when no reading was recorded.

## Environment
SDK version: not involved (direct contract calls); network: Somnia Tokyo testnet (Hideki, chain 50383), SomniaAgents `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3`, Price Oracle agent id `9911223344556677889`; wallet address: read-only (no wallet needed)
