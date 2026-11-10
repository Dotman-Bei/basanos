# Sponsor: Somnia (chain, Markets SDK, Reactivity, Somnia Agents)

**Primary sources, all fetched 2026-11-10 with Chrome in-page `fetch` of the docs' Markdown twins (every page has a `.md`):**
`https://somnia-platform-docs.vercel.app` → `/markets/somnia-markets` (rendered), `/llms.txt` (page index, 259 links), `/blockchain/tokyo.md`, `/blockchain/networks.md`, `/blockchain/faucet.md`, `/markets/perpetuals.md`, `/markets/somnia-markets/typescript/perps.md` (84 KB; headings, method inventory and key sections read), `/markets/somnia-markets/typescript/how-to/get-testnet-funds.md`, `/markets/somnia-markets/typescript/reactivity.md`, `/developer/reactivity.md`, `/developer/reactivity/reactivity-onchain.md` and `-offchain.md` (first sections and headings), `/agents.md`, `/agents/somnia-agents.md`, `/agents/somnia-agents/invoking-agents/quickstart.md`, `/build/mcp.md`.
The docs also say they are served at `docs.somnia.network` (`/llms.txt`, `/llms-full.txt`). The vercel host was the one linked from the bounty page.

---

## 1. What Somnia rewards here

The bounty page names "Somnia primitives such as Reactivity or Somnia Agents" as "a plus" for MVPs. There is no separate Somnia prize.

## 2. Networks: resolves "Somnia Tokyo testnet" (verbatim tables)

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

## 3. Gas and faucet (verbatim, `/blockchain/faucet.md`)

| Chain | Chain ID | Faucet |
| --- | --- | --- |
| Global L1 | `50312` | explorer.testnet.somnia.network/faucet |
| Tokyo Subchain | `50383` | explorer.testnet.somnia.network/tokyo/faucet |

> The faucet sends 1 STT to any address holding less than 1 STT.
> One request per address an hour, and five from the same connection.
> The faucet is a form in the explorer, meant for a person.

The SDK needs "0.6 STT at the defaults" of headroom for a write (`get-testnet-funds`). Perps txs cost "between 0.0003 and 0.003 STT each" (dreamDEX). Other routes: the dreamDEX app's Link-a-Bot "Send it … for gas" / "Top up" (sends STT from the app wallet), or ask in Somnia Discord `#dev-chat` (gated).

⚠️ The `get-testnet-funds` how-to says USDso on **Shannon** has a public `mint` (`0x9c32…b171`). That is the Shannon token, **not** the Hideki perps collateral (`0xed79…4F72`). For Hideki perps, margin comes from the paper-USDso voucher (dreamDEX). No public mint for Hideki USDso is documented, so that is a gap.

## 4. Somnia Markets SDK: `@somnia-chain/markets-sdk`

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

## 5. Reactivity

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

## 6. Somnia Agents

`/agents/somnia-agents.md` (verbatim): "**Prototype notice.** Somnia Agents is in prototype state and deployed on **Somnia Mainnet** (Global, chain ID `5031`, and Tokyo, chain ID `50321`) and **Somnia Testnet** (Global, chain ID `50312`, and Tokyo, chain ID `50383`)."

- Model: "Agent invocations are **asynchronous**." A contract calls the `SomniaAgents` platform contract with a deposit; a validator subcommittee runs the agent and reaches consensus, and the result goes to a callback. Payment is in STT on testnet (operations reserve plus reward pot; the remainder is rebated).
- `SomniaAgents` contract, verbatim (`invoking-agents/quickstart.md`): Global mainnet `0x5E5205CF39E766118C01636bED000A54D93163E6` · Global testnet `0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776` · Tokyo mainnet `0x085f05Bc63c3185812f765CbA75F7eeC33e7A3A1` · **Tokyo testnet `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3`**.
- ⚠️ Verbatim: "**Tokyo runs JSON API Request and Price Oracle. LLM Inference and LLM Parse Website run on the Global chains only.**" So an "AI agent" that uses Somnia's deterministic LLM must invoke it on Global testnet (50312), cross-chain from the perps chain. On Tokyo only JSON API Request and Price Oracle are available.
- Base agents: LLM Inference ("Deterministic LLM inference"), LLM Parse Website, JSON API Request, Price Oracle ("The weighted median price of a token across exchanges, on request"). Directory: `explorer.testnet.somnia.network/agents`; web app `https://agents.testnet.somnia.network`.

## 7. Somnia CLI and MCP server (`/build/mcp.md`)

- `somnia mcp` ships in `@somnia-chain/cli` (Node ≥22). "It never signs or sends a transaction." Claude Code setup (verbatim): `claude mcp add somnia -- npx -y @somnia-chain/cli mcp`. Testnet default via `--network testnet` or `SOMNIA_NETWORK=testnet`.
- Read tools include `perp_markets` ("Perp markets, and whether each is tradeable"), `perp_account` ("A cross-margin account's collateral, equity, margin and positions"), `fills`, `price`, `venue_health`, `explorer_*`.
- "The CLI has about 190 commands, including every transaction" (signing via keychain, `SOMNIA_PRIVATE_KEY`, or `build:<address>` for unsigned output plus offline `somnia tx sign` / `somnia tx submit`).
- Not checked: whether `--network testnet` targets Hideki (50383) or Shannon (50312). The page says "Try writes on the Global testnet first". Gap for perps.

## 8. Docs feedback channel (useful for the Feedback track)

Every Somnia docs page ends with (verbatim): "Tell us: `POST /api/feedback` on this site with JSON `{"message": "…", "context": "…", "page": "…"}`". This is Somnia-docs feedback, **separate from** the bounty's `feedback/` folder. The bounty only pays for items in the repo folder.

## 9. Gaps (Somnia)

- WSS endpoint for `api.hideki.infra…` (in `/blockchain/rpcs`, not fetched). dreamDEX gives `wss://api.hideki2.infra.testnet.somnia.network/ws`.
- How Hideki USDso can be obtained beyond the voucher (no public mint is documented for that token).
- SDK release notes 0.32.1 → 0.33.0 (not read; 381 KB).
- Somnia Discord / SomniaHacks Telegram are gated and not joined.
