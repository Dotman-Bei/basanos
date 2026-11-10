# Prior art: what already exists (so idea-forge doesn't clone it)

**Sources (all 2026-11-10):**
- (A) bot kit tree, README and docs via `gh api` (primary).
- (B, C) GitHub repository search via `gh api search/repositories?q=dreamdex+perps+in:name,description,readme`: **203 total hits**, the first ~80 by recency read. These are **secondary**: public repos, not confirmed Builds, since the bounty's Builds tab is hidden (`hide_builds_tab: true`). One-liners are the repos' own GitHub descriptions, quoted; code was not inspected.
- (D) DoraHacks Event Contracts Hackathon Winners tab (Chrome, primary).
- (E) this bounty's Q&A tab (Chrome, secondary).

---

## A. The official bot kit and its siblings: the "clone line"

Anything that is mostly one of these, re-skinned, is a **clone**. The builder already generates it in five clicks.

| Name | One-line (source) | Tech | Link |
|---|---|---|---|
| perp-starter | "Opens one position and closes it at a take-profit or stop-loss." | TS, markets-sdk, trading key | github.com/somnia-chain/dreamdex-bot-kit/tree/main/strategies/perp-starter |
| perp-maker | "Rests a bid and an ask around the mark and skews them to stay flat." | TS | …/strategies/perp-maker |
| perp-funding | "Holds whichever side funding pays, and steps aside when the rate drops." | TS | …/strategies/perp-funding |
| perp-guard | "Not a trader: trims or closes positions as margin health falls." | TS | …/strategies/perp-guard |
| perp-doctor | read-only link, gas and margin check (`npm run perp:doctor`) | TS script | …/scripts/perp-doctor.ts |
| Spot strategies | starter, market-making, grid, momentum, mean-reversion, twap, ensemble (+optional LLM), treasury, yield-optimizer | TS (+Python core) | …/strategies |
| EC strategies | ec-starter, ec-maker, ec-passive, ec-laddering-bot, ec-oracle-follow, ec-settlement | TS | …/strategies |
| backtest + edge-analytics | bar-by-bar backtester; maker-edge measurement (captured spread vs adverse selection) | TS | …/packages/backtest, …/tools/edge-analytics |
| batch-7702 | EIP-7702 batching technique demo | Solidity + TS | …/advanced/batch-7702 |
| examples/01–08 | "The real competition bots, sanitized to core code" from the first DreamDEX alpha trading competition (multi-strategy AI, modular TS + Ollama LLM, monorepo grid, Python ops, async, multipair, stable maker, regime multi-strategy). Mostly spot; many use the removed `placeTakerOrderWithoutVault` | JS/TS/Python | …/examples |
| skills/ | agent skills `somnia` and `dreamdex-bot` for AI coding agents | Markdown | …/skills |
| DreamFly | fruit-fly connectome model picks maker / trend / funding-carry / sit-out per market; dashboard | Python + Node | github.com/somnia-chain/dreamdex-dreamfly |
| dreamBot Builder | 5-step no-code config generator for the kit / DreamFly; Railway one-click | web app | app.testnet.dreamdex.io/dreambot-builder |
| Somnia MCP server | read-only perps/markets tools for AI agents (`perp_markets`, `perp_account`…) | Node CLI | `@somnia-chain/cli` (`/build/mcp`) |
| CCXT dreamDEX | unified CCXT interface (spot, alpha) | TS | github.com/somnia-chain/ccxt#add-dreamdex-exchange |

## B. Shipped / in-progress competitor MVPs for THIS bounty (GitHub, public)

Grouped by idea cluster. Every one-liner is the repo's own description.

**Risk guards / stop-loss / liquidation protection (MOST CROWDED)**
| Repo | One-line | Pushed |
|---|---|---|
| 0xvikram/seatbelt | "Perps with a seatbelt: set the most you can lose, get a dreamDEX perps order with a stop that keeps…" | 11-10 |
| DmitriyTopka/stopcheck | "Does your dreamDEX take profit and stop loss actually cover your position? Checker + gap-keeper bot" | 11-09 |
| successaje/dreamdex-perps | "Dreamcatcher — cut a perp position before the liquidation engine does. Non-custodial, on Somnia." | 10-29 |
| Techkeyy/forsee | "Forsee: see account risk and arm native protective stops for dreamDEX perps on Somnia testnet" | 10-29 |
| Ay-obami/TradeFirewall | "Independent risk guard for dreamDEX perpetual futures bots and AI agents" | 10-29 |
| metafrogmeme-droid/claw-guard-perps-public | "Operator-key firewall for AI perps agents on dreamDEX (Somnia Tokyo testnet)." | 11-07 |
| nftkingiii/halter | "Let a bot trade your dreamDEX perps account, but only inside limits you set on chain. Somnia Hideki testnet." | 10-28 |
| falcaofah/stop-guardian, sniperchief/panicbutton, 0xGp/risker | (no description) | 10-29/30 |
| subheeksh5599/catch | "Liquidation backstop for dreamDEX perps: resting liquidity where liquidations land, re-quoted by Somnia Reacti[vity]" | 10-29 |
| LBCron/dreamdex-perps-sentinel | "Automated Funding-Rate Arbitrage, Liquidation Guard & Risk-Managed Executi[on]" | 11-08 |

**AI trading agents / copilots**
| Repo | One-line | Pushed |
|---|---|---|
| shreyas-sovani/perp-pilot | "PerpPilot: autonomous AI trading agent for dreamDEX perps on Somnia Tokyo testnet" | 10-29 |
| Hajrajadoon/PerpPilot-AI | "AI-Powered Perpetual Trading Intelligence for DreamDEX on Somnia Testnet." | 11-08 |
| edycutjong/dreamdex-pilot | "MCP server: AI agents plan, guard and place dreamDEX perps orders on Somnia testnet" | 11-01 |
| ElTanque81/perppilot, JimmyOgb/PerpsPilot, southenempire/apexperp-ai | (no / short description) | 10-30/31 |
| jeffrey-graham/dreamdex-somnia-bounty | Q&A post: "Quant Funding-Rate Arbitrage, Cross-Margin Liquidation & Bracket CLI Agent", dual-track with 12 feedback reports | 11-09 |

**Copy-trading / social**
| Repo | One-line | Pushed |
|---|---|---|
| sanjaysah101/dreamdex-mirror | "Copy-trade any dreamDEX perps trader with a linked bot key that can trade but never withdraw." | 10-28 |
| RaYYeR220/copybook | "Follow a trader or a thesis on dreamDEX perps. Somnia validators keep your book in sync — every leg…" | 10-30 |

**Consumer / game-ified perps**
| Repo | One-line | Pushed |
|---|---|---|
| Saber1Y/dreamarena-perps | "Leverage arcade and AI agent for dreamDEX perps on Somnia, scored on-chain through Reactivity" | 11-09 |
| PhiBao/perpduel | "A 1v1 perpetuals duel on dreamDEX" | 10-30 |
| orjinameh/Perp-tow | "Perpetual trading tug of war" | 10-30 |

**Trader tools / analytics / execution**
| Repo | One-line | Pushed |
|---|---|---|
| rishu4436/perpshq | "dreamDEX perpetual market intelligence and Somnia Hideki testnet workspace" | 11-10 |
| zkzora/pairpilot | "One ticket for a two-leg perp trade on dreamDEX (Somnia Tokyo testnet): bounded IOC legs, fill read-[back]" | 11-05 |
| hms1499/perplog | "PerpLog: trade journal with true net PnL and bot-held stop-loss protection for dreamDEX perps" | 10-29 |
| kaminariouji/dreamdex-perp-runner | "Perpetual futures bot… bracketed cycles, watched exits, JSONL evidence tr[ail]" | 10-28 |
| draarivpatel-ui/perps-risk-sim | "Zero-dependency perpetual futures orderbook, funding, liquidation cascade and VaR simulator" | 11-10 |
| sharath2525/DreamDEX-Perps-Inspector, Cedric-uxb/dreamdex-perpscope ("Read-only conformance scanner and evidence generator"), chapaevv123/perp-canary ("Read-only dreamDEX perps evidence") | inspectors / evidence | 10-28 to 11-09 |
| vincent-lxc/dreamdex-go | "Go client for dreamDEX Perps on Somnia Hideki testnet + builder feedback" | 10-30 |
| BUIDL 50361 "dreamDEX Perps MM Bot" (Q&A post) | market-making bot; submitter blocked by the whitelist | 11-07 |
| elon00/qmoosa-hyperperps | "perpetual DEX trading bot & margin vault" | 11-09 |

**Proof-of-build only** (Topeseun/dreamdex-perps-proof "claims the 1,000 paper USDso perps voucher and…", sumun2026/dreamdex-build-proof, vaultvult/dreamdex-testnet-proof, krsnak/dreamdex-perps-sdk-smoke, suneetbhardwaj-art/dreamdex-perps-sdk-check). These are thin entries.

### White-space read (for idea-forge to test, not a decision)
- **Saturated:** stop-loss / risk guards / liquidation protection (≥12), "PerpPilot"-style AI agents (≥6), copy-trading (2), and funding-rate carry, which the kit already ships.
- **Thin or absent in the visible field:** scored competitions or **leaderboards** with equity netting (the SDK documents the procedure in `getAccountEquity`), multi-wallet / **sub-account portfolio** tooling (linked wallets, isolated margin), **builder-code** monetized frontends, **liquidation-keeper / backstop** contracts (only one, `catch`), and **Somnia Agents** (Price Oracle / JSON API on Tokyo) gating orders. These are unverified signals; idea-forge should check them.

## C. Feedback-track repos (duplicate-risk map)

At least 25 public repos: DmitriyTopka/dreamdex-perps-feedback, ahmardchain/…, devorun/…, graceful14011/…, MarwanWidjaya/…, ajocircle-dev/dreamdex-feedback, peterpeter228/…, Anand-0037/…, Fuma2514/dreamdex-feedback, cyrvance53/somnia-dreamdex-feedback, saltxd/dreamdex-feedback, DavisBrains/…, duclucky/…, bug-origin/… ("13 SDK/docs reports with repro scripts"), cryptocloud786/…, RaYYeR220/copybook-feedback, SavvySID/perpslab, clatsonhacks/…, sanjaysah101/… ("5 reproducible… reports"), WV629/…, discodictator/DreamDEX-feedback, and more. Q&A posts claim batches of 8, 12, 13 and 17. **The obvious docs and SDK nits are almost certainly already filed.** Only build-time friction specific to our own MVP is likely to be first.

## D. dreamDEX Event Contracts Hackathon: the earlier event's winners

DoraHacks hackathon **2358** (`/hackathon/event-contracts`), 2026-08-18 → 2026-09-11 18:00 UTC, prize 5,000 USD, 469 hackers, 230 Builds, `winner_announced: true`. Source: https://dorahacks.io/hackathon/event-contracts/winner, "Top 10 projects", Winners. One-liners are verbatim card text.

| Winner | One-line (verbatim) | Theme |
|---|---|---|
| DreamPulse | "solves fragmented prediction markets plagued by thin liquidity, stale pricing, approval friction, and stranded payouts with intelligent execution, autonomous agents, no-code strategies, and automated settlement on Somnia." | agents + automation |
| Market Royale: Battle royal on DreamDex | "A fully on-chain trading battle royale… Every player starts with the same isolated vault… survives oracle-ranked cuts for a winner-paid entry pool." | consumer game |
| Lucid | "makes the desk a contract and Somnia validators its keeper and its brain: the loop runs with nothing of ours switched on." | on-chain agent via Reactivity/Agents |
| Decedo | "makes smart-contract safety claims worth challenging… onchain results determine payouts" | novel use of the instrument |
| Ropes | "Every sixty seconds, Bitcoin decides whether you live… the chain itself does the killing, in the same block the market settles." | consumer game + reactivity |
| HOUSE | "A wallet that is the book… rests both sides from a normal wallet with one button" | market-making UX |
| Masayume · 正夢 | "A prediction market you can tap, play, hand to an agent, or just tweet at" | consumer + social |
| Autoroll | "collapses an endless chain of 60-second dreamDEX windows into one position that never expires - sign once, and an on-chain vault rolls it for you." | on-chain automation vault |
| Harvest-Call | "hides it in a farm: pick Bitcoin or Ethereum, say Up or Down, a right call grows a crop." | consumer game |
| ForeSight | "combining evidence-backed Dual AI debate, Velocity Coverage trajectory physics, and a 1-click on-chain Batch Sweeper contract" | AI + tooling |

**Pattern (an observation, not doctrine):** 5 of 10 winners are consumer or game framings, and 3 put the automation **on-chain** (validators or a vault as keeper). Plain off-chain trading bots are absent from the winner list. Related public repos: neromtoobad/ropes (★2), Timidan/decedo (★1), Aji-Q/levelfield (★97; EC-hackathon entry, not in the winner list). The winners' build/repo links were not captured (a DOM read was blocked), so this is a gap.

## E. Other dreamDEX/Somnia references

- First DreamDEX alpha trading competition: its top bots are sanitized in bot-kit `examples/`.
- `lrmn7/dreamdex-docs-agent-skill` ("Grounded DreamDex documentation for AI coding agents"), `IronicDeGawd/ec-dreamdex-hackathon-template`.
