# Event: dreamDEX Perps Builder Bounty

**Primary source:** https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail, fetched 2026-11-10 with Chrome (`get_page_text`). Also the public platform JSON `https://dorahacks.io/api/v1/hub/hackathons/2443`, fetched 2026-11-10 with Chrome in-page `fetch`.
Organizer: Somnia Network (DoraHacks org 3427) × dreamDEX. DoraHacks hackathon id **2443**, slug `dreamdex-perps-bounty`. Virtual. Prize pool **3,000 USD**. 269 registered hackers (2026-11-10).

Everything in "quotes" or code blocks is verbatim from the source named beside it.

---

## 1. Deadline: ⚠️ CONTRADICTION ON THE PAGE (both versions recorded)

### A. Timeline widget (Details page header, labelled "(UTC+1)")

```
EVENT TIMELINE
(UTC+1)
Submission deadline extended
Upcoming
Submission
2026/10/19 13:00
Deadline
2026/11/02 00:59
Extended
2026/11/15 15:30
```

### B. Details body text, "Timeline" section

```
October 19 Bounty opens, perps introduction session
October 19 to 25 Perps bot kit session
October 26 to November 1 Quick build ideas session, MVP builds and X posts
November 1, 23:59 UTC Submissions close
By November 8 Results
```
The intro paragraph also says: "It runs from October 19 to November 1 and has two tracks."

### C. Platform API (machine-readable, primary): this resolves the conflict

From `GET /api/v1/hub/hackathons/2443`, converted from Unix seconds:

| Field | Raw | UTC | WAT (UTC+1) |
|---|---|---|---|
| `timeline_start` | 1792411200 | 2026-10-19T12:00:00Z | 2026-10-19 13:00 |
| `timeline_old_end` | 1793577540 | 2026-11-01T23:59:00Z | 2026-11-02 00:59 |
| `timeline_end` | 1794753000 | **2026-11-15T14:30:00Z** | **2026-11-15 15:30** |
| `is_extended` | `true` | | |
| `winner_announced` | `false` | | |

**Reading:** the body text's "November 1, 23:59 UTC" is the **original** deadline, and it equals the widget's `2026/11/02 00:59 (UTC+1)`. The body was never updated after the extension. The platform's live deadline is **2026-11-15 14:30 UTC = 2026-11-15 15:30 WAT**. The user confirmed this date to the guide on 2026-11-10 (runsheet blocker B1).

**Still unknown:**
- The results date after the extension. The page says "By November 8", which predates the extension.
- Whether the extension applies to **both** tracks. A Q&A post on 2026-11-10 asks exactly this, with no organizer answer visible.

**Announcements tab:** "The list is empty" (re-checked 2026-11-10). There is no official extension notice.

---

## 2. Eligibility (verbatim, Details → "Who can submit")

> Registration is open to everyone. Only whitelisted emails can submit Builds.
>
> Selected builders from the dreamDEX Event Contracts hackathon are already whitelisted and get an invite by email and Telegram.
> Anyone else: open a ticket in the dreamDEX Discord, or message us in the SomniaHacks Telegram group, with the email you use on DoraHacks, and we add you to the whitelist.

- Platform API: `enable_whitelist: true`.
- **How the whitelist bites (secondary: Q&A posts by other hackers, 2026-11-05 to 11-10):** if the account is not whitelisted, `POST /api/v1/hub/hackathons/2443/publish-buidl` returns `{"success":false,"msg":"You are not in the whitelist for this hackathon"}`, and the Submit button shows as disabled. **The whitelist matches by email**, so a request made from a different DoraHacks account does not carry over. Many hackers have open whitelist requests with no visible organizer reply.
- User status: the user told the guide (2026-11-10) they are already whitelisted. This session did **not** check that. Step 3's closing pass should confirm that Submit Build actually opens.

---

## 3. Submission format (verbatim, Details → "How to submit")

> Every Build needs a GitHub repository.

### Feedback track: template, verbatim

> Put each item in its own Markdown file in a feedback/ folder in your repo, one file per issue:

```
# Short title
Severity: critical | major | normal
Area: API | SDK | docs | app | contracts

## Steps to reproduce
1. ...

## Expected

## Actual

## Evidence
Transaction hash, request and response, screenshots

## Environment
SDK version, network (Somnia Tokyo testnet), wallet address
```

> Found a security vulnerability? Do not put it in your repo. Send it privately to security@dreamdex.io.

### MVP track: requirements, verbatim

> Your MVP places real perps orders on Somnia Tokyo testnet.
> Your README explains what it does, who it is for and how to run it.
> Your README has an X posts section with links to 2 or 3 posts about your MVP that tag @DreamDEXSomnia.
> Categories: bots and agents, trader tools, consumer perps. Using Somnia primitives such as Reactivity or Somnia Agents is a plus.

The Tracks tab words the MVP requirement as: "Your MVP should place real perps orders on Somnia Tokyo testnet. Add an "X posts" section to your README with links to 2 or 3 posts about your MVP that tag @DreamDEXSomnia."

### DoraHacks submission form (platform API; there is no rendered copy)

- `mandatory_git_repo_link: true`, `mandatory_video_link: false`. The header also shows "GitHub/Gitlab/Bitbucket Link Required".
- `buidl_form_mode: "application"`, `is_enabled_submission_form: true`, and `submission_form` has **two required questions: "Telegram username" and "Discord username"**. The user needs both handles at submission (Step 3 closing).
- `is_multi_tracks_allowed: true`, `tracks_limit_for_buidl: 0`. One Build can enter both tracks; the page says "You can enter one or both."
- `hide_builds_tab: true` and `buidls_count: 0`. Submitted Builds are invisible to other hackers.

---

## 4. Judging criteria: ⚠️ NO NUMERIC WEIGHTS ARE PUBLISHED

Verbatim, Details → "Evaluation":

> Feedback: severity, clarity, reproducibility, and how useful the item is for the perps product and developer experience.
>
> MVP:
>
> MVP potential: clear user value, credible scope, a viral or repeat-use loop, technical execution
> Evidence of building: live orders on Somnia Tokyo testnet, transaction hashes, repo and demo
> Communication: quality and accuracy of your X posts

**Weights:** none are given anywhere on the Details, Tracks or Announcements pages, or in the platform JSON (`bonus_description: []`). idea-forge must **not** invent percentages. At most it can treat the three MVP criteria as listed, in this order, with no published ranking.

---

## 5. Prize structure (verbatim, Details → "Prizes")

> **Feedback track, up to $1,500**
>
> $40 for each accepted critical or major item
> $15 for each other accepted item
> An item is accepted only if we can reproduce it. Only the first valid report of an issue is paid; duplicates are closed.
> Payouts stop once the $1,500 track budget is used.
>
> **MVP track, 3 x $500**
>
> Three MVPs win $500 each, paid in two parts: $300 when the winners are announced, and $200 once the MVP runs on mainnet. The $200 is paid after the perps mainnet launch, if the MVP places orders on mainnet within 30 days of the launch.
> Each winner also gets a technical breakdown post on the dreamDEX X account.

### The 30-day mainnet $200 clause (verbatim)

> "The $200 is paid after the perps mainnet launch, if the MVP places orders on mainnet within 30 days of the launch."

Context, from sponsor docs fetched 2026-11-10: "Perps are on the testnet only. There are no perp markets on mainnet yet." (dreamDEX trader docs). Somnia docs say perps mainnet is "coming soon", with no date. Somnia's **Tokyo Subchain mainnet** (chain 50321) has been live since 29 October 2026, so the mainnet target is probably Tokyo, but that is **not confirmed**. Gap: no perps mainnet date is published, nor which chain the mainnet perps will run on.

**Payout token / network:** not stated anywhere. A Q&A post (2026-11-10) asks this, with no answer. Gap.

---

## 6. Testnet-vs-mainnet rules

- MVP orders must be **real perps orders on Somnia Tokyo testnet**.
- **Naming resolution (sponsor docs, 2026-11-10):** "Somnia Tokyo testnet" = the Tokyo Subchain testnet = **"Hideki" testnet, chain ID 50383**. The dreamDEX app calls it the "DreamDEX region"; its explorer lives at `explorer.testnet.somnia.network/tokyo`. It is **not** the Shannon testnet (Global L1 testnet, chain 50312), where dreamDEX **spot** and the HTTP API run. See `sponsors/somnia.md` §Networks.
- Mainnet perps do not exist yet. Only the post-win $200 involves mainnet.

### Testnet funds: Perps Arena / bounty-account USDso rules (verbatim, Details → "Testnet funds")

> Trade with your Perps Arena balance: join the Perps Arena on app.testnet.dreamdex.io and you receive paper USDso every week.
>
> If your build needs more, ask us in Discord and tell us why. Extra USDso only goes to a bounty account that is not in the Perps Arena, and those wallets are monitored. Moving bounty USDso into a Perps Arena account is not allowed.

Related sponsor-doc facts:
- "Join Perps Arena, the paper-trading competition, to receive 1,000 paper USDso to trade with" (trader docs).
- SDK: "Any address can claim the 1,000 USDso perps credit once, as long as it holds no perp positions or orders" (dev docs).
- The **paper-USDso voucher rules** (non-withdrawable, allowlisted markets only, leverage locked, 14-day reclaim) are in `sponsors/dreamdex.md` §Paper USDso.

**Discrepancy:** the bounty page says paper USDso arrives "every week". The SDK docs say the voucher is "One claim per address, for the distributor's life. A new campaign window does not reset it." Either the Arena tops up by some other route, or one of the two is out of date. Gap: there is no published Perps Arena rules page (see INDEX).

---

## 7. Other event facts

- **Resources linked from the Details page (hrefs verified):** `https://app.testnet.dreamdex.io/`, `/docs/developers/perps-testnet`, `/docs/trading/perps-testnet`, `https://github.com/somnia-chain/dreamdex-bot-kit`, `https://app.testnet.dreamdex.io/dreambot-builder`, `/docs/trading/common/link-a-bot`, `https://somnia-platform-docs.vercel.app/markets/somnia-markets`, Discord `https://discord.gg/dreamdex`, Telegram `https://t.me/+s_oRMnGpOyQ3ODQ0`, X `https://x.com/DreamDEXSomnia`.
- "Session times are announced in the dreamDEX Discord and in the Announcements tab." The Discord sessions (perps intro, bot kit, quick build ideas) are **gated**, so this is a gap.
- Organizer's public contact handle on DoraHacks: `emrey` (platform JSON `public_contact_hacker_handle`).
- Tags: Perps, Trading Bots, AI Agents, DeFi, Trader Tools, Testnet, Somnia, dreamDEX. Platform tech: dreamDEX, Somnia, Perps, Markets SDK, dreamBot Builder.
