# wave-1b landing — REPORT (SHIPPED)

## Result: v2.36.95 pushed to origin/develop as 41f1bff64831bbdeba142b9994f6c564272c7c75

## 0. Setup
Fresh clone `.../w1b/land`, `origin` set to the main checkout's real origin URL, branch `release/w1b`
from `origin/develop` (`8564ef2cd6070ec59272950d40743fb789e74232`), `core.hooksPath=.githooks`.
Remotes `rlr`/`hlsm`/`dlrm`/`mrce` added, `hands/*` fetched.

## 1. Cherry-picks — 10 rows, all landed cleanly, governance intact throughout

| Row | Unit | Picked SHA(s) | Landed SHA (release/w1b, pre-repair) |
|---|---|---|---|
| 15 | mrce | `b1c1465c` | `ea81dcdb` fix(managed-rail): non-git --repo still consumes a Mission claim before intake rejects it |
| 139 | hlsm | `8064fdac` | `25c935f6` fix(depth0-delegate-gate): document Bash matcher P3.1 delta |
| 140 | hlsm | `c4210072` | `b1f1817a` fix(live-state-dir): strengthen context-budget test coverage |
| 93 | dlrm | `14ef3717` | `91669618` fix(prune-tmp-residue): cover tmp-dir prefixes via shared registry |
| 109 | dlrm | `78ff7fca`+`a5b5fcaf` (squashed) | `1e0182bf` fix(admit-backlog-follow-ups): recover stale admission locks safely |
| 122 | dlrm | `13b5d9ea` | `1b2e2485` fix(dispatch-contract): resolve quota for cc-shim/anthropic-compatible VA seats |
| 123 | dlrm | `959525a2` | `d179c364` fix(mission-runtime): support withdraw for a never-granted DRAFT |
| 131 | rlr | `a5ff0046` | `b2ad7eb9` fix(check-phase-review-receipt): freeze plan-loop dispatcher/checker disposition shape |
| 136 | rlr | `91ca8706` | `1c1e8ee6` fix(hetero-review-loop): consumer-declared exclude allowlist |
| 137 | rlr | `39c2a982` | `ca39a653` fix(hetero-review-loop): check agy seat payload size against argv ceiling before dispatch |

Verified after every pick: governance file stayed `"enforcement_mode": "enforce"`; row 109's stray file `-`
confirmed removed (`git ls-files -- ./-` empty). No cherry-pick conflicts. Two rewords (`row122`, `row131`)
initially mis-fired via `sed` (their subject text contains `/`, breaking the delimiter) and landed with their
original `dispatch-hetero(cursor): edits on hands/...` subject; fixed via an automated `git rebase -i` reword
pass preserving body/trailers.

## 2a. First gate run (pre-repair) — 5 suites red only on this branch → escalated, STOPPED

Full run: 41 suites (4 primary + 3 named consumers + `grep -lE 'runCampaignIntake|prune_tmp_residue|
admit-backlog-follow-ups|dispatch-contract|withdrawPreparedMission|depth0-delegate-gate' hooks/tests/*.test.sh`)
+ `check-js-syntax.js` + `sync-codex-plugin-skills.sh --check` + `validate.sh`. 36/41 green.

Red (rerun solo, clean tree each time; then confirmed green in a throwaway `origin/develop` worktree, i.e.
red **only** on `release/w1b`):
- `dispatch-author-contract.test.sh`, `dispatch-contract.test.sh`, `dispatch-hetero.test.sh` — all traced to
  row 122's `dispatch-contract.js` VA-quota surface (glm-5.2 quota resolution / missing `assurance` key).
- `implementation-campaign-routing.test.sh` (`defaultCleanroomProbe`) — its own "RED at base 130b97a8" label
  is stale; actual failure was `mission_repo_identity_invalid` — row 15's surface, not the pre-existing defect
  the brief anticipated (that suite is green at the fetched `origin/develop` tip).
- `resolve-review-loop-consult-discuss-switch.test.sh` — a hardcoded population/config-count pin (42→43,
  6→7) that one of the rows' `hooks/tests/*.test.sh` additions shifted without a matching re-pin.

Per brief §2 ("Red only on your branch means stop and report"), stopped and reported at this point. Full
per-suite logs: `$RUN/gates/`.

## 2b. Depth-0 repair — 3 follow-up commits, tip moved to `7b90f681`

Depth-0 repaired the 5 reds directly on `release/w1b` in this same clone:
- `2b598435` test(resolve-review-loop-consult-discuss-switch): re-pin Population B 42→43 / explicit-switch 6→7
- `580f535a` test(implementation-campaign-routing): git-init the shadow-admit-repo fixture
- `7b90f681` fix(dispatch-contract): restore agy to the effort-consuming set; drop fabricated effort from
  VA/anthropic-compatible fixtures

Governance re-verified intact, no stray files, tree clean at `7b90f681`.

## 2c. Second gate run (post-repair) — all green

`origin/develop` unchanged (`8564ef2c`), so no rebase was needed before re-testing. Re-ran the full 41-suite
list + syntax/sync/validate, one suite at a time in the foreground on `7b90f681`: **all 44 gates rc=0**.
Logs: `$RUN/gates2/`.

## 3. Final review — SHIP-AS-IS

`git diff origin/develop..HEAD > RUN/w1b.diff` (2218 lines, includes the 3 repair commits) reviewed via
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m`,
run detached with a dead-man wait. Verdict (independently read from `RUN/w1b.review.json`, run id
`review-1790261743-2939485-a4ca`): **SHIP-AS-IS**, three 🔵 CUT/FOLLOW-UP findings, no MUST-FIX:
1. `isAcceptedConsumerRow` two-segment prefix heuristic could be widened by a reviewed config row.
2. `runnerConsumesEffort` hardcodes the same consumer set as `probe-engine-capability.sh` — a later runner
   added to only one side would silently misroute.
3. `admit-backlog-follow-ups`'s `releaseLock` now runs in `finally` without a try/catch — an exception there
   could mask the original error.
Mentioned in the CHANGELOG as known follow-ups per repo rule (🔵 items do not go into BACKLOG).

## 4. Release

- Version: base was `2.36.94` at `origin/develop`; bumped to **`2.36.95`** via
  `node scripts/sync-version.js --version 2.36.95 --hook-count 31 --skill-count 30 --opt-in-count 13`
  (counts unchanged — no hook/skill added).
- `docs/BACKLOG.md`: all 10 rows deleted (verified via `check-backlog-entries.js`, exit 0). 9 of the 10 rows
  had `docs/backlog/*.md` sidecars (row 15/mrce had `Pointer: none`); confirmed each was unreferenced
  elsewhere in BACKLOG before `git rm`.
- `CHANGELOG.md`: new `## v2.36.95` section, one bullet per row plus a landing/verification summary and the
  3 🔵 follow-ups, in the file's existing zh-TW house style.
- `docs/projects/INDEX.md`: new row in the "Fix ships" table mirroring the v2.36.81 wave-1 row shape.
- Bundle plans: checked all 4 wave-1 bundle plans (`review-loop-resolver-b`, `hooks-live-state-misc`,
  `dispatch-lifecycle-residue-mission`, `managed-rail-core-engine`) — every row each one lists besides the
  ones landed here was already gone from BACKLOG (shipped in wave-1). All 4 fully shipped; archived via
  `node scripts/check-plan-graduation.js --archive <stem> ... --shipped-in 2.36.95` (the CHANGELOG-mention
  auto-detection path didn't fire since the entry doesn't name the plan stems verbatim, so used the explicit
  `--archive`/`--shipped-in` path the script documents for "shipped but CHANGELOG doesn't say so" plans).
  `review-loop-resolver-a` (wave 2) left untouched, confirmed still `active` in INDEX.
- `bash scripts/preflight-release.sh`: 9/9 PASS after the release commit (check 6, "opt-in change… in the
  CHANGELOG", requires the version bump already committed — ran preflight again post-commit to confirm).
- Release commit `41f1bff64831bbdeba142b9994f6c564272c7c75`, final paragraph carries both trailers adjacent,
  no blank line between:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 review-1790261743-2939485-a4ca plus depth-0 row acceptance, 2026-09-24)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Push: `origin/develop` was still `8564ef2c` (unmoved) — no rebase needed. `git push origin HEAD:develop`
  fast-forwarded. Confirmed: `git rev-parse HEAD` == `git ls-remote origin develop` == `41f1bff6...`.
  No `--force` used; pre-push hook did not object (release commit itself carries the QC-Verdict trailer,
  satisfying the protected-path gate for the whole pushed range).

## Minor wording/shape imprecisions (not worth a follow-up commit, noted for the record)
- `docs/projects/INDEX.md`'s new row uses `(this ship)` in the Merge column, not a SHA — the v2.36.81 row the
  brief said to mirror has the actual merge SHA (`aa236aca`) there, but that SHA didn't exist yet when the row
  was written (chicken-and-egg: the row is part of the commit that produces the SHA). `(this ship)` is an
  existing convention already used by the first row in that same table. A follow-up docs-only edit could
  replace it with `41f1bff6` once depth-0 wants that; not done here since it would mean a second commit/push
  beyond what this brief authorized.
- The CHANGELOG's "落地驗證" bullet says "row 122 首輪整合觸發 5 個 gate suite ... 只在本分支紅" — of the 3
  repair commits, 2 are attributed to row 122 (`7b90f681` dispatch-contract fix, `2b598435` the population-pin
  re-pin) and 1 to row 15 (`580f535a`, the routing-fixture git-init). The repair-commit list right below is
  accurate; only the attributing clause slightly over-generalizes the cause to "row 122."

## Still on disk (not asked to be cleaned up)
- `$W/land` — the clone this whole landing happened in, now at `41f1bff6` (== pushed develop).
- `$W/base-wt` — the throwaway `origin/develop` comparison worktree from the first gate run.

## Everything the brief asked for was completed and pushed. Nothing outstanding beyond the two wording notes above.
