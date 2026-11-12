# Basanos — design spec

> Basanos (Greek: the touchstone, the original test a metal's purity is checked against) runs
> prop-firm-style challenges on dreamDEX perps: a published rulebook, a referee key that watches the
> account every block and flattens it on a breach (it can close, never withdraw), and an on-chain
> verdict, with a certificate on a pass, that anyone can replay from chain state.

**Trust model (verbatim, used unchanged in this spec, the README and the landing copy):**
**"Every certificate is chain-checked at mint; every verdict is replayable."**
Never write "the contract verifies every verdict".

- **Status:** approved design (architect Step 1, 2026-11-10). Source brief:
  `docs/idea-forge/2026-11-10-verdict-brief.md` (working title "Verdict" = Basanos; "verdict" stays the
  in-product noun for a pass/fail result).
- **Architect seat:** `claude-opus-5-5`, tier `top`, effort `xhigh` (user-attested).

## 0. Header — target, runtime, deadline, constraints (verbatim from the kickoff)

| Field | Value |
|---|---|
| Chain | Somnia Tokyo testnet = Hideki, chain **50383**. RPC `https://api.hideki.infra.testnet.somnia.network` (WSS `wss://api.hideki.infra.testnet.somnia.network/ws`), fallback `https://api.hideki2.infra.testnet.somnia.network` (WSS `wss://api.hideki2.infra.testnet.somnia.network/ws`). Explorer `https://explorer.testnet.somnia.network/tokyo`. |
| Off-chain runtime | TypeScript/Node (Node v22.23.4 installed), strict ESM. |
| SDK pin | `@somnia-chain/markets-sdk` exactly **`0.33.0`**; fallback pin `0.32.1` (switch if the first real order on 0.33.0 has not landed within ~2 h of starting the skeleton). |
| Contract | Solidity verdict registry on Hideki. |
| Frontend | React for the terminal and verdict pages; a static marketing landing page. |
| Hard deadline | **2026-11-15 15:30 WAT (14:30 UTC)**. Internal hard stop: **submitted by 2026-11-15 09:00 WAT**. |
| Tripwire | A walking skeleton FIRST — one real order on Tokyo testnet with a tx hash by end of **2026-11-11**, money shot before polish. |
| Track | MVP (category trader tools, with bots and agents served by the same rulebook); Feedback as a by-product only. |

Constraints (verbatim from the architect kickoff):

- Burner testnet wallet only, no secret in the repo (.env git-ignored).
- README with what / who it's for / how to run plus an "X posts" section (2–3 posts tagging
  @DreamDEXSomnia — a human gate, published by the user).
- Log every reproducible dreamDEX/Somnia API, SDK, docs or contract defect met during the build as
  `feedback/<slug>.md` using the template in the pack's `event.md` §3, with tx-hash or request/response
  evidence. Never put a security issue in the repo; skip anything already filed (bot-kit issues #26–#45,
  prior-art.md §C).
- All UI follows docs/design/frontend.md. Every frontend task's code applies its tokens, type, layout and
  components, and its task block cites the file.
- Team = solo + AI (the user + the autonomous agent pool).
- Must land the demo money shot.
- Out of scope: real funding, payouts, fees or any money movement; on-chain Reactivity (32 STT owner
  balance); linked-wallet sub-accounts and main funding; builder fees; mainnet; copy-trading or any
  marketplace built on certificates; our own AI trading agent as a product; exchange TP/SL armed by the
  referee; anti-collusion forensics (documented limitation); Discord/Telegram bots, mobile apps, Shannon
  spot, Event Contracts.

Guide guards G1–G6 and notes R1–R5 are binding; each is mapped to the section that satisfies it in §17.

## 1. Product and scope

**What it is.** A trader (or a bot) takes a published rulebook challenge on a dreamDEX perps account on
Hideki. The account grants the Basanos referee key place + cancel rights (never withdraw), enrolls in
the on-chain registry, and trades any way it likes (the Basanos terminal, the dreamDEX app, its own bot).
The referee watches the account at every price write; on a breach it cancels resting orders and closes
the position with real perps orders, then records **FAILED** with the rule, the breach block and the
close tx hashes. When the profit target is reached after the minimum time, the referee locks the gain
(flattens) and the registry, reading the account's end state itself, records **PASSED** and mints a
non-transferable certificate. Every verdict page replays the reads at their pinned blocks.

**Who it is for.** Traders who want a pass they can show; bot and agent builders who must prove a bot
trades inside a rulebook before anyone links its key; (later, on mainnet) desks and DAOs that publish a
rulebook and fund the accounts that pass.

**In scope (ships):**
1. Day-1 de-risk spike + walking skeleton (G1).
2. `BasanosRegistry` (Solidity) with the soulbound certificate. It also holds a Price Oracle cross-check, asked at each PASS and FAIL verdict inside `try` (best-effort; see §3a G1(d)).
3. The referee daemon + CLI (TypeScript) and a scripted bot that takes the same rulebook.
4. The web app: challenge terminal, verdict page with replay, certificate page.
5. **A marketing landing page for Basanos — required scope, not a stretch** (user directive
   2026-11-10, relayed by the guide; the brief is unchanged). See §11.
6. README (with the X posts section), demo, X post drafts, feedback files, the public deploy (Vercel).

**One rulebook (G2):** "Tokyo Sprint", shipped as two registered parameter sets of the same schema —
`tokyo-sprint` (standard) and `tokyo-sprint-demo` (demo mode, §5). No other rulebooks or levels.

**Cut order (amended by the user directive, first to go):** landing scenes / shader moments → Price
Oracle cross-check (cut on 2026-11-11, then **restored the same day**: probe P1, one symbol through the registry's own 4-argument path, finalized Success as request 7782661. `ORACLE_ENABLED=true`, and every surface shows a reading only when one was recorded.) → X card / share polish → certificate polish → extra rulebooks / levels.
**Never cut:** the referee's close with tx hashes, the registry verdict record, the verdict page with
replay, README + X posts, and — once built — the landing's hero + CTAs + three steps + the link to a
real verdict page.

**Out of scope:** exactly the kickoff list in §0. Also not built: a hosted referee (it runs on the
builder's machine; the README shows how anyone runs one), per-verdict server-rendered pages.

**Documented post-hackathon upgrades (not built):** registry-checks-every-breach (the registry records a
FAIL at the breach block by re-reading equity before the close); an on-chain Reactivity judge (needs a
32 STT owner balance); anyone-callable expiry; multi-market rulebooks; anti-collusion forensics.

## 2. Trust model

"Every certificate is chain-checked at mint; every verdict is replayable."

| Fact | Who establishes it | How a third party checks it |
|---|---|---|
| Start equity, start block, account flat, referee grant held | **the registry, in the `startRun` tx** (it calls MarginBank and the pool itself) | read the tx's stored `start` read; replay the same calls at `start.blockNumber` |
| PASS: flat in every market, no locked collateral, equity ≥ target, min time elapsed, within time limit, grant held | **the registry, in the `recordPass` tx**; the certificate mints only if all hold | same as above at `end.blockNumber` |
| FAIL: which rule, breach block, breach reads | the referee (attested), stored on-chain with raw reads + close tx hashes + evidence hash | replay the four calls at `breach.blockNumber`; re-read the book (`getBookLevels`, both sides) at that block and revalue the stored equity to the closeable equity the rule judged (§5); re-run the evaluator over the stored reads and that book |
| FAIL end state (equity after the close) | the registry, in the `recordFail` tx | replay at `end.blockNumber` |
| FAIL by time limit | the registry checks `block.timestamp > startTime + timeLimitSec` | the block timestamp |
| VOID (flow, foreign market) | the referee (attested) with the triggering tx hash | look up that tx |
| VOID (grant revoked) | anyone can call `voidRevoked`; the registry checks the grant is gone | the pool's `isOperatorAuthorized` |
| Path rules (daily loss, trailing drawdown, exposure) | the referee; never claimed as contract-checked | replay |

**Raw reads stored with every verdict (R2).** Each stored `Read` is `{blockNumber, equityOk, equity,
lockedCollateral, positionSize, markOk, markPrice}`, and each field is the return value of a fixed call:
`MarginBank.tryGetAccountEquity(account)`, `MarginBank.getAccountState(account).lockedCollateral`,
`MarginBank.getPosition(account, pool).size`, `PerpPool.tryGetMarkPrice()`. The replay page re-runs those
calls at that block; when the RPC no longer serves that state, it shows the stored values labelled
"stored on-chain, state no longer served by the public RPC". The closeable equity a FAIL was judged on (§5) is
not a stored field, because the `Read` struct is fixed. It is the stored equity revalued at the book in the breach
block. The referee's evidence bundle records that equity and that book (its hash is on-chain), and the verdict
page re-reads the book at the block to show it (web:12).

**Replay horizon.** Stage-1 probe (2026-11-10 ~17:03 WAT, block 46,725,618): the public Hideki RPC
served `USDso.totalSupply()` at **10,000,000 blocks back (2026-10-30, ≈ 11.6 days)**; measured with the equity view: equity view served 20,000,000 blocks back (≈ 23.1 days), with values that
change over time (archive state). Task `spike:13` replaces this line's measurement with the
equity-view measurement (`tryGetAccountEquity` at depth) and writes the real horizon here. Judging
happens after 2026-11-15 and the results date is unpublished, hence the stored raw reads.

## 3. Stage-1 evidence (architect probes, 2026-11-10, read-only, no STT spent)

| Probe | Result |
|---|---|
| SDK 0.33.0 vs 0.32.1 `listPerpMarkets` via the public indexer | both OK: **40** perp markets (docs list 21) |
| BTC-PERP row | pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`, marginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, baseDecimals 8, quoteDecimals 18, quoteToken `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72`, initialMarginBps 250, stopRegistry `0x52e2ccebaec9332672c247e9a90aa3d61fb615ef`, index ≈ 74,509 USDso |
| `getPerpSystemConfig` | maxLeverageLimit 40, fullyWired true, collateral = USDso `0xed79…4F72` |
| `getPerpVoucherCampaign` | live; grantAmount 1,000 USDso; `leverageCapX: 20`; 70,779 claims remaining; expiry 14 days |
| `getVenueHealth` (0.33.0) | `ok` (indexer 0 s behind, RPC OK, price feed 0 s) |
| `somnia_watch` on MarginBank with an attached `eth_call` | works: 2,254 pushes / 20 s (all accounts); payload keys `address, topics, data, simulationResults` — **no block number, no tx hash** |
| `somnia_watch` on PriceFeedScheduler `0x1998C88D54a240b8C671493f27f58eC416b81D7F` with `Multicall3.getBlockNumber()` attached | ~5 pushes / s; the attached call returns the block |
| Historical `eth_call` | served ≥ 10,000,000 blocks back (≈ 11.6 days) |
| EIP-1898 block objects | `{blockNumber}` → `-32602 invalid parameters`; `{blockHash}` → OK (same defect as bot-kit #37, so already filed) |
| `eth_getCode` | OperatorPermissionsRegistry `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a` (176 B proxy), SomniaAgents `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3` (130 B), VoucherDistributor `0x2ACD…42C4` (176 B), Multicall3 (3,808 B) |
| `eth_gasPrice` | 6 gwei; client `somnia-0001bb9a5845925-release` |
| Toolchain on this machine | forge/anvil 1.7.1, pnpm 10.33.0, npm 10.9.9, Node 22.23.4, Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`, Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe` |

**SDK facts read from the 0.33.0 package source (authoritative for plans):**
- `SOMNIA_HIDEKI_TESTNET_ADDRESSES` has **no `operatorPermissionsRegistry`**, and the SDK's grant helper
  says "SPOT-ONLY", although perp stop orders write `setOperatorApprovalForPool` on the same registry.
  Basanos passes `operatorPermissionsRegistry: 0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a` in its config
  (a Feedback candidate, §16).
- The SDK has no perp `…For` writes. The referee sends `placeOrderFor` / `cancelOrderFor` with viem.
- There is **no reduce-only flag** in `placeOrder` / `placeOrderFor`; a close is an opposite-side IOC
  (`orderType = 2`) sized to the position.
- `getOwnOpenOrders()` on a pool answers for `msg.sender`, so it is read with `eth_call` `from = owner`
  and never through Multicall3.
- MarginBank views: `tryGetAccountEquity(address) → (bool ok, int256 equity)`,
  `getAccountState(address) → (int256 unlockedCollateralBalance, uint256 lockedCollateral, address[]
  activePerpPools)`, `getPosition(address account, address perpPool) → (int128 size, uint128
  avgEntryPrice, int256 entryFundingIndex, uint64 lastUpdatedTimestampNs)`. `totalEquity = equity +
  lockedCollateral`.
- MarginBank events (topic1 = account): `PositionUpdated`, `FundingSettled`, `Deposited`, `DepositedFor`,
  `Withdrawn`, `CollateralLocked`, `CollateralUnlocked`, `FeeCharged`, `RebatePaid`, `AutoDeleveraged`,
  `CloseOutMarginSettled`, `BadDebtAbsorbed`, `PositionTransferred`, `LiquidationOrderPanicked`,
  `MainFundedChild`, `IsolatedModeSet`, `MaxLeverageSet`, `BuilderFeeCharged`; voucher events
  (`AccountCredited` / `CreditReclaimed`) are not in the SDK's ABI.

**Open until the spike runs:** G1(a) the referee's close on a funded account (deposited USDso; no voucher, B14), the per-account `getPerpLeverage` read for (e), the
equity-view history depth (c), and R1's three indexer reads. Task `spike:13` writes each answer, with
its evidence file, into §3a below. G1(d) is answered (2026-11-11). The two-symbol request finalized Failed (Majority consensus). Probe P1 (one symbol, the registry's own path) finalized Success, so the cross-check stays (§1).

### 3a. Spike evidence (written by task `spike:13`)

| Item | Evidence file | Result |
|---|---|---|
| G1(a) referee close on a funded account | `docs/evidence/g1a-close.json` | PASS — flat after 1 close attempt, 5 txs. The entry filled at the best ask: slippage 0 bps (`entry.costVsBookBps`) and a spread of 0.13 bps (`entry.spreadBps`). The fill sits 21.05 bps above the mark (`entry.costBps`); that is the mark-to-book basis, not a cost (§5, closeable equity) |
| G1(b) watch with attached equity multicall | `docs/evidence/g1b-watch.json` | 117 price pushes and 1168 account pushes in 30s; equity decoded: true; block timestamp unit: seconds |
| G1(c) equity history depth | `docs/evidence/g1c-history.json` | equity view served 20,000,000 blocks back (≈ 23.1 days) |
| G1(d) Price Oracle `BTC/USDC:PERP` | `docs/evidence/g1d-oracle.json` | **Failed.** Request 7773100 (createRequest tx `0xdf795f1f…a30d`, block 47437497) finalized Failed one block later (`RequestFinalized` status 3, tx `0x851aaa04…2301`). All three validators answered Success with prices: `BTC/USDC:PERP` 73,976.65 from 7 sources, identical across the three; `BTC/USDC` 74,008.55–74,011.48 from 6–7 sources, differing. The 4-argument `createRequest` uses Majority consensus, which needs byte-identical answers, so the request failed and no consensus price reached the callback. dreamDEX's PriceFeedScheduler uses `createAdvancedRequest` with Threshold consensus (3 validators, threshold 2, 30 s, 0.06 STT) and succeeds every 5 blocks. **Probe P1** (request 7782661: one symbol, `BTC/USDC:PERP`, through the registry's own 4-argument path, 0.0309 STT) finalized **Success**. Two of three validators answered byte-identically (≈ 73,735.85, 6 sources), which Majority needs; the evidence is `docs/evidence/g1d-probe-p1.json`. The cross-check is restored: `ORACLE_ENABLED=true`. A request can still fail, so every surface shows a reading only when one was recorded. |
| G1(e) leverage cap that applies (the voucher's 20× only for a voucher account, else the market's 40×) | `docs/evidence/g1a-close.json` (`leverage` field) | PASS — the cap that applies is 40× (`leverage.capX` 40, `capSource` market). No voucher was claimed, so the voucher's 20× does not apply |
| R1 indexer reads | `docs/evidence/r1-indexer.json` | getMarginEvents: ok; listPerpMarginPulls: ok; listPerpMainFundingEvents: ok |
| Live mark tape for G4 | `packages/core/test/fixtures/btc-tape.json` | 2153 BTC mark points over 540s |
| Measured STT cost per tx | `docs/evidence/g1a-close.json` (`costs`) | 0.0436 STT for the 5 txs (gasUsed × effectiveGasPrice at 6 gwei): grant 0.00335, open 0.0189, rest 0.00979, cancel 0.00102, close 0.0105 |

## 4. Architecture and repo layout

npm workspaces monorepo (Node 22, npm 10). Every package builds and tests on its own.

```
package.json                 workspaces: packages/*, apps/*; scripts test/build per workspace
tsconfig.base.json           strict, ES2022, NodeNext
.env.example                 every env name in §13, no values
rulebooks/tokyo-sprint.json, rulebooks/tokyo-sprint-demo.json
packages/core/               @basanos/core — config, ABIs, env loader, rulebook schema+hash, snapshot multicall,
                             somnia_watch client, close-plan math, evaluator (pure), log classifier
packages/spike/              @basanos/spike — G1 evidence scripts + evidence checker
packages/referee/            @basanos/referee — daemon, close protocol, registry writer, CLI
packages/bot/                @basanos/bot — scripted challenger + demo runner
contracts/                   Foundry — BasanosRegistry.sol, interfaces, mocks, tests, export-abi script
apps/web/                    @basanos/web — React + Vite app served at /app/ (terminal, verdict, certificate)
apps/landing/                @basanos/landing — static marketing page served at /
docs/evidence/               spike + demo evidence JSON (committed; no secrets)
feedback/                    one Markdown file per reproducible defect (event template)
deployments/hideki.json      registry address, deploy block, rulebook ids (written by the deploy task)
```

Data flow: trader/bot → (grant + `startRun`) → registry; referee ← `somnia_watch` (price writes +
account logs, each with the snapshot multicall) → evaluator → close protocol (`cancelOrderFor`,
`placeOrderFor` IOC) → `recordFail` / `recordPass` (+ an oracle request when `ORACLE_ENABLED=true`, as in this build) → registry → web verdict page
(reads registry, replays at pinned blocks).

## 5. The Tokyo Sprint rulebook

Canonical JSON (`schema: "basanos.rulebook/1"`). `rulebookId = keccak256(utf8(canonicalJson(rb)))`, where
`canonicalJson` sorts object keys recursively and emits no whitespace. The registry stores the id and the
contract-checked fields; the full JSON is published in `rulebooks/` and on the verdict page.

| Field | `tokyo-sprint` | `tokyo-sprint-demo` | Enforced by |
|---|---|---|---|
| market | BTC-PERP, pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0` | same | registry (grant + flat checks are per pool) / referee |
| `profitTargetBps` | 150 (+1.5%) | 50 (+0.5%) | **registry at mint** |
| `minDurationSec` | 120 | 60 | **registry at mint** |
| `timeLimitSec` | 1800 | 1200 (v1: 900) | **registry** (FAIL `TimeLimit` only after it) |
| `dailyLossBps` | 150 (−1.5% from the UTC-day start equity) | 150 (v1: 50) | referee, replay |
| `trailingDrawdownBps` | 200 (−2.0% from the high-water mark) | 200 (v1: 75) | referee, replay |
| `maxExposureX` | 15 (account notional ≤ 15 × totalEquity) | 15 | referee, replay |
| `oracleSymbol` | `BTC/USDC:PERP` | same | registry (oracle request) |
| VOID on | money flow, a position in another market, grant revoked | same | referee / anyone |

The demo column is **demo v2** (architect ruling P7, 2026-11-12; *Demo mode* below). `rulebooks/tokyo-sprint-demo-v1.json` keeps the first registered demo byte-identical (id `0x59e93903…0757`), so the rehearsal's runs 1 and 2 still resolve in the referee, the web app and the featured-run snapshot.

**Tuning to the leverage cap.** The demo accounts are not voucher accounts. `claim()` reverts chain-wide (B14), so each account holds its own USDso, deposited into its MarginBank balance (≈ 50 USDso each, 2026-11-12).
- **The cap that applies** is the market's 40× (`marketMaxLeverageBps` 400000). The voucher's 20× cap binds only a voucher account.
- **Why the cap matters:** the exposure cap (15×) sits below either cap, so an exposure breach is still reachable on demand (the bot's breach goes to 16×).
- **Demo sizing is 10×** (`DEMO_LEVERAGE_X`; ruling P7, 2026-11-12; 5× under P5, 12× before) of live equity. At ≈ 50 USDso that is ≈ 500 USDso of notional, ≈ 0.007 BTC, about 54 times the 0.00013 BTC minimum. Sizing scales with equity, so nothing assumes 1,000 USDso (referee:11).
- **What a move does at 10×:** a 0.05% BTC move is ±0.5% equity (the demo's target), and a 0.15% move is ±1.5% (demo v2's daily floor). Opening costs the spread × 10 at once: the replay's median round trip, 1.57 bps of notional, is about 16 equity bps (below).

**Closeable equity (architect ruling P5, 2026-11-12).** Every equity rule judges *closeable equity*, not the marked equity.
- **What it is:** the MarginBank equity revalued from the mark to the book levels that would fill a close of the position (bids for a long, asks for a short), read in the same block. Flat, it equals the marked equity.
- **Why (the measurement):** the BTC-PERP book trades about 19 bps above the on-chain mark. The guide's read-only samples showed best bid +18.1 to +19.9 bps and best ask +19.5 to +21.7 bps above `getMarkPrice`. The architect's re-read found a spread of 1.2 to 3.6 bps and zero taker and maker fees (`getPerpPoolParameters`).
- **What the mark alone does:** opening books an instant paper PnL of about ±19 bps × leverage. A fresh 12× long reads −252 bps, an unearned DailyLoss on either rulebook. A fresh 12× short reads +228 bps, a phantom target that only a real move could realize. Under closeable equity, both start only the spread down.
- **Consistency:** it is the number the PASS lock locks from (since P7, the push's own closeable equity with a 10 bps buffer; before, the SDK's `quotePerpClose` prediction), and what the registry's flat-equity check at mint realizes.
- **Pause:** a position the levels read cannot price (an empty side, or a size beyond `BOOK_DEPTH` = 20 levels) pauses judging, like an unpriceable mark.
- **Rejected:**
  - Lowering leverage or widening thresholds alone: the basis × leverage hits both rulebooks, and new thresholds would need a new registration.
  - Re-baselining after entry: stateful across fills and funding, and not replayable from one read.
- **Unchanged:** both rulebooks and their registered ids.
- **Opening orders:** IOCs are capped from the book too, at best ask + 20 bps to buy and best bid − 20 bps to sell (`OPEN_MARGIN_BPS`). An IOC fills at the book's prices, so the cap only bounds slippage. A mark + 20 bps buy sits below the whole ask side and reverts (`0xd48c4403`; spike:11's first GO stopped on it).
- **Closing orders:** capped from the book too since P7: best ask + 20, 50, 100 bps to buy back a short, best bid − the same to sell a long. The mark ladder (mark ± 20, 50, 100 bps) is the fallback, and the more permissive limit wins (§8). In the rehearsal, B's first close at mark + 20 bps reverted under a book about 20 bps above the mark.

**Demo mode (G4).** `tokyo-sprint-demo` is the same rulebook schema with tighter numbers, registered
with its own id and labelled "Tokyo Sprint · Demo" on every surface that shows it. `npm run demo -w
@basanos/bot` starts both challenge accounts on it together and opens opposite 10× positions in the same block: the
human's long from the terminal with B's short right after it, or both by the runner. It then streams both runs. Once one run PASSES, the runner pushes the other past the
15× exposure cap, a FAIL on demand, so the take ends one PASS and one FAIL. If neither run PASSES within the 20-minute
limit, both end FAILED and the next take starts after a faucet top-up. (A take that fails after a run started is
aborted, which is a different case: §9.)

**Demo v2, from data (architect ruling P7, 2026-11-12).**
- **Why v1 failed:** the rehearsal's two runs both FAILED DailyLoss (guide diagnosis B19). At 5×, v1's 0.50% band is 10 bps of BTC price, which BTC crosses in tens of seconds. The target equalled the floor, and the two entries were 13 s apart.
- **The replay:** `demo-replay` (`packages/bot/src/demo-replay.ts`) sampled 12 hours of on-chain history: blocks 47,994,246 to 48,426,246, one Multicall3 read a second at past blocks (timestamp, mark, 10 levels a side), 43,201 samples.
  - It replayed an opposite pair opened in the same block every 60 s through the evaluator on closeable equity.
  - It closed a FAIL, and locked a PASS, 3 s (or 7 s) after the verdict, at that later block's book.
  - The results are in `docs/evidence/demo-replay.json`:

| candidate | windows | P(≥ 1 PASS) | P(both FAIL) | first PASS, median / p90 |
|---|---|---|---|---|
| v1 at 5×, closes 7 s after the verdict (as rehearsed) | 705 | 64.7% | 35.3% | 296 s / 709 s |
| **v2 at 10×, closes 3 s after (chosen)** | 700 | **95.6%** | 4.4% | 226 s / 703 s |
| v2 at 10×, closes 7 s after | 700 | 94.9% | 5.1% | 233 s / 707 s |
| v2 with a 900 s limit | 705 | 91.2% | 8.8% | 213 s / 616 s |
| v2 at 5× / 8× / 12× | 700 | 69.7% / 90.9% / 97.4% | 30.3% / 9.1% / 2.6% | 356 / 269 / 192 s median |
| v2 with a +0.40% target, at 10× | 700 | 98.6% | 1.4% | 189 s / 611 s |
| v2 with v1's 0.50% / 0.75% floors, at 10× | 700 | 60.7% | 39.3% | 177 s / 521 s |

- **Reading the table:** with the FAIL on demand, P(≥ 1 PASS) is also P(one PASS + one FAIL). Left to the market, the chosen set gives one PASS and one FAIL in 81.6% of windows. Refused locks: 0.6%. Funding is not modeled; fees are 0. Every 2-hour stretch of the sample clears 93% for the chosen set.
- **Validation:** the replay reproduces the rehearsal. B judged −52.92 bps (actual −52.9) and realized −59.08 at 7 s (actual −57.8); A judged −54.46 (actual −54.8) and realized −65.52 (actual −65.7).
- **Why these numbers:**
  - The +0.50% target stays, so every surface that quotes it stays true. At 10× it is a 5 bps price move.
  - The floors widen to 1.5% daily and 2% trailing: at 10×, v1's 0.50% floor is a 5 bps whipsaw that kills both sides (60.7%).
  - The time limit grows to 20 minutes.
  - 12× and a +0.40% target score higher, but 12× loses more to a close gap, and a +0.40% target is a weaker claim. 10× with +0.50% clears the guide's ~85% bar with room.
- **The skeleton proves the math.**
- **What the spike records:** a live 9-minute (540 s) BTC mark tape, and the real entry fill against the mark and the book (`docs/evidence/g1a-close.json`: `entry.costBps` is the basis, `entry.costVsBookBps` the slippage, `entry.spreadBps` the spread).
- **The tape test:** a core test replays the tape at 10× on demo v2 with a 3.6 bps round trip paid at entry, and none at the close, since closeable equity already values the exit side. It asserts that both sides resolve.
- **The live check:** `demo-check` measures the live round trip for the demo size from one book read. It passes when the round trip is at most half the 50 bps target, which is 2.5 bps of notional at 10×. The replay's median round trip is 1.57 bps and its p90 2.39, so the check fails about 7% of the time.
- **If the check fails:** wait and re-run. A wide spread is a moment, not a parameter; the rulebook is never changed for it.

**Who operates the demo accounts.** Both demo challenge accounts are burners operated by the builder:
account A is driven by a human from the terminal, account B is the scripted bot. The README and the
landing page say so in plain words; no surface implies independent traders.

**Clock.** The evaluator's `nowSec` is the snapshot block's timestamp (from the multicall's
`getCurrentBlockTimestamp`), never the referee's wall clock, so `recordFail(TimeLimit)` and
`recordPass` see the same clock the contract checks. The spike records the timestamp unit (seconds
expected; the RPC's block headers are seconds).

**Evaluation order per snapshot (referee, pure function in `@basanos/core`).** `totalEquity` below is the closeable
equity whenever the referee has the book of the snapshot's block (always, since referee:14); the tape simulator,
which has no book, values at the mark.
1. `equityOk` or `markOk` false → `pause` (unpriceable; no verdict, no breach).
2. Any active pool other than the rulebook pool → `void` (`ForeignMarket`).
2a. An open position the same-block book cannot price (book read failed, a side empty, or deeper than the levels
   read) → `pause` (unpriceable).
3. Update the high-water mark and the UTC-day start equity (first snapshot of a new UTC day).
4. `nowSec > startTime + timeLimitSec` → `fail` (`TimeLimit`).
5. `totalEquity ≤ dayStart × (10000 − dailyLossBps) / 10000` → `fail` (`DailyLoss`).
6. `totalEquity ≤ hwm × (10000 − trailingDrawdownBps) / 10000` → `fail` (`TrailingDrawdown`).
7. `|size| × mark / 10^baseDecimals > totalEquity × maxExposureX` → `fail` (`MaxExposure`).
8. `totalEquity ≥ start × (10000 + profitTargetBps) / 10000` and `nowSec ≥ startTime + minDurationSec`
   → `target` (the referee locks only once that closeable equity clears the target by `LOCK_BUFFER_BPS` = 10, so
   the close cannot slip back under it before the registry's check; otherwise it keeps watching).
9. Otherwise `ok`.

MarginBank log classes (account-filtered pushes): trading = `PositionUpdated`, `FundingSettled`,
`CollateralLocked`, `CollateralUnlocked`, `FeeCharged`, `RebatePaid`, `BuilderFeeCharged`; liquidation =
`AutoDeleveraged`, `CloseOutMarginSettled`, `BadDebtAbsorbed`, `LiquidationOrderPanicked` → `fail`
(`Liquidated`); everything else, including any unknown topic0 (voucher credits, deposits, withdrawals,
main funding, transfers, isolation/leverage changes) → `void` (`Flow`). This makes the verdict path
independent of `getMarginEvents`, `listPerpMarginPulls` and `listPerpMainFundingEvents` (R1).

## 6. BasanosRegistry (Solidity)

solc **0.8.28**, `evm_version = "cancun"` (never osaka: bot-kit #36). If the first deploy rejects the
bytecode, recompile with `paris` and record it. Foundry 1.7.1, forge-std v1.16.2. Unit tests use mocks
(the RPC rejects EIP-1898 objects, so no fork tests); R5's live gate calls `previewStart` against the
real MarginBank after deploy. Verification: `forge verify-contract` against the explorer's verifier if
it accepts the build, plus a repo script that matches the on-chain runtime bytecode against the forge
artifact (independent of the explorer).

### 6.1 Interfaces it calls

```solidity
interface IMarginBank {
    struct AccountState { int256 unlockedCollateralBalance; uint256 lockedCollateral; address[] activePerpPools; }
    struct Position { int128 size; uint128 avgEntryPrice; int256 entryFundingIndex; uint64 lastUpdatedTimestampNs; }
    function getAccountState(address account) external view returns (AccountState memory);
    function tryGetAccountEquity(address account) external view returns (bool ok, int256 equity);
    function getPosition(address account, address perpPool) external view returns (Position memory);
}
interface IPerpPool {
    function isOperatorAuthorized(address owner, address operator, bytes4 selector) external view returns (bool);
    function tryGetMarkPrice() external view returns (bool ok, uint256 price);
}
interface ISomniaAgents {
    function createRequest(uint256 agentId, address callbackAddress, bytes4 callbackSelector, bytes calldata payload)
        external payable returns (uint256 requestId);
}
interface IPriceOracleAgent {
    function getPrices(string[] calldata symbols, uint8 decimals)
        external returns (uint256[] memory prices, uint8[] memory numSources, uint64[] memory lastUpdated);
}
```

SomniaAgents callback types (verbatim from the Somnia docs): `enum ConsensusType { Majority, Threshold,
FirstQuorum }`, `enum ResponseStatus { None, Pending, Success, Failed, TimedOut }`, `struct Response {
address validator; bytes result; ResponseStatus status; uint256 receipt; uint256 timestamp; uint256
executionCost; }`, `struct Request { uint256 id; address requester; address callbackAddress; bytes4
callbackSelector; address[] subcommittee; Response[] responses; uint256 responseCount; uint256
failureCount; uint256 threshold; uint256 createdAt; uint256 deadline; ResponseStatus status;
ConsensusType consensusType; uint256 remainingBudget; uint256 perAgentBudget; }`. Price Oracle agent id
`9911223344556677889`; practical deposit **0.0309 STT**.

### 6.2 Public surface (exact; plans paste these)

```solidity
enum Status { None, Active, Passed, Failed, Voided }
enum Rule { None, DailyLoss, TrailingDrawdown, MaxExposure, TimeLimit, Liquidated }
enum VoidReason { None, Flow, ForeignMarket, GrantRevoked }

struct Read {
    uint64 blockNumber; bool equityOk; int256 equity; uint256 lockedCollateral;
    int128 positionSize; bool markOk; uint256 markPrice;
}
struct RulebookParams {
    address pool; uint32 profitTargetBps; uint32 minDurationSec; uint32 timeLimitSec;
    string oracleSymbol; bool exists;
}
struct Run {
    address account; bytes32 rulebookId; Status status; Rule rule; VoidReason voidReason;
    uint64 startTime; uint64 endTime; Read start; Read breach; Read end;
    bytes32 evidenceHash; bytes32 voidTxHash;
    uint256 oracleRequestId; uint256 oraclePrice; uint8 oracleSources; uint64 oracleUpdatedAt; bool oracleDone;
}

constructor(address marginBank, address somniaAgents, address referee, string memory baseUrl)
function owner() external view returns (address)
function referee() external view returns (address)
function marginBank() external view returns (address)
function oracleDeposit() external view returns (uint256)          // default 0.0309 ether
function registerRulebook(bytes32 id, address pool, uint32 profitTargetBps, uint32 minDurationSec,
    uint32 timeLimitSec, string calldata oracleSymbol) external     // owner only
function getRulebook(bytes32 id) external view returns (RulebookParams memory)
function previewStart(address account, bytes32 rulebookId) external view returns (uint8 code, Read memory read)
function startRun(address account, bytes32 rulebookId) external returns (uint256 runId)   // account or referee
function recordPass(uint256 runId) external payable                // referee only
function recordFail(uint256 runId, Rule rule, Read calldata breach, bytes32 evidenceHash,
    bytes32[] calldata closeTxs) external payable                   // referee only
function recordVoid(uint256 runId, VoidReason reason, bytes32 txHash, bytes32 evidenceHash) external // referee only
function voidRevoked(uint256 runId) external                       // anyone
function handleOracle(uint256 requestId, Response[] calldata responses, ResponseStatus status,
    Request calldata details) external                              // SomniaAgents only
function getRun(uint256 runId) external view returns (Run memory)
function getCloseTxs(uint256 runId) external view returns (bytes32[] memory)
function getActiveRunIds() external view returns (uint256[] memory)
function activeRunOf(address account) external view returns (uint256)
function runCount() external view returns (uint256)
// certificate (ERC-721 + ERC-5192, soulbound): name "Basanos Certificate", symbol "BSNC", tokenId = runId
function balanceOf(address) external view returns (uint256)
function ownerOf(uint256) external view returns (address)
function tokenURI(uint256) external view returns (string memory)   // data:application/json;base64,… (base64: the URL holds a '#')
function locked(uint256) external view returns (bool)              // always true for a minted id
function supportsInterface(bytes4) external view returns (bool)    // 0x01ffc9a7, 0x80ac58cd, 0x5b5e139f, 0xb45a3c0e
// approve / setApprovalForAll / transferFrom / safeTransferFrom revert Soulbound()
function setOracleDeposit(uint256 wei_) external                   // owner only
function setBaseUrl(string calldata url) external                  // owner only (certificate external_url base, set after the Vercel deploy)
function baseUrl() external view returns (string memory)
function withdraw(address payable to) external                    // owner only (oracle rebates, failed requests)
receive() external payable                                         // SomniaAgents rebates the unused deposit here
```

Only `recordPass` and `recordFail` are payable and only they request the oracle; `recordVoid` and
`voidRevoked` never do. `recordVoid` reverts `InvalidVoidReason()` for `GrantRevoked` (and `None`):
only `voidRevoked`, after its on-chain check, can set `GrantRevoked`.

`previewStart` codes: 0 ok, 1 unknown rulebook, 2 account already has an active run, 3 place or cancel
grant missing, 4 not flat (active pools or locked collateral), 5 unpriceable, 6 non-positive equity.

Events: `RulebookRegistered(bytes32 indexed id, address pool, uint32 profitTargetBps, uint32
minDurationSec, uint32 timeLimitSec, string oracleSymbol)`, `RunStarted(uint256 indexed runId, address
indexed account, bytes32 indexed rulebookId, uint64 blockNumber, int256 startEquity)`,
`RunPassed(uint256 indexed runId, address indexed account, uint64 blockNumber, int256 endEquity)`,
`RunFailed(uint256 indexed runId, address indexed account, Rule rule, uint64 breachBlock, uint64
endBlock)`, `RunVoided(uint256 indexed runId, address indexed account, VoidReason reason, bytes32
txHash)`, `OracleRequested(uint256 indexed runId, uint256 requestId)`, `OracleRequestFailed(uint256
indexed runId)`, `OracleRecorded(uint256 indexed runId, uint256 price, uint8 sources, uint64
updatedAt)`, `Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`,
`Locked(uint256 tokenId)`.

Rules the contract enforces: `startRun` — caller is the account or the referee; rulebook exists; no active
run for the account; `isOperatorAuthorized(account, referee, 0x80054449)` and `(…, 0xe37b444b)`; flat
(`activePerpPools.length == 0 && lockedCollateral == 0`); `equityOk` and `equity > 0`. `recordPass` —
run active; `block.timestamp ≥ startTime + minDurationSec` and `≤ startTime + timeLimitSec`; flat; both
grants held; `equityOk`; `(equity + locked) × 10000 ≥ startTotal × (10000 + profitTargetBps)`; mints.
`recordFail` — run active; for `TimeLimit`, `block.timestamp > startTime + timeLimitSec`; stores the
attested `breach`, the chain-read `end`, the close tx hashes, the evidence hash. Each verdict call with
`msg.value ≥ oracleDeposit` asks the Price Oracle inside `try`; a failed request emits
`OracleRequestFailed` and never reverts the verdict; the callback stores the first consensus price. For this build the referee sends the deposit (`ORACLE_ENABLED=true`). A request can still fail; the verdict then simply has no reading.

## 7. `@basanos/core`

- `config.ts`: chain (`hidekiTestnet` from `@somnia-chain/markets-sdk/chains`), RPC/WSS URLs (env
  overrides), `HIDEKI_ADDRESSES = { ...SOMNIA_HIDEKI_TESTNET_ADDRESSES, operatorPermissionsRegistry:
  "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a" }`, the constants in §3 (BTC pool, marginBank, USDso,
  SomniaAgents, Multicall3, PriceFeedScheduler, VoucherDistributor), selectors `PLACE_ORDER_FOR
  0x80054449`, `CANCEL_ORDER_FOR 0xe37b444b`, `REDUCE_ORDER_FOR 0x364c2587`, `ORDER_GAS =
  10_000_000n`, `ORACLE_AGENT_ID = 9911223344556677889n`, `ORACLE_DEPOSIT = 30_900_000_000_000_000n`.
- `abi.ts`: viem `parseAbi` constants for MarginBank reads, PerpPool reads + operator writes, the
  OperatorPermissionsRegistry write, Multicall3 (`aggregate3`, `getBlockNumber`,
  `getCurrentBlockTimestamp`), SomniaAgents
  (`createRequest`, `getRequest`), the Price Oracle `getPrices`.
- `env.ts`: typed loader for §13 names; validates 0x-hex keys; never prints a value.
- `rulebook.ts`: `Rulebook` type, `canonicalJson`, `rulebookId`, `loadRulebook(path)`.
- `snapshot.ts`: one Multicall3 `aggregate3` call per account set → `{ block, accounts: Map<Address,
  AccountSnapshot> }`, used both as the `somnia_watch` attached call and as a head read over HTTP.
- `watch.ts`: raw `eth_subscribe("somnia_watch", {address, topics, eth_calls, push_changes_only})` over
  WebSocket, with `connected / push / gap` callbacks and backoff reconnect (R3).
- `close.ts`: pure close-plan math (side, lot-aligned quantity, slippage-bounded IOC price inside the band).
- `evaluate.ts`, `classify.ts`: §5's evaluator and MarginBank log classifier.

## 8. Referee (`@basanos/referee`)

- **Discovery:** `getActiveRunIds()` + `getRun()` at boot and after every `RunStarted` push.
- **Watches (R3):** (i) PriceFeedScheduler logs with two calls attached, the snapshot multicall and the book
  multicall (`bookCall`: block number and 20 levels per side), with `push_changes_only: true`. Both run at the push's
  block: 73 of 73 pushes matched in a read-only check, 2026-11-12. This watch judges, on closeable equity (§5); (ii) MarginBank logs with `topics: [null, [account topics…]]` (account-
  filtered pushes) and the same attached call. Pushes for accounts that are not under an active run are
  ignored. A trading-class log is classified but not judged: it carries no book, and the price watch judges
  within about a second. Flows void and liquidations fail on the log as before.
- **Gaps (R3):** on socket close/error every run goes to `paused`; reconnect with backoff (0.5 s doubling
  to 30 s), resubscribe both watches, then read the snapshot and the book of its block once at head over HTTP and re-evaluate
  before resuming. Every gap is logged in the run's evidence (`fromBlock`, `toBlock`, duration). While
  paused or unpriceable the referee issues no verdict and no close.
- **Close protocol (R4; reordered by architect ruling P7, 2026-11-12):**
  1) On a FAIL or a PASS lock, plan the first close from the push that raised it (that block's position, mark and
     book) and send it at once: `placeOrderFor(account, isBid = size < 0, 0, price, qty, farFuture, 2 /*IOC*/, 0,
     0x0, 0)`, with `qty = |size|` aligned down to `lotSize` and `price` capped from the book (best ask + 20 bps to buy,
     best bid − 20 bps to sell). The mark ladder (mark ± 20 bps) is the fallback, and the more permissive limit wins.
  2) Cancel every resting order: ids from `getOwnOpenOrders()` with `eth_call` `from = account`, then
     `cancelOrderFor(account, id)` each, waiting for receipts. A resting order can change the position only after the
     close, so this sweep and the read-back catch it.
  3) Read the position fresh at head.
  4) If it is non-zero, close again from a fresh book at 50 bps, then 100 bps: at most 3 attempts in all. A flipped
     position closes the remainder the same way.
  5) A final cancel sweep and read-back.
  Without a push (a resume at head) the protocol cancels first, as before. Every tx hash, gasUsed and revert goes into
  the evidence bundle. The run's verdict does not depend on
  the close succeeding; a close that still leaves a position after 3 attempts is recorded as such.
- **Latency (P7).** The rehearsal took 7.7 s from the breach block to the first close (B) and 7.1 s (A).
  - **Why:** a read-only probe found 0.38 to 0.40 s per RPC round trip from the operator's machine, with 4.5 s
    outliers, and seven sequential RPCs before the close left (open orders, book parameters, position, chain id,
    nonce, fees, send).
  - **The fix:** every referee write now goes through one fast sender. It tracks the nonce locally (forgotten after
    a failed send, and adopted from the chain on idle refreshes when the chain is ahead), caches fees for 60 s, signs
    locally (4.7 ms) and makes one `eth_sendRawTransaction`. Registry writes estimate gas with 30% headroom.
  - **Expected:** about 1.1 s from the breach block to the close block (about 0.6 s of push lag, one round trip, one
    block).
  - **The lock:** the PASS lock no longer asks the SDK for `quotePerpClose`. It locks from the push's closeable
    equity, the number the evaluator judged.
- **What the gap still costs:** a FAIL's realized loss can exceed the rule's limit by the price move between the
  verdict and the close: 4.9 and 10.9 equity bps in the rehearsal at 7 s, and a median of 7.1 bps in the replay at
  3 s. The registry records the referee's breach read as the breach; the close txs and the end read show what was
  realized.
- **Verdict writes:** `recordFail(runId, rule, breachRead, evidenceHash, closeTxs)` and, after a lock,
  `recordPass(runId)`, both with `value = ORACLE_DEPOSIT` when `ORACLE_ENABLED=true` (true for this build); `recordVoid` for
  flows and foreign markets. **A VOID is recorded only: the referee does not cancel or close on a VOID**
  (no rule was breached; the run is simply not judged). It closes only on a FAIL and on a PASS lock. A PASS bundle carries `lock: { blockNumber, judgedEquity, bufferBps }` (P7). A FAIL bundle carries `judged: { equity, book }`, the closeable equity the rule judged and the book it was revalued at. `evidenceHash = keccak256(canonicalJson(bundle))`; bundles are written to
  `docs/evidence/runs.json`, keyed by run id (one fixed file, so verdict tasks can declare it).
- **CLI:** `basanos-referee start`, `basanos-referee enroll <account> --rulebook <name>` (bring-your-own
  account that already granted the referee, e.g. via dreamDEX Link a Bot), `basanos-referee status`.

## 9. Bot and demo runner (`@basanos/bot`)

- The bot signs with `ACCOUNT_B_PK` (its own account, no operator): grant the referee place + cancel on
  the BTC pool, `startRun`, open a short IOC at the demo size, hold; `bot.ts breach` adds size past
  15×.
- `npm run demo -w @basanos/bot`: preflight both accounts (STT ≥ 0.6, funded: unlocked MarginBank margin, flat, grants),
  start both runs on `tokyo-sprint-demo` together, then open opposite 10× positions (`DEMO_LEVERAGE_X`) in the same block.
  - **The pair:** one book read, both IOCs capped from it (best ask + 20 bps / best bid − 20 bps), both signed, then
    sent back to back (`openPair`). With `--a-manual`, B's short goes out as soon as A's long is seen (polled every
    250 ms).
  - **The FAIL on demand:** once one run PASSES, the other is pushed past the exposure cap (P7).
  - **The stream:** both runs until both have a verdict (at most the time limit + 300 s), with every tx hash and its
    explorer link.
- **The PASS take's gate (P7, referee:22):** `check-pass` wants the latest take to be one PASSED run whose certificate
  (`ownerOf(runId)`) its own account holds, and one FAILED run. It writes `docs/evidence/rehearsal-pass.json`.
- **How account writes reach the chain (P6, 2026-11-12).** Every bot and demo write is viem-direct (`packages/bot/src/send.ts`): the grant, `startRun` and the opens.
  - **The send:** signed locally with `ORDER_GAS` and an explicit pending nonce, sent once with `eth_sendRawTransaction` to the standard RPC, receipt taken from the public client. The hash is known before the send, so a failed or timed-out send is still looked up.
  - **The calls:** built by `@basanos/core/owner-tx`, byte-identical to the SDK's own encoding (pinned by a test).
  - **Why:** the SDK's send path (`eth_sendRawTransactionSync` on `send.hideki…`) ended "outcome unknown" with nothing on-chain twice: the voucher claim (2026-11-11) and B's grant in the first rehearsal (2026-11-12, B18). The bot never hands the SDK a key; the SDK stays for reads.
  - **Read back, never re-sent:** a write counts only when its effect is read back (both grant selectors authorized, the account's active run, or its position size moving). Nothing is re-sent: a grant is idempotent, but an open is not.
- **When a write does not take effect (P6b).**
  - **Before the take has started a run:** the demo stops. A re-run starts over and reads the grant and the active run before it sends anything.
  - **Once a run has started, the take aborts.** Nothing is re-sent and no run is voided. A void is the referee's verdict on a flow, a foreign market or a revoked grant, and none of those happened. Revoking the grant to force one would also leave the referee unable to close an open that lands late.
  - **The abort:** the referee ends each run by a rule or at its time limit, closing any position first. The demo waits for every verdict (at most the time limit + 300 s), checks the accounts are flat, records the take in `docs/evidence/demo-aborted.json` and exits 1. It never writes to `demo-takes.json`, which check-rehearsal and check-money-shot judge.
  - **A failed exposure top-up** for a FAIL on demand is only noted.
- No bot or demo command ever claims a voucher. The demo accounts are funded by depositing their own wallet USDso (spike:18, spike:19), because `claim()` reverts chain-wide (B14).
  The web terminal's "Claim voucher" button (§10) is the only claim path in the product; it fires only on
  an explicit user click, and every test and dev run mocks it.

## 10. Web app (`@basanos/web`, served at `/app/`)

All UI follows `docs/design/frontend.md`; the app uses the same `:root` tokens as the landing (page kind
software, sharp radius, no violet; tokens, type and layout only — no scenes or effects in the app).
Routes (hash router): `#/challenge` (terminal), `#/run/:id` (verdict + replay), `#/cert/:id`
(certificate). Verdict and certificate pages are public and shareable (the X posts link to them).

- **Challenge wallet:** generate or paste-import a testnet burner key; held only in `sessionStorage`;
  export button; a fixed "testnet challenge wallet" label. Never in the build or the repo; the web build
  fails if any `VITE_*` variable name ends in `_PK`.
- **Terminal:** STT and voucher status (faucet link), the start flow (claim voucher if eligible → grant
  referee → `startRun`, each with its tx link), a BTC-PERP ticket (market IOC capped from the book, opening at
  10×), closeable equity (what the referee judges) beside the equity at the mark, live closeable-equity rails
  (start, target, daily floor, trailing high-water line), run status, event log with explorer links.
  Cut (cut order, recorded 2026-11-11): the limit-order ticket and the exposure rail.
- **Verdict page:** status, rule, rulebook (name, variant, canonical JSON whose keccak256 is the id, id), the
  start / breach / end reads (equity in USDso, position size in BTC), close tx hashes (a PASS stores none: the
  page shows the referee's lock close from its evidence bundle, labelled as such, when the build holds that
  run's bundle), the Price Oracle cross-check line (the recorded reading beside the mark, or "No Price Oracle reading was recorded for this verdict."), and **Replay**: re-run each stored call at
  its block (for a FAIL, also re-read the book there and show the breach's closeable equity) and show "chain: X — registry: X" or the stored-value fallback (R2); the X share card is
  cuttable polish.
- **Certificate page:** the holder, the trust line, and the tokenURI attributes in plain words: start and
  end equity in USDso, the gain (end against start, signed, 2 decimals), start and end blocks, the rulebook
  by name and id. No page renders a raw wei amount.

## 11. Landing page (`@basanos/landing`, served at `/`)

Required scope (user directive 2026-11-10). Static page built from the frontend kit's `starter.html`.

- **Content, in order:** what it is in one line + the trust line → three steps (published rulebook →
  referee → verdict + certificate) → a real verdict (the actual verdict card as live HTML inside one
  `app-frame`, rendered from `featured-verdict.json`, plus a `shoot.mjs` screenshot of the app's real
  verdict page for the featured run (`/app/#/run/<id>`, read live from Hideki), so every figure in the
  image belongs to that run; the terminal itself is not shot because it would need the account's key in
  the browser)
  → "Replay any verdict" (links to that run's replay) → testnet notice ("Somnia Tokyo testnet, paper
  USDso, no real funds, no payouts, not a financial service") → the touchstone name story.
- **CTAs:** primary → `/app/#/challenge`; second → `/app/#/run/<FEATURED_RUN_ID>`, a real run.
- **Which run it shows.** The landing is built against the **first real verdict run** (the Nov 12 referee
  rehearsal), not the final money-shot run: its snapshot, screenshot and copy are made from that real
  run. When the money shot lands, only `FEATURED_RUN_ID` changes and the snapshot is regenerated.
- **Disclosure.** The page states that the demo's two accounts are operated by the builder (one
  human-driven, one scripted).
- **Truth by construction:** a build script reads the featured run from the registry and writes
  `apps/landing/src/featured-verdict.json`; the page renders only from it. A check script fails the build
  if the page contains a `0x…` hash, a run id or a figure that is not in that snapshot. No testimonials,
  logos, "trusted by", usage stats, prices or customer photos. The X post drafts (ship plan) are
  generated from the same snapshot, so the claims match.
- **Design and gate:** `frontend.md`'s marketing rules (hero alone on the first screen, one section per
  screen, real product UI; effects/moments allowed but first in the cut order). Gate: the kit's
  `consistency.mjs`, `check.mjs`, `perf.mjs`, `shoot.mjs`, run in place by absolute path from
  `C:\Users\bamig\Documents\VIBE CODE\Hackathons\.claude\skills\design-taste-frontend`. Only the files the
  page uses are copied into `apps/landing/` and listed under third-party assets in
  `docs/gates/submission-draft.md`; the kit (38 MB, no licence file) is never committed wholesale.
- **Executor access:** the Step 2 session is started with
  `claude --add-dir "C:\Users\bamig\Documents\VIBE CODE\Hackathons\.claude\skills\design-taste-frontend"`
  (or `/add-dir` with the same path inside the session); a Stack row proves a dispatched subagent can
  read a file under it.

## 12. Spike, live gates and STT budget (G1, G3, R5)

The first plan's first tasks are the spike. Read-only scripts (no key, no STT) measure history depth with
the equity view, run R1's three indexer reads, prove the watch with the equity multicall on a live
account, and record the BTC mark tape. Human-gated live tasks use accounts the Step 3 preflight has
**already** funded and claimed: **(a)** account A grants the referee and opens 0.00013 BTC (plus one
resting limit order); the referee cancels, closes with an IOC `placeOrderFor` and reads back flat —
**stop and escalate to the user if this fails**, the product depends on it; **(d)** one Price Oracle
request from the referee EOA (callback = the EOA), read back through `getRequest`; **(e)** account A's
`getPerpLeverage`. **No gate ever claims a voucher.** Pin timebox: if (a) has not landed on 0.33.0
within ~2 h of starting the skeleton, switch every package to `0.32.1`.

Live gates are few: spike (a), spike (d), the registry deploy, R5's `previewStart` read against the real
MarginBank (read-only, zero STT), one referee rehearsal, the demo money shot, the Vercel deploy.

**Burners (3):** the referee (also deployer and registry owner), account A (human), account B (bot).

**STT budget** (pessimistic, from the probed 6 gwei; the spike replaces the per-tx figure with the
measured one): perp tx ≈ 0.02–0.05 STT (docs say 0.0003–0.003); registry deploy: **measured 2026-11-11** (ledger `810c356`, read-only `eth_estimateGas`): **77,007,457 gas for
15,949 bytes of runtime code, ≈ 0.462 STT at 6 gwei**. That is the gas limit the referee must cover; the earlier
≈ 0.2 STT guess was wrong.
- **Why:** Somnia charges 3,125 gas per byte of deployed bytecode (Ethereum charges 200) and 160 gas per calldata byte, and its `eth_estimateGas` returns 1.5 times the executed gas (docs: "Somnia Gas Differences To Ethereum").
- **So:** the ≈ 4,800 gas per byte in the estimate is 3,125 × 1.5. A read-only check measured a 4,688 gas per byte marginal.
- **Expected charge** (if unused gas is refunded as on Ethereum): about two-thirds of the limit, ≈ 51M gas ≈ 0.31 STT, plus the two `registerRulebook` transactions.
- **Actual spend** (contracts:10, 2026-11-11, `deployments/hideki.json`): deploy tx `0x0046bcd4…3190` (block 47,503,978) used **51,338,305 gas = 0.30803 STT**, two-thirds of the 77.0M estimate as expected. The two `registerRulebook` txs used 718,540 gas each (≈ 0.0043 STT each). **Total ≈ 0.3167 STT.**
- **Balance:** the referee needs ≥ 0.47 STT before contracts:10, so top it up to ≈ 1 STT first.

The rest of the budget: per run, referee ≈ 0.15 STT (cancels, closes, verdict, + a 0.0309 STT oracle deposit per PASS or FAIL, mostly rebated: ≈ 0.002 STT net) and per account ≈ 0.2
STT (grant, `startRun`, orders). Each write needs 0.6 STT of headroom. Faucet: 1 STT per address per hour
while the balance is under 1 STT. Plan: top every burner to ~1 STT before each live session; ≈ 6 runs
total (spike, rehearsal, demo takes).

## 13. Env contract (names only; values live in the git-ignored `.env`)

| Name | Holder | Used by |
|---|---|---|
| `REFEREE_PK`, `REFEREE_ADDRESS` | referee / deployer burner | spike (a, d), deploy, referee |
| `ACCOUNT_A_PK`, `ACCOUNT_A_ADDRESS` | human challenge account (imported into the browser wallet by paste for the demo) | spike (a), demo |
| `ACCOUNT_B_PK`, `ACCOUNT_B_ADDRESS` | bot challenge account | bot, demo |
| `REGISTRY_ADDRESS` | written after deploy (also in `deployments/hideki.json`) | referee, bot, web, landing |
| `HIDEKI_RPC_HTTP`, `HIDEKI_RPC_WSS` | optional overrides (defaults in §0) | all |
| `ORACLE_ENABLED` | `true` for this build (the cut-order switch: `false` sends no oracle deposit) | referee |
| `FEATURED_RUN_ID` | the real run the landing shows | landing build |
| `VERCEL_TOKEN` | Vercel deploy token (closing, human gate) | ship deploy |
| `CHROME_PATH` | optional, for the kit's checkers | landing gate |

Public web build variables (no secrets): `VITE_REGISTRY_ADDRESS`, `VITE_REFEREE_ADDRESS`.

## 14. Toolchain pins

Node 22.23.4 · npm 10.9.9 · `@somnia-chain/markets-sdk` 0.33.0 (exact) · `viem` 2.57.12 (exact) ·
`typescript` 6.0.3 (the SDK's own) · `vitest` 4.1.12 · `tsx` 4.23.15 · `@types/node` 22.20.5 · `ws`
8.22.0 + `@types/ws` 8.18.2 (test WebSocket server only) · `vite` 8.3.5 · `react` / `react-dom` 19.1.10 ·
`@vitejs/plugin-react` 6.1.2 · `@types/react` / `@types/react-dom` 19.3.0 · `@testing-library/react`
16.3.3 · `jsdom` 30.1.3 · `vercel` CLI 65.3.1 (via `npx`, closing only) · Foundry forge 1.7.1 · solc
0.8.28 · forge-std v1.16.2 · Chrome or Edge (kit checkers).

## 15. Testing strategy

- `@basanos/core`: vitest unit tests for config selectors (against `toFunctionSelector`), rulebook ids,
  snapshot encode/decode (fixture bytes), close-plan math, the evaluator (synthetic tapes + the recorded
  live tape), the log classifier, the watch client (a local `ws` server: push, gap, reconnect).
- Contracts: forge unit tests with `MockMarginBank`, `MockPerpPool`, `MockSomniaAgents` (start, pass,
  fail, void, revoke, time limit, oracle success / failure / bad caller, soulbound reverts, tokenURI).
- Referee: vitest with fake chain I/O (state machine, gap → pause → head re-evaluate, close protocol incl.
  a concurrent fill that flips the position, bounded retry).
- Web / landing: vitest + Testing Library for the rails math, replay comparator and wallet guard; `vite
  build`; the landing's kit checkers.
- Live gates: §12 only. No dev/test gate spends a voucher; fixtures and dry-runs everywhere else.

## 16. Feedback harvest

Every reproducible defect met during the build becomes `feedback/<slug>.md` in the event template
(Severity, Area, Steps, Expected, Actual, Evidence with tx hash or request/response, Environment: SDK
version, Somnia Tokyo testnet, wallet address). Skip bot-kit #26–#45 and anything in prior-art §C.
Never a security issue (those go to security@dreamdex.io). Stage-1 candidates to check for duplicates
first: `SOMNIA_HIDEKI_TESTNET_ADDRESSES` omits `operatorPermissionsRegistry` (so the SDK's grant writes
throw `NotConfiguredError` on Hideki unless the caller passes it); docs list 21 perp markets while
`listPerpMarkets()` returns 40 and BTC's IM is 250 bps vs the docs' 5%; `somnia_watch` pushes carry no
block number or tx hash and the docs don't say so; any R1 indexer read that fails on 0.33.0.

## 17. Guard and note mapping

| Guard / note | Where satisfied |
|---|---|
| G1 day-1 spike (a)–(e), (a) stop-and-escalate | §12; plan `spike` tasks 1–13 |
| G2 cut order, never-cut list | §1 (amended by the landing directive) |
| G3 scarce live gates, no voucher claims, STT budget | §12 |
| G4 PASS needs movement; demo mode proven in the skeleton | §5 (demo mode, tape test) |
| G5 Solidity toolchain vs #36 / #37, evmVersion, verification | §6 |
| G6 lead with the verdict and the certificate | §2, §10, §11, README plan |
| R1 indexer-independent verdict path; three reads tested and recorded | §5 classifier, §12, §3a |
| R2 raw reads stored; real horizon measured | §2, §3a |
| R3 resubscribe, head re-evaluate, pause on gap / unpriceable, account-filtered pushes | §8 |
| R4 close protocol | §8; proven by spike (a) |
| R5 one live gate against the real MarginBank | §12 (`previewStart` after deploy) |
| Landing directive (routes, plan shape, truthful content, design gate, cut order, deploy) | §1, §11, §18 |

## 18. Delivery

Plans (one per subsystem; task ids `<subsystem>:<N>`):

1. `docs/superpowers/plans/2026-11-10-basanos-spike.md` — monorepo + `@basanos/core` foundation,
   spike scripts, live (a)/(d) gates, evidence into §3a. **Push 1.**
2. `docs/superpowers/plans/2026-11-10-basanos-contracts.md` — registry, mocks, tests, ABI export,
   deploy (human gate), R5 live read, bytecode verification. **Push 1.**
3. `…-basanos-referee.md` — evaluator, classifier, referee daemon, close protocol, bot, demo runner,
   live rehearsal (human gate). **Push 2.**
4. `…-basanos-web.md` — tokens, challenge wallet, terminal, verdict + replay, certificate. **Push 2.**
5. `…-basanos-landing.md` — additive; new ids `landing:N`; Files only under `apps/landing/` plus one task
   that edits the submission draft's third-party list; depends on web's token and verdict-page tasks and
   on the **first real verdict run (the Nov 12 rehearsal)**, not the money-shot run; the money shot only
   swaps `FEATURED_RUN_ID`. **Push 2.**
6. `…-basanos-ship.md` — money-shot demo run (human gate), featured-run snapshot, README (schema),
   X post drafts, feedback files, Vercel deploy (human gate), evidence index; deploy depends on the
   landing's final gate. **Push 2.**

Push 2 is strictly additive: new plan files and appended manifest tasks; push 1's task ids, Files and
gates never change.

Deploy: **Vercel** (user decision). The assembled static site (`/` = landing, `/app/` = web) is deployed
with `npx vercel@65.3.1 deploy --prod` using `VERCEL_TOKEN`; the Vercel account / token is a concierge
signup gate; the deploy task is `human_gate: true`, `gate_profile: deploy`. It works while the repo is
private.

Calendar (WAT): Nov 10 evening — preflight (burners, faucet, two voucher claims); Nov 11 — spike, the
first real order (tripwire), core, contracts; Nov 12 — deploy, referee end-to-end on live accounts, one
rehearsal; Nov 13 — web terminal and verdict pages; Nov 14 — money shot, landing, README, X posts,
feedback, deploy; Nov 15 — buffer, submitted by 09:00.

## 19. Known limitations (stated in the README)

- Path rules (daily loss, trailing drawdown, exposure) are referee-enforced and replayable, not
  contract-checked; a referee gap pauses judging, and a breach inside a gap that recovers before
  reconnect is not seen (gaps are logged in the evidence).
- The referee's grant could also open orders (a close is a `placeOrderFor`); every referee order is public
  evidence and its code is open.
- A trader who self-trades against a second account at the band edge can manufacture a pass
  (anti-collusion forensics are out of scope).
- Replay depends on the public RPC's history; past the horizon the page shows the stored reads.
- An aborted demo take (§9) holds its accounts until the referee ends their runs, at most the demo's 1,200 s time
  limit (v2); no run is voided to free them sooner.
- The close follows the verdict by about a second (§8); a FAIL's realized loss can exceed its limit by the move in
  that gap.
- The registry asks the Price Oracle with the 4-argument `createRequest`, which uses Majority consensus (byte-identical
  answers). 3 of 4 requests finalized Failed although every validator answered Success, because the answers differ
  in their source counts and timestamps (and sometimes the price); a reading is shown only when one is recorded.
  Threshold consensus (`createAdvancedRequest`, the docs' advice for price data) would mean redeploying the registry,
  and the guide and the architect judged that not worth its risk this late (P7; `feedback/`).
- Rules judge closeable equity from the 20 best levels on each side; a position those levels cannot price
  pauses judging for that snapshot, so an account larger than the visible book is not judged until the book
  refills.

## 20. Design decisions

| Question | Answer | Source |
|---|---|---|
| How does the human trader sign in the terminal? | In-browser challenge wallet (generate/import a burner, sessionStorage, export); BYO accounts join by granting the referee and `enroll` | user, 2026-11-10 |
| How much does the registry verify? | Chain-checked certificate: start and PASS checked in-tx; FAIL/VOID referee-recorded with raw reads, replayable; registry-checks-every-breach is a documented upgrade | user, 2026-11-10 |
| Tokyo Sprint PASS conditions | All contract-checkable at the end state (flat, equity ≥ target, min time, within time limit, grant); path rules referee-enforced, shown by replay | user, 2026-11-10 |
| Trust-model wording | "Every certificate is chain-checked at mint; every verdict is replayable." | user, 2026-11-10 |
| Which equity do the rules judge? | Closeable equity: the marked equity revalued at the same-block book (bids for a long, asks for a short); opening IOCs capped from the book; demo at 5×; rulebooks unchanged | architect ruling P5 on the guide's measurement (the book ≈ 19 bps above the mark), 2026-11-12 |
| How do the bot's own writes reach the chain, and what if one fails mid-take? | viem-direct (signed locally, `ORDER_GAS`, explicit pending nonce, standard RPC), read back from the chain, never re-sent; a take that fails after a run started aborts: the runs end by a rule or at their time limits (no void), recorded in `demo-aborted.json` | architect ruling P6 on the guide's diagnosis B18 (the SDK's send path ended "outcome unknown" twice), 2026-11-12 |
| What makes a demo PASS likely, and how fast does the referee close? | Demo v2 (+0.50% target, 1.5% / 2% floors, 20 min) at 10×, chosen by replaying 12 h of on-chain history (95.6% of windows see a PASS); same-block entries; the FAIL on demand after the first PASS; closes capped from the book and sent in one round trip from the push; a 10 bps PASS lock buffer; the Price Oracle stays best-effort (no redeploy) | architect ruling P7 on the guide's diagnosis B19, 2026-11-12 |
| How do the verdict and certificate pages show amounts, and a PASS's close? | Money in USDso to the cent, the gain as a signed percent, sizes in BTC, blocks as plain integers, the rulebook JSON in canonical form (its keccak256 is the id); a PASS's lock close from the referee's evidence bundle, labelled as such (recordPass stores none); the landing names a PASS's certificate instead of a close count | architect ruling P8 on the guide's viewing of run 3 and certificate #3 (2026-11-12) |
| Demo mode | `tokyo-sprint-demo`, a separately registered parameter set of the one rulebook, labelled on every surface; demo runner; exposure-breach fallback | user (fold-in list) + G4 |
| Landing page | Required scope, additive `landing` plan, truthful content, kit checkers as gate | user directive via the guide |
| Deploy host | Vercel | user, 2026-11-10 |
| SDK pin | 0.33.0 exact, fallback 0.32.1, 2 h timebox | architect (Stage 1 diff + probes), user-confirmed |
| Spec/plan shape | One spec, one plan per subsystem, two pushes, push 2 strictly additive | architect, user-confirmed |
| Watch transport | Raw `somnia_watch` over WebSocket in `@basanos/core` (no `@somnia-chain/reactivity` dependency) for full control of resubscribe and gaps | derived (R3) |
| Solidity toolchain | Foundry 1.7.1, solc 0.8.28, `evm_version = cancun`, mocks + one live read, bytecode-match verification | derived (G5, Stage-1 probes) |
| Certificate form | Soulbound ERC-721 + ERC-5192 inside the registry, on-chain JSON tokenURI | derived (cut order: certificate polish is cuttable) |
