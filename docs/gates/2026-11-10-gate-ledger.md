# Gate ledger — Basanos (dreamDEX Perps Builder Bounty)

The campaign's one gate ledger (gate-concierge, Step 3). Each pass extends this file; it is never forked.
It records env-var **names**, storage locations and **public** addresses only. No key or token value
ever appears here.

- **Created:** 2026-11-11 02:45 WAT by the gate-concierge **preflight** pass. Seat: `claude-opus-5-5`, tier top,
  effort high (the campaign's top-tier binding is `claude-opus-5-5`, runsheet row 18, so this seat is at it).
- **Chain:** Somnia Tokyo testnet = **Hideki, chain 50383**. NOT Shannon (50312).
- **Repo:** `Dotman-Bei/basanos` (private). Local clone: `…\Hackathons\dreamdex-perps-bounty-2026`.
  Synced to `fff6fec` at creation.
- **Consent rule:** nothing in this ledger runs until the user names the gate ("run gate P2"). An approval for one
  gate does not carry over to the next. Silence counts as a no.
- **Signup automation: STRUCK** for this campaign (runsheet D3). If a CAPTCHA or wallet-connect appears, the user
  makes that click; the concierge does the rest.
- **Granted this pass:**
  - claude-in-chrome, for the Hideki faucet page only;
  - three testnet BURNER wallets, with their keys written to the git-ignored repo-root `.env`;
  - throwaway scripts in a scratch folder outside the repo and the kit.
- **Not granted:** computer-use, the email inbox, any wallet extension, the user's main wallet or seed phrases,
  anything mainnet.

## Session card (tollgate rows for this seat, probed 2026-11-11 ~02:40 WAT)

| Row | Check | Result | Evidence |
|---|---|---|---|
| 5 | claude-in-chrome responds in THIS session | **PASS** | `tabs_context_mcp` answered: tab group `1797704298`, one blank tab |
| 15 | cross-session env store | **PASS** (store = repo-root `.env`, per the kickoff) | `git check-ignore -v .env` → `.gitignore:2:.env`; `.env` absent before P1; repo root writable |
| 6 | computer-use | not granted (kickoff) | not needed: the P1–P4 gates are browser and CLI only |
| 7 | email inbox | not granted (kickoff) | not needed for P1–P4. Closing signups become Tier B (see C4) |
| 8 | wallet extension | not granted (kickoff) | not needed: burners are generated locally, not in MetaMask |
| C1 | Hideki RPC | **PASS** | `eth_chainId` = `0xc4cf` (50383) on `api.hideki.infra…` and `api.hideki2.infra…` |
| — | Node / npm for scratch scripts | **PASS** | Node v22.23.4, npm 10.9.9 |
| — | kit repo write-back (P2 playbook) | **DEGRADED** | `gh api repos/bitnormie01/build-system` → Dotman-Bei has `push: false`. The playbook can be committed **locally** in the kit checkout but cannot be pushed; the kit owner pushes it, or a PR goes up later (the user decides) |
| — | GitHub identity | **PASS** | `gh auth status` → `Dotman-Bei`, active |

## Gates

**Tiers:**
- **A** — agent-runnable with consent.
- **B** — assisted: one capability gap or user click remains.
- **C** — human-only.

**Pass:**
- `preflight` — runnable in THIS pass.
- `orchestrator-pause` — a declared manifest human gate. The user runs it with the guide; the concierge does NOT
  run it.
- `closing` — runs after Step 2 is green.

### Preflight — this pass's runnable set (P1–P4)

| # | Gate | Tier | Pass | Tool plan | Human moment | Risk note | Status |
|---|---|---|---|---|---|---|---|
| P1 | **Burners.** Three fresh keypairs: REFEREE (also the registry deployer and owner), ACCOUNT_A (human challenge account), ACCOUNT_B (bot challenge account). Written to the repo-root `.env` as `REFEREE_PK`, `REFEREE_ADDRESS`, `ACCOUNT_A_PK`, `ACCOUNT_A_ADDRESS`, `ACCOUNT_B_PK`, `ACCOUNT_B_ADDRESS` (the manifest `env` names) | A | preflight | Bash: (1) `git check-ignore .env` must report ignored; (2) a node script in the scratch folder, `viem@2.57.12` `generatePrivateKey` + `privateKeyToAccount`, appends the six lines straight to `.env`, refuses to run if any of those names already exist, and prints **addresses only** | none | A key reaching stdout, a log or a commit. Mitigated: the script never prints a key, `.env` is git-ignored, and every commit is by explicit path. Blast radius: three empty testnet burners | **done** 2026-11-11 (see Evidence) |
| P2 | **STT.** Fund REFEREE, ACCOUNT_A and ACCOUNT_B to about 1 STT each from the Hideki faucet. Then write the faucet playbook `references/faucets/somnia-hideki-testnet.md` from `_template.md` | A, but **B** if a CAPTCHA or wallet-connect appears | preflight | claude-in-chrome on `https://explorer.testnet.somnia.network/tokyo/faucet`: discovery, then one claim per burner address. Bash: `eth_getBalance` on `api.hideki.infra…` (fallback `api.hideki2.infra…`) before and after. Write + `git commit` by explicit path in the kit checkout (public facts only, no addresses). **Local commit only:** no push right on the kit (see the session card) | only if the page shows a CAPTCHA or wallet-connect: the user makes that click, then the concierge continues | Pack facts: 1 STT per address per hour, paid only while the balance is under 1 STT, five per connection, "a form meant for a person". Three addresses fit in one connection. A wasted attempt costs nothing but the cooldown. Blast radius: none (the faucet sends; nothing is signed) | **done** 2026-11-11: 3 × 1 STT, no CAPTCHA (see Evidence) |
| P3 | **Vouchers.** For ACCOUNT_A and ACCOUNT_B ONLY (never the referee), claim the one-time 1,000 paper-USDso voucher, ONCE each | A | preflight | Bash: a scratch folder outside the repo and kit with exact pins `@somnia-chain/markets-sdk@0.33.0` and `viem@2.57.12` (`--legacy-peer-deps` if npm crashes with "edgesOut"). The script reads over **WebSocket** (`wss://api.hideki.infra…/ws`) and takes the key from `.env` without printing it: `listPerpMarkets()` → BTC row → `getPerpVoucherEligibility(btc.marginBank, account)` → only if `eligible`, `trader.claimPerpVoucher({ marginBank })`. Verify: `getPerpVoucher`, total equity about 1,000 USDso (quote token read off the market row, NOT `SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral`), account flat (no positions, no locked collateral), `getPerpLeverage` | none | **One-shot per address, for the distributor's life.** A failed claim still mines and costs gas. Rule: one attempt per account; on any error STOP and report; never re-send without re-reading eligibility. Needs about 0.6 STT of headroom, so it depends on P2 for A and B. If a claim is lost, that account would need a new burner and a new `.env` entry. Testnet only | **BLOCKED** 2026-11-11. Attempt 1 (SDK send): outcome-unknown, never mined. Retry (user go, viem path): **`claim()` reverts in simulation for EVERY caller** with custom error `0x3e31dcc2`, although the SDK reports A eligible. Nothing was sent; A still has nonce 0, 1 STT and an unclaimed voucher. ACCOUNT_B not attempted. Awaiting the user (see Evidence) |
| P4 | **Ledger.** This file: per-gate tier, tools, risk, status and evidence. Committed and pushed by explicit path | A | preflight | Write; `git add docs/gates/2026-11-10-gate-ledger.md`; `git -c credential.helper= -c "credential.helper=!gh auth git-credential" push` | none | Shared working tree (architect + orchestrator). Mitigated: explicit-path add, `pull --ff-only`, no stash/reset/clean/checkout on other seats' files | **done**: created and pushed by this commit; evidence rows are added as each gate runs |

**Recommended order:** P1 → P2 (all three addresses in one faucet connection) → P3 (ACCOUNT_A, then ACCOUNT_B, one
attempt each) → P4 evidence commit after each gate. Say "run gates P1–P3" to batch them, or name them one at a time.
P1–P3 feed the Nov 11 tripwire (spike:11 needs ACCOUNT_A's voucher and the referee's STT).

### Orchestrator-pause — declared manifest human gates (the concierge does NOT run these)

| # | Gate | Tier | Pass | Who | Needs from preflight | Status |
|---|---|---|---|---|---|---|
| spike:11 | LIVE: the referee closes a voucher account (G1 a, e; the Nov 11 tripwire), `gate_profile: wallet` | A in principle | orchestrator-pause | user + guide | `REFEREE_PK`, `ACCOUNT_A_PK`, A's voucher (P3), STT on both | pending (not this seat) |
| spike:12 | LIVE: one Price Oracle request on Tokyo testnet (about 0.031 STT), `wallet` | A in principle | orchestrator-pause | user + guide | `REFEREE_PK` + STT | pending (not this seat) |
| contracts:10 | LIVE: deploy BasanosRegistry on Hideki and register Tokyo Sprint, `deploy` | A in principle | orchestrator-pause | user + guide | `REFEREE_PK` + STT (deploy cost measured by the spike) | pending (not this seat) |
| referee:10 | LIVE: referee rehearsal (Nov 12), the first real verdicts, `wallet` | A in principle | orchestrator-pause | user + guide | all three burners funded; `REGISTRY_ADDRESS` | pending (not this seat) |
| ship:3 | LIVE: money shot (one PASS, one FAIL) + `FEATURED_RUN_ID`, `wallet` | A in principle | orchestrator-pause | user + guide | as referee:10 | pending (not this seat) |
| ship:6 | LIVE: deploy to Vercel + `setBaseUrl`, `deploy` | B (Vercel account) | orchestrator-pause | user + guide | `VERCEL_TOKEN` (C4), `REFEREE_PK` + STT | pending (not this seat) |

### Closing — implicit campaign gates (inventoried now, run after Step 2 is green)

| # | Gate | Tier | Pass | Tool plan | Human moment | Risk note | Status |
|---|---|---|---|---|---|---|---|
| C1 | `REGISTRY_ADDRESS` into `.env` after contracts:10 (the manifest says "set by the human") | A | closing | Bash: read `deployments/hideki.json`, append the name to `.env`, verify `eth_getCode` is non-empty | none (or the user sets it during the contracts:10 pause) | public value; none | pending |
| C2 | `FEATURED_RUN_ID` into `.env` after ship:3 | A | closing | Bash, from `docs/evidence/featured-run.json` | none | public value; none | pending |
| C3 | STT top-ups (referee: deploy, rulebook registration, oracle 0.0309 STT per request, closes; accounts: orders 0.0003–0.003 STT, 0.6 STT write headroom) | A, but B on a CAPTCHA | closing (repeatable whenever a balance drops under 1 STT) | as P2 | as P2 | The faucet only pays while the balance is under 1 STT, at most 1 STT per hour, so a burner never holds much more than about 1 STT. Watch the referee before contracts:10 | pending |
| C4 | Vercel account + `VERCEL_TOKEN` (ship:6) | **B** | closing | claude-in-chrome to the Vercel token page once the user is signed in; the token goes into `.env` under `VERCEL_TOKEN`, verified with `npx vercel@65.3.1 whoami` | **the user signs up or signs in** (signup automation is struck and no inbox is granted, so OAuth, CAPTCHA and email codes are the user's). Ideally the user pastes the token into `.env` themselves | a token with deploy scope on the user's Vercel account. Scope it to the project, and revoke it after the hackathon | pending |
| C5 | Flip `Dotman-Bei/basanos` to public | A | closing | Bash/`gh`: `gh auth status` identity re-read; secrets scan of the full git history (no `.env`, no 64-hex keys); confirm `docs/design/frontend.md` and the vendored kit files are listed as third-party (B5/B11); `gh repo edit --visibility public` | none, but **hard to reverse** (history is public the moment it flips), so it gets its own explicit consent | key exposure if the scan misses something: testnet burners only, but scan first anyway | pending |
| C6 | 2–3 X posts tagging @DreamDEXSomnia (required in the README's "X posts" section) | **C** | closing | the concierge drafts the text from the evidence (trust line verbatim, demo disclosure) | **the user publishes** on their own X account (no X access is granted) | claims must match the product (FORBIDDEN_CLAIMS list) | pending |
| C7 | Resolve the README's and the submission draft's `TBD-post-build:` lines (repo URL, Vercel URL, featured verdict URL, registry address, g1a and money-shot tx hashes, X-post URLs, feedback file list, third-party asset list) | A | closing | Read/Edit `docs/gates/submission-draft.md` and the README TBD lines only; commit by explicit path | none | none | pending |
| C8 | Demo video URL | (not this seat) | closing | produced by demo-studio (Step 2.5). The submission waits for it | — | — | dependency |
| C9 | Fill the DoraHacks Build form (save as platform draft), and confirm the whitelist lets Submit Build open | **B** | closing | claude-in-chrome on dorahacks.io, re-reading the logged-in identity first (stop on a mismatch or logged-out state; never log in or switch accounts) | DoraHacks showed a human-verification wall to the architect: the user clears it. The user supplies the **Telegram and Discord usernames** (B7) | none until submit | pending |
| C10 | Final Submit on DoraHacks | **C** | closing | page left open on the filled form, with a checklist | **the user presses Submit** (its own consent, separate from C9) | irreversible | pending |
| C11 | Pasting `ACCOUNT_A_PK` into the in-browser challenge wallet for the demo | **B** | closing / demo | none: the concierge never pastes a key | the user pastes it | testnet burner only | pending |
| C12 | A security-class defect found during the build → report privately to security@dreamdex.io (never in the repo) | **C** | closing, only if one exists | the concierge drafts it | the user sends it (no inbox is granted) | disclosure hygiene | conditional |

### Excluded by the kickoff (recorded so nobody re-raises them)

- Perps Arena app flows and the weekly arena USDso: excluded. The SDK voucher (P3) is the USDso route.
- USDso requests in Discord or Telegram, a bounty account, moving USDso between accounts: excluded (moving bounty
  USDso into an Arena account is forbidden by the event).
- A voucher for the referee, or a second claim for any address: never.
- MetaMask or any wallet extension, computer-use, the email inbox, the main wallet, mainnet: not granted, never.

## Evidence

_Filled per gate as it runs. Public addresses and tx hashes only._

### P1: Burners. DONE 2026-11-11 ~03:00 WAT (user: "run gates P1–P3")

- `git check-ignore -v .env` → `.gitignore:2:.env`, checked before writing and again after.
- Script: `viem@2.57.12` `generatePrivateKey`, run from the session scratch folder outside the repo and the kit.
  - It created `.env` exclusively (`wx` flag) with six names: `REFEREE_PK`, `REFEREE_ADDRESS`, `ACCOUNT_A_PK`,
    `ACCOUNT_A_ADDRESS`, `ACCOUNT_B_PK`, `ACCOUNT_B_ADDRESS`.
  - Readback: every PK derives its stored address (OK × 3).
  - No key was printed.
- `.env` does not appear in `git status`.
- Public addresses:
  - REFEREE (deployer / registry owner): `0xE358D82209ea9360F411A041C0200adc385877eb`
  - ACCOUNT_A (human challenge account): `0x917Fa4Fd95d80d0dbf2823bFa1F07496Aca4AEc1`
  - ACCOUNT_B (bot challenge account): `0x1609F6ABE3aD29B45D1F2fdd15a15d17AbB326aD`

### P2: STT. DONE 2026-11-11 ~03:05 WAT

- The faucet page `explorer.testnet.somnia.network/tokyo/faucet` (Tokyo selected) showed one address field and a
  "Send 1 STT" button.
  - **No CAPTCHA, no wallet-connect.** There was no user moment.
  - The page answered "Sent 1 STT. View the transaction" for each claim.
- Before: `eth_getBalance` = `0x0` for all three addresses.
- After: **1.0 STT each** (`api.hideki.infra…`).
- Faucet txs, all status `0x1`, value 1 STT, all from the same faucet sender:

| To | Tx hash | Block |
|---|---|---|
| REFEREE | `0xd964936b3475df11d517a14e51bbda3eddc3430477e42bce50267acfca14bff4` | 47078869 |
| ACCOUNT_A | `0xf87f6ef953a5664fd8af21f81eaafb7f13d6b5125929cc5c822cc6e6695de629` | 47079146 |
| ACCOUNT_B | `0x2daa19c2269971df71898bc99cad732a1cbdf084f46bfe85f4a314208f5ccf26` | 47079380 |

- Faucet playbook: `references/faucets/somnia-hideki-testnet.md`, committed in the kit checkout as **`0e63cfa`
  (LOCAL ONLY)**. Dotman-Bei has no push right on `bitnormie01/build-system`; the kit's `main` is ahead 1.

### P3: Vouchers. BLOCKED 2026-11-11 ~03:15 WAT

- **Setup:** scratch folder, exact pins `@somnia-chain/markets-sdk@0.33.0` and `viem@2.57.12`. npm installed cleanly;
  `--legacy-peer-deps` was not needed.
- **Read-only pre-check** (WebSocket SDK, no key loaded), both accounts:
  - `getPerpVoucherEligibility` → `eligible: true`, `grantAmount` 1,000 USDso;
  - `getPerpVoucher` → `claimed: false`;
  - total equity 0, locked collateral 0, BTC position 0;
  - `getPerpLeverage` → `voucherLeverageCapX: 20`, `voucherMarketAllowed: true`, `protocolMaxLeverageX: 40`;
  - STT 1.0 each.
- **Market row:**
  - BTC/USDso, pool `0x4181dd08E73BbCdd1Ba3E615A18f6abD941b94C0`, marginBank
    `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`.
  - Quote token **`0xed7993a74dae1e6656b704a424dcd8711aaf4f72` (USDso, 18 decimals)**. This confirms the pack's
    gotcha: `SOMNIA_HIDEKI_TESTNET_ADDRESSES.collateral` is a different token (`0x9E94…148f`).
- **ACCOUNT_A, the one claim attempt:** `trader.claimPerpVoucher({ marginBank })` threw
  `TransactionOutcomeUnknownError`, which said: "rpc eth_sendRawTransactionSync failed: transaction
  `0x8bcb9be8c6cb45bc57eb62d0245efe1b59bb2a82aacae10ab93da4e98a02f038` on chain 50383 may have been sent; its
  receipt was not observed".
- **Verified afterwards, read-only:**
  - `eth_getTransactionByHash` and `eth_getTransactionReceipt` → `null` on both `api.hideki` and `api.hideki2`;
  - account A nonce `0x0` (latest AND pending);
  - STT still exactly 1.0 (no gas spent);
  - re-read eligibility → still `eligible: true`, voucher `claimed: false`.
  - **Conclusion: the claim was NOT mined and the voucher is NOT spent.**
  - At that moment the SDK chain's `default`, `send` (`send.hideki.infra…`) and `session` hosts all answered
    `eth_chainId` = 50383, so the cause is unknown (a dropped or timed-out sync send at the validator endpoint).
- **Per the rule** (one attempt per account; on any error STOP and report; never re-send without re-reading
  eligibility), the concierge STOPPED.
  - **No re-send for A. ACCOUNT_B was not attempted.**
  - The next attempt for either account needs the user's explicit go.
- **Feedback-track candidate** (duplicate-check first): `claimPerpVoucher` on 0.33.0 surfaced an outcome-unknown
  send for a transaction that never reached the chain.

### P3 retry: user go 2026-11-11 ~03:20 WAT (diagnostics D1/D2 from the REFEREE, then ONE claim for ACCOUNT_A)

The user's method:
1. D1 and D2 run from the referee only.
2. Re-read A's state immediately before sending.
3. Build the claim UNSIGNED with `buildClaimPerpVoucher`.
4. Sign and send it with viem over a path D1/D2 proved, with explicit nonce 0, gas 1.5× the estimate and gas
   price 1.3× `eth_gasPrice`.
5. Wait up to 90 s for the receipt.

On any error, STOP. No SDK pin or plan change.

**D1 (verbatim): viem `sendTransaction`, 0-value self-transfer from the REFEREE over `https://api.hideki.infra…`.
WORKS.**
```
D1 host https://api.hideki.infra.testnet.somnia.network before {"latest":0,"pending":0,"balance":"1000000000000000000"}
D1 sent 0x3a720759acf930500206dd28fe4b34368f30ef3a4c3b266e4ef0ad3f56fcf061
D1 receipt {"hash":"0x3a720759acf930500206dd28fe4b34368f30ef3a4c3b266e4ef0ad3f56fcf061","status":"success","block":"47088026","gasUsed":"21000","effectiveGasPrice":"6000000000","type":"eip1559"}
D1 after {"latest":1,"pending":1,"balance":"999874000000000000"}
```
(`api.hideki2` was not needed.)

**D2 (verbatim): SDK 0.33.0 `trader.approvePerpMargin({ amount: 1n, marginBank })` from the REFEREE.**
This is a 1-wei USDso allowance to the MarginBank on an account with 0 USDso: no funds move and no voucher is
touched.
- Default send path: **WORKS.** The SDK sent it with type 2 and a fixed gas of 10,000,000.
- Non-default `wsRpcUrl` `wss://api.hideki2.infra…/ws`: **FAILS before sending.**
```
D2[default] before {"latest":1,"pending":1,"balance":"999874000000000000"}
D2[default] OK {"hash":"0xce514c94a40b6077ebbe44b457c52464b28f626dd3a549bde0dc625783185b26","status":"success","block":"47088233","gasUsed":"260601"}
D2[default] after {"latest":2,"pending":2,"balance":"998310394000000000"}
D2[ws2] before {"latest":2,"pending":2,"balance":"998310394000000000"}
D2[ws2] FAILED RpcError:  | @somnia-chain/markets-sdk: rpc getBlock failed: genesis check failed
D2[ws2] after {"latest":2,"pending":2,"balance":"998310394000000000"}
```
- Referee STT after D1 + D2: 0.998310394. Its nonce is now 2.

**ACCOUNT_A claim: STOPPED before sending.**
- **Pre-read** (just before the send step): nonce latest 0 / pending 0, STT 1.0, `eligible: true` (grant 1,000
  USDso), voucher `claimed: false`, equity 0, BTC position 0.
- **Unsigned call** (`buildClaimPerpVoucher`): chainId 50383, to the VoucherDistributor
  `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4`, value 0, data `0x4e71d92d` (`claim()`).
- **`eth_estimateGas` from A → `EstimateGasExecutionError: Execution reverted for an unknown reason`.** The script
  exited before signing. **No transaction was sent.**
- **Read-only follow-up** (no send):
  - A's nonce is still 0 / 0, STT 1.0, still eligible, voucher unclaimed.
  - `eth_call` of `claim()` from A, with and without gas 10,000,000, reverts with data **`0x3e31dcc2`**.
    `eth_estimateGas` with a 10M cap gives the same.
  - **The same revert, `0x3e31dcc2`, appears when simulating from ACCOUNT_B and from two never-used addresses
    (`0x…dEaD`, `0x1111…1111`), so it is GLOBAL, not account-specific.**
  - The selector is not among the 591 custom errors in the SDK 0.33.0 ABIs, and is unknown to openchain and
    4byte.
  - The distributor is an EIP-1967 proxy; implementation slot = `0x9657f0fd53efc01cd108d93c835bb4b517732b43`.
  - `getPerpVoucherCampaign` shows the campaign is active:
    - startsAt 1790553600 (2026-09-28), endsAt 1798477478 (2026-12-28);
    - budgetRemaining and claimsRemaining both 70,779 (that is, 70,779 claims of 1,000 USDso left);
    - grant 1,000 USDso, leverageCapX 20.
    - Chain head time was 2026-11-11T02:11Z.
  - Recent distributor logs could not be scanned: `eth_getLogs` is capped at 1,000 blocks (about 100 s).
- **Reading:** the distributor itself rejects every `claim()` right now with an error the SDK does not know. The
  SDK's eligibility read does not reflect it. Attempt 1's "outcome-unknown" send was most likely this same
  revert, rejected at the sync-send endpoint.
- **Feedback-track candidate** (strong; duplicate-check first): eligibility says `eligible: true` while
  `VoucherDistributor.claim()` reverts for every address with `0x3e31dcc2`, an error not in the SDK's ABIs.
