# Idea Forge Brief — Verdict: on-chain prop challenges for dreamDEX perps

> Working title "Verdict" is provisional; the builder may rename it. This brief is the single source of
> truth handed to the architect (Step 1). It is a brief, not a spec: it fixes *what* and *why*, not *how*.

## Event + constraints

- **Date written:** 2026-11-10 (WAT = UTC+1). Idea-forge seat: `claude-opus-5-5`, tier `top`, effort
  `max` (effort is user-attested).
- **Hackathon:** dreamDEX Perps Builder Bounty (Somnia × dreamDEX, DoraHacks hackathon 2443):
  https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail (tracks: …/tracks). Source of truth for
  every event fact: the committed pack `docs/resources/2026-11-10-dreamdex-perps-bounty/` and the
  tollgate `docs/tollgate/2026-11-10-tollgate.md`.
- **Hard deadline (an inert calendar fact; idea-forge did not gate on it):** 2026-11-15 14:30 UTC =
  15:30 WAT (DoraHacks API `timeline_end`, `is_extended: true`; user-confirmed). Internal hard stop:
  submitted by 2026-11-15 09:00 WAT.
- **Chain:** Somnia Tokyo testnet = Hideki, chain 50383. Perps go only through
  `@somnia-chain/markets-sdk` or raw PerpPool calls. The dreamDEX HTTP API, CCXT and CLI are spot-only
  on Shannon (50312).
- **Team:** the builder + an autonomous agent pool (architect → executor pool → reviewer).
- **Builder skills:** Solidity/EVM, TypeScript/React, Python/ML (assumed from past campaigns).
- **Risk posture:** `novel-wow`, inside the pack's buildability walls.
- **Target track:** MVP (3 × $500 from one pool). Category: **trader tools**, with **bots and agents**
  served by the same rulebook. The Feedback track is a by-product of build friction only.

## Problem

Prop-firm evaluations are the paid "prove you can trade" step most funded traders go through. They
already run on demo money, but they are judged on the firm's own servers. A trader can't check how a
breach was computed, a firm can't prove it judged fairly, and a pass is not a record anyone else can
verify. Bots have the same problem one level down: before anyone links a bot key to an account, there
is no standard way to show that the bot trades inside a rulebook. On dreamDEX, Perps Arena hands every
trader 1,000 paper USDso to compete with, but nothing turns a good run into a credential.

## Solution (one line)

Verdict runs prop-firm-style challenges on dreamDEX perps: a published rulebook, a referee key that
watches the account every block and flattens it on a breach (it can close, never withdraw), and an
on-chain verdict, with a certificate on a pass, that anyone can replay from chain state.

## Who it is for

- **Traders** who want a pass they can show. They take a challenge on a Perps Arena or burner account,
  trade it any way they like (the dreamDEX app, their own bot, the Verdict terminal), retry when they
  fail and level up when they pass.
- **Bot and AI-agent builders** who need to prove a bot trades inside the rules before anyone links its
  key. The referee does not care whether a human or a bot trades the account.
- **Prop desks, funds and DAOs** (after mainnet): publish a rulebook and fund the accounts that pass.
  Evaluations already run on paper money in the real world, so testnet is the natural home for them.
- **dreamDEX:** a reason for traders to come back, retry and trade more, and a showcase for linked
  keys, Reactivity and Somnia Agents.

## Must-have demo features (the minimum that makes the money shot land)

1. **The referee (TypeScript/Node).** It watches each challenge account with off-chain Reactivity
   (`somnia_watch` with MarginBank equity reads attached in the same block) and evaluates the
   published rulebook on every push: profit target, daily-loss floor, max-drawdown floor, max-exposure
   cap and minimum time. A deposit, a withdrawal or a revoked grant voids the run. On a breach it uses
   the operator grant the account gave it at the start (place / cancel / reduce, never withdraw) to
   cancel resting orders and close the position with real perps orders, each with a tx hash.
2. **The verdict registry (Solidity on Hideki).** It records each run: rulebook hash, start block and
   start equity, then the verdict (PASSED or FAILED, the rule, the block, the equity). A pass mints a
   non-transferable certificate. At verdict time the registry asks Somnia's **Price Oracle agent** on
   Tokyo testnet for the perp-composite median and stores it beside the verdict as an independent
   bad-tick check. The reading is appended by callback, and a verdict never waits on it. A verifier
   re-runs the block-pinned equity reads, so any verdict can be replayed.
3. **The challenge terminal and verdict pages (React).** Start a challenge (voucher claim, referee
   grant and first order in as few signatures as the SDK allows), trade with real orders, watch equity
   against the rule rails live, and share a verdict or certificate page with explorer links and an X
   card.

## Target sponsor track(s)

- **MVP track**, "Build a perps product worth using on Somnia Tokyo testnet": category **trader
  tools**, with **bots and agents** served by the same rulebook. The minimum bar is met in-product:
  the terminal and the referee both place real perps orders with tx hashes, and the README covers what
  it does, who it is for, how to run it, and the X posts.
- **The Somnia plus:** off-chain Reactivity (the referee's watch) and Somnia Agents (the Price Oracle on
  Tokyo testnet). Each one does a job in the product.
- **Feedback track:** a by-product only. Reproducible friction met while building is logged with the
  event's template.

## Judging criteria (published — MVP, unweighted)

Verbatim from the event page (pack `event.md` §4). **No numeric weights are published**, and none are
implied here.

> MVP potential: clear user value, credible scope, a viral or repeat-use loop, technical execution
> Evidence of building: live orders on Somnia Tokyo testnet, transaction hashes, repo and demo
> Communication: quality and accuracy of your X posts

From the same page (MVP requirements): "Using Somnia primitives such as Reactivity or Somnia Agents is
a plus."

## Why it wins

**The white space.** In the full public field (all 203 GitHub repos matching "dreamdex perps", read
2026-11-10), leagues (`Gideonjon/perps_league`), duels (`bayuapriansyah/dreamduel`, `PhiBao/perpduel`)
and arcade runs (`Saber1Y/dreamarena-perps`) rank players against each other, and the 20-plus guards
(perp-guard, seatbelt, halter, Hoax, Dreamcatcher and others) only protect a position. None of them
evaluates one account against a published rulebook, enforces a breach and certifies the pass. That is
the prop-firm evaluation. Targeted searches for prop firm, rulebook, challenge, certificate,
credential and licence found no such repo.

**The head-to-head.** Against the strongest referee-based entry, dreamduel (a live Reactivity referee
with knockouts, fouls and flow netting), Verdict wins on **clear user value**: an evaluation is a job
traders already pay prop firms for, and a pre-link check for bots, where a duel is a game. It also wins
on **technical execution**, because its referee enforces (a close order lands on the breach, where
dreamduel's referee "only reads the chain") and leaves a verdict anyone can replay at a pinned block,
cross-checked against Somnia's Price Oracle. It ties on the repeat-use loop: retries, levels and
shareable certificates against rematches and an Elo ladder.

## Demo money shot (~15 seconds)

Two accounts take the same tight "Tokyo Sprint" rulebook on BTC-PERP. A human goes long from the
terminal and a scripted bot goes short. The price ticks. The losing side crosses its loss floor, and
within seconds the referee cancels its orders and flattens it: **FAILED**, with the breach block and the
referee's close order as tx hashes. The winning side crosses the profit target: **PASSED**. The
certificate mints, the Price Oracle reading lands beside it, and the verdict page replays the equity at
the pinned block.

Whichever way the price moves, one account passes and one fails, so the shot always lands. If the
market sits still, the max-exposure rule trips a breach on demand.

## Out of scope (explicit)

- Real funding, payouts, challenge fees or any movement of money. Paper USDso only.
- On-chain Reactivity. It needs a 32 STT owner balance, which is treated as unbuildable; the referee
  runs on off-chain Reactivity.
- Linked-wallet sub-accounts and main funding. A main funds its children from its *wallet* USDso; the
  voucher is credited inside the MarginBank and can't be withdrawn; there is no public Hideki USDso
  mint; organizer-granted funds are excluded.
- Builder fees or any monetization ("No builder fees are charged on the account" while the voucher
  remains).
- Mainnet. Testnet only; the post-win $200 mainnet clause comes later.
- Copy-trading, "hire a certified trader or bot", or any marketplace built on certificates.
- An AI trading agent of our own as a product. The demo bot is a scripted trader that shows bots take
  the same rulebook.
- Exchange TP/SL armed by the referee (a linked key can't arm them). The referee's breach path is cancel
  plus close.
- Anti-collusion forensics, such as fills at the band edge against a second self-owned account. This is
  a documented known limitation and is not built.
- Discord or Telegram bots, mobile apps, Shannon spot and Event Contracts.

## Feasibility notes for the architect (primitives, not design)

Facts, not design. Part 1 is transcribed **verbatim** from the pack's sponsor files, with each block's
source lines named and headings demoted two levels; nothing else is changed. Part 2 adds facts
idea-forge verified this session from primary docs, quoted with their source. Part 3 lists the
pressure-test findings.

**Where the bites are in Part 1:**

| Need | Where |
|---|---|
| addresses | dreamdex §3 (network), §4 (contracts); somnia §2 (networks), §6 (SomniaAgents on Tokyo testnet) |
| entry-point signatures | dreamdex §5 (SDK snippets, raw `placeOrderFor`, operator ABI and selectors, SDK perp surface) |
| decimals · 10M gas · IOC no-fill reverts · WebSocket | dreamdex §8 gotchas 1, 2, 3 and 4 |
| voucher rules | dreamdex §6 "Paper USDso (voucher) rules"; somnia §4 voucher bullet; dreamdex §8 gotcha 6 |
| TP/SL limits | dreamdex §6 Costs and Orders; §7 Link-a-Bot table; §8 gotcha 9 |
| equity scoring | somnia §4 "Scoring-relevant" (expanded in Part 2 B) |
| Reactivity and the 32 STT wall | somnia §5 |
| day-1 dependency | somnia §3 (faucet, 0.6 STT headroom); dreamdex §5 claim snippet; somnia §4 voucher bullet |

**Day-1 dependency for this build (idea-forge note):** this build needs **three burner addresses**
holding Hideki STT for gas (the referee key and two challenge accounts) and **two one-time voucher
claims**, one per challenge account. The referee needs no USDso. Because the SDK wants 0.6 STT of
headroom per write at its defaults, fund each burner straight from the faucet: one request per address
per hour, five per connection, so all three fit in one sitting.

### Part 1 — verbatim from the pack

**dreamdex §3 — network** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/dreamdex.md` lines 35–48

#### 3. Network (verbatim, `developers/perps-testnet`)

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

**dreamdex §4 — contracts** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/dreamdex.md` lines 50–68

#### 4. Contracts: Hideki testnet (verbatim table)

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

**dreamdex §5 — entry points and signatures** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/dreamdex.md` lines 70–144

#### 5. Entry points and signatures

##### SDK connect, claim, size, place (verbatim, `developers/perps-testnet`)

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

##### Raw operator call (verbatim)

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

##### SDK perp surface (method names found in Somnia's `typescript/perps.md`; full list in `somnia.md` §4)

The core calls are `trader.placePerpOrder`, `trader.depositMargin`, `trader.amendOrders`, `trader.claimPerpVoucher`, `trader.buildPlacePerpStopOrder`, `trader.setPerpIsolated`, `client.listPerpMarkets`, `client.getMaxPerpOrderSize`, `client.previewPerpOrderMargin`, `client.getPerpPosition`, `client.getMarginAccount`, `client.getAccountHealth`, `client.getLiquidationPrice`, `client.previewPerpClosePnl`, `client.quotePerpClose`, `client.getPerpState`, `client.getPerpFeedStatus`, `client.listPerpPositions`, `client.getFundingPayments`, `client.listFundingRateHistory`, `client.listLiquidations`, `client.watchPerpMarkets`, `client.listPerpOrderRejections` (named in the dreamDEX docs), `exchange.fetchPositions`, `exchange.fetchFundingRate`, `exchange.createOrder`.

**dreamdex §6 — orders, margin, funding, markets, voucher rules** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/dreamdex.md` lines 146–196

#### 6. Order / margin / funding flow (trader docs, verbatim highlights)

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

##### Paper USDso (voucher) rules (verbatim, `/margin-and-liquidations`)

> It can't be withdrawn. Only USDso above the voucher balance can leave the Perps account.
> Only some markets. You can open or increase positions only in the markets marked Yes under Paper USDso in the market table. The six newest markets are not on that list.
> Your leverage setting can't be changed while it remains.
> Reducing and closing are never blocked, in any market.
> No builder fees are charged on the account.
> …A voucher can be taken back 14 days after it was granted, but only while the account has no positions and no resting orders: it never forces a position closed.

**dreamdex §7 — Link a Bot / trading keys** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/dreamdex.md` lines 198–215

#### 7. Link a Bot / trading-key model (`trading/common/link-a-bot`, verbatim highlights)

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

**dreamdex §8 — gotchas** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/dreamdex.md` lines 217–234

#### 8. Gotchas (verbatim from `developers/perps-testnet` unless noted). This is architect feasibility fuel.

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

**dreamdex §9 — bot kit (perps pieces, env contract)** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/dreamdex.md` lines 236–251

#### 9. Bot kit: `somnia-chain/dreamdex-bot-kit`

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

**somnia §2 — networks** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/somnia.md` lines 13–31

#### 2. Networks: resolves "Somnia Tokyo testnet" (verbatim tables)

`/blockchain/networks.md`:

| Chain | Network | Region | Chain ID | Currency | RPC | Explorer |
| --- | --- | --- | --- | --- | --- | --- |
| Global L1 | Mainnet | Worldwide | `5031` | SOMI | `https://api.infra.mainnet.somnia.network/` | explorer.somnia.network |
| Tokyo Subchain | Mainnet | Asia-Pacific, Tokyo | `50321` | SOMI | `https://api.tokyo.infra.mainnet.somnia.network` | explorer.somnia.network/tokyo |
| Global L1 | Testnet | Worldwide | `50312` | STT | `https://api.infra.testnet.somnia.network/` | explorer.testnet.somnia.network |
| Tokyo Subchain | Testnet | Asia-Pacific, Tokyo | `50383` | STT | `https://api.hideki.infra.testnet.somnia.network/` | explorer.testnet.somnia.network/tokyo |

`/blockchain/tokyo.md` (verbatim): "Mainnet is live, chain ID 50321, and its testnet is chain ID 50383." · "Block time | 100 ms, final on inclusion" · "Status | Mainnet live since 29 October 2026" · "`eth_getLogs` accepts a range whose `toBlock` minus `fromBlock` is at most 1,000, about 100 seconds of chain at 100 ms blocks. Multicall3 is at its canonical address, `0xcA11bde05977b3631167028862bE2a173976CA11`."

**Naming map (derived from the sources above plus the dreamDEX docs):**
- Somnia Tokyo testnet = Tokyo Subchain testnet = **Hideki** testnet = chain **50383** = the dreamDEX app's "DreamDEX region". **Perps live here.**
- Somnia Shannon testnet = Global L1 testnet = chain 50312. dreamDEX **spot**, the HTTP API and Event Contracts live here.
- Probe 2026-11-10: `api.hideki.infra…` and `api.hideki2.infra…` (dreamDEX's host) both return chain 50383.

⚠️ `/markets/perpetuals.md` says perps are "live on testnet, on the Global L1 and the Tokyo Subchain". The dreamDEX docs and the bounty only use Tokyo/Hideki. **Build on 50383.**

**somnia §3 — gas and faucet** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/somnia.md` lines 33–46

#### 3. Gas and faucet (verbatim, `/blockchain/faucet.md`)

| Chain | Chain ID | Faucet |
| --- | --- | --- |
| Global L1 | `50312` | explorer.testnet.somnia.network/faucet |
| Tokyo Subchain | `50383` | explorer.testnet.somnia.network/tokyo/faucet |

> The faucet sends 1 STT to any address holding less than 1 STT.
> One request per address an hour, and five from the same connection.
> The faucet is a form in the explorer, meant for a person.

The SDK needs "0.6 STT at the defaults" of headroom for a write (`get-testnet-funds`). Perps txs cost "between 0.0003 and 0.003 STT each" (dreamDEX). Other routes: the dreamDEX app's Link-a-Bot "Send it … for gas" / "Top up" (sends STT from the app wallet), or ask in Somnia Discord `#dev-chat` (gated).

⚠️ The `get-testnet-funds` how-to says USDso on **Shannon** has a public `mint` (`0x9c32…b171`). That is the Shannon token, **not** the Hideki perps collateral (`0xed79…4F72`). For Hideki perps, margin comes from the paper-USDso voucher (dreamDEX). No public mint for Hideki USDso is documented, so that is a gap.

**somnia §4 — Markets SDK (versions, methods, scoring, voucher rules)** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/somnia.md` lines 48–64

#### 4. Somnia Markets SDK: `@somnia-chain/markets-sdk`

- npm (2026-11-10): `latest 0.33.0` (modified 2026-11-09T15:28Z). dist-tags: `rc 0.32.0-rc…`, `next-0.32 0.32.1-rc…`, `canary 0.32.2-canary…`. License MIT. Homepage `https://prd.smk.somnia.host/docs/typescript`. Repo `github.com/somnia-chain/somnia-markets` is **not public** (`gh` cannot resolve it). The dreamDEX docs pin 0.32.1. There are release notes at `/markets/somnia-markets/typescript/release-notes.md` (381 KB, not read). The architect should diff 0.32.1 → 0.33.0 there before choosing.
- Description: "TypeScript SDK for Somnia Markets: live order books, account views, trading, and React hooks. Market watches stream chain events; account views combine event updates with polling."
- Ways to integrate (verbatim, `/markets/somnia-markets`): "The TypeScript SDK… realtime order books, trades, candles, and positions streamed with zero polling, plus a typed trader…" and "Raw smart contracts — no SDK. Any language, any runtime, nothing but an RPC node and the ABIs".
- **Perps shape (verbatim, `typescript/perps.md`):** "`Market` is a three-way discriminated union — `SpotMarket | PerpMarket | BinaryMarket`… A `PerpMarket` is a plain base/quote book plus perp state: `marginBank`, `initialMarginBps`, `fundingRate`, `cumulativeFundingPerUnit`, `indexPrice`, `openInterest`, `fundingWindowSec`, `fundingIntervalSec`." · "**Margin, not escrow.**… `trader.placePerpOrder` (or plain `createOrder` on a perp symbol) locks margin from that balance — no per-order token approval." · "Positions are on-chain reads, not indexed rows".
- ⚠️ **Stale line:** the same page opens "Perps are live on testnet: `BTC/USDso:USDso` and `ETH/USDso:USDso`", while the dreamDEX app lists **21** markets. This is a docs-drift Feedback candidate.
- Symbols: SDK unified form `BTC/USDso:USDso`; the app/kit form is `BTC-PERP` (bot-kit issue #23).
- **Perps method inventory** (every `client.` / `trader.` / `exchange.` name in `typescript/perps.md`):
  - `client.`: getAccountEquity, getAccountHealth, getBankruptcyPrice, getEffectiveImfBps, getFundingPayments, getInsuranceFundState, getLiquidationEngineConfig, getLiquidationPrice, getLiquidations, getLiveMarketByPool, getMarginAccount, getMarginEvents, getMaxPerpOrderSize, getOpenInterestHistory, getPerpFeedStatus, getPerpHealthSnapshot, getPerpIsolation, getPerpLeverage, getPerpLinkedWalletRegistry, getPerpMainFunding, getPerpMarket, getPerpMaxLinkedChildren, getPerpPortfolio, getPerpPosition, getPerpPositionAnalytics, getPerpPositionsPage, getPerpRiskParams, getPerpSideHolders, getPerpState, getPerpStopOrders, getPerpSystemConfig, getPerpVoucher, getPerpVoucherCampaign, getPerpVoucherEligibility, getPerpWalletLinkage, getPerpWalletPullCapacity, getUnclaimedPerpStopSomi, getViemClient, listAccountEquities, listFundingRateCandles, listFundingRateHistory, listLiquidations, listLiveFundingPayments, listLiveLiquidations, listPerpLinkedChildren, listPerpMainFundingEvents, listPerpMarginPulls, listPerpMarkets, listPerpOrderHistory, listPerpPoolStatuses, listPerpPositionAnalytics, listPerpPositionChanges, listPerpPositionChangesForFills, listPerpPositions, listPerpStopOrders, listPerpWalletLinkEvents, perpAdlQueue, previewPerpClosePnl, previewPerpLiquidationPrice, previewPerpOrderMargin, quotePerpClose, quotePerpFundingPayer, subscribeLive, waitForIndexedBlock, watchMarket, watchPerpMarkets.
  - `trader.`: acceptPerpWalletLink, amendOrders, approveBuilder, approvePerpMargin, buildAcceptPerpWalletLink, buildApprovePerpMargin, buildClaimPerpVoucher, buildPlacePerpStopOrder, buildRepayPerpMainFunding, buildSetPerpIsolated, claimPerpStopSomi, claimPerpVoucher, depositMargin, getMaxBuilderFeeBpsTimes1k, placePerpOrder, proposePerpWalletLink, recallPerpMainFunding, repayPerpMainFunding, setPerpIsolated, unlinkPerpWallet.
  - `exchange.`: createOrder, depositMargin, fetchFundingRate, fetchPositions, fetchTicker, loadMarkets, quotePerpClose.
  - Pure helpers (no client): `perpLiquidationPrice`, `perpPositionAnalytics`, `perpOrderMarginQuote` (bot-kit #23), `fundingRate8h`, `fundingRate1h`, `fundingRatePerInterval`, `annualizedFundingRate`.
- Page sections worth reading in full at Step 1: "Linked wallets (isolated margin)", "Credit vouchers (house money)", "History (indexer)" incl. "Realized PnL per close", "Watch the perp plane (liquidations + funding settlement)", "Watch from chain (event ABIs)", "Quick start", "One-shot reads (no watch)".
- Scoring-relevant (verbatim): "`client.getAccountEquity(account, { scope: "perps", marginBank })` returns `equity`, `lockedCollateral`, their sum `totalEquity`… score on `totalEquity`. The read has no history: store a snapshot at the start and at the end of the period." The page walks through netting deposits and voucher grants out of the PnL.
- Voucher rules (verbatim): "**One claim per address, for the distributor's life.** A new campaign window does not reset it." · "**The account must be flat to claim.**" · eligibility reasons `"dormant" | "notStarted" | "ended" | "notFlat" | "mainFunded" | "alreadyClaimed" | "budgetExhausted"` · "`trader.buildClaimPerpVoucher` returns the unsigned claim, so a claim and the first order can go out as one transaction."
- Liquidation-keeper reads exist (`getPerpSideHolders`, `getBankruptcyPrice`), so "a keeper can find every open position from head state alone — no off-chain indexer".

**somnia §5 — Reactivity** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/somnia.md` lines 66–82

#### 5. Reactivity

`/developer/reactivity.md` (verbatim): "Both forms of reactivity are live on the Global mainnet and testnet and on the Tokyo Subchain mainnet and testnet."

| | Off-chain (WebSocket) | On-chain (Solidity) |
|---|---|---|
| What | `eth_subscribe` with `somnia_watch`. "Each matched log arrives with your `eth_call` results from the same block." | Subscription in chain state. Validators call your handler's `onEvent(address,bytes32[],bytes)` as a synthetic tx |
| Cost | "Nothing on-chain, nothing to pay for, gone when you disconnect." | "Callbacks are paid out of the subscription owner's native balance (which must hold at least 32 SOMI/STT)." |
| Package | `@somnia-chain/reactivity` (TS; also re-exported via `@somnia-chain/markets-sdk/reactivity` with `createReactivity`, `unwrap`). It is an "optional peer dependency" | `@somnia-chain/reactivity-contracts` (`SomniaEventHandler`, `SomniaExtensions.subscribe(...)`) |
| Precompile | | `0x0100`; `subscribe((bytes32[4],address,address,address,address,bytes4,uint64,uint64,uint64,bool,bool))`, `unsubscribe(uint256)`, `getSubscriptionInfo(uint256)` |
| Scheduling | | `scheduleSubscriptionAtBlock` / `AtEpoch` / `AtTimestamp` (one-shot) |

Verbatim cautions: "*a subscription can provoke a recursive explosion*, unstoppably draining the owner's balance." The on-chain reactivity use cases listed include "Build an automated liquidation bot as a contract rather than an off-chain service."

⚠️ **Feasibility gotcha:** the **32 STT minimum** owner balance for on-chain reactivity, against the Tokyo faucet's **1 STT per address per hour, only when the balance is under 1 STT**. Accumulating 32 STT on Hideki from the faucet is impractical within the deadline. You would need the app's Top-up route, Discord, or the bounty team. **Off-chain reactivity (free)** is the realistic "Somnia primitive" for a 5-day build. Also, bot-kit issue #28 reports that on-chain `subscribe` "reverts with empty data for two unrelated reasons", and #34 that no on-chain read reports a failed callback.

The dreamDEX markets themselves already use on-chain reactivity: "`OracleHub` is the Solidity handler the precompile calls for `OracleCore.AnswerPosted`" (SDK reactivity page).

**somnia §6 — Somnia Agents** · source: `docs/resources/2026-11-10-dreamdex-perps-bounty/sponsors/somnia.md` lines 84–91

#### 6. Somnia Agents

`/agents/somnia-agents.md` (verbatim): "**Prototype notice.** Somnia Agents is in prototype state and deployed on **Somnia Mainnet** (Global, chain ID `5031`, and Tokyo, chain ID `50321`) and **Somnia Testnet** (Global, chain ID `50312`, and Tokyo, chain ID `50383`)."

- Model: "Agent invocations are **asynchronous**." A contract calls the `SomniaAgents` platform contract with a deposit; a validator subcommittee runs the agent and reaches consensus, and the result goes to a callback. Payment is in STT on testnet (operations reserve plus reward pot; the remainder is rebated).
- `SomniaAgents` contract, verbatim (`invoking-agents/quickstart.md`): Global mainnet `0x5E5205CF39E766118C01636bED000A54D93163E6` · Global testnet `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` · Tokyo mainnet `0x085f05Bc63c3185812f765CbA75F7eeC33e7A3A1` · **Tokyo testnet `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3`**.
- ⚠️ Verbatim: "**Tokyo runs JSON API Request and Price Oracle. LLM Inference and LLM Parse Website run on the Global chains only.**" So an "AI agent" that uses Somnia's deterministic LLM must invoke it on Global testnet (50312), cross-chain from the perps chain. On Tokyo only JSON API Request and Price Oracle are available.
- Base agents: LLM Inference ("Deterministic LLM inference"), LLM Parse Website, JSON API Request, Price Oracle ("The weighted median price of a token across exchanges, on request"). Directory: `explorer.testnet.somnia.network/agents`; web app `https://agents.testnet.somnia.network`.


### Part 2 — verified this session from primary docs (verbatim excerpts, 2026-11-10)

Fetched as Markdown from `https://somnia-platform-docs.vercel.app` (the host the bounty links). Each
block names its page and line range and is copied unchanged, except that headings are demoted. These
are the facts the pack left unread ("read at Step 1 if needed") that decide this build. Re-read the
full pages at Step 1.

**A. Operator grants an owner sends itself (SDK 0.33.0, Patch Changes)** · source: `https://somnia-platform-docs.vercel.app/markets/somnia-markets/typescript/release-notes.md` lines 82–84

- Spot and perp stop orders now grant the stop registry `placeOrderFor` on the stop's own pool only, and refuse a `registry` that does not belong to `pool`. Before, `placeSpotStopOrder`, `placePerpStopOrder` and `buildPlacePerpStopOrder` granted the registry globally, which also covered every other spot and perp pool. A stop registry serves one pool, so a per-pool grant is all that a stop needs.
    `placePerpStopOrder` and `buildPlacePerpStopOrder` compare `registry` with the stop registry that the PerpPoolFactory records for `pool`. `placeSpotStopOrder` compares `pool` with the registry's own `spotPool()`. A mismatch throws `InvalidInputError` before any transaction. `skipOperatorApproval: true` skips this check together with the grant.
    An owner who already has a global grant keeps a working stop, and the SDK sends no new grant for it. To move such an owner to per-pool grants, for each stop registry with live stops, first call `setOperatorApprovalForPool({ pool, operator: registry, selectors: [PLACE_ORDER_FOR_SELECTOR], approved: true })` on its pool, then revoke the global grant with `setOperatorApprovalGlobal({ operator: registry, selectors: [PLACE_ORDER_FOR_SELECTOR], approved: false })`. Grant per pool first, so the live stops keep their approval at every point. A per-pool revoke cannot clear a global grant: the OperatorPermissionsRegistry rejects it with `GlobalApprovalStillGrants`.

**B. Margin health and equity for scoring** · source: `https://somnia-platform-docs.vercel.app/markets/somnia-markets/typescript/perps.md` lines 81–136

- **Margin health is a chain read too.** `getMarginAccount` now also returns the
  requirements + status (`imReq` / `mmReq` / `cmReq` / `marginStatus`, from
  `MarginBank.getAccountHealth` + `getMarginStatus`);
  `client.getAccountHealth(marginBank, account)` is the lighter standalone read
  when only health matters, and `client.getLiquidationPrice({ marginBank, pool,
account })` estimates the mark at which this pool's move alone would trip
  maintenance (null when flat). `MarginStatus` / `MARGIN_STATUS` /
  `AccountHealth` are exported; `exchange.fetchPositions()` now fills
  `UnifiedPosition.liquidationPrice`.
- **Account equity for scoring is one read.**
  `client.getAccountEquity(account, { scope: "perps", marginBank })` returns `equity`,
  `lockedCollateral`, their sum `totalEquity` and the block they were read at.
  `equity` counts free collateral only, and a resting order moves collateral to
  `lockedCollateral`, so score on `totalEquity`. The read has no history: store a
  snapshot at the start and at the end of the period. A market with no fresh mark
  price makes the read throw. Pass `blockNumber` to read at a fixed block instead of
  the head. `client.listAccountEquities(accounts, params)` reads a cohort at one block
  in batched requests; an account that cannot be priced comes back as
  `{ priceable: false }` and does not fail the rest. The `"spot"` and `"overall"` scopes take no
  `marginBank` and throw `NotSupportedError`.

  The change between two snapshots includes money that moved in or out of the
  account. Remove those flows before you call the change a trading gain. Each snapshot
  carries `asOfBlock`, and the read at block `a` already includes every flow in block
  `a`, so the flows to remove are those in blocks `a + 1` to `b`, both included. When
  both snapshots were read at the same block, there are no flows between them: skip the
  reads, because `a + 1` to `a` is an inverted range and is rejected. Three indexed reads
  list the flows, and each takes the same inclusive `sinceBlock` / `toBlock`:

  | Read                        | Rows to count                                 | Sign |
  | --------------------------- | --------------------------------------------- | ---- |
  | `getMarginEvents`           | `Deposit`, `Credited` (voucher grant)         | in   |
  | `getMarginEvents`           | `Withdraw`, `CreditReclaimed` (voucher sweep) | out  |
  | `listPerpMarginPulls`       | every row, `OwnWallet` and `Main`             | in   |
  | `listPerpMainFundingEvents` | `kind: "Returned"`: principal sent to a main  | out  |

  Leave out `Locked` / `Unlocked` (collateral moving between the account's free and
  order-locked balance) and the main-funding `Funded` and `Settled` rows: a `Funded` row
  is the same money as a `Main` pull, and a `Settled` row moved none.

  The procedure removes the money the account's owner moved in or out. Two other credits
  reach the balance without a trade by the account, and the procedure counts them as
  trading gain: builder fees that other traders pay to the account as a builder
  (`listPerpFees({ builder: account, kind: "BuilderFee" })`), and the insurance fund
  covering a liquidated account's negative balance (`listLiquidations` kind
  `BadDebtAbsorbed`, field `insuranceCovered`). A competition that must remove them reads
  those lists too. Neither takes a block range. A liquidation row carries its
  `blockNumber`, so keep the rows in `a + 1` to `b`. A fee row carries only a
  `timestamp`, so a builder fee close to either snapshot cannot be placed exactly.
  Everything else that changes equity (fills, fees, funding, liquidations) is trading.

  Page each read until a short page. The margin events come back in block, then log
  index order, and the two pull ledgers in block, then id order, so the reads are
  stable: run the procedure twice and it returns the same rows and the same net. Wait
  until the indexer has processed block `b` before you net, or the newest flows are
  missing: `client.waitForIndexedBlock(chainId, end.asOfBlock)` does that.

**B (cont.). The 0.33.0 indexer-schema break for the netting reads** · source: `https://somnia-platform-docs.vercel.app/markets/somnia-markets/typescript/release-notes.md` lines 30–32

- BREAKING: `MarginEvent` rows carry `blockNumber` and `logIndex`, and `getMarginEvents` pages newest first by block, then log index. Deploy the matching indexer schema and run a full reindex before upgrading: the read selects columns an older indexer does not have, and fails against it. Code that constructs `MarginEvent` values must add both fields.
  
  `getMarginEvents`, `listPerpMarginPulls` and `listPerpMainFundingEvents` take inclusive `sinceBlock` / `toBlock` bounds, validated like the fill reads' bounds. With them, the flows between two `getAccountEquity` reads at blocks `a` and `b` are exactly the rows in `a + 1` to `b`, and the same on every read; the perps guide gives the netting procedure. A voucher sweep is indexed as `MarginEvent` kind `CreditReclaimed`, an outflow, and `MarginEventKind` gains that value: code that switches over the kind should handle it.

**C. Off-chain Reactivity — what it is** · source: `https://somnia-platform-docs.vercel.app/developer/reactivity/reactivity-offchain.md` lines 4–11

Off-chain reactivity works through a WebSocket subscription served by the node API. A client subscribes
to matching logs and receives pushed events as they land in blocks. Each event notification can optionally
include the results of read-only simulations run against the same block, so that an
application can react to both the event and its derived state at once. There's no additional latency, and
no risk of inconsistency.

The subscription is served by the RPC node the client is connected to. It is not stored on
chain, does not cost [SOMI](../network-info/somi-coin), and disappears when the client disconnects or unsubscribes.

**C (cont.). Subscription method and request parameters** · source: `https://somnia-platform-docs.vercel.app/developer/reactivity/reactivity-offchain.md` lines 140–156

##### Subscription method

`somnia_watch`. Subscribed via the standard `eth_subscribe` request over a WebSocket transport.
Unsubscribed via `eth_unsubscribe`.

##### Request parameters

The parameters object follows [`eth_getLogs`](../json-rpc-api#eth_getlogs)-style filter conventions with additions for
read-only simulation.

| Field | Type | Purpose |
|---|---|---|
| `address` | `address` or `address[]` | Optional. Matches only logs emitted by one of these addresses. Omit or pass `null` for any address. |
| `topics` | `(Hash \| Hash[] \| null)[]` | Optional. Positional topic filter. Entry `i` constrains topic `i` of the log. Each entry can be a single hash, an array of hashes (OR), or `null` (any). Omit for any topics. |
| `eth_calls` | array | Required. A list of read-only calls the node runs for each matching log. Pass `[]` if you only want log notifications with no attached simulation. See [eth_calls](#eth_calls) below. |
| `context` | `string` or `string[]` | Optional. Selectors that tell the node which fields of the matching log to append to each simulated call's calldata. See [context](#context) below. |
| `push_changes_only` | `bool` | Optional, default false. If true, and `eth_calls` is non-empty, only events whose simulation results differ from the previous event are pushed. |

**C (cont.). Simulation semantics** · source: `https://somnia-platform-docs.vercel.app/developer/reactivity/reactivity-offchain.md` lines 167–168

For every matching log the node executes each call as a read-only simulation against
the end-of-transaction state. The raw returned bytes are included in `simulationResults`, in order.

**C (cont.). Lifetime** · source: `https://somnia-platform-docs.vercel.app/developer/reactivity/reactivity-offchain.md` lines 233–237

##### Lifetime

The subscription lives on the API connection that created it. If the connection closes
(client disconnect, node restart, network blip) the subscription is gone and must be
recreated. The node does not buffer missed events across disconnects.

**D. Somnia Agents — Price Oracle agent: identity and methods** · source: `https://somnia-platform-docs.vercel.app/agents/somnia-agents/base-agents/price-oracle.md` lines 7–22

| Property | Value |
| --- | --- |
| Agent ID | `9911223344556677889`, the same on every chain (Global and Tokyo, mainnet and testnet) |
| Version | 1.0.0 |
| Author | Somnia Team |
| Per-agent price | 0.0003 SOMI (STT on testnet). See [Gas fees](../invoking-agents/gas-fees#current-per-agent-prices). |
| Explorer | [explorer.somnia.network/agents/9911223344556677889](https://explorer.somnia.network/agents/9911223344556677889) |

#### Methods

| Function | Inputs | Output | Use case |
| --- | --- | --- | --- |
| `getPrices` | symbols, decimals | uint256[], uint8[], uint64[] | Median price, source count and update time per symbol |
| `getPricesPacked` | symbols, decimals | uint256[] | Same medians, two symbols per 256-bit word |
| `getPricesSlots` | symbols, decimals | bytes | Same medians, one 48-bit slot per symbol |
| `getExchangePrice` | symbol, exchange, decimals, maxAgeMillis | uint256, uint64 | One exchange's latest quote, with caller-defined freshness |

**D (cont.). getPrices on a missing price** · source: `https://somnia-platform-docs.vercel.app/agents/somnia-agents/base-agents/price-oracle.md` lines 54–54

`getPrices` never fails the whole call. A symbol with no fresh quote, fewer fresh quotes than its min-source floor, or that isn't tracked returns `price=0, numSources=0, lastUpdated=0`. Check `numSources[i] > 0` to tell a real price from a missing one.

**D (cont.). Spot vs perp composites** · source: `https://somnia-platform-docs.vercel.app/agents/somnia-agents/base-agents/price-oracle.md` lines 116–117

- **Spot** symbols are `BASE/USDC`: the weighted median across exchanges' spot USDC markets.
- **Perp composites** are `BASE/USDC:PERP`: the weighted median of the top-of-book mids of each venue's USDC-margined perpetual (`BASE/USDC:USDC`). They are read through the same four functions.

**D (cont.). What to send as msg.value** · source: `https://somnia-platform-docs.vercel.app/agents/somnia-agents/invoking-agents/gas-fees.md` lines 7–11

#### TL;DR

- `getRequestDeposit()` returns the **operations-reserve floor** (gas refunds, callback gas, finalisation overhead). It is **not** the deposit you should send in practice — pay it only and your request will time out.
- Send `msg.value = floor + (per_agent_price × subcommitteeSize)`, where `per_agent_price` matches the agent type (table below). The contract takes no fee; whatever isn't spent on operations or paid to agents is rebated.
- Today, runners have fixed per-type prices baked into their software (see [Current per-agent prices](#current-per-agent-prices)). If you don't pay at least `subcommitteeSize × per_agent_price` on top of the floor, runners will skip your request and it will time out.

**D (cont.). The exact-minimum trap** · source: `https://somnia-platform-docs.vercel.app/agents/somnia-agents/invoking-agents/gas-fees.md` lines 28–28

If you deposit *exactly* the minimum, `perAgentBudget = 0` — and since agents watching `RequestCreated` see that cap up front, rational runners will skip the request entirely. The contract won't reject your call, but the request will almost certainly sit idle and time out. Deposit **more than** the floor if you want agents to actually do the work.

**D (cont.). Practical deposits (read SOMI as STT on testnet)** · source: `https://somnia-platform-docs.vercel.app/agents/somnia-agents/invoking-agents/gas-fees.md` lines 58–63

For the default `subcommitteeSize = 3` and `minPerAgentDeposit = 0.01 SOMI`:

| Agent Type | Operations reserve | Agent reward pot | Practical `msg.value` |
| --- | --- | --- | --- |
| JSON API Request | 0.03 SOMI | 0.0003 × 3 = 0.0009 SOMI | **0.0309 SOMI** |
| Price Oracle | 0.03 SOMI | 0.0003 × 3 = 0.0009 SOMI | **0.0309 SOMI** |

**D (cont.). Invocation flow (a contract with a callback)** · source: `https://somnia-platform-docs.vercel.app/agents/somnia-agents/invoking-agents/from-solidity.md` lines 25–36

#### How it works

| Step | From → to | Call or event |
| --- | --- | --- |
| 1 | Your contract → `SomniaAgents` | `createRequest{value: deposit}(agentId, callback, selector, payload)` |
| 2 | `SomniaAgents` → validators | `RequestCreated(..., perAgentBudget, subcommittee)` event |
| 3 | Validators → `SomniaAgents` | `submitResponse(result, receipt, success, executionCost)` |
| 4 | `SomniaAgents` → validators | Gas refund from the operations reserve |
| 5 | `SomniaAgents` | Reaches consensus |
| 6 | `SomniaAgents` → your contract | `handleResponse(requestId, responses[], status, details)` |
| 7 | `SomniaAgents` → committee | `deposit(subcommittee, [median × subSize])` |
| 8 | `SomniaAgents` → your contract | Rebate of unused budget |

**E. Linked wallets — where a child's margin comes from (why sub-accounts are out)** · source: `https://somnia-platform-docs.vercel.app/markets/somnia-markets/typescript/perps.md` lines 734–754

##### How the funding actually happens

There is no funding call, and this is the part that surprises people. The main supplies
USDso and an ERC-20 allowance to the **MarginBank**, and then sends nothing. `PerpPool`
performs the pull inside the child's own order placement:

- The child's own wallet pays first, sized by `min(balance, allowance)`.
- The main's wallet pays the residual, sized the same way.
- The pool's entire gate is `msg.sender == order.owner`. An order routed through
  `placeOrderFor`, an operator grant, a router or the stop registry pulls **nothing**,
  from either wallet.

So the child must send its own orders, and it needs native SOMI for gas. Revoking the
main's allowance stops the funding without touching the link. Funding does not wait for
link maturity: the rail reads the raw graph, and `maturesAt` gates ADL netting only.

What a main funds is a **claim, not a gift**. The bank records the funded principal
against the child, and the child's `withdraw` frees at most `balance - principal` — so a
compromised child key can trade the money and lose it, but cannot take it out. The
child's own money is the junior tranche: a loss eats it first, and a child that
genuinely lost the principal owes nothing.

**F. Closing against the live book (SDK 0.33.0)** · source: `https://somnia-platform-docs.vercel.app/markets/somnia-markets/typescript/release-notes.md` lines 35–35

- Add `quotePerpClose` on the engine client and the exchange. It quotes a reduce-only perp close against the live book: the size that fills within a price band, the band that fills it all, the size available at the pool's maximum band, the average fill price, and whether the opposite side is empty. The band uses the pool's own resting-price band and reference price.

**G. Credit vouchers — SDK side** · source: `https://somnia-platform-docs.vercel.app/markets/somnia-markets/typescript/perps.md` lines 943–987

#### Credit vouchers (house money)

A credit voucher is a one-time grant of collateral into a new account's MarginBank
balance. The grant is non-withdrawable. The account can trade with it and can withdraw
profit above it. A `VoucherDistributor` holds the budget and the campaign rules, and the
bank names the live distributor, so no deployment address is needed.

| Question                                  | Read                                                    | Tier  |
| ----------------------------------------- | ------------------------------------------------------- | ----- |
| Is a campaign live, and what does it pay? | `client.getPerpVoucherCampaign(marginBank)`             | chain |
| Can this account claim now? If not, why?  | `client.getPerpVoucherEligibility(marginBank, account)` | chain |
| How much house money does it hold?        | `client.getPerpVoucher(marginBank, account)`            | chain |

Check eligibility before you claim. A failed claim still mines and costs gas:

```ts
const eligibility = await client.getPerpVoucherEligibility(marginBank, account);
if (eligibility.eligible) {
  await trader.claimPerpVoucher({ marginBank });
} else {
  // "dormant" | "notStarted" | "ended" | "notFlat" | "mainFunded" | "alreadyClaimed" | "budgetExhausted"
  console.log("cannot claim:", eligibility.reason);
}
```

Rules to know before you build on it:

- **One claim per address, for the distributor's life.** A new campaign window does not
  reset it.
- **The account must be flat to claim.** No positions and no resting perp orders.
- **The grant confines position increases.** Only allowlisted markets, at no more than
  the voucher leverage cap, and the account cannot change its own leverage setting.
  `getPerpLeverage` and `previewPerpOrderMargin` already apply these rules.
- **Own funds can mix in.** A voucher account can still deposit, and an order placed
  with an ERC-20 allowance to the bank can pull wallet collateral in. To keep an account
  on house money only, do not ask it for that allowance.
- **The grant expires.** After `expiresAt`, anyone can sweep the remaining floor back to
  the distributor, but only while the account is flat. A sweep never forces a close.
- **Each grant and each sweep is indexed.** A grant appears in `client.getMarginEvents` as
  `kind: "Credited"`, and a sweep as `kind: "CreditReclaimed"`, an outflow whose
  `granter` is the address that swept it. A sweep of an account with no positive
  balance left has `amount` 0.

`trader.buildClaimPerpVoucher` returns the unsigned claim, so a claim and the first order
can go out as one transaction. The claim must execute first.

**H. Event ABIs for a raw watch** · source: `https://somnia-platform-docs.vercel.app/markets/somnia-markets/typescript/perps.md` lines 1253–1267

#### Watch from chain (event ABIs)

Indexer history is one-shot and the chain reads are point-in-time. To see a perp
event as it lands, decode the log yourself. The SDK publishes the event ABIs so
your decoder uses the same signatures the SDK and the indexer use:

| ABI                          | Contract          | Scope                | Carries                                                                               |
| ---------------------------- | ----------------- | -------------------- | ------------------------------------------------------------------------------------- |
| `perpPoolEventsAbi`          | PerpPool          | one per market       | funding rate, open interest, the maker pre-fill reason tags                           |
| `marginBankEventsAbi`        | MarginBank        | singleton, all pools | positions, collateral flow, funding settlement, fees, the liquidation settlement legs |
| `liquidationEngineEventsAbi` | LiquidationEngine | singleton, all pools | the liquidation waterfall stages and their costs                                      |

Both singletons serve every pool and every account, so a subscription is one
stream. The pool and the account are indexed topics, not the log source. Get the
addresses from the market row and the system config:


### Part 3 — pressure-test findings (idea-forge's reading, not sponsor text)

No external blocker was found. These are the risks the architect should plan around:

- **Grant path.** A challenge account grants the referee itself with the SDK's owner-side
  `setOperatorApprovalGlobal` / `setOperatorApprovalForPool` (Part 2 A) and the selectors in Part 1
  dreamdex §5. App-wallet users can use Link a Bot instead. Revoking the grant mid-run voids the run.
- **Grant scope.** Closing a position is a `placeOrderFor`; `reduceOrderFor` shrinks a resting order,
  not a position. So the referee's grant could also open orders. Every referee order is public on-chain
  evidence, and the referee's code is open.
- **Close liquidity.** A close is an IOC through the book. Size it with `quotePerpClose` (Part 2 F) and
  price it "through the book with some slippage room" (gotcha 3); a single IOC that finds nothing
  reverts `ImmediateOrCancelNoFill()`. Other public entries fill IOC orders on Tokyo BTC and ETH
  (secondary evidence).
- **Unpriceable marks.** `getAccountEquity` throws on a market with no fresh mark (Part 2 B). The
  referee must pause judging (no verdict, no breach) rather than act on a missing price.
- **Netting vs the indexer schema.** Under 0.33.0 the netting reads need the reindexed indexer (Part 2
  B, release-note line). A rulebook where any flow voids the run, detected live from MarginBank events,
  keeps verdicts independent of the indexer schema. This is an input for the architect's version pin.
- **Replay depth.** Replays use `getAccountEquity` with `blockNumber`. How far back the public Hideki
  RPC serves historical state is unverified, so keep each verdict's raw reads (block, call, result) so
  a replay can fall back to them, and test the depth on day 1.
- **Price Oracle coverage.** Whether the Tokyo-testnet Price Oracle tracks `BTC/USDC:PERP` is
  unverified. One request on day 1 settles it; fall back to `BTC/USDC` spot. Send the practical
  deposit, not the floor (Part 2 D).
- **Voucher sizing.** The voucher leverage cap is unknown until read (`getPerpLeverage` →
  `voucherLeverageCapX`). Demo thresholds must be tight enough for a small move to resolve the run.
- **Positioning.** Judges may pattern-match "flatten on breach" to the 20-plus guards. Lead every
  surface (README, demo, X posts) with the verdict and the certificate, not with protection.

## Prior-art check (this session, 2026-11-10)

One bounded pass:

- the full GitHub search `dreamdex perps` (203 repos, names and descriptions);
- 33 targeted searches: league, leaderboard, tournament, competition, challenge, prop, prop firm,
  fantasy, linked wallet, sub-account, keeper, builder fee and code, Somnia Agents, price oracle, vote,
  basket, squad, streak, Perps Arena, certificate, certified, credential, licence and license,
  evaluation, funded, rulebook and verdict. "Prop firm" and "rulebook" returned 0 repos; the
  certificate, credential and licence hits were boilerplate matches inside guard, agent and feedback
  repos; "funded" matched only funding-rate bots;
- the README heads of 38 repos that had no description or sat closest to the shortlist.

Public repos are secondary evidence, not confirmed Builds (the Builds tab is hidden).

**Closest to Verdict:**

| Repo | What it does (its own words) | Why Verdict differs |
|---|---|---|
| `bayuapriansyah/dreamduel` | "timed 1v1 duels … the referee reads both accounts' equity on-chain"; knockout at −20% of the cap; flows netted; Elo ladder; X result card | a game between two players; "The referee only reads the chain", so no enforcement and no certificate |
| `Saber1Y/dreamarena-perps` | arcade "challenges" (Survivor, Streak, Boss) scored by its own contract through on-chain Reactivity, with a 32 STT bond | arcade runs, not a rulebook evaluation; no enforcement; no verdict replay |
| `Gideonjon/perps_league` | friends' leagues on real P&L from the indexer; "Read-only on-chain" | ranks people; places no orders |
| perp-guard, `0xvikram/seatbelt`, `nftkingiii/halter`, `linoxbt/Hoax`, `successaje/dreamdex-perps`, `abrahamebij/dexter`, `Lightgrid01/Subsidium` | protect a position from liquidation or loss | protection, not evaluation; no pass and no certificate |
| `alien1-stack/perparena-agents` | "Somnia Agent verdict → live Tokyo trades" | gates one agent's trades; does not evaluate an account |

**The pack's thin signals, tested:**

- Leaderboards and scored competitions with equity netting: **occupied** (perps_league, dreamduel,
  dreamarena).
- Multi-wallet and sub-account tooling: **empty** (0 hits), but **knocked out** by the wallet-USDso
  wall (Part 2 E).
- Builder-code frontends: **empty**, and **knocked out** (no builder fees on voucher accounts).
- Liquidation keepers: one backstop (`subheeksh5599/catch`) and one liquidation map
  (`Tissuesurgeon/wipeout-map`); **knocked out**, because the money shot needs other accounts'
  liquidations.
- Somnia Agents gating orders: **occupied** (perparena-agents; `OkeyAmy/bicameral` on Shannon;
  `RaYYeR220/copybook`'s validator-run AI guard).
- Prop-style evaluation and certification: **empty**. This is Verdict.
- Crowd-voted trading: **empty**. It was scored; see below.

## Rubric mapping (why this won, for the record)

**Weights.** The kit rubric (`references/ideation-rubric.md`) supplies **internal scoring weights, not
event weights; the event publishes none**: intrinsic buildability **30**, demo WOW + story **25**,
theme + track fit **20**, novelty **25**. `novel-wow` moves 5 points from buildability to novelty, and
buildability stays the highest weight.

**Axis mapping to the three published criteria:**

- *Evidence of building*, *credible scope* and *technical execution* → buildability.
- *Demo* and *Communication* (a moment worth posting) → WOW.
- *Clear user value*, *a viral or repeat-use loop*, the category and the Somnia-primitives plus → fit.
- Standing out among about 200 public repos for three prizes → novelty (the white-space verdict plus
  the head-to-head).

**The field.** 35 candidates: 27 plus 8 bolder-pass rewrites. Seven were knocked out at the
buildability gate:

- linked-wallet strategy pods (wallet USDso);
- a builder-code storefront (no builder fees on voucher accounts);
- a funding-settlement sniper and its "funding countdown" rewrite (the money shot rides on live
  funding);
- a liquidation backstop keeper (it needs other accounts' liquidations);
- a PnL "lie detector" (it places no orders);
- a 64-player bracket (it needs dozens of faucet-funded accounts).

The other 28 were scored. Top five after the head-to-head:

| Candidate | Build ×30 | WOW ×25 | Fit ×20 | Novelty ×25 | Total |
|---|---|---|---|---|---|
| **Verdict** (prop challenges for humans and bots) | 5 | 4 | 5 | 4 | **450** |
| The Hive (one account traded by crowd vote) | 5 | 4 | 4 → 3 | 5 | 455 → 435 |
| Bot licence (know-your-agent via evaluation), merged into Verdict | 5 | 4 | 4 | 4 | 430 |
| Humans vs Machine (crowd account vs AI account) | 5 | 4 | 4 → 3 | 4 | 430 → 410 |
| Narrative indexes as share links | 5 | 3 | 4 | 3 | 380 |

The Hive scored highest before the head-to-head but can't advance. Against dreamduel it **loses on
clear user value**: voting on a shared account versus trading your own, and dreamduel already courts
first-time traders ("take the other seat"). So its fit drops, and it fails the skill's "no clear loss"
condition. Verdict wins on clear user value and technical execution, with no clear loss. Under the
kit's default weights (35/25/20/20) Verdict still leads, 455 to 435. The pressure test on the top three
(Verdict, The Hive, Bot licence) found no external blocker in any of them. Verdict's only external
dependency is the day-1 STT and voucher claims.
