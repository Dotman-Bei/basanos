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
