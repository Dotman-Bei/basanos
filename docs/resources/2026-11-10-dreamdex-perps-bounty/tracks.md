# Tracks: dreamDEX Perps Builder Bounty

**Sources:** https://dorahacks.io/hackathon/dreamdex-perps-bounty/tracks and `/detail`, plus platform JSON `/api/v1/hub/hackathons/2443` (`tracks[]`). All fetched 2026-11-10 with Chrome.
There are exactly **two tracks** (platform track ids 4726 and 4728). No sponsor bounties are listed separately, and the three MVP "categories" are **not** separate prizes: the 3 × $500 comes from one pool. One Build may enter both tracks (`is_multi_tracks_allowed: true`).

---

## Track 1: Feedback (platform id 4726)

| | |
|---|---|
| **Sponsor** | dreamDEX (on Somnia) |
| **Problem statement (verbatim, Tracks tab)** | "Find bugs, API and SDK issues, documentation gaps and missing features in dreamDEX perps on Somnia Tokyo testnet, and send reproducible reports." |
| **Prize (verbatim)** | "Every accepted item is paid: $40 for a critical or major item and $15 for any other accepted item, until the $1,500 track budget is used. Only the first valid report of an issue is paid." The Details page adds: "An item is accepted only if we can reproduce it." and "duplicates are closed." |
| **Minimum bar to qualify** | A GitHub repo with one Markdown file per issue in `feedback/`, using the Details-page template (verbatim copy in `event.md` §3). The item must be reproducible by the organizers and be the first valid report of that issue. Security issues go privately to security@dreamdex.io, never into the repo. |
| **Required tech** | None mandated. The scope is "dreamDEX perps on Somnia Tokyo testnet": API, SDK, docs, app, contracts (the template's `Area:` values). |
| **Judging (verbatim)** | "severity, clarity, reproducibility, and how useful the item is for the perps product and developer experience." No weights. |
| **Competition reality** | Dozens of public `*dreamdex-perps-feedback*` repos already exist on GitHub (see `prior-art.md` §C). Q&A posts mention batches of 8, 12, 13 and 17 reports. With first-report-wins and a $1,500 cap (37 critical/major items at most), **duplicate risk is high and the budget may already be spoken for.** Feedback is best treated as a by-product of real build friction, not a primary target. |

## Track 2: MVP (platform id 4728)

| | |
|---|---|
| **Sponsor** | dreamDEX (on Somnia) |
| **Problem statement (verbatim, Tracks tab)** | "Build a perps product worth using on Somnia Tokyo testnet: a trading bot, an AI agent, a trader tool or a consumer perps app." |
| **Prize (verbatim, Details)** | "Three MVPs win $500 each, paid in two parts: $300 when the winners are announced, and $200 once the MVP runs on mainnet. The $200 is paid after the perps mainnet launch, if the MVP places orders on mainnet within 30 days of the launch." Plus: "Each winner also gets a technical breakdown post on the dreamDEX X account." |
| **Minimum bar to qualify (verbatim)** | "Your MVP places real perps orders on Somnia Tokyo testnet." · "Your README explains what it does, who it is for and how to run it." · "Your README has an X posts section with links to 2 or 3 posts about your MVP that tag @DreamDEXSomnia." · "Every Build needs a GitHub repository." |
| **Categories (verbatim)** | "bots and agents, trader tools, consumer perps." |
| **Stated plus (verbatim)** | "Using Somnia primitives such as Reactivity or Somnia Agents is a plus." |
| **Required tech** | Real perps orders on chain **50383** (Hideki / Tokyo testnet). In practice that means `@somnia-chain/markets-sdk` (`trader.placePerpOrder`) or raw `placeOrder` / `placeOrderFor` on a PerpPool. The dreamDEX HTTP API is **spot-only on Shannon (50312)** and cannot place perps orders. See `sponsors/dreamdex.md`. |
| **Judging (verbatim)** | "MVP potential: clear user value, credible scope, a viral or repeat-use loop, technical execution" · "Evidence of building: live orders on Somnia Tokyo testnet, transaction hashes, repo and demo" · "Communication: quality and accuracy of your X posts". **No numeric weights published.** |
| **Evidence implied by the criteria** | Tx hashes of real orders (Tokyo explorer links), a repo, a demo (a video is not mandatory on the platform, but "demo" is named in the criteria), and 2–3 accurate X posts. |
| **Competition reality** | The organizer hides the Builds tab. GitHub shows about **200 public repos** matching "dreamdex perps" as of 2026-11-10, many of them MVPs: risk guards, copy-trading, AI agents, MCP servers, games, journals. There are three winners. See `prior-art.md` §B for the crowded idea clusters to avoid. |

---

## Cross-track notes

- One repo can carry both: the MVP code plus a `feedback/` folder.
- The DoraHacks submission form also requires a **Telegram username** and a **Discord username** (platform `submission_form`).
- Whitelisting is required to submit at all (see `event.md` §2).
