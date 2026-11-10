# Runsheet — dreamDEX Perps Builder Bounty (DoraHacks)

_Guide seat: claude-sonnet-5-5 · tier standard · effort high (model id stated by the session; effort set by the user per the kickoff). Created 2026-11-10 14:45 WAT (~121h to the extended deadline). All times WAT = UTC+1 (the user's local tz, and the DoraHacks timeline's tz)._

## Event
- **Name / URL:** dreamDEX Perps Builder Bounty — https://dorahacks.io/hackathon/dreamdex-perps-bounty/detail (tabs: /tracks · /announcements · /build · /qa). Organizer: Somnia Network × dreamDEX. Virtual. Platform: DoraHacks.
- **Deadline:** timeline widget (UTC+1): Submission opened 2026/10/19 13:00 · Deadline 2026/11/02 00:59 · **Extended → 2026/11/15 15:30 (UTC+1) = 2026-11-15 14:30 UTC = Sun 15:30 WAT**. **CONTRADICTION on the page:** the Details body still says "Submissions close November 1, 23:59 UTC" and "By November 8 Results"; Announcements tab is empty (no official extension notice). **User-confirmed 2026-11-10 ~15:00 WAT: the widget's extended date, 2026-11-15 15:30 WAT, is the correct deadline** (the body text is stale). Working deadline = 2026-11-15 15:30 WAT (blocker B1 resolved).
- **Prizes ($3,000 pool):** Feedback track up to $1,500 ($40 per accepted critical/major item, $15 per other; first valid report only; stops when the $1,500 is used). MVP track 3 × $500, paid $300 at announcement + $200 after the perps mainnet launch if the MVP places mainnet orders within 30 days of launch; winners also get a technical-breakdown post on the dreamDEX X account.
- **Evaluation (no numeric weights published):** MVP — MVP potential (clear user value, credible scope, viral/repeat-use loop, technical execution) · Evidence of building (live orders on Somnia Tokyo testnet, tx hashes, repo and demo) · Communication (quality and accuracy of X posts). Feedback — severity, clarity, reproducibility, usefulness.
- **Required (MVP):** GitHub repo link; the MVP places REAL perps orders on Somnia Tokyo testnet; README explains what it does / who it is for / how to run it; README has an **"X posts" section with links to 2–3 posts about the MVP that tag @DreamDEXSomnia**. Categories: bots and agents · trader tools · consumer perps; Somnia primitives (Reactivity, Somnia Agents) are "a plus".
- **Required (Feedback):** one Markdown file per issue in `feedback/` (template on the Details page: title, Severity, Area, Steps to reproduce, Expected, Actual, Evidence, Environment). Security issues go privately to security@dreamdex.io, never in the repo.
- **Eligibility gate:** registration open to all, but **only whitelisted emails can submit Builds** (invite already sent to selected dreamDEX Event Contracts hackathon builders; others: ticket in dreamDEX Discord or message in the SomniaHacks Telegram with the DoraHacks email). The user's Chrome showed the page's Submit Build / Unregister buttons (registered). **User-attested 2026-11-10 ~15:00 WAT: already whitelisted** (guide did not verify it independently; blocker B2 resolved).
- **Testnet funds:** paper USDso weekly via the Perps Arena (app.testnet.dreamdex.io); extra USDso on request in Discord, only to a bounty account NOT in the Perps Arena; moving bounty USDso into an Arena account is forbidden.
- **Builds list is private** (organizer setting) → no visible competitors; 269 registered hackers; real field = whitelisted submitters (unknown).
- **Resource links (from the page):** dev docs https://app.testnet.dreamdex.io/docs/developers/perps-testnet · trader docs https://app.testnet.dreamdex.io/docs/trading/perps-testnet · bot kit https://github.com/somnia-chain/dreamdex-bot-kit · dreamBot Builder https://app.testnet.dreamdex.io/dreambot-builder · Link-a-Bot guide https://app.testnet.dreamdex.io/docs/trading/common/link-a-bot · Markets SDK docs https://somnia-platform-docs.vercel.app/markets/somnia-markets · Discord https://discord.gg/dreamdex · Telegram (SomniaHacks) https://t.me/+s_oRMnGpOyQ3ODQ0 · X https://x.com/DreamDEXSomnia.
- _All of the above is a light guide read of the live page, for strategy only. The Step 0a pack is the source of truth; every figure gets re-verified there._

## Project repo
- **`Dotman-Bei/dreamdex-perps-bounty-2026`** — **private**, pipeline-created by the guide 2026-11-10 ~14:35 WAT per `references/repo-bootstrap.md` (event-named form). Local clone: `C:\Users\bamig\Documents\VIBE CODE\Hackathons\dreamdex-perps-bounty-2026` (sibling of the kit, not inside it). Branch `main`, commits `781cf06` (README stub + .gitignore), `c10e5b9` (docs/design/frontend.md). idea-forge Step 4 will rename it to the project slug — update this line and every kickoff's `REPO:` when it does.
- Kit checkout: `C:\Users\bamig\Documents\VIBE CODE\Hackathons\build-system` (origin `bitnormie01/build-system`), at origin/main `230bbc8`, verified in sync 2026-11-10 14:33 WAT. (The prompt said `~/hackathons/build-system`; the real location is the Hackathons workspace folder — same layout, different path.)
- Git note (from the prior campaign, still applies): the default credential helper can stall on fetch/push; `git -c credential.helper= -c "credential.helper=!gh auth git-credential" <cmd>` works (used for both pushes today).

## Tollgate
- Report: **none yet** — Step 0a's Stage 0 creates `docs/tollgate/<date>-tollgate.md` (0a is RUN, so the guide does not run the campaign tollgate itself).
- Guide pre-checks 2026-11-10 14:33 WAT (informational, not a report): row 1 git 2.54 + identity PASS · row 2 gh logged in as Dotman-Bei PASS · row 3 kit at origin/main PASS · row 4 repo created PASS · row 5 claude-in-chrome responded in THIS session (session-scoped; 0a re-probes) · row 9 Node v22.23.4 PASS.
- Verdicts: 0a CLEAR to hand over (rows 2–5 pass) · all later steps: not yet assessed. **No kickoff goes out for a BLOCKED step.**

## Goal / skills (assumed — the prompt left the placeholders)
- **Goal (assumed):** win one of the three **MVP-track** slots ($500 each) with a perps bot/agent/trader tool that places real testnet orders; harvest the **Feedback track** as a by-product of the same build. User to correct if the aim differs.
- **Skills (assumed from the 3 prior campaigns):** TypeScript/React/Node, Solidity/EVM, Python/ML. This event looks API/SDK-driven (no contract authoring expected) — pack confirms.

## Strategy decisions
| Decision | Choice | Reason |
|---|---|---|
| Mode | guided | user approves each baton; ~5-day clock, real wallet/signing involved |
| 0a extractor | **RUN, time-boxed ~60 min** | the build lives or dies on dreamDEX/Somnia facts (testnet addresses, SDK signatures, order flow, chain id/RPC) and the docs are JS-rendered portals |
| 0 idea-forge | **RUN**, `safe-feasible`, MVP track | user has no idea yet; the rubric rewards a credible, working, repeat-use product |
| 1 architect | RUN — budget ≤3h | |
| 2 orchestrator | RUN — review mode decided at Step 2 boot (lean `autonomous` with security/signing tasks pinned `top`; testnet burner wallet only) | |
| 2.5 demo-studio | **OPTIONAL — decide at green** (planned in 0a so Stage 0 probes its rows) | "demo" is part of Evidence of building and the X posts need a clip/GIF; run only if ≥10h remain after green |
| 3 gate-concierge | **both passes**: preflight right after Step 1 (burner wallet, Somnia Tokyo gas, Perps Arena join, USDso, any API keys); closing (repo-public flip, README X-posts links, DoraHacks submission) | many human gates: wallet, funds, X posts, public repo, submit |
| Calendar fit | fits **only as a vertical slice** | see Calendar section |
| Track shortlist | (1) **MVP** — lean bots & agents, (2) **MVP** — trader tool as the alternative framing, (3) **Feedback** in parallel | only 2 real tracks; 3 MVP winners come from one pool, categories are not separate prizes; consumer perps dropped (viral loop + multi-user polish is the least feasible in 5 days) |
| Risk appetite | **`safe-feasible`** (user decides) | 121h; unfamiliar stack whose API the organizers are literally paying people to bug-hunt; "Evidence of building" = real on-chain orders, so execution reliability beats ambition. Guard: the idea must NOT be a bot-kit clone — differentiate by a sharp use-case + a Somnia primitive (stated plus), judged against `prior-art.md` |
| Sponsor depth (0a) | **deep:** dreamDEX (perps dev + trader docs, API/SDK/contracts, bot kit repo incl. open issues, dreamBot Builder + Link-a-Bot, Perps Arena rules, USDso) and Somnia (Tokyo testnet chain id/RPC/explorer/faucet, Markets SDK, Reactivity, Somnia Agents). **shallow:** DoraHacks submission mechanics, Discord/Telegram (gated → gap, do not join) | the two sponsors are the whole event |

## Calendar (WAT) — internal, not the event's
- **Nov 10 (today):** 0a 15:00–16:00 → 0 idea-forge ~16:00–17:00 → 1 architect ~17:00–20:30; **Step 3 preflight in parallel from ~21:00**.
- **Nov 11:** build starts. **Tripwire: our code places a real order on Somnia Tokyo testnet with a tx hash by end of Nov 11.** If not, stop and escalate (and log the blocker as a Feedback item).
- **Nov 12–13:** build the rest; money shot first, polish last. **Nov 14:** QA, demo clip, README, the 2–3 X posts published (user), README X-posts section filled.
- **Nov 15:** buffer. **Hard stop: submitted by 09:00 WAT** (6.5h before the 15:30 deadline).

## Frontend constraint (carry into idea-forge's and the architect's kickoffs)
- `docs/design/frontend.md` (the design-taste-frontend skill's SKILL.md, committed `c10e5b9`). Architect kickoff **DOCS** must list it; **CONSTRAINTS** must include verbatim: *"All UI follows docs/design/frontend.md. Every frontend task's code applies its tokens, type, layout and components, and its task block cites the file."*
- Caveats: the skill is a marketing-site skill applied to what is likely a trading dashboard/tool (apply tokens/type/layout, not hero/scene moments to the app); its SKILL.md points at sibling files (`layout-v4.md`, `sections.md`, `assets/`) that are NOT in the repo — the architect decides whether to add a kit subset. The skill folder carries no licence file: review before the public flip.

## Feedback-track harvest (carry into the architect kickoff)
- CONSTRAINT to add: "Log every reproducible dreamDEX/Somnia API, SDK, docs or contract defect met during the build as `feedback/<slug>.md` using the Details-page template (Severity, Area, Steps, Expected, Actual, Evidence with tx hash/request-response, Environment: SDK version, Somnia Tokyo testnet, wallet address). Never put a security issue in the repo."

## Step status
| Step | Status | Artifact | Verified | Seat settings |
|---|---|---|---|---|
| 0a | pending | — | — | — |
| 0 | pending | — | — | — |
| 1 | pending | — | — | — |
| 2 | pending | — | — | — |
| 2.5 | pending (optional) | — | — | — |
| 3 | pending (two passes) | — | — | — |

## Open blockers
- ~~**B1 — deadline ambiguity.**~~ RESOLVED (user-confirmed): the widget's 2026-11-15 15:30 WAT is correct; the page body text is stale.
- ~~**B2 — whitelist.**~~ RESOLVED (user-attested): already whitelisted. Step 3's closing pass still confirms Submit Build opens when it files.
- **B3 — funds/wallet.** Real testnet orders need a burner wallet + Somnia Tokyo gas + Perps Arena USDso (Step 3 preflight; user consents per gate).
- **B4 — X posts.** 2–3 posts tagging @DreamDEXSomnia must exist before submission; publishing is the user's consent (Step 3 closing).
- **B5 — repo visibility.** A GitHub link is required; public flip is consent-gated at submission time. Review `docs/design/frontend.md` (no licence file) and scan for secrets before flipping.
- **B6 — path with spaces.** The workspace path contains a space; the prior campaign lost hours to a Node tool that shells out unquoted. If the stack is Node/pnpm, build in a no-space clone (e.g. `C:\dev\<project>`, same origin) — decide at Step 2 boot.

## Next action
- **User:** set a fresh session to `opus` · `high`, then paste the Step 0a kickoff (deadline and whitelist already confirmed — no organizer message needed).
