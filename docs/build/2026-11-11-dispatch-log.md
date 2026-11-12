# Dispatch log (orchestrator O-2, 2026-11-11)

Agent type: general-purpose (executor-* variants installed but not loaded until session restart; per-spawn model+effort bound, so routing holds; degraded only in tool restriction).

| Task | Requested tier | Model alias | Dispatched effort | Attempt | Result | Commit |
|---|---|---|---|---|---|---|
| spike:1 | fast | haiku | low | 1 | DONE (gate 3 passed, re-run) | 97164f4 |
| spike:2 | standard | sonnet | high | 1 | | |
| contracts:1 | fast | haiku | low (worktree) | 1 | | |
| (spike:2 DONE f47fcad, gate 6 passed re-run; contracts:1 DONE bd2cad1, gate 1 passed re-run in main tree) | | | | | | |
| spike:3 | standard | sonnet | high | 1 | | |
| contracts:2 | standard | sonnet | high (worktree) | 1 | | |
| (spike:3 DONE 3cb75d6, 9 passed re-run; contracts:2 DONE, 2 passed re-run) | | | | | | |
| spike:4 | standard | sonnet | high | 1 | | |
| contracts:3 | top (pinned) | opus | high (worktree) | 1 | | |
| spike:7 | standard | sonnet | high (worktree) | 1 | | |
| (spike:4 DONE, 3 passed re-run) | | | | | | |
| spike:5 | standard | sonnet | high | 1 | | |
| (contracts:3 DONE, 8 passed re-run; access surface reviewed) | | | | | | |
| contracts:4 | top (pinned) | opus | high (worktree) | 1 | | |
| (spike:5 DONE 028b4f7, 3 passed; spike:7 DONE d02c746, 7 passed, tsc clean) | | | | | | |
| spike:6 | standard | sonnet | high | 1 | | |
| spike:8 | standard | sonnet | high (worktree) | 1 | | |
| (contracts:4 DONE 0422285, 7 passed, forge 18/18; spike:6 DONE, 7 passed) | | | | | | |
| spike:10 | top (pinned) | opus | high | 1 | | |
| contracts:5 | top (pinned) | opus | high (worktree) | 1 | | |
| (spike:8 DONE 8851ec9, 12 passed in worktree, tsc clean) | | | | | | |
| spike:9 | standard | sonnet | high | 1 | | |
| referee:1 | standard | sonnet | high (worktree) | 1 | | |
| (contracts:5 DONE 3b34f97, 8 passed, forge 26/26; spike:10 DONE, 16 passed, tsc clean) | | | | | | |
| (referee:1 DONE 10d926a, 12 passed; also restores the @basanos/spike lockfile entry dropped by 0422285 — orchestrator land-script bug, fixed) | | | | | | |
| contracts:6 | top (pinned) | opus | medium (worktree) | 1 | | |
| web:1 | standard | sonnet | high | 1 | | |
| (web:1 DONE, PASS design kit) | | | | | | |
| web:2 | top (pinned) | opus | medium | 1 | | |
| landing:1 | standard | sonnet | high (worktree) | 1 | | |
| (contracts:6 DONE, 6 passed, forge 32/32, access reviewed) | | | | | | |
| contracts:7 | standard | sonnet | high (worktree) | 1 | | |
| (web:2 DONE, 4 passed, tsc clean; NOTE its lockfile change was swept into 74dd70f contracts:6 commit by the land script — content correct, attribution off; script fixed to add the lockfile only on explicit flag) | | | | | | |
| (landing:1 DONE 0922f7e, 4 passed; spike:9 DONE 1494326, 4 PASS evidence (tape 2153 pts); contracts:7 DONE, forge 36/36) | | | | | | |
| contracts:8 | standard | sonnet | high | 1 | | |
| referee:2 | standard | sonnet | high (worktree) | 1 | | |
| web:4 | standard | sonnet | high (worktree) | 1 | | |
| (contracts:8 DONE, 3 passed, ABI export reproducible, tsc clean) | | | | | | |
| (web:4 DONE ad469b9, 7 passed, tsc clean; referee:2 DONE, 7 passed) | | | | | | |
| contracts:9 | top (pinned) | opus | high | 1 | | |
| referee:3 | standard | sonnet | high (worktree) | 1 | | |
| web:3 | top (pinned) | opus | high (worktree) | 1 | | |
| (contracts:9 DONE, tsc exit 0, key never printed) | | | | | | |
| (landing:6 DONE, PASS third-party list) | | | | | | |
| (referee:3 DONE, 4 passed, tsc clean; executor wall time 8.6 h — session paused) | | | | | | |
| (web:3 DONE, 7 passed, tsc clean, key in sessionStorage only) | | | | | | |
| spike:14 (architect plan-bug fix afbd41b) | top | opus | high | 1 | | |
| referee:4 | standard | sonnet | high (worktree) | 1 | | |
| web:5 | top | opus | high (worktree) | 1 | | |
| (spike:14 DONE 535344d, 19 passed, tsc clean; referee:4 DONE, 6 passed) | | | | | | |
| referee:5 | top | opus | high | 1 | | |
| (web:5 DONE, 5 passed, tsc clean) | | | | | | |
| (web:5 DONE bd18da8; referee:5 DONE, 7 passed) | | | | | | |
| referee:6 | top | opus | high | 1 | | |
| web:6 | standard | sonnet | high (worktree) | 1 | | |
| (referee:6 DONE, 2 passed, tsc clean) | | | | | | |
| referee:7 | top | opus | high | 1 | | |
| referee:8 | top | opus | high (worktree) | 1 | | |
| (web:6 DONE 540dd22, 3 passed; referee:7 DONE, typecheck exit 0) | | | | | | |
| web:7 | standard | sonnet | high | 1 | | |
| ship:1 | standard | sonnet | high (worktree) | 1 | | |
| (web:7 DONE ddb1ce4, build ok + app test 1 passed — WEB PLAN COMPLETE; referee:8 DONE, 4 passed; full workspace green) | | | | | | |
| referee:9 | top | opus | medium | 1 | | |
| (referee:9 DONE 57a3114, 2 passed, tsc clean; ship:1 DONE ce829bb, 6 passed) | | | | | | |

## Status at stop (2026-11-11, orchestrator O-2)

- 39 of 56 tasks done, each gate re-run by the orchestrator, scope-checked, diff-reviewed against the plan's code blocks, committed by explicit path and pushed.
- Web plan COMPLETE (7/7). Spike 11/14 (open: 11, 12 human-gated; 13). Contracts 9/12 (open: 10 human-gated; 11, 12). Referee 9/10 (open: 10 human-gated). Ship 1/7. Landing 2/6.
- Blocked on human gates: spike:12 (ready), spike:11 (ready, but needs paper USDso on account A — B14). Every other open task depends on one of them.

## Observations for the architect (none blocked a task)

1. spike:10's gate expects `16 passed`, which counts spike:8's 5 lib tests, but spike:10 has no depends_on edge to spike:8. Resolved by sequencing; add the edge if the plan is regenerated.
2. ship:1 `packages/ship/src/deploy-vercel.ts` passes `--token <VERCEL_TOKEN>` on the npx command line with `shell: true`, so the token is visible in the local process list. Suggest passing it through the child env (the Vercel CLI reads VERCEL_TOKEN natively). Fix before ship:6 runs.

## Orchestrator-side incidents (own glue, fixed)

- 0422285 (contracts:4) committed a stale worktree lockfile that dropped the @basanos/spike workspace entry; restored in 10d926a (referee:1). Land script now copies a worktree lockfile only when the task changed it.
- 74dd70f (contracts:6) swept in web:2's in-progress lockfile change (content correct, attribution off). Land script now adds the lockfile only on an explicit flag.

## Resume 2026-11-11 (plan-bug wave: spike:15, web:8, spike:16; spike:12 rebuild)

| Task | Routed | Commit | Gate (re-run by orchestrator) |
|---|---|---|---|
| web:8 | sonnet / high (worktree) | 98f578f | web 28 passed; test block SAME as plan |
| spike:15 | opus / high (worktree) | 75e296f | spike 21 passed; all 5 plan blocks present; typecheck 0 errors; `--from-tx` path loads no key |
| spike:12 | orchestrator (user-authorized Step 3 only: `--from-tx`, no key, no send) | 10a7436 | `PASS g1d-oracle` |
| spike:16 | opus / medium (worktree) | 93f4732 | spike 25 passed; all 3 plan blocks present; typecheck 0 errors; g1d-oracle still PASS |

spike:12 content check: `mode: from-tx`, `finalStatus: Failed` (code 3), 3 validator responses, finalize tx
0x851aaa04f95533ccabd87e11e3398b09eb85dfe9d709f393223126a3c9582301. Answers not identical: read-only read of the three
validator response transactions' calldata shows the BTC price word differs (74010.77 / 74008.55 / 74011.48) and the
source-count word differs (6 / 7 / 6). The old "Pending" file was overwritten by the rebuild (backup kept outside the repo), never committed.

contracts:10 prepared and HELD (waits for the guide's deploy GO after P1): forge build current; Step 1 fallback does not
apply (`symbols: []` — the failed request recorded no per-symbol numSources), rulebooks unchanged; `deploy.ts --dry-run`
OK: deployer = owner = referee 0xE358…77eb, balance ≈ 0.996 STT, two rulebook lines, `dry-run: no transaction sent`.

Status: 43 / 59 done. Ready tasks are human gates only: spike:11 (blocked on B14 / USDso), contracts:10 (held for P1).

## Resume 2026-11-11 (P1 evidence, contracts:10, contracts:12)

| Task | Routed | Commit | Verification |
|---|---|---|---|
| P1 evidence (spike:16 runbook) | concierge ran it; orchestrator committed | a952757 | finalStatus Success, answersIdentical true, requestId 7782661, BTC/USDC:PERP numSources 6 |
| contracts:10 | concierge deployed on guide GO; orchestrator verified | e53e4e9 | `PASS deployment`; receipts re-read: deploy tx success from referee, contract 0xf5d8…9370; both registerRulebook txs success to the registry; runtime 15,197 B (creation 15,949 B, matching the guide's figure), contains setBaseUrl; rulebooks/foundry.toml unchanged |
| contracts:12 | executor-high / sonnet (main tree) | 32c03da | `PASS verify` re-run (17 immutable slots masked, match true). Explorer attempt failed server-side: "Not available: the explorer cannot answer this request right now" — advisory, not osaka; feedback candidate for ship |

**Plan-bug (contracts:11 — HELD):** its gate needs preview code 0, i.e. account A holds the referee grant and is flat,
which spike:11 produces; the manifest lacks a `contracts:11 -> spike:11` edge. Confirmed with one read-only run:
`FAIL r5-preview (code 3 grant missing; registry 0 vs sdk 0)`. The failing evidence file was deleted, not committed.
contracts:11 stays held until spike:11 lands (blocked on B14 / USDso).

Status: 45 / 59 done. Ready: spike:11 (human gate, B14), contracts:11 (held, needs spike:11).

## Resume 2026-11-11 (architect decouplings and new tasks: web:9, ship:4, ship:5, ship:8, ship:9, referee:11)

| Task | Routed | Commit | Gate (re-run by orchestrator) |
|---|---|---|---|
| web:9 | executor-high / sonnet (worktree) | 2b26225 | web 29 passed; ORACLE_OFF_LINE fully replaced |
| ship:5 | executor-high / sonnet (worktree) | 3c4a1b8 | check-readme PASS; README, LICENSE, check-readme.ps1 byte-identical to the current plan (incl. 2b052eb) |
| ship:4 | executor-high / sonnet (worktree, resumed once) | cca9c8d | PASS feedback (5 items); 3 templated items match the plan templates exactly outside Evidence; explorer item Severity normal / Area app; indexer item skipped (all R1 reads ok) |
| ship:9 | executor-medium / opus (worktree) | 7fc9f46 | base-url 2 passed; 4 plan blocks present; typecheck 0; set-base-url / check-deploy not run |
| ship:8 | executor-medium / opus (worktree) | b795855 | vercel 2 passed; token only in child env, argv guard (resolves the ship:1 observation) |
| referee:11 | executor-high / sonnet (main tree) | f771ae9 | sizing 3 passed; bot 7 passed; typecheck 0; demo-check not run |

Workspace totals after this wave: core 53, referee 21, spike 25, web 29, ship 10, bot 7, landing 4.

**Orchestrator incidents (fixed):**
- The prompt builder ended a task block at the first `\n## ` line, which cut ship:4 and ship:5 inside their fenced markdown
  templates. Audit of all 63 tasks: only those two were affected. ship:5's executor read the plan itself (verified identical);
  ship:4's executor was resumed with the full block and conformed its files. Builder now ends a block only at
  `### Task N:` or `---` followed by `## `.
- land.sh `commit` tried to `git add` a declared-but-intentionally-absent file (ship:4's skipped indexer item), so no commit
  was made while the script still printed "pushed". Committed by explicit path; land.sh now skips absent untracked files and
  stops with "COMMIT FAILED" if HEAD did not move.

Status: 51 / 63 done. Ready: spike:11 only (human gate, B14 / USDso). contracts:11 now depends on spike:11 (63b70d3).

## Resume 2026-11-12 (architect P1–P4 wave: spike:17, spike:20, referee:12, web:10, landing:3, ship:10)

| Task | Routed | Commit | Gate (re-run by orchestrator) |
|---|---|---|---|
| spike:17 | executor-medium / opus (main tree) | 5bcdb29 | funding 6 passed; all 3 files SAME as plan; typecheck 0; deposit.ts never run |
| spike:20 | executor-medium / opus | 0bf0275 | spike 31 passed; plan block present; typecheck 0; skeleton-close never run |
| referee:12 | executor-medium / opus | 6aef744 | readiness 2 passed; bot 9 passed; 4 plan blocks present; typecheck 0 |
| web:10 | executor-high / sonnet | a5f5fe2 | nav 3 passed; web 32 passed; build OK (`check-env: no VITE_*_PK variables`) |
| landing:3 | executor-high / sonnet | 2ccef75 | page + sample-guard 7 passed; landing 11 passed; all 9 files SAME as plan |
| ship:10 | executor-high / sonnet | 9ac0a8e | sample 1 passed; ship 11 passed; ship:9 baseUrl check retained |

**Incident:** worktree isolation refused both first dispatches — the session cwd came back with a lowercase `c:` drive
letter while git resolves `C:/`, which the harness reads as a worktree redirect. The two fresh worktrees were clean and
removed; every task in this wave ran sequentially in the main tree (no parallelism, so no isolation needed).

Status: 57 / 70 done. Ready: spike:18 and spike:19 only (human gates: LIVE deposits). Stopped per the guide.

## Resume — P5 wave (2026-11-12)

Synced to `8cec5fe` (manifest 77 tasks). spike:18's evidence (`docs/evidence/deposit-a.json`, left uncommitted by the concierge's run) re-checked key-free (`PASS deposit-a`) and committed. All tasks serial in the main tree (worktree isolation still broken).

| Task | Executor / model | Commit | Gate re-run / checks |
|---|---|---|---|
| spike:18 evidence | (concierge run) | 719ff3c | `deposit.ts --account A --check` → PASS deposit-a; 50 USDso credited, 0 locked, 0 pools |
| referee:13 | executor-medium / opus | 3c4e756 | 16 passed; core 69; 4 files SAME, 2 partial-block files all added lines in plan |
| referee:14 | executor-medium / opus | cbdf2cf | 3 passed; referee 24; all added lines in plan |
| referee:15 | executor-medium / opus | 4b6bd40 | 2 passed; bot 11; 60 added lines all in plan |
| spike:21 | executor-medium / opus | 9f48687 | 2 passed; spike 33; skeleton-close never run |
| web:11 | executor-high / sonnet | 83e788a | 3 passed; web 35; build OK |
| web:12 | executor-high / sonnet | 2c7c912 | 3 passed; web 38; build OK |
| ship:11 | executor-high / sonnet | 6c1da30 | check-readme PASS; README fragments verbatim from plan |

Workspace: 197 tests (core 69, referee 24, spike 33, web 38, ship 11, bot 11, landing 11); typecheck 0 errors; web build `check-env: no VITE_*_PK variables`. Remaining ready: spike:11, spike:19 (human gates).
