# REPORT — dispatch-hetero wall-timeout watchdog landing (row 1) — SHIPPED

## Picked -> landed (final, after r6 repair)
Cherry-picked onto `release/wdog` (base `origin/develop` @ `9dbe88a7`):
`9b6e7e08` -> `4821e68b` -> `88d76b82` -> `75e9cf5c` -> `9d50f318` -> `e71a5e94` (r6 repair, all
clean, no conflicts; `1f81de14` shadow NOT picked). Squashed via
`git reset --soft origin/develop && git commit -F fix-msg.txt` into ONE commit:

`2f9e21d6 fix(dispatch-hetero): enforce --timeout on every rail with a central run_worker watchdog (explicit bounds only)`

`grep enforcement_mode .claude/owner-kernel-governance.json` showed `enforce` throughout.

## History of this landing
1. First pass (5 hand commits, r5): all §2 gates green; §3 review on that diff came back
   **FIX-THEN-SHIP** with a new 🟠 MUST-FIX (`wdog-stale-pid-fallback` — a bare-pid `kill`
   fallback in `_watchdog_signal_worker` that could only ever hit a stale/recycled pid after an
   abnormal dispatcher exit, since every containment path makes WORKER_SID a group leader).
   Per the brief, STOPPED and reported instead of self-adjudicating (notable: the reviewed diff
   was byte-identical to what round 5 upstream had gotten SHIP-AS-IS on — same
   model/runner/effort gave a different verdict on identical input).
2. Depth-0 adjudicated the 🟠 as real; a repair (`e71a5e94`, hand-1-r6) removed the bare-pid
   fallback (group-kill only) and added `assert_r6_no_bare_pid_fallback`. Depth-0 authorized
   continuing with a rebuilt squash (6 commits), a **targeted** gate rerun (not the full suite),
   a fresh combined §3 review, and §4 release/push conditional on green gates + SHIP-AS-IS.

## Gates (§2, targeted rerun per depth-0 authorization)
Full suite was already green on the r5 squash and r6 only narrows one function, so depth-0
authorized running only: `dispatch-hetero-wall-timeout`, `dispatch-hetero`,
`dispatch-hetero-contract`, `dispatch-hetero-cursor-routing`, `dispatch-hetero-gc`,
`dispatch-status`, `dispatch-detach` (each run solo, rc=0, all 7 green) plus
`check-js-syntax.js` (rc=0, 693 files), `sync-codex-plugin-skills.sh --check` (rc=0, in sync),
`validate.sh` (rc=0, 30/30 skills). Working tree confirmed clean before §3 (no residue this
time). **Full suite was NOT rerun on this squash** — that is the depth-0-authorized deviation
from the brief's literal §2, recorded here per its own instruction.

(For reference, the ORIGINAL full-suite run on the r5 squash, done before the 🟠 was found:
rc=0, 1/381 files failed — `engine-qualify-verdict-stability.test.sh`, confirmed pre-existing
at `origin/develop` in a throwaway worktree, identical error; `migrate-backlog-entries.test.sh`
was green; nested `slash-entry-probe` FAIL lines were fixture noise inside a passing outer test.)

## Final review (§3, combined review on the r6 diff)
`git diff origin/develop..HEAD` (1025 lines) reviewed via
`scripts/dispatch-review.sh --runner claude-native --model claude-fable-5-1 --effort high --timeout 20m`
against `$B/run/implement-brief.md`.

**Verdict: SHIP-AS-IS.** Review run id: `review-1790618753-2256392-1f5a`
(manifest `/tmp/autopilot-dispatch-runs/review-1790618753-2256392-1f5a.manifest.json`).
Only 🟡/🔵 findings, none blocking: `wdog-sleeppid-recycle` (🟡, sleeper-pid recycling under a
sub-second pid-wrap window), `caller-source-ordering`, `detached-new-session-reap`,
`set-m-job-notices`, `contract-comment-default` (all 🔵). Full JSON at
`$RUN/wdog-r6.review.json`.

## Release (§4)
- **Version**: `.claude-plugin/plugin.json` (and mirrors) bumped `2.36.100` -> **`2.36.101`**
  via `node scripts/sync-version.js --version 2.36.101 --hook-count 32 --skill-count 30 --opt-in-count 13`.
- **BACKLOG.md**: deleted the row "`dispatch-hetero.sh --timeout` is accepted and recorded but
  never applied to the grok rail" and its sidecar `docs/backlog/dispatch-hetero-grok-timeout-not-applied.md`
  (no other row pointed at it; only HANDOFF/closeout-brief mentions remained, which the brief
  said are fine). Added new row "dispatch-hetero watchdog: review 🔵 follow-ups..." pointing at
  new sidecar `docs/backlog/dispatch-hetero-watchdog-followups.md`, which collects all 5
  follow-up items from round 5 (`$B/run/1-r5.review.json`) plus all 5 from the r6 combined
  review above (10 items total, some overlapping in substance). `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md`
  exits 0 (had to shorten the new row's Title/Context once to fit the cap; the sidecar body
  itself is uncapped).
- **CHANGELOG.md**: new `## v2.36.101` section in zh-TW house style (symptom, new rule, behavior
  guarantee, the detached-path miss caught by the real-rail proof, the 🔵 follow-ups pointer,
  plus a `prose-justification:` line — the north-star gate required one since prose grew >5%
  vs the v2.35.2 baseline, pre-existing drift unrelated to this landing).
- **docs/projects/INDEX.md**: one Fix-ships row for v2.36.101, merge column `—`.
- `node scripts/check-plan-graduation.js --repo-root . --json`: `ok:true, exit:0` (44 pre-existing
  `plan_reference_dangling` + 1 `plan_active_lineage` advisory items, none introduced by this
  landing).
- `bash scripts/preflight-release.sh`: **9/9 PASS** (had to run twice — first pass before the
  release commit existed failed checks [6] opt-in-changelog and [8] north-star-prose, because
  [6]'s git-history walk needs the version-bump commit to already exist and [8] needed the
  `prose-justification:` line added; both fixed, second pass after the release commit was
  9/9 green).
- **Release commit**: `27b2e583 chore(release): v2.36.101 — dispatch-hetero wall-timeout watchdog`,
  trailer (verified via `git interpret-trailers --parse`, single final paragraph, no blank line
  between the two lines):
  `QC-Verdict: PASS (reviewer claude-fable-5-1 review-1790618753-2256392-1f5a plus depth-0 row acceptance, 2026-09-29)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
  The fix commit (`2f9e21d6`) did NOT need its own trailer — `.githooks/pre-push`'s qc-gate
  accepts ANY commit in the pushed range carrying the trailer, and the range
  `9dbe88a7..27b2e583` includes the release commit that has it.
- **Push**: `git fetch origin && git rebase origin/develop` — no-op (origin/develop unchanged
  at `9dbe88a7`, no version collision). `git push origin HEAD:develop` — success, no force, no
  pipe. Confirmed `git ls-remote origin develop` == local HEAD == `27b2e583fa915df78ea524635f32f223429bd307`.

## NOT done / deviations from the literal brief (all depth-0-authorized)
- §2's full `hooks/tests/run.sh --parallel 8` was run once on the r5 squash (before the 🟠 was
  found) but NOT rerun on the final r6 squash — depth-0 authorized a targeted 7-suite + 3-gate
  rerun instead, recorded above.
- Nothing else outstanding. Version 2.36.101 is live on `origin/develop` at `27b2e583`.

## Post-push verification addendum
`migrate-backlog-entries.test.sh` reads the real `docs/BACKLOG.md`, which the release commit
edited (net-zero row swap); it was not in the targeted §2 rerun list, and its only prior run
(full suite, r5 squash) predates the BACKLOG edit. Re-ran it solo at pushed HEAD (`27b2e583`):
**PASS, 98 assertions, rc=0.**
