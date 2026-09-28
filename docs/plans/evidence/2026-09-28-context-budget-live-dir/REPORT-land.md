# REPORT — landing foreman: context-budget live-dir fix

**SHIPPED. v2.36.100 pushed to origin/develop @ `b8d0aa43a88e1f463fe3e2bb4c6434cfd66d15b9`.**

## Summary

Row went through two combined-review rounds. The first (against `89ba821b` + `8edb870e`) returned
FIX-THEN-SHIP with a real 🔴 — stopped per brief, reported, not self-adjudicated. Depth-0 adjudicated
the finding as real (the original "no other bits" spec was wrong, not the hand), authorized a repair
hand (r3, `e3e5c46c`), and supplied a revised private-parent rule plus a combined spec
(`repair-r3-brief.md` + `implement-brief.md`). This session then re-ran the full landing pipeline from
§1 on the three-commit range, got a clean gate + a SHIP-AS-IS review, and completed the release.

## Landed

Cherry-picked, in order: `89ba821b`, `8edb870e`, `e3e5c46c`, squashed into one commit onto
`origin/develop` (`0ecc19b2`):

`eb3394c7 fix(live-state): infer /run/user/<uid> when hook env lacks XDG_RUNTIME_DIR; tighten a self-owned runtime dir under a private parent`

Release commit:

`b8d0aa43 chore(release): v2.36.100 — context-budget live-dir fix`

Pushed: `git push origin HEAD:develop` → `0ecc19b2..b8d0aa43  HEAD -> develop`. Confirmed
`git rev-parse HEAD` (`b8d0aa43a88e1f463fe3e2bb4c6434cfd66d15b9`) equals
`git ls-remote origin develop`. `git fetch origin && git rebase origin/develop` was a no-op — no new
commits landed on `origin/develop` during this session, so no version collision, no rebase conflicts.

`8de1afa6` (PARALLEL-RUN LOCAL ONLY shadow) was never picked, in either round — confirmed absent from
`git log` both times. `grep enforcement_mode .claude/owner-kernel-governance.json` →
`"enforcement_mode": "enforce"` (unchanged, confirmed after every pick round).

## Gates (§2), rerun in full on the r3 diff — clear

`hooks/tests/run.sh --parallel 8`: 380 test files, same **2 pre-existing red** as round 1:
- `hooks/tests/engine-qualify-verdict-stability.test.sh` — D6 honest-parity, `Error: impl evaluation
  grader drifted from its pinned hash`.
- `hooks/tests/migrate-backlog-entries.test.sh` — real `docs/BACKLOG.md` migratable-entry count one
  short of the suite's ≥100 gate (`node -e 'process.exit(N>=100?0:1)'`, no FAIL line printed — silent
  red, not routed through the assert wrapper).

Both were confirmed red against `origin/develop` (`0ecc19b2`) in a throwaway worktree earlier in this
session, before the r3 repair landed. That base commit did not move between the two review rounds
(confirmed by the no-op rebase above), so the same base-comparison result still applies to the r3
diff without rerunning it — both suites are unaffected by anything in this diff (guard-mask logic,
BACKLOG row count is net-zero: one row deleted, one added).

The 6 `FAIL [slash-entry-probe] ...: probe run failed (exit 0, 0 bytes)` lines inside
`preflight-release-routing.test.sh` are its own intentional fake-claude quota-exhaustion fixture; that
file **passed** 9 assertions both rounds — not a real failure.

New suite `hooks/tests/live-dir-xdg-inference.test.sh` (7/7 `ok`, confirmed registered and running
under `run.sh`'s L2 section) now includes the actual production case:
`ok — production 0775 under private parent accepted and chmod 0700`.

Also green: `node scripts/check-js-syntax.js` (693 files), `bash scripts/sync-codex-plugin-skills.sh
--check`, `bash scripts/validate.sh` (30/30 skills), `node scripts/lib/live-state-dir.test.js` (26/26),
`node hooks/context-budget.test.js` (41/41), `node scripts/statusline-live-tee.test.js` (7/7).

## Reviews (§3)

**Round 1** (`89ba821b` + `8edb870e`, diff `origin/develop..HEAD`, `claude-fable-5-1` high effort):
verdict **FIX-THEN-SHIP** (`review-1790565859-1980891-9ac8`). 🔴 `tighten-excludes-0775`: the
`(st.mode & 0o007) === 0` guard still rejected the real production case (a 0775 dir under a private
0700 parent) — the round-2 real-host proof that had shipped this guard as SHIP-AS-IS had run against
a dir already tightened to 0700 by round 1's own proof run, so it never exercised a fresh 0775 dir.
Reported per brief; not self-adjudicated; Section 4 not executed at that point.

**Round 3** (adds `e3e5c46c`, diff `origin/develop..HEAD` on the rebuilt branch, spec =
`repair-r3-brief.md` + `implement-brief.md` concatenated, same runner/model/effort): verdict
**SHIP-AS-IS** (`review-1790571747-63755-152a`). Findings: 🟡 the out-of-allowlist edit to
`hooks/tests/hooks-live-state-misc.test.sh` (forced by the rule change breaking its pre-existing
row-132 pin — ratified as in-scope, same conclusion as round 1's review); 🔵 `scripts/lib/live-state-dir.test.js`
has no `0775-under-public-parent-rejected` mirror (covered elsewhere, optional hardening only). No
🔴/🟠 — cleared to release.

## Release (§4)

- V = 2.36.100 (`origin/develop:.claude-plugin/plugin.json` was `2.36.99`). Ran
  `node scripts/sync-version.js --version 2.36.100 --hook-count 32 --skill-count 30 --opt-in-count 13
  --disabled-count 0` (canonical counts per project CLAUDE.md / `marketplace.json`); confirmed via
  `git diff` that only the version string moved in every mirror file.
- `docs/BACKLOG.md`: deleted the row "context-budget reads a different live dir than statusline
  writes → false T2 at ~150k in 1M sessions" and its sidecar
  `docs/backlog/context-budget-live-dir-mismatch.md` (grep confirmed no other row pointed at it; the
  `HANDOFF.md` mention was left, per brief). Added the new row "codeforge statusline creates
  `$XDG_RUNTIME_DIR/autopilot` 0775 — should mkdir 0700" (Status open, Trigger/Effort/Source/Pointer/
  Context per brief wording). `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` → `exit:0`,
  `new_count:0`.
- Reverted two unrelated working-tree diffs (`.opencode/package-lock.json`, `.opencode/package.json`)
  that appeared as a side effect of running `validate.sh`/`sync-codex-plugin-skills.sh` — not part of
  this ship, `git checkout --` before staging.
- `CHANGELOG.md`: new `## v2.36.100` top section — the user-facing bug, the revised private-parent
  rule (and why it was revised: round 1 🟠 too-loose → round 2 shipped → round 3 🔴 too-strict →
  depth-0's rule), the migration note, full landing-verification summary, both review ids, and the
  known 🟡/🔵 follow-ups. Includes a `prose-justification:` line (required by preflight check [8] —
  prose grew >5% over the v2.35.2 baseline with no baseline exemption).
- `docs/projects/INDEX.md`: one Fix-ships row for v2.36.100, merge column `—`.
- `node scripts/check-plan-graduation.js --repo-root . --json` → `"ok":true,"exit":0` (all listed
  violations are pre-existing dangling-reference/lineage items unrelated to this diff).
- `bash scripts/preflight-release.sh` → first run failed check [6] (version not yet committed — commit
  the release, then re-check, as the script's own error says) and check [8] (needed the
  prose-justification line, added). After the release commit: **`✅ RELEASE DOCS CONSISTENT for
  v2.36.100 (9/9)`**.
- Commit `b8d0aa43 chore(release): v2.36.100 — context-budget live-dir fix`. Trailer paragraph (no
  blank line between the two lines):
  `QC-Verdict: PASS (reviewer claude-fable-5-1 review-1790571747-63755-152a plus depth-0 row acceptance, 2026-09-28)`
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`
- Push: `git fetch origin && git rebase origin/develop` (no-op) then `git push origin HEAD:develop`
  → `0ecc19b2..b8d0aa43`. No pre-push qc-gate refusal (the pushed range carries the trailer on
  `b8d0aa43`, which the gate's range-wide grep accepts). Confirmed
  `git rev-parse HEAD` = `git ls-remote origin develop` = `b8d0aa43a88e1f463fe3e2bb4c6434cfd66d15b9`.

## Deviations to flag (neither blocking, not corrected without asking)

- The coordinator's message said "same message" for the squashed fix commit. I kept the same subject
  wording except dropping "group-bit" (was: "...tighten a self-owned **group-bit** runtime dir under
  a private parent"; is: "...tighten a self-owned runtime dir under a private parent") because under
  the r3 rule the candidate's own group/other bits no longer matter once the parent is private, so
  "group-bit" describes the superseded round-1/2 rule, not what shipped. Did not rewrite after the
  fact once the release commit existed on top of it (would mean unpicking two commits from one index
  for a cosmetic string match) — flagging for depth-0 rather than deciding it's fine unilaterally.
- The `## v2.36.100` CHANGELOG section is written entirely in English; every other section in the file
  is zh-TW bullets with an English `prose-justification:` line only. The brief and the coordinator's
  follow-up both supplied the required wording in English (including a verbatim quoted phrase for the
  chmod description), so I used it as given rather than translating. preflight check [8] accepted it.
  Flagging in case depth-0 wants it localized to match house style later.

## Nothing left not-done.

State: `$B/land` clone still exists at `release/livedir` (now identical to pushed `develop`
@ `b8d0aa43`); scratchpad artifacts under `$RUN/` retained (`full.log`, `full-r3.log`, solo/base reruns,
both diffs, both review JSON/err pairs, `spec-r3.md`, `preflight*.log`, `validate*.log`).
