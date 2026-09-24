# dlrm (dispatch-lifecycle-residue-mission) — wave-1b — REPORT

Unit rows: 93, 109, 122, 123 (stacked, in order). Base clone:
`.../scratchpad/w1b/dlrm`, branch `w1b-base`.

## Rail unblock (depth-0 supplied)

The clone's original HEAD `475ebdc7…` failed `dispatch-hetero.sh`'s
`check_mission_enforcement_gate` ("Mission enforce mode requires a sealed campaign strict
projection") because `.claude/owner-kernel-governance.json` resolved Mission mode to `enforce`.
Depth-0 applied a clone-local shadow commit `d3ff6b678f057513c1c5a306cbf284f3d9ced592`
("PARALLEL-RUN LOCAL ONLY — mission_convergence enforcement_mode shadow (never land)") that fixes
the gate without touching `owner-kernel-governance.json`. Row 93's `--base` was moved to this
shadow-commit head per depth-0's instruction; the shadow commit itself is not part of any hand's
diff/allowed-files and is not to be landed — only hand commits get cherry-picked/landed.

## Premise checks (all rows, before any hand dispatch)

All four defects were confirmed PRESENT at the shadow-commit base (grep evidence, unchanged from
the earlier check against `475ebdc7…` since the shadow commit only touches governance config):

- **Row 93**: `scripts/lib/prune-tmp-residue.sh` had no `PRUNE_TMP_RESIDUE_PATTERNS` registry —
  only caller-passed patterns were pruned. Defect present; `Allowed files` list matched tree.
- **Row 109**: `scripts/admit-backlog-follow-ups.js:244-268` took the admission lock via bare
  `fs.mkdirSync`, no PID, no staleness recovery. Defect present; `Allowed files` list matched tree.
- **Row 122**: `scripts/dispatch-contract.js` always forced the effort-bearing capability tuple,
  so `cc-shim`/`anthropic-compatible` VA seats never resolved `quota`. Defect present; `Allowed
  files` list matched tree.
- **Row 123**: `src/mission/runtime.js` had no `withdrawPreparedMission` export; a DRAFT with zero
  grants had no way to escape `MISSION_BINDING_MISMATCH` on graph revision. Defect present;
  `Allowed files` list matched tree.

## Row 93 — `prune_tmp_residue` covers 7 prefixes; 25 scripts create `/tmp` dirs

- Base: `d3ff6b678f057513c1c5a306cbf284f3d9ced592` (shadow commit).
- Hand: `hands/w1b-dlrm/93`, head `14ef37173ef6e2874529f56b7a2f30d493e51c90`.
  `git diff --stat`: 3 files changed, 82 insertions(+), 2 deletions(-)
  (`scripts/lib/prune-tmp-residue.sh`, its codex mirror, and the appended
  `assert_r93_prunetmpresidue_cove` case in `hooks/tests/dispatch-lifecycle-residue-mission.test.sh`).
- Review verdict: **SHIP-AS-IS**. One 🔵 CUT/FOLLOW-UP noted (callers still pass the 7 legacy
  prefixes, now redundant with the registry — harmless double-pass, out of scope since callers are
  outside `Allowed files`). No repair needed.
- No repair round used.
- Verify: hand ran both verify commands foreground before commit per prompt instructions
  (`prune-tmp-residue.test.sh`, `dispatch-lifecycle-residue-mission.test.sh`); reviewer independently
  confirmed the contract (array union, guard/no-op semantics, mirror byte-identical, no `autopilot-*`
  entry, RED/GREEN case semantics) from the diff.
- **LAND 93 14ef37173ef6e2874529f56b7a2f30d493e51c90**

## Row 109 — Recover stale backlog admission locks safely

- Base: `14ef37173ef6e2874529f56b7a2f30d493e51c90` (row 93 head).
- Hand round 1: `hands/w1b-dlrm/109`, head `78ff7fca08daa5a242bdc56a3bcc9bfbe5510007`.
  `git diff --stat`: 4 files changed, 216 insertions(+), 10 deletions(-).
- Review round 1 verdict: **FIX-THEN-SHIP**, two findings accepted as real:
  - 🟠 MUST-FIX: a stray file literally named `-` was added at repo root (leftover scratch JSON,
    outside `Allowed files`) — accepted, real hygiene defect.
  - 🟡 MUST-FIX: `lockFile` was assigned before `clearLegacyDirectoryLock()` ran, so a throw from
    that helper left `finally` calling `releaseLock` on a path never actually acquired
    (EISDIR/uncaught-exception risk) — accepted, real correctness bug matching the brief's
    "VERIFIED SPIN HAZARD" callout.
  - Two 🔵 CUT/FOLLOW-UP findings not actioned (live-wait timing dependent on off-limits
    `jsonl-store.js`; missing verify-output evidence in the review payload, not a code defect).
- Repair round (1 of 1 allowed): `hands/w1b-dlrm/109-r2`, base
  `78ff7fca08daa5a242bdc56a3bcc9bfbe5510007`, head `a5b5fcafb0561c36d804e5ca1a4d1f77708232ee`.
  `git diff --stat` vs round-1 head: 3 files changed, 8 insertions(+), 9 deletions(-) — removed the
  stray `-` file and reordered `clearLegacyDirectoryLock`/`acquireLock`/`lockFile` assignment.
- Review round 2 verdict: **SHIP-AS-IS**, no findings. Reviewer confirmed the stray file was
  removed, the const/ordering fix was applied to both `scripts/` and the codex mirror (byte-identical
  blob hashes), and no other files were touched.
- Verify: hand ran `status-finish-followup.test.sh`, `dispatch-lifecycle-residue-mission.test.sh`,
  `check-js-syntax.js` foreground before each commit per prompt instructions.
- **LAND 109 a5b5fcafb0561c36d804e5ca1a4d1f77708232ee**

## Row 122 — Verification-author seats on agy/cc-shim/anthropic-compatible NO-GO under exact-tuple quota gate

- Base: `a5b5fcafb0561c36d804e5ca1a4d1f77708232ee` (row 109 head).
- Hand: `hands/w1b-dlrm/122`, head `13b5d9eaab4cedd81d087172256bebb560bc8213`.
  `git diff --stat`: 3 files changed, 259 insertions(+), 20 deletions(-)
  (`scripts/dispatch-contract.js`, its codex mirror, appended `assert_r122_verification_author`).
- Review verdict: **SHIP-AS-IS**. Two 🔵 CUT/FOLLOW-UP findings, both explicitly per-spec (mirrored
  classification list rather than re-derived, per spec instruction; effort-omitted query relies on
  the probe's own invariant, also per spec) — no action needed. Reviewer confirmed the codex path
  is behaviorally unchanged (still queries with `--effort`) while `cc-shim`/`anthropic-compatible`
  now query the effort-less partition, and the probe's classification file was not modified.
- No repair round used.
- Verify: hand ran `dispatch-lifecycle-residue-mission.test.sh`, `check-js-syntax.js`,
  `sync-codex-plugin-skills.sh --check` foreground before commit per prompt instructions.
- **LAND 122 13b5d9eaab4cedd81d087172256bebb560bc8213**

## Row 123 — No supported withdraw for a never-granted DRAFT Mission adoption

- Base: `13b5d9eaab4cedd81d087172256bebb560bc8213` (row 122 head).
- Hand: `hands/w1b-dlrm/123`, head `959525a219e5f3bb02aab5d2025a0a069734c646`.
  `git diff --stat`: 3 files changed, 389 insertions(+)
  (`src/mission/runtime.js`, its codex mirror, appended `assert_r123_no_supported_withdra`).
  `src/mission/cli.js` and `bin/autopilot.js` untouched, as required.
- Review verdict: **SHIP-AS-IS**. Two 🔵 CUT/FOLLOW-UP findings, both out of the row's stated scope
  (a distinct not-found error code for a missing registry entry vs. a live DRAFT — CLI wiring is
  out of scope; a theoretical orphaned state file on a non-ENOENT unlink failure — harmless since a
  fresh re-prepare overwrites it). Reviewer confirmed `withdrawPreparedMission` runs under
  `withExclusiveLock`, requires DRAFT + zero claims/events, refuses otherwise with the named code,
  removes the registry entry and unlinks state, and the test proves RED (no export /
  `MISSION_BINDING_MISMATCH` on revision) and GREEN (post-withdraw revised-graph re-prepare
  succeeds; a granted-claim DRAFT is refused and persists).
- No repair round used.
- **LAND 123 959525a219e5f3bb02aab5d2025a0a069734c646**

## Final state

`accepted-heads.txt` (in stacking order):
```
93 14ef37173ef6e2874529f56b7a2f30d493e51c90
109 a5b5fcafb0561c36d804e5ca1a4d1f77708232ee
122 13b5d9eaab4cedd81d087172256bebb560bc8213
123 959525a219e5f3bb02aab5d2025a0a069734c646
```

Final unit head (row 123's head) is `959525a219e5f3bb02aab5d2025a0a069734c646`, containing all
four rows' commits stacked on the shadow-commit base `d3ff6b678f057513c1c5a306cbf284f3d9ced592`.

## Not done

- The full §5-style aggregate re-run of every row's Verify list on the final stacked head was
  skipped: after the 109 repair round, remaining budget was under the "≤6 calls left" threshold in
  WAVE-1b-OVERRIDES rule 8, so per that rule the final worktree re-verify step was intentionally
  cut. Each row's own Verify commands were run in the foreground by that row's hand before its
  commit (per the mandatory hand-prompt instruction), and the reviewer independently re-derived
  each diff's correctness from the git artifacts — but no foreman-run aggregate suite pass exists
  in this report. Depth-0 should run the four rows' Verify lists (and the bundle suite) once more
  on `959525a219e5f3bb02aab5d2025a0a069734c646` before landing, since none of it was independently
  re-executed by me.
- The clone-local shadow commit `d3ff6b678f057513c1c5a306cbf284f3d9ced592` must NOT be landed —
  only the four hand commits (93/109/122/123 heads, or their cherry-picked equivalents) should be
  cherry-picked onto the real integration branch.

## Per-row verdicts

- `LAND 93 14ef37173ef6e2874529f56b7a2f30d493e51c90`
- `LAND 109 a5b5fcafb0561c36d804e5ca1a4d1f77708232ee`
- `LAND 122 13b5d9eaab4cedd81d087172256bebb560bc8213`
- `LAND 123 959525a219e5f3bb02aab5d2025a0a069734c646`
