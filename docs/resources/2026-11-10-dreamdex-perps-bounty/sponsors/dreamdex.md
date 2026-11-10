# Sponsor: dreamDEX (perps on Somnia Tokyo / Hideki testnet)

**Primary sources, all fetched 2026-11-10:**
- dreamDEX docs at `https://app.testnet.dreamdex.io/docs/...`, server-rendered. Fetched in Chrome with in-page `fetch` + `DOMParser`, then read with `get_page_text`. Pages: `developers/perps-testnet`, `trading/perps-testnet` (+`/margin-and-liquidations`, `/funding`, `/orders`), `trading/common/link-a-bot`, `trading/common/fees`, `trading/spot/operators`, `developers`, `developers/dreambot` (+`/strategies`, `/dreamfly`, `/run-your-bot`), `developers/contracts` (+`/contract-addresses`, `/errors`), `developers/http-api` (+`/authentication`, `/market-data`, `/trading`, `/error-handling`), `developers/libraries/ccxt`, `welcome/quick-start`, `welcome/roadmap`, `support`.
- Bot kit at `https://github.com/somnia-chain/dreamdex-bot-kit`, read via `gh api`: README, `docs/perps.md`, `packages/perp-core/src/{index,operator,orders}.ts`, root `package.json`, issues and PRs.
- npm metadata for `@somnia-chain/markets-sdk` (`npm view`).
- Read-only RPC probes (`eth_chainId`, `eth_blockNumber`, `eth_getCode`) against Hideki.

Quotes are verbatim. Address tables are copied exactly. All addresses are on **testnet**.

---

## 1. What dreamDEX rewards (this event)

Real perps orders on Somnia Tokyo testnet, from a product with "clear user value, credible scope, a viral or repeat-use loop, technical execution". Also: evidence (tx hashes, repo, demo), accurate X posts, and use of Somnia primitives (Reactivity, Somnia Agents) as a plus. Separately, reproducible bug and docs reports. See `../event.md`.

Roadmap stance (`welcome/roadmap`): "agents-first by design". Builder-codes and fee-rebate program: "Apps that route flow get paid". Perps: "Six-stage liquidation waterfall. Same transparent ruleset… no discretionary intervention."

## 2. Integration model: which surface does perps?

| Surface | Perps? | Network | Notes |
|---|---|---|---|
| **`@somnia-chain/markets-sdk`** (TypeScript) | **YES, the documented path** | Hideki 50383 (`hidekiTestnet` chain) | Docs pin **0.32.1** ("the one the app runs"). The kit's perp-core uses `^0.31.0`. npm `latest` = **0.33.0** (published 2026-11-09). |
| Raw PerpPool contracts (`placeOrder`, `placeOrderFor`, batch/amend) | YES | Hideki 50383 | Signatures in §5 |
| dreamDEX bot kit `packages/perp-core` + `strategies/perp-*` | YES (wraps the SDK; `…For` writes via viem) | Hideki 50383 | §8 |
| dreamBot Builder (`app.testnet.dreamdex.io/dreambot-builder`) | YES (generates a `.env` for kit `perp-*` / DreamFly) | testnet only | §9 |
| DreamFly (`somnia-chain/dreamdex-dreamfly`, Python + Node) | YES (perps run is "testnet only") | | §9 |
| **dreamDEX HTTP API** (`stg.api.dreamdex.io/v0`) | **NO, spot only** | Shannon 50312 | SIWE auth; returns unsigned txs. Market list is SOMI/WBTC/WETH vs USDso |
| CCXT (`github:somnia-chain/ccxt#add-dreamdex-exchange`) | NO (spot examples; alpha, not on npm) | | |
| dreamDEX CLI (`go install github.com/somnia-chain/somnia-dex-cli/cmd/dreamdex@latest`) | Not documented for perps | | Spot quick start |
| Somnia CLI / MCP (`@somnia-chain/cli`) | Reads perps (`perp_markets`, `perp_account`); writes via the CLI | | See `somnia.md` §6 |

**The SDK has no perp `…For` writes** (bot kit `operator.ts`, verbatim): "The markets SDK has no perp `…For` writes, so the three calls are sent here with viem. Reads stay on the SDK, pointed at the owner's address."

## 3. Network (verbatim, `developers/perps-testnet`)

> Testnet perps run on the Hideki testnet chain, which the app shows as the DreamDEX region. Build against it with @somnia-chain/markets-sdk; this page uses version 0.32.1, the one the app runs.

| | |
|---|---|
| Chain ID | 50383 |
| RPC | https://api.hideki2.infra.testnet.somnia.network |
| WebSocket | wss://api.hideki2.infra.testnet.somnia.network/ws |
| Indexer (GraphQL) | https://hideki-dev.smk.somnia.host/v1/graphql |
| Explorer | explorer.testnet.somnia.network/tokyo |
| Gas coin | STT |

⚠️ **RPC hostname differs between sponsors.** dreamDEX says `api.hideki2.infra…`; Somnia docs say `https://api.hideki.infra.testnet.somnia.network/`. **Both answered `eth_chainId = 0xc4cf (50383)` on 2026-11-10.** Pick one, keep the other as a fallback, and get the WSS for the Somnia-docs host from `/blockchain/rpcs`. This is a possible Feedback (docs) item.

## 4. Contracts: Hideki testnet (verbatim table)

| Contract | Address |
|---|---|
| MarginBank | `0x478769E1177C0773c43A593DCCc4Ad15F15F1394` |
| Collateral (USDso) | `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72` |
| PerpPoolFactory | `0xE631fAEE547baeE07353E290f0562ea67d856560` |
| LiquidationEngine | `0xA66d3C24Ad4a389d863846905D8173e1017e9F4D` |
| InsuranceFund | `0x50826894D47C6D4f3BeA38BFDC7Dc5c5be171b80` |
| VoucherDistributor (paper USDso) | `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4` |
| OperatorPermissionsRegistry | `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a` |

Probe 2026-11-10: `eth_getCode` is non-empty for MarginBank (proxy-sized) and USDso.

> Read per-market addresses off the market row rather than hardcoding them: poolAddress, marginBank and stopRegistry are all on it. client.getPerpSystemConfig(marginBank) returns the MarginBank's collateral, factory, liquidation engine and insurance fund in one read, which is the check worth running before trusting any list.

Per-market PerpPool addresses are **not** published as a table. Read them at runtime (`listPerpMarkets()`).

Do not mix these up with the **spot / Shannon (50312)** addresses on `developers/contracts/contract-addresses`: there, USDso is `0x9c32F3827A1a99f0cf9B213de8b53eC3d57bb171` and the OperatorPermissionsRegistry is `0x15C7e8CE38F021c5b45d098AaD788f63090bF20A`. Those are **different tokens and registries** from the Hideki perps stack.

## 5. Entry points and signatures

### SDK connect, claim, size, place (verbatim, `developers/perps-testnet`)

```ts
import {
  SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  SomniaMarkets,
} from "@somnia-chain/markets-sdk"
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains"

const markets = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  privateKey: process.env.PRIVATE_KEY as `0x${string}`, // leave out for read-only
})

const perps = await markets.client.listPerpMarkets()
const btc = perps.find((m) => m.baseSymbol === "BTC")!
```

```ts
const account = markets.walletAddress!
const eligibility = await markets.client.getPerpVoucherEligibility(btc.marginBank, account)
if (eligibility.eligible) {
  await markets.trader.claimPerpVoucher({ marginBank: btc.marginBank })
}
```

```ts
import { parseUnits } from "viem"

const price = parseUnits("100000", btc.quoteDecimals)
const max = await markets.client.getMaxPerpOrderSize({
  pool: btc.poolAddress,
  marginBank: btc.marginBank,
  account,
  isBid: true,
  price,
})

const quantity = parseUnits("0.001", btc.baseDecimals)
if (!max.priceable) throw new Error("No live mark price to size against")
if (!max.placeable || quantity > max.maxQuantity) {
  throw new Error(`Order too large for this account: limited by ${max.limitedBy}`)
}
await markets.trader.placePerpOrder({ pool: btc.poolAddress, isBid: true, price, quantity })
```

### Raw operator call (verbatim)

```solidity
function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity,
uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder,
uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)
```

From the bot kit's `packages/perp-core/src/operator.ts` (the ABI it actually sends against PerpPools):

```
function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)
function cancelOrderFor(address owner, uint128 orderId)
function reduceOrderFor(address owner, uint128 orderId, uint256 newQuantityRemaining)
function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)
```

- Operator selectors: `placeOrderFor 0x80054449`, `cancelOrderFor 0xe37b444b`, `reduceOrderFor 0x364c2587`. The batch variants (`placeOrdersFor` etc.) reuse the same grants; `amendOrder(s)For` needs both the place and cancel grants (`trading/spot/operators`).
- Owner-side spot `placeOrder` (same shape without `owner`; documented for SpotPool, assumed identical on PerpPool): `placeOrder(bool,uint64,uint256,uint256,uint64,uint8,uint8,address,uint96)`. orderType: "0 = Normal (GTC), 1 = Fill-or-Kill, 2 = IOC, 3 = PostOnly". selfMatchingOption: "0 = cancel taker on self-match, 1 = cancel maker".
- The kit uses expiry "fifty years out, in nanoseconds", `ORDER_GAS = 10_000_000n`, userData `0`, builder `0x0`.
- `getOrderBookParameters()` on the pool "returns the raw tickSize, minQuantity and lotSize, in that order."

### SDK perp surface (method names found in Somnia's `typescript/perps.md`; full list in `somnia.md` §4)

The core calls are `trader.placePerpOrder`, `trader.depositMargin`, `trader.amendOrders`, `trader.claimPerpVoucher`, `trader.buildPlacePerpStopOrder`, `trader.setPerpIsolated`, `client.listPerpMarkets`, `client.getMaxPerpOrderSize`, `client.previewPerpOrderMargin`, `client.getPerpPosition`, `client.getMarginAccount`, `client.getAccountHealth`, `client.getLiquidationPrice`, `client.previewPerpClosePnl`, `client.quotePerpClose`, `client.getPerpState`, `client.getPerpFeedStatus`, `client.listPerpPositions`, `client.getFundingPayments`, `client.listFundingRateHistory`, `client.listLiquidations`, `client.watchPerpMarkets`, `client.listPerpOrderRejections` (named in the dreamDEX docs), `exchange.fetchPositions`, `exchange.fetchFundingRate`, `exchange.createOrder`.

## 6. Order / margin / funding flow (trader docs, verbatim highlights)

**Get started (`trading/perps-testnet`):**
> Sign in at app.testnet.dreamdex.io. On testnet your wallets live in DreamDEX, the region the perp markets are in.
> Get paper USDso. Join Perps Arena, the paper-trading competition, to receive 1,000 paper USDso to trade with.
> Move margin into Perps if you hold USDso in your spot wallet: open Perps ⇆ Spot on the perps page… Perp orders only use margin that is already in the Perps account.

**Costs (verbatim):** Maker fee 0 · Taker fee 0 · Funding "Paid between longs and shorts every hour, never to the protocol" · Liquidation fee "Up to 1% of the notional closed, only if you are liquidated" · TP and SL "0.15 STT held per pending TP or SL, refunded when you cancel it".

**Markets (verbatim; "These figures are read from the live markets and can be retuned at any time"):**

| Market | Max lev | IM / MM | Tick | Min size | OI cap | Paper USDso |
|---|---|---|---|---|---|---|
| BTC-PERP | 20x | 5% / 2.5% | 0.1 | 0.00013 BTC | 246.81545 BTC | Yes |
| ETH-PERP | 20x | 5% / 2.5% | 0.01 | 0.004 ETH | 3,995.6125 ETH | Yes |
| HYPE-PERP | 20x | 5% / 2.5% | 0.01 | 0.12 HYPE | 23,812.72 HYPE | Yes |
| SOL-PERP | 20x | 5% / 2.5% | 0.01 | 0.1 SOL | 47,654.44 SOL | Yes |
| XRP-PERP | 20x | 5% / 2.5% | 0.0001 | 6.9 XRP | 344,632 XRP | Yes |
| ADA-PERP | 10x | 10% / 5% | 0.0001 | 46 ADA | 2,254,678 ADA | Yes |
| AVAX-PERP | 10x | 10% / 5% | 0.001 | 1.4 AVAX | 66,672.2 AVAX | Yes |
| BNB-PERP | 10x | 10% / 5% | 0.001 | 0.014 BNB | 693.975 BNB | Yes |
| DOGE-PERP | 10x | 10% / 5% | 0.00001 | 120 DOGE | 5,613,590 DOGE | Yes |
| LINK-PERP | 10x | 10% / 5% | 0.001 | 0.9 LINK | 42,643.6 LINK | Yes |
| NEAR-PERP | 10x | 10% / 5% | 0.0001 | 5.1 NEAR | 250,410 NEAR | Yes |
| SUI-PERP | 10x | 10% / 5% | 0.0001 | 13 SUI | 635,009 SUI | Yes |
| XLM-PERP | 10x | 10% / 5% | 0.0001 | 54 XLM | 2,677,780 XLM | Yes |
| 1000PEPE-PERP | 5x | 20% / 10% | 0.0000001 | 2,700 1000PEPE | 130,285,600 1000PEPE | No |
| LIT-PERP | 5x | 20% / 10% | 0.0001 | 2.8 LIT | 138,896.6 LIT | No |
| PUMP-PERP | 5x | 20% / 10% | 0.000001 | 1,800 PUMP | 87,993,700 PUMP | No |
| TAO-PERP | 5x | 20% / 10% | 0.001 | 0.044 TAO | 2,185.491 TAO | Yes |
| VVV-PERP | 5x | 20% / 10% | 0.001 | 0.44 VVV | 21,786.14 VVV | No |
| WLD-PERP | 5x | 20% / 10% | 0.0001 | 26 WLD | 1,264,000 WLD | Yes |
| ZEC-PERP | 5x | 20% / 10% | 0.001 | 0.009 ZEC | 420 ZEC | No |
| ZRO-PERP | 5x | 20% / 10% | 0.0001 | 5.1 ZRO | 250,599.5 ZRO | No |

(The source table renders without separators. The columns were split by the pattern; spot-check against `listPerpMarkets()` before relying on a single cell.) "A single account is capped at a tenth of it on most markets."

**Margin (`/margin-and-liquidations`):** thresholds are IM = 1/max-lev; MM = IM/2; close-out = MM/2 (20x: 5% / 2.5% / 1.25%). "Cross is the default." Isolated: "orders in any other market are rejected, reducing ones included. Choosing a margin mode in the app is coming soon." Liquidation: "Your open orders are cancelled first, then positions are closed on the order book one at a time…". Escalation: backstop bidder → Insurance Fund → ADL. "No backstop bidders are registered on testnet, so the later stages come in sooner."

**Funding (`/funding`, verbatim):** "Rate window 8 hours · Settlement Every hour". "Hourly payment = position size × index price × funding rate / 8". "Funding is applied to your position the next time it is touched, by a trade, a withdrawal or a liquidation, and everything owed since the last time is settled at once."

**Orders (`/orders`):** GTC (default on perps) / IOC / FOK / ALO; reduce-only; TP/SL are reduce-only. "On a limit order, TP/SL can be armed before it fills only with GTC or ALO". "Each pending TP or SL holds 0.15 STT from your wallet."

### Paper USDso (voucher) rules (verbatim, `/margin-and-liquidations`)

> It can't be withdrawn. Only USDso above the voucher balance can leave the Perps account.
> Only some markets. You can open or increase positions only in the markets marked Yes under Paper USDso in the market table. The six newest markets are not on that list.
> Your leverage setting can't be changed while it remains.
> Reducing and closing are never blocked, in any market.
> No builder fees are charged on the account.
> …A voucher can be taken back 14 days after it was granted, but only while the account has no positions and no resting orders: it never forces a position closed.

## 7. Link a Bot / trading-key model (`trading/common/link-a-bot`, verbatim highlights)

> You add the bot's address in the app, and from then on it can place, cancel and reduce orders for that wallet, and nothing else: it cannot withdraw or send, and every fill settles back to your wallet. The bot keeps its own key… the bot pays for its own orders with its own gas.

| Linked bot | |
|---|---|
| Place, cancel and reduce orders for the wallet | Yes |
| Withdraw, send or transfer the wallet's funds | No |
| Trade your other wallets | No, access is per wallet |
| Arm take-profit or stop-loss orders on the exchange | **No, only the wallet itself can** |

- Prerequisite: "A Somnia Account wallet. The Legacy Account can't link bots."
- "Perps access is granted market by market, so a perps market listed later needs the same bot added again."
- "Press Add bot. The app signs this change with its own key, so there is no wallet prompt."
- Consequence (kit `docs/perps.md`): "**Stop orders** can only be armed by the account itself. perp-starter therefore watches its take-profit and stop-loss and closes the position when the mark crosses one. That only works while the bot is running." "**Leverage** is your account's setting. The bot reads it and leaves it alone." "**Margin** is not pulled from your spot wallet automatically."
- Kit sizing: "Only an order its owner sends can pull, so a trading key never gets this" (`autoPull: false` for `placeOrderFor`).

Alternative: leave `OWNER_ADDRESS` blank and the bot trades its **own** key's perps account. Then it needs STT, USDso in its own MarginBank, and it **can** arm real stop orders (0.15 STT each).

## 8. Gotchas (verbatim from `developers/perps-testnet` unless noted). This is architect feasibility fuel.

1. **Decimals.** "price always has 18 decimals, because every market's collateral, USDso, does. quantity uses the base asset's own decimals". Base decimals: 6 → ADA, HYPE, PUMP, XRP · 7 → XLM · 8 → BTC, DOGE, ZEC · 9 → SOL, SUI, TAO · 18 → 1000PEPE, AVAX, BNB, ETH, LINK, LIT, VVV, WLD, ZRO · 24 → NEAR. "A wrong scale does not fail with an error that says so… placeOrderFor reverts with InsufficientCollateral() (0x3a23d825)."
2. **Gas.** "a simple resting order simulated with a 1.5M limit reverts while the same call with 3.2M succeeds. eth_estimateGas returned 3.2M for a resting order and 7.7M for an IOC that crossed several price levels… the bot kit sends every perp order with 10,000,000." "A transaction that runs out of gas or reverts lands with status 0 and no reason in the receipt. Replay it with eth_call at the parent block to see the revert."
3. **IOC no-fill reverts.** "An IOC order that finds nothing to fill reverts a single placeOrderFor with ImmediateOrCancelNoFill() (0xd48c4403). In a batch (placeOrdersFor) a refused request does not revert… its OrderRejected log carries reason 5". Price IOCs "through the book with some slippage room". The kit defaults to 20 bps.
4. "The SDK reads the chain over WebSocket. An environment that only proxies HTTP fails on the first chain read with genesis check failed."
5. "The perps collateral is not SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral. That entry is a different token. Read the perps collateral from the market row (quoteToken) or from getPerpSystemConfig."
6. "Paper USDso blocks some markets… getMaxPerpOrderSize reports it as limitedBy: "voucherBlocked"."
7. "An isolated account trades one market only. Orders anywhere else revert with IsolatedMarketBlocked, reducing ones included."
8. "Each account has a position cap per market… MaxPositionSizeExceeded() (0x714b36d6)".
9. "Stop orders carry 0.15 STT each, sent with the order and refunded on cancel. An account holding only USDso cannot place one."
10. Gas cost: "transactions to perp pools measured on testnet cost between 0.0003 and 0.003 STT each". The SDK also wants "0.6 STT at the defaults" of headroom for a write (Somnia `get-testnet-funds`).
11. Rejections now **revert** with a named error instead of returning `success=false` (`welcome/quick-start`): "success is now always true: if the call returned at all, the order was accepted." Fill evidence = `OrderFilled` logs. A resting order shows only `OrderPlaced`.
12. Kit (`orders.ts`): a POST_ONLY that would cross reverts `PostOnlyWouldCross`; `orderType` defaults to LIMIT, which **rests** ("A strategy that means to cross has to say `ORDER_TYPE.MARKET`").
13. Kit (`orders.ts`): "close all" must use `previewPerpClosePnl().closedQuantity` (lot-aligned down), or a remainder stays open.
14. Somnia `perps.md`: `fundingRate` is per **8h window**. Normalize with `fundingRate8h` / `fundingRate1h` / `annualizedFundingRate`, never a hardcoded denominator.

**Selected error selectors** (`developers/contracts/errors`; these are spot-pool tables, shared OrderBook core): `0xaf608abb InvalidPrice`, `0x4f174b29 InvalidQuantity`, `0xeaa68ceb QuantityBelowMinimum`, `0x3154078e OrderAlreadyExpired`, `0x6ffc9258 SelfMatchCancelTaker`, `0x7cf05fcb PostOnlyWouldCross`, `0xc04ad919 FillOrKillNotFillable`, `0xd48c4403 ImmediateOrCancelNoFill`, `0xf5e39c1f IncorrectSender`, `0x3fb0ba2e OnlyApprovedContracts` (operator not authorized), `0x528c953f BuilderFeeExceedsApproval`. Perps-only errors named in the perps docs: `InsufficientCollateral 0x3a23d825`, `MaxPositionSizeExceeded 0x714b36d6`, `IsolatedMarketBlocked`, `AmendReplacementRejected`, `OrderPriceOutsideBand`, `PriorFundingPayerOutstanding`. **There is no dedicated perps error table.** That is a gap and a possible Feedback item.

## 9. Bot kit: `somnia-chain/dreamdex-bot-kit`

- MIT, ★13, 15 forks, pushed 2026-10-29. Node ≥20 npm workspaces (`packages/*`, `strategies/*`, `advanced/*`).
- **Perps pieces:** `packages/perp-core` (config, exchange, funding, margin, markets, operator, orders, stops; vitest tests), `scripts/perp-doctor.ts` (`npm run perp:doctor`, read-only), and `strategies/perp-starter`, `perp-maker`, `perp-funding`, `perp-guard` (added in PR #50, 2026-10-07: "Add the perp-* strategies, running on Hideki with app trading keys").
- perp-core exports (verbatim names): `createExchange, tradingKeyCheck, linkCoverage, shutdown, assertTxOk, createTradingKey, linkStatus, linkProblem, placeFor, cancelFor, reduceFor, loadConfig, perpMarkets, requireMarket, toRaw, fromRaw, alignPrice, alignQuantity, sizeForNotional, markOf, markAgeSec, liveMark, preflight, marginSnapshot, healthRatio, marginForNotional, ensureLeverage, sizeOrder, placePerp, cancelQuietly, positionIn, closePosition, armBracket, cancelStops, pendingStops, somiPerStop, fundingApr, fundingSide, liveFunding`.
- Perp env contract (`docs/perps.md`, verbatim):
  ```bash
  NETWORK=hideki
  PRIVATE_KEY=0x...
  OWNER_ADDRESS=0x...
  STRATEGY=perp-starter
  PERP_SYMBOL=ETH-PERP
  PERP_NOTIONAL_USDSO=20
  DRY_RUN=true
  ```
  "`STRATEGY` is only read on Railway; locally, run `npm start -w perp-starter`." The builder/run-your-bot docs say `npm run dev -w <strategy>`. The two commands are inconsistent, so check the strategy's package.json.
- Spot strategies: starter, market-making, grid, momentum, mean-reversion, twap, ensemble (+LLM), treasury, yield-optimizer. Event-contract: ec-starter, ec-maker, ec-passive, ec-laddering-bot, ec-oracle-follow, ec-settlement. Plus `packages/backtest`, `tools/edge-analytics`, `advanced/batch-7702` (EIP-7702 batching), `skills/` (agent skills `somnia`, `dreamdex-bot`), `examples/01–08` (sanitized competition bots, mostly spot, many using the removed `placeTakerOrderWithoutVault`).
- **Open issues (20 open, 2 closed, 2026-11-10).** Perps-relevant or worth knowing:
  - #54 (2026-11-02) whitelist request for this bounty (people use the repo as a support channel).
  - #45 [Security] unauthenticated GraphQL resource exhaustion on production endpoints.
  - #41–#26 (2026-09-06, one author): Event Contracts and binary-pool defects, plus chain-wide items: **#37 "The RPC rejects EIP-1898 block objects, so Foundry cannot fork Shannon"**, **#36 explorer verifier advertises `osaka` and cannot verify an osaka build**, **#34 "No on-chain read reports that a reactivity callback fired and failed, and the gas floor is undocumented"**, **#28 "Reactivity `subscribe` reverts with empty data for two unrelated reasons"**, #35 `Schedule` topic carries the fired ms, #31 indexer "RegistryMarkets failed: fetch failed" intermittently.
  - #23 "Add the perp-* strategies" (done by PR #50 but still open).
  - #7 session-key mode: `Pool.walletBase()/vaultBase()/openOrderIds()` read the signer, not the owner (spot core).
  - Open PRs: #51/#44 dependabot bumps, #48 "docs: add Chain.Love Somnia toolbox".
  - **Feedback-track implication:** these already-reported items are **duplicates**. Do not resubmit them.

## 10. dreamBot Builder + DreamFly (`developers/dreambot*`)

- Five steps: Connect wallet → Strategy → Network (Testnet/Mainnet × Dry-run/Live) → Tune → Deploy (copy `.env`; Railway one-click or local). "The builder never sees your key." "dreamDEX doesn't host, run or monitor your bot." "Every new bot starts on testnet in dry-run. A Perps bot has a single choice, the testnet".
- **Perps strategies offered (verbatim):** Perp Starter "Opens one leveraged position and closes it at a take-profit or a stop-loss" · Perp Market Maker "Rests a bid and an ask around the mark price, leaning them back towards flat" · Funding Carry "Holds whichever side funding pays, and steps aside when it stops paying" · Perp Risk Guard "Not a trader: reduces a position before liquidation reaches it, and closes it if it gets closer still".
- DreamFly: a fruit-fly mushroom-body model "picks which strategy to run on each market, or to sit out". Perps run = "Maker, trend, funding carry, or sit out". It has a dashboard (port 8765, password required), and its perps run is testnet only via a linked bot key. Repo `somnia-chain/dreamdex-dreamfly` (pushed 2026-10-30).
- The dreamBot Builder app page itself (`/dreambot-builder`) was **not rendered** because it needs a wallet sign-in. Its behaviour is documented above from the docs.

## 11. Reliability guidance (`developers`, verbatim highlights)

"roughly 1 request/second per endpoint for market data is plenty" · "Treat timeouts, 5xx, rpc_unavailable, and connection errors as retryable; treat 4xx validation errors as terminal" · "exponential backoff with jitter - e.g. base 500 ms, doubling, capped at ~30 s" · "For submitted transactions, retry idempotently: re-query the receipt before re-broadcasting" · "The public feed carries market-wide data only - it does not attribute fills to your account."

## 12. Support and security

- Support only happens inside a Discord ticket; "nobody from dreamDEX will DM you first."
- Security reports go to security@dreamdex.io (bounty page).

## 13. Gaps (dreamDEX)

- **Perps Arena rules page:** none found in the docs index. The "paper USDso every week" claim cannot be reconciled with the one-claim voucher (see `../event.md` §6).
- No published per-market PerpPool address table (runtime read only).
- No perps-specific errors page, no perps HTTP/WS API, no perps CCXT.
- The bot-kit docs disagree on `npm start` vs `npm run dev -w <strategy>`.
- The dreamBot Builder UI and the Perps Arena UI need sign-in and were not rendered.
- WebSocket API page (`developers/websocket-api`) not fetched. It is spot-only per the HTTP API base-URL table.
