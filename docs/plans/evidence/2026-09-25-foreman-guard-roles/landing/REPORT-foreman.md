# foreman-guard role-caps — foreman REPORT

Plan: `docs/plans/2026-09-25-foreman-guard-role-caps-reserve.md`. BASE_SHA (row 1) = `93189f4f` (develop HEAD
`44336243` + clone-local shadow commit `93189f4f`, never landed). Runner: cursor/cursor-grok-4.6-low, effort=low.
Reviewer: claude-native/claude-fable-5-1, effort=high.

## Setup note (for depth-0)

The brief's dispatch commands use relative paths `RUN/hands.ledger`, `RUN/hand-<n>.md` with cwd `$C` (the clone).
No `$C/RUN` existed at start, so the first P1 dispatch failed (`precondition_failed: prompt file not readable:
RUN/hand-p1.md`, rc=2, no branch/commit created — harmless, nothing to clean up). Fixed by creating
`$C/RUN -> $C/../run` (a symlink to the actual scratchpad run dir) before retrying. This symlink is untracked
residue at the clone root; it was never committed. Recommend the brief template either pre-create this symlink
in Setup, or spell out an absolute `--prompt-file`/`--ledger` path.

## Per-row results

**LAND p1 `b8fc7bac6c861383788a5c08ce3f81e53103fabe`**
- Diff-stat (93189f4f..head): `hooks/foreman-guard.js` +29/-3 (round 1) then `hooks/tests/foreman-guard.test.sh`
  +12/-4 (round 2 repair); `hooks/tests/foreman-guard-roles.test.sh` new file, 104 lines.
- RED (round 1, at 93189f4f): 14/26 new-suite assertions failing (stdout empty where additionalContext now
  expected) — recorded in-file.
- Round 1 review (`RUN/p1.review.json`): 🟠 finding — my own hand-p1.md wrongly forbade ANY edit to
  `foreman-guard.test.sh`, contradicting KR4 group (i) (the warn/diagnostic channel is exactly P1's own
  change). This broke 4 pre-existing assertions in the old suite (they expected empty stdout on warn/diagnostic
  allows, which the new additionalContext delivery correctly changes). This was a spec defect I introduced, not
  a hand defect.
- Repair (r2, `hand-p1-r2.md`, base `245ffc62`): re-expected exactly 4 assertions in `foreman-guard.test.sh`
  by message string — "warn mode: no deny JSON", "config warn mode: cap breach is a warning", "context-ceiling:
  no matching row ⇒ allowed", "context-ceiling: two rows same id ⇒ allowed (ambiguous, never a gate)" — each now
  asserts stdout contains `hookSpecificOutput`/`additionalContext`/`permissionDecision":"allow"` instead of
  exact-empty. No other assertion touched, none deleted (114 assertions total, same as before + net 0 removed).
  Hand commit messages are the generic `dispatch-hetero(cursor): edits on hands/fg/<n>` (the rail overwrites
  whatever the hand writes) — the list above is the substitute record for KR4's "list each changed assertion in
  the commit message"; depth-0 should reword at cherry-pick time if that literal text is wanted in history.
- Round 2 review (`RUN/p1.review.json`, final): **SHIP-AS-IS**, only 🔵 advisories (the P1 deny-shape choice is
  correct by design).
- Verify: all suites + check-js-syntax + sync --check green at `b8fc7bac`.

**LAND p2 `9514ced746d6a33e0bbe8584dda9791215dbabc5`**
- Diff-stat: `hooks/foreman-guard.js` +81/-5, `hooks/tests/foreman-guard-roles.test.sh` +209 (new cases).
  `hooks/tests/foreman-guard.test.sh` untouched (confirmed byte-identical).
- RED (at `b8fc7bac`): captured in-file, new role-cap assertions failing pre-change.
- Review: **SHIP-AS-IS**, only 🔵 advisories (cumulative-diff scope note; a harmless no-trailing-newline edge
  case, noted for docs).
- Verify: 196 new-suite assertions (total), all suites/checks green.

**LAND p3 `70dc78cb9a6f7daae0a29bee19b0f2cf45f07ef4`** (round 1 `6d7a8606441bfb25ccb3f64f19bcd9fadd8b4142`, repaired)
- Diff-stat (round 1): `hooks/foreman-guard.js` +138/-13, `hooks/tests/foreman-guard-roles.test.sh` +207/-3,
  `hooks/tests/foreman-guard.test.sh` +12/-4 — one legitimate, in-scope edit inside the existing section-4
  agent-2 cap-5 loop: calls 4–5 changed from `echo step $i` to `git status` (allowlisted), and "call 4 within
  cap allowed" re-expected to assert the stdout contains `Close-out reserve` (entry directive) instead of empty
  — because cap 5 → effective reserve floor(5/2)=2 puts calls 4–5 inside the reserve window. No other assertion
  in that file touched.
- RED (at `9514ced7`): captured in-file for the new reserve cases and the updated cap-boundary loops.
- Round 1 review (`RUN/p3.review.json`): **FIX-THEN-SHIP**, two real 🟡 MUST-FIX: (1)
  `AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS=""` parsed to `0` via bare `Number()`, silently disabling the reserve;
  (2) `rm -rf /tmp/` (trailing slash, no further path) incorrectly matched the reserve allowlist.
- Repair (r2, `hand-p3-r2.md`, base `6d7a8606`, head `70dc78cb`): fixed both — `overlayNonNegInt` now requires
  `/^\d+$/` on the trimmed string before accepting; `isTmpSafePath` now requires `p.length > '/tmp/'.length`.
  Two new red-then-green cases added.
- Round 2 review: **SHIP-AS-IS**, only 🔵 advisories (a stricter-than-required `rm` with zero operands denied —
  safe direction, not a defect).
- Verify: 383 new-suite assertions, all suites/checks green at `70dc78cb`.

**LAND p4 `d8b6eed388946c19a97744431ed00f00d81a8fa7`**
- Diff-stat: `hooks/foreman-guard.js` +141/-24 (refactored `resolveRole` into `readFirstUserMessageContent` +
  scan, added the no-marker advisory branch in `main()`, added bounded/rate-limited GC), `hooks/tests/foreman-guard-roles.test.sh`
  +261. `hooks/tests/foreman-guard.test.sh` untouched (confirmed byte-identical).
- RED (at `70dc78cb`): captured in-file.
- Review: **SHIP-AS-IS**, only 🔵 advisories (cumulative-diff scope note; GREEN Verify output not attached to
  the artifact itself, but independently re-run and confirmed green by this foreman both in the dispatch
  worktree and again in the final aggregate verify below).
- Verify: 945 new-suite assertions (worker-120 and reviewer loops + 520-file bounded-GC case run full length),
  all suites/checks green at `d8b6eed3`.

**LAND p5 `c52a43e392523395c6e98ff55facd5c06ae662b5`**
- Docs-only phase, no code/test changes. Diff-stat: `hooks/README.md` (+1/-1, foreman-guard row extended),
  `skills/ceo-agent/references/level-front-door.md` (+17/-4, In-loop enforcement bullet extended),
  `skills/l4/SKILL.md`, `skills/l5/SKILL.md`, `skills/l6/SKILL.md` (each +1/-1, 一刀一命 bullet extended with the
  Role:-line-2 + cap-120 + close-out-allowlist sentence), plus their Codex mirrors under
  `platforms/codex/plugin/skills/{l4,l5,l6}/SKILL.md` and `platforms/codex/plugin/skills/ceo-agent/references/level-front-door.md`
  (byte-identical to source, confirmed via diff and via `sync-codex-plugin-skills.sh --check`). No CHANGELOG,
  version, plugin.json, scripts-inventory, profiles/, or dev-flow/ceo-agent SKILL.md body touched.
- "RED" analog: confirmed `Role:`/`reserve`/`advisory_every` absent from the four doc locations before edit.
- `doc-drift-gate.js .` at base `d8b6eed3` (this phase's baseline, saved as `RUN/p5-baseline-drift.txt`): rc=1,
  3 pre-existing FAIL categories (links/fences/script-refs) unrelated to foreman-guard, all pre-dating this
  plan. After P5's edit: byte-identical FAIL set (`diff` empty) — no new FAIL introduced.
- `validate.sh` at base and after: rc=0, 30/30 skills pass, both times.
- Review: **SHIP-AS-IS**, only a 🔵 note (that the bundled cumulative diff also carries prior-phase hunks,
  correctly identified as out of scope for this phase's own commit).

## Aggregate verify (worktree at accepted head `c52a43e3`, one at a time, solo)

| Suite/check | rc |
|---|---|
| `hooks/tests/foreman-guard.test.sh` | 0 (114 assertions) |
| `hooks/tests/foreman-guard-roles.test.sh` | 0 (945 assertions) |
| `hooks/tests/dispatch-model-guard.test.sh` | 0 (76 assertions) |
| `node scripts/check-js-syntax.js` | 0 |
| `bash scripts/sync-codex-plugin-skills.sh --check` | 0 |
| `bash scripts/validate.sh` | 0 (30/30 skills) |
| `node scripts/doc-drift-gate.js .` | 1 (pre-existing baseline only, no new FAIL — see P5 above) |

Verify worktree removed after the run.

## Residue for depth-0

- Cherry-pick order: `245ffc62` → `b8fc7bac` → `9514ced7` → `6d7a8606` → `70dc78cb` → `d8b6eed3` → `c52a43e3`
  (the `245ffc62`/`6d7a8606` intermediate round-1 commits are superseded by their r2 repairs but are real
  ancestors on the branch — cherry-pick either the whole chain or squash each row to its accepted head, per
  depth-0's usual landing convention).
- 7 dispatch worktrees remain under `/tmp/hetero-hands-fg-*` (one per hand dispatch, each a detached/branch
  checkout of the accepted or superseded commit) — not cleaned up by this foreman per the brief (no cleanup
  step was specified for hand worktrees, only the end-of-run `RUN/verify` worktree, which was removed).
- `$C/RUN` is an untracked symlink created to unblock dispatch — see Setup note above.
- Four background `sleep 2700; echo WAKE-fg-*` dead-man timers (p3, p3-r2, p4, p5) are still pending and will
  fire after this foreman returns; harmless, not live dispatches.
- Plan §5's landing step (`hooks/tests/run.sh --parallel 8`, reds rerun solo and compared at base) was NOT
  run by this foreman — it is not in the brief's "After all rows" list and belongs to depth-0's landing, not
  to this per-row verify.
- No version/CHANGELOG/BACKLOG edit made, no merge, no push, per instructions.
