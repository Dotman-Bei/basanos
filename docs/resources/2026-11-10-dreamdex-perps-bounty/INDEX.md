# Resource pack: dreamDEX Perps Builder Bounty (Step 0a)

Extracted 2026-11-10 (~15:10–16:15 WAT) by the resource-extractor seat (`claude-opus-5-5`, tier `top`, effort `high`). Read-only: no logins, forms, registrations, wallet connections or fund movements. The campaign tollgate is at [`../../tollgate/2026-11-10-tollgate.md`](../../tollgate/2026-11-10-tollgate.md).

## Contents

| File | What it holds |
|---|---|
| [event.md](event.md) | Deadline (incl. the page contradiction + platform-API resolution), eligibility/whitelist, submission format (Feedback template verbatim, MVP requirements, X-posts rule, DoraHacks form fields), judging criteria (**no numeric weights published**), prizes incl. the 30-day mainnet $200 clause, testnet rules, Perps Arena / bounty-account USDso rules |
| [tracks.md](tracks.md) | The two tracks (Feedback, MVP): sponsor, problem statement, prize, minimum bar, required tech, competition reality |
| [sponsors/dreamdex.md](sponsors/dreamdex.md) | Perps integration model, Hideki network, **testnet contract addresses**, **entry-point signatures**, SDK snippets, markets table, margin/funding/orders, paper-USDso rules, Link-a-Bot trading-key model, 14 gotchas, error selectors, bot kit (structure, perp-core API, env contract, **open issues**), dreamBot Builder/DreamFly |
| [sponsors/somnia.md](sponsors/somnia.md) | Networks (resolves "Tokyo testnet" = Hideki 50383), faucet/gas, Markets SDK (versions, perps method inventory, voucher + equity-scoring rules), Reactivity (off-chain vs on-chain, 32 STT gotcha), Somnia Agents (Tokyo testnet address, which agents run on Tokyo), Somnia CLI/MCP |
| [prior-art.md](prior-art.md) | Bot-kit "clone line", ~50 shipped competitor repos grouped by idea cluster + white-space read, Feedback-repo duplicate map, Event Contracts hackathon's 10 winners |

## Headline facts for idea-forge / architect

1. **Working deadline: 2026-11-15 14:30 UTC (15:30 WAT)** per the DoraHacks API `timeline_end` (`is_extended: true`); the Details body's "November 1, 23:59 UTC" is the stale original (`timeline_old_end`). User-confirmed.
2. **No judging weights are published.** MVP criteria: potential (value, scope, viral/repeat loop, execution) · evidence (live Tokyo-testnet orders, tx hashes, repo, demo) · communication (X posts).
3. **Build on chain 50383 (Hideki = Somnia Tokyo testnet).** Perps go through `@somnia-chain/markets-sdk` (docs pin 0.32.1; npm latest 0.33.0) or raw PerpPool calls. The dreamDEX HTTP API / CCXT / CLI are spot-only (Shannon 50312).
4. **A linked bot key (Link a Bot) can place/cancel/reduce but cannot arm exchange TP/SL, change leverage, or pull margin** → those must be app-side or bot-watched.
5. Paper USDso voucher: 1,000 USDso, one claim per address, flat account, allowlisted markets only (not 1000PEPE/LIT/PUMP/VVV/ZEC/ZRO), leverage locked.
6. Somnia plus-points that are realistic in 5 days: **off-chain Reactivity (free)**; on-chain Reactivity needs a **32 STT** owner balance (faucet gives 1 STT/h). **Somnia Agents on Tokyo testnet = JSON API Request + Price Oracle only** (LLM agents are Global-only).
7. Field is crowded (~200 public "dreamdex perps" repos; risk guards and "PerpPilot" AI agents saturated); the bot kit + dreamBot Builder already ship starter/maker/funding/guard.

## Provenance

Tool key: **Chrome** = claude-in-chrome (navigate + `get_page_text` / in-page `fetch`+`DOMParser` for server-rendered docs / `javascript_tool` for platform JSON); **gh** = GitHub CLI API; **npm** = `npm view`; **curl** = read-only JSON-RPC; **WebFetch/WebSearch** as named.

| # | Source | Fetched | Tool | Primary? | Confidence / gaps |
|---|---|---|---|---|---|
| 1 | https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail | 2026-11-10 | Chrome | primary | High. Body text is stale on dates (see event.md §1) |
| 2 | https://dorahacks.io/hackathon/dreamdex-perps-bounty/tracks | 2026-11-10 | Chrome | primary | High |
| 3 | https://dorahacks.io/hackathon/dreamdex-perps-bounty/announcements | 2026-11-10 | Chrome | primary | "The list is empty" |
| 4 | https://dorahacks.io/hackathon/dreamdex-perps-bounty/qa | 2026-11-10 | Chrome | secondary (hacker posts) | First page only ("View More" not expanded); posts contain other people's emails — deliberately NOT copied |
| 5 | https://dorahacks.io/api/v1/hub/hackathons/2443 | 2026-11-10 | Chrome (same-origin fetch) | primary (platform data) | High; timestamps, form questions, track ids, flags |
| 6 | https://app.testnet.dreamdex.io/docs/developers/perps-testnet | 2026-11-10 | Chrome | primary | High; the key dev page |
| 7 | …/docs/trading/perps-testnet (+ /margin-and-liquidations, /funding, /orders) | 2026-11-10 | Chrome (fetch+DOMParser) | primary | High; market table columns re-split by hand (spot-check at runtime) |
| 8 | …/docs/trading/common/link-a-bot, /fees, /order-types | 2026-11-10 | Chrome | primary | High (order-types fetched, not quoted) |
| 9 | …/docs/trading/spot/operators | 2026-11-10 | Chrome | primary | High; spot/Shannon addresses — perps uses its own registry |
| 10 | …/docs/developers, /developers/dreambot (+ strategies, dreamfly, run-your-bot) | 2026-11-10 | Chrome | primary | High |
| 11 | …/docs/developers/contracts (+ contract-addresses, errors; functions/events fetched, scanned only) | 2026-11-10 | Chrome | primary | High for spot; no perps-specific error/function pages exist |
| 12 | …/docs/developers/http-api (+ authentication, market-data, trading, error-handling; builder-fees/portfolio/wallets fetched not quoted) | 2026-11-10 | Chrome | primary | High; spot-only |
| 13 | …/docs/developers/libraries/ccxt, /welcome/quick-start, /welcome/roadmap, /support | 2026-11-10 | Chrome | primary | High |
| 14 | WebFetch of …/docs/trading/perps-testnet | 2026-11-10 | WebFetch | primary (paraphrased) | Used only to confirm SSR; content superseded by #7 |
| 15 | https://github.com/somnia-chain/dreamdex-bot-kit (metadata, tree, README, docs/perps.md, docs/gotchas.md outline, packages/perp-core/{package.json,index,operator,orders}.ts, root package.json) | 2026-11-10 | gh | primary | High; pushed 2026-10-29 |
| 16 | dreamdex-bot-kit issues (open list + #23, #7 bodies) and PRs (last 20) | 2026-11-10 | gh | primary | High; other issue bodies not read |
| 17 | https://github.com/somnia-chain/dreamdex-dreamfly, somnia-chain/ccxt (metadata) | 2026-11-10 | gh | primary | Metadata only |
| 18 | github.com/somnia-chain/somnia-markets | 2026-11-10 | gh | — | **Gap: not public** |
| 19 | npm `@somnia-chain/markets-sdk` | 2026-11-10 | npm | primary | High; release notes not read |
| 20 | https://somnia-platform-docs.vercel.app/markets/somnia-markets (+ /llms.txt) | 2026-11-10 | Chrome | primary | High |
| 21 | Somnia docs .md: /blockchain/{tokyo,networks,faucet}, /markets/perpetuals, /markets/somnia-markets/typescript/{perps (partial: headings, method inventory, shape, voucher, history), reactivity (first 7k), how-to/get-testnet-funds}, /developer/reactivity (+ onchain first 6k + headings, offchain first 3.5k), /agents, /agents/somnia-agents (first 6k), /agents/somnia-agents/invoking-agents/quickstart, /build/mcp | 2026-11-10 | Chrome (fetch) | primary | High for quoted parts; perps.md (84 KB), exchange.md, networks-and-endpoints.md, agents from-solidity/gas-fees/llm-inference, cli.md fetched but **not fully read** — read at Step 1 if needed |
| 22 | JSON-RPC probes: `eth_chainId`/`eth_blockNumber` on api.hideki2…, api.hideki…, api.infra.testnet…; `eth_getCode` MarginBank + USDso; GraphQL `__typename` on hideki-dev indexer | 2026-11-10 | curl | primary (live) | High; both Hideki hosts = 50383 |
| 23 | GitHub search `dreamdex perps` (pages 1–2, 203 total) and `dreamdex event contracts` | 2026-11-10 | gh | secondary | Descriptions only; repos ≠ confirmed submissions |
| 24 | https://dorahacks.io/org/3427/hackathon → hackathon 2358 JSON → https://dorahacks.io/hackathon/event-contracts/winner | 2026-11-10 | Chrome | primary | Names + one-liners; build links not captured |
| 25 | WebSearch "dreamDEX Event Contracts hackathon DoraHacks winners Somnia" | 2026-11-10 | WebSearch | secondary | No useful hits; superseded by #24 |

## Gaps (labelled, not filled)

- **Discord (discord.gg/dreamdex) and SomniaHacks Telegram — gated, not joined.** Session recordings/times, organizer answers, extra-USDso requests, whitelist status all live there.
- **Perps Arena rules page** — none found in the docs index; the bounty's "paper USDso every week" vs the SDK's "one claim per address" is unreconciled.
- **Results date post-extension**, **whether the extension covers both tracks**, **payout token/network** — unanswered in Q&A.
- **Perps mainnet launch date and chain** (for the $200 clause) — "coming soon" only.
- **Which chain the 21 dreamDEX perps markets will use on mainnet** (Tokyo 50321 is the likely, unconfirmed, target).
- Per-market PerpPool addresses (runtime read only); no perps-specific errors page; no Hideki USDso mint.
- dreamBot Builder and Perps Arena app UIs (need wallet sign-in) — not rendered; behaviour taken from docs.
- Event Contracts winners' repo/build links; Q&A beyond first page.
- User's whitelist status was user-attested to the guide, not verified here.

## Freshness / drift flags

- SDK version: docs 0.32.1 · bot kit ^0.31.0 · npm latest 0.33.0 (2026-11-09).
- Somnia SDK perps page says only BTC/ETH perps live; the dreamDEX app lists 21 markets.
- RPC host: dreamDEX `api.hideki2…` vs Somnia `api.hideki…` — both live.
- Market params "can be retuned at any time" — read `listPerpMarkets()` / `getOrderBookParameters()` at runtime.
