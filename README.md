<!-- readme-schema: R1-web-app v1 + event-overlay -->
# Basanos

Prop-firm challenges for dreamDEX perps: a published rulebook, a referee that closes on a breach, and a verdict anyone can replay.

## Demo

- Live site (landing, terminal at `/app/#/challenge`): TBD-post-build:vercel-url
- Featured verdict, a real run on Somnia Tokyo testnet: TBD-post-build:featured-verdict-url
- Demo video: TBD-post-build:demo-video-url
- Screenshot of the featured verdict page: TBD-post-build:verdict-screenshot

## What it does

Basanos (Greek for the touchstone, the original test a metal's purity is checked against) turns a dreamDEX perps account into a prop-firm evaluation with a public result. A trader or a bot takes the published "Tokyo Sprint" rulebook, grants the Basanos referee key place and cancel rights only (it can close a position, never withdraw), and enrolls in the Basanos registry on Somnia, which reads the starting equity from the dreamDEX MarginBank itself. The referee watches the account at every price write; on a breach it cancels resting orders and closes the position with real perps orders, then records **FAILED** with the rule, the block and the close transactions. When the profit target is reached after the minimum time, the referee locks the gain and the registry checks the end state itself before it records **PASSED** and mints a non-transferable certificate.

**Every certificate is chain-checked at mint; every verdict is replayable.** Path rules (daily loss, trailing drawdown, exposure) are enforced by the referee and shown by replay; they are not checked by the contract.

Both demo accounts are burners operated by the builder: one human-driven, one scripted. Somnia Tokyo testnet, paper USDso. No real funds, no payouts; not a financial service.

## Quickstart

```bash
git clone https://github.com/Dotman-Bei/basanos.git
cd basanos
npm install
cp .env.example .env   # fill in three testnet burner keys and REGISTRY_ADDRESS / REFEREE_ADDRESS
npx tsx packages/referee/src/cli.ts start   # terminal 1: the referee
npx tsx packages/bot/src/demo.ts            # terminal 2: two accounts, opposite 5x positions, one PASS and one FAIL
```

## Built at dreamDEX Perps Builder Bounty

Built for the dreamDEX Perps Builder Bounty (Somnia × dreamDEX, DoraHacks), MVP track, category trader tools, with bots and agents served by the same rulebook; reproducible defects met along the way are in `feedback/` for the Feedback track. Built by a solo builder with an AI agent pool (Claude Code). Everything in this repository was written during the event window (2026-11-10 to 2026-11-15): the referee, the verdict registry and certificate, the challenge terminal, the verdict and certificate pages, and the landing page.

## How it works

- **Rulebook.** `rulebooks/tokyo-sprint.json` and `rulebooks/tokyo-sprint-demo.json` (the demo parameter set, labelled "Tokyo Sprint · Demo" everywhere it appears). The registry stores each rulebook's id (keccak256 of its canonical JSON) and the contract-checked fields.
- **Start (chain-checked).** `startRun` reads MarginBank in the transaction: the account must be flat and must have granted the referee place and cancel on BTC-PERP; the start equity is stored with its block.
- **Referee.** Off-chain Somnia Reactivity: `somnia_watch` on price writes and on the account's MarginBank logs, each push carrying a Multicall3 snapshot of block, time, mark and equity. A watch gap pauses judging; the referee re-reads at head before it resumes. Money flows void a run; liquidations fail it.
- **Closeable equity.** Every rule judges the equity a close would leave: the MarginBank equity revalued from the mark to the book levels that would fill the close (bids for a long, asks for a short), read in the same block, since the price watch carries the book with each snapshot. On BTC-PERP the book trades about 19 bps above the mark, so equity at the mark alone would show a fresh long an instant loss and a fresh short a phantom gain; closeable equity charges only the spread actually crossed. A position the book cannot price pauses judging.
- **Close protocol.** Cancel resting orders, read the position fresh, close with an opposite-side IOC `placeOrderFor`, read back, retry at most three times, sweep. Every transaction is recorded.
- **Verdicts.** FAIL and VOID are recorded by the referee with the raw reads (block, equity, locked collateral, size, mark) and an evidence hash of the bundle in `docs/evidence/runs.json`; a FAIL's bundle also carries the closeable equity it was judged on and the book it was revalued at. PASS is checked by the registry at mint: flat, equity at or above the target, minimum time, time limit, grant still held. Each PASS or FAIL verdict also asks Somnia's Price Oracle for the BTC perp median, inside `try`, so a failed request never blocks a verdict; the verdict page shows the reading only when one was recorded.
- **Replay.** The verdict page re-runs every stored read at its block, and for a FAIL re-reads the book at the breach block to show the closeable equity the rule judged; past the public RPC's history it shows the values stored on-chain.

## Tech stack

TypeScript on Node 22 (strict ESM), `@somnia-chain/markets-sdk` 0.33.0, viem 2.57.12, Solidity 0.8.28 with Foundry 1.7.1 (`evm_version = cancun`), React 19 + Vite 8, vitest 4. Chain: Somnia Tokyo testnet (Hideki, chain 50383). Somnia primitives: off-chain Reactivity (`somnia_watch`) and Somnia Agents (the Price Oracle, asked at each verdict).

## Run locally

```bash
npm install
npm test                                   # all workspaces
node contracts/script/forge.mjs test       # the registry's Foundry suite
npm run build -w @basanos/web              # the app (served at /app/)
npx tsx packages/referee/src/cli.ts status # active runs in the registry
```

| Variable | Purpose |
|---|---|
| `REFEREE_PK` | the referee burner's key (closes, verdicts; it owns the registry) |
| `REFEREE_ADDRESS` | the referee's address (the app's grant target) |
| `ACCOUNT_A_PK`, `ACCOUNT_A_ADDRESS` | the human challenge account (demo) |
| `ACCOUNT_B_PK`, `ACCOUNT_B_ADDRESS` | the scripted bot's account |
| `REGISTRY_ADDRESS` | the deployed BasanosRegistry |
| `HIDEKI_RPC_HTTP`, `HIDEKI_RPC_WSS` | optional RPC overrides |
| `ORACLE_ENABLED` | `true` (this build): sends 0.0309 STT per PASS or FAIL verdict for a Price Oracle reading; most of it is rebated |
| `FEATURED_RUN_ID` | the run the landing page shows |
| `VITE_REGISTRY_ADDRESS`, `VITE_REFEREE_ADDRESS` | public values baked into the app build |

Keys stay in the git-ignored `.env`; the app build refuses any `VITE_*_PK` variable.

## Contract addresses

| network | address | explorer |
|---|---|---|
| Somnia Tokyo testnet (Hideki, 50383): BasanosRegistry | `0xf5D8099239200DF961E0910A42C105214D1E9370` | https://explorer.testnet.somnia.network/tokyo/address/0xf5D8099239200DF961E0910A42C105214D1E9370 |
| Somnia Tokyo testnet: dreamDEX MarginBank | `0x478769E1177C0773c43A593DCCc4Ad15F15F1394` | https://explorer.testnet.somnia.network/tokyo/address/0x478769E1177C0773c43A593DCCc4Ad15F15F1394 |
| Somnia Tokyo testnet: BTC-PERP pool | `0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0` | https://explorer.testnet.somnia.network/tokyo/address/0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0 |
| Somnia Tokyo testnet: OperatorPermissionsRegistry | `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a` | https://explorer.testnet.somnia.network/tokyo/address/0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a |
| Somnia Tokyo testnet: SomniaAgents (Price Oracle requests) | `0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3` | https://explorer.testnet.somnia.network/tokyo/address/0x7407cb35a17D511D1Bd32dD726ADb8D5344ECbE3 |

## Who it is for

- **Traders** who want a pass they can show: take the challenge from the Basanos terminal, the dreamDEX app or your own bot, retry when you fail.
- **Bot and AI-agent builders** who need to show that a bot trades inside a rulebook before anyone links its key: the referee does not care whether a human or a bot trades the account.
- **Later, on mainnet:** desks, funds and DAOs that publish a rulebook and fund the accounts that pass.

## X posts

- TBD-post-build:x-post-1-url
- TBD-post-build:x-post-2-url
- TBD-post-build:x-post-3-url

## Roadmap

Known limitations: path rules are referee-enforced and replayable, not contract-checked; a referee watch gap pauses judging, and a breach that recovers inside a gap is not seen (gaps are logged in the evidence); a position the book read cannot price (an empty side, or a size beyond the 20 levels read) pauses judging for that snapshot; the referee's grant could also open orders, so every referee order is public evidence and its code is open; self-trading against a second account at the band edge can manufacture a pass (anti-collusion forensics are out of scope); replay depends on the public RPC's history, after which the page shows the stored reads.

Next: the registry checks every breach on-chain before the close; an on-chain Reactivity judge; anyone-callable expiry; multi-market rulebooks; anti-collusion forensics.

## License

MIT for the Basanos code (see `LICENSE`). The files under `packages/design/vendor/` and `apps/landing/vendor/`, and `docs/design/frontend.md` (a copy of the design skill's `SKILL.md`), are third-party frontend-kit files (tasteskill 2.5.0), listed in `docs/gates/submission-draft.md`, and are not covered by this licence.
