# DoraHacks submission draft — Basanos (dreamDEX Perps Builder Bounty)

Pre-answered by the architect at Step 1 (2026-11-10) from the brief, the spec and the pack's `event.md`. Facts that
do not exist until the build lands are marked `TBD-post-build:<what>`, one per line. Demo-studio (Step 2.5) fills the
video URL; the Step 3 closing pass resolves the rest and pastes this into the platform.

- Event: dreamDEX Perps Builder Bounty — https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail (hackathon 2443)
- Deadline: 2026-11-15 15:30 WAT (14:30 UTC). Internal stop: submitted by 2026-11-15 09:00 WAT.
- Eligibility: whitelisted email only (user-attested as whitelisted; the closing pass confirms Submit Build opens).

## Form fields

**Project name:** Basanos

**One-liner:** Prop-firm-style challenges for dreamDEX perps on Somnia: a published rulebook, a referee that
flattens the account on a breach, and an on-chain verdict anyone can replay. Every certificate is chain-checked at
mint; every verdict is replayable.

**Tracks (the platform allows several):**
- MVP — category: trader tools, with bots and agents served by the same rulebook.
- Feedback — reproducible defects met while building, one Markdown file per item in `feedback/`.

**Description:**

Basanos (Greek for the touchstone, the original test a metal's purity is checked against) runs prop-firm-style
evaluations on dreamDEX perps on Somnia Tokyo testnet.

A trader, or a bot, takes a published rulebook challenge, "Tokyo Sprint", on a dreamDEX perps account. The account
grants the Basanos referee key place and cancel rights only; the referee can close a position but can never
withdraw. The account then enrolls in the Basanos registry on Hideki, and the registry reads its starting equity
from the dreamDEX MarginBank itself. The trader trades any way they like: the Basanos terminal, the dreamDEX app or
their own bot.

The referee watches the account on every price write with Somnia off-chain Reactivity (`somnia_watch` with the
account's MarginBank equity read attached in the same block). On a breach (daily-loss floor, trailing drawdown,
exposure cap, time limit) it cancels resting orders and closes the position with real perps orders, then records
**FAILED** on-chain with the rule, the breach block, the raw reads and the close transaction hashes. When the
profit target is reached after the minimum time, the referee locks the gain by flattening, and the registry checks
the end state itself (flat, equity at or above the target, minimum time, referee grant still held) before it
records **PASSED** and mints a non-transferable certificate. A Price Oracle cross-check is implemented in the
registry but switched off for this build: our test request on Tokyo testnet (request 7773100, 2026-11-11) finalized Failed with no prices.

Trust model, stated exactly: every certificate is chain-checked at mint; every verdict is replayable. Path rules
(daily loss, trailing drawdown, exposure) are enforced by the referee and shown by replay; they are not checked by
the contract. Every verdict page re-runs the stored reads at their pinned blocks and falls back to the values
stored on-chain once the public RPC no longer serves that state.

Who it is for: traders who want a pass they can show; bot and agent builders who need to show a bot trades inside a
rulebook before anyone links its key; later, on mainnet, desks and DAOs that publish a rulebook and fund the
accounts that pass.

Demo disclosure: the demo's two challenge accounts are burners operated by the builder — one driven by a human from
the terminal, one by a scripted bot. Somnia Tokyo testnet only, paper USDso, no real funds, no payouts; Basanos is
not a financial service.

**Somnia primitive used:** off-chain Reactivity (`somnia_watch` with attached `eth_call` simulations) for the
referee. A Somnia Agents Price Oracle cross-check is implemented but switched off for this build, because our test
request on Tokyo testnet finalized Failed.

**Tech stack:** TypeScript on Node 22 (strict ESM), `@somnia-chain/markets-sdk` 0.33.0, viem 2.57.12; Solidity 0.8.28
(Foundry 1.7.1, `evm_version = cancun`) for the verdict registry and soulbound certificate (ERC-721 + ERC-5192);
React + Vite for the challenge terminal and the verdict and certificate pages; a static marketing landing page;
deployed on Vercel. Chain: Somnia Tokyo testnet (Hideki, chain 50383).

**Team:** solo builder (GitHub `Dotman-Bei`), building with an AI agent pool (Claude Code).

## Links and build facts

- GitHub repository (required by the form):
  TBD-post-build:public-repo-url
- Live site (landing at `/`, terminal at `/app/#/challenge`):
  TBD-post-build:vercel-url
- Featured verdict page (a real run):
  TBD-post-build:featured-verdict-url
- Demo video (optional on the form; "demo" is named in the judging criteria):
  TBD-post-build:demo-video-url
- BasanosRegistry address on Hideki (from `deployments/hideki.json`):
  TBD-post-build:registry-address
- First real order and referee close (from `docs/evidence/g1a-close.json`):
  TBD-post-build:g1a-tx-hashes
- Money-shot PASS and FAIL transactions (verdicts, referee close, certificate mint):
  TBD-post-build:money-shot-tx-hashes
- X posts (2–3, each tagging @DreamDEXSomnia; published by the user):
  TBD-post-build:x-post-urls
- Feedback items filed in `feedback/`:
  TBD-post-build:feedback-file-list

## Submission-form questions (platform `submission_form`, both required)

- Telegram username:
  TBD-post-build:telegram-username
- Discord username:
  TBD-post-build:discord-username

(Both are supplied by the user at the Step 3 closing pass; runsheet blocker B7.)

## Third-party assets

The landing plan copies only the frontend kit files the page actually uses (from
`C:\Users\bamig\Documents\VIBE CODE\Hackathons\.claude\skills\design-taste-frontend`, tasteskill 2.5.0, which ships
no licence file) and lists each one here. Review the list before the public flip (runsheet B5/B11).

| Repo path | Kit source (tasteskill 2.5.0) | Used by |
|---|---|---|
| `packages/design/vendor/system.css` | `assets/system.css` | app + landing |
| `packages/design/vendor/motion/motion.css` | `assets/motion/motion.css` | app + landing |
| `packages/design/vendor/motion/motion.js` | `assets/motion/motion.js` | app + landing |
| `apps/landing/vendor/system.js` | `assets/system.js` | landing |
| `apps/landing/vendor/layout/layout.css` | `assets/layout/layout.css` | landing (collage hero) |
| `apps/landing/vendor/layout/layout.js` | `assets/layout/layout.js` | landing |
| `apps/landing/vendor/layout/demo.css` | `assets/layout/demo.css` | landing (window UI) |
| `docs/design/frontend.md` | `SKILL.md` (the skill's own instructions, copied verbatim) | the design rules every UI task cites |

The landing's hero markup follows the kit's `assets/layout/hero-collage.html` structure. sha256 of each copy: `packages/design/vendor/manifest.json` and `apps/landing/vendor/manifest.json`. The kit ships no licence file: review before the public flip.

## Pre-submit checklist (closing pass)

- README has "what it does", "who it is for", "how to run", and an "X posts" section with the 2–3 links.
- README, landing and X posts use the trust line verbatim and the demo disclosure; no surface says "the contract
  verifies every verdict".
- The repo is public, secrets scan clean, `.env` never committed.
- At least one real perps order on Somnia Tokyo testnet is linked by transaction hash.
