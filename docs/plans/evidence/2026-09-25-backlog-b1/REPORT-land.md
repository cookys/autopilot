# B1 review-loop-resolver-a — landing foreman REPORT

Clone: `$B/land` (branch `release/b1`, based on `origin/develop` @ `4c8c953a`).
Never picked `56189ee6` (verified — not in history). `enforcement_mode: enforce` held after every pick.

## Picked -> landed

| Row | Hand SHA (picked) | Landed SHA on release/b1 |
|---|---|---|
| 23 | `789c7f6a` | `b93f4bf8` |
| 36 | `09a47301` | `542df2e9` |
| 41 | `2678cf10` | `76b03de2` |
| 42 | `e4c3e1dc` | `bab2a50c` |
| 43 | `65527b86` | `eb6fd6b5` |
| 44 | `28b25cb8` | `58180b14` |
| 54 (+ 05f4f20e repair, squashed) | `82e9dc04` + `05f4f20e` | `2404db23` |

All 7 commits reworded to `fix(<area>): <what> (backlog B1 row <n>)`; diffstats verified identical
to `$B/run/REPORT.md`'s per-row diffs. (First rebase attempt via `git rebase -i ... reword` mis-shifted
messages by one commit — a git/editor-invocation quirk, not a content issue; redone via `exec git commit
--amend -F <msgfile>` keyed to each commit's actual SHA, then verified message<->diffstat pairing directly.)

## Gates

- `hooks/tests/run.sh --parallel 8`: 375 test files, 1 FAILED (`engine-qualify-verdict-stability`).
  Rerun solo: still red (`D6 honest solver + other-role parity`, `impl evaluation grader drifted from
  its pinned hash`). Rechecked in a throwaway worktree at `origin/develop` (`4c8c953a`): same failure,
  same error — pre-existing, not introduced by B1. No bisect needed (base is red too). No repair
  attempted, per brief.
  - The 6 `slash-entry-probe` "FAIL" lines inside `preflight-release-routing.test.sh`'s log are internal
    fixture output for a deliberate negative-test scenario; that test file itself reports
    `PASS [preflight-release-routing] 9 assertions` — not a real failure.
- `node scripts/check-js-syntax.js`: rc=0 (682 files).
- `bash scripts/sync-codex-plugin-skills.sh --check`: rc=0, in sync.
- `bash scripts/validate.sh`: rc=0, 30/30 skills pass.
- Discarded incidental `.opencode/package.json` / `package-lock.json` npm-drift picked up by `validate.sh`
  (unrelated to B1, not part of the authorized diff) before committing.

## Review

`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high` on
`git diff origin/develop..HEAD` (874 lines) against the B1 plan spec.

- Verdict: SHIP-AS-IS
- run_id: `review-1790283760-3046047-113f`
- Findings: 3x 🔵 CUT/FOLLOW-UP, no 🔴/🟠, no MUST-FIX:
  1. `scripts/lib/qualification-applicability-scope.js` (+ codex mirror) not in B1 §3 file map — scope-
     bookkeeping amendment, not a code defect.
  2. Row 42's `normEngine` hardcodes only one alias (`gemini-flash -> gemini-3.6-flash-high`); should
     eventually source from the same table `normalize_agy_alias()` uses.
  3. Row 23's `resolverField` re-spawns per-field if the full snapshot omits a key — correct behavior,
     unverified against real resolver output shape.

## Release

- Version: 2.36.96 (`node scripts/sync-version.js --version 2.36.96 --hook-count 31 --skill-count 30
  --opt-in-count 13 --disabled-count 0`, preserving canonical hook/skill counts from `origin/develop`).
- `docs/BACKLOG.md`: deleted the 7 named rows + their 7 orphaned sidecar files under `docs/backlog/`
  (each pointer verified referenced by exactly one row before deletion). `check-backlog-entries.js` rc=0
  (only pre-existing, allowed `cap_exceeded` advisories).
- `CHANGELOG.md`: new `## v2.36.96` section, one line per row + known-follow-ups + `prose-justification:`
  line (north-star gate required it — RED->GREEN evidence lines pushed prose over the +5% threshold).
- `docs/projects/INDEX.md`: `check-plan-graduation.js --repo-root . --fix` archived
  `docs/plans/2026-09-21-backlog-review-loop-resolver-a.md` to `docs/plans/_archive/2026/09/` and
  flipped its INDEX row's Version from `active` to `v2.36.96` (merge column left as `—`, since the
  release SHA wasn't known until after commit/push — the brief's documented fallback). One incidental
  reference rewrite in `docs/projects/ongoing-maintenance/HANDOFF.md` (path only, done by `--fix`).
  Note: the first `--fix` pass did nothing until the CHANGELOG section's text literally contained the
  plan's full slug (`backlog-review-loop-resolver-a`) — the graduation detector requires a boundary-
  matched slug/stem substring in a released CHANGELOG section; added a one-line plan pointer to the
  CHANGELOG entry to satisfy it. `check-plan-graduation.js --json`: exit=0, ok=true,
  plan_released_not_archived: 0 (all remaining violations are pre-existing/report-only, unrelated to B1).
- `bash scripts/preflight-release.sh`: 9/9 PASS (after the version-bump commit existed in
  first-parent history, required by check [6]).

## Commit & push

- Release commit: `9fc56347` on `release/b1`, trailer paragraph:
  `QC-Verdict: PASS (reviewer claude-fable-5-1 review-1790283760-3046047-113f plus depth-0 row acceptance, 2026-09-25)`
  immediately followed (no blank line) by `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- `git fetch origin && git rebase origin/develop`: already up to date, no collision, no re-stamp needed.
- `git push origin HEAD:develop`: succeeded, no force, no pipe.
- Confirmed `git ls-remote origin develop` == `9fc56347f0b4853005d0c10b980efa6bfeeb7a73` == local HEAD.

## Not done / deviations

- INDEX merge column for the B1 plan-registry row reads `—`, not the pushed SHA (brief-permitted
  fallback; SHA was unknown at the point that row was written, and no further commit/push cycle was
  run afterward to backfill it).
- Everything else in the brief was completed.
