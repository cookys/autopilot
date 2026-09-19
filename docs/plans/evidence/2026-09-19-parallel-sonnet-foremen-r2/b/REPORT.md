# REPORT — unit B (migrate-b)

## Branches / commits
- `hands/par4-b/migrate-b` @ `9645d269f15bb7c82b850fde511e4fc41c82ade2` (one commit) — base `488dc6dc`.
  `diff --stat`: 7 files, +475/-34 (migrate-backlog-entries.js + codex mirror, check-backlog-entries.js + codex mirror
  export, references/backlog-entry.md + codex mirror, new test suite).
- `hands/par4-b/migrate-b-r2` @ `87a29ad2c1fb896bbc0004fbf239a036d132ed2e` (one commit, repair round) — base = r1 head.
  `diff --stat`: 3 files, +190/-24 (test suite, migrate-backlog-entries.js + codex mirror).

## Review verdict (round 1, claude-native/claude-fable-5-1, high effort)
FIX-THEN-SHIP. Findings and disposition:
- 🟠 `preserved-not-computed` MUST-FIX — accepted. `normalized_bytes` was defined as the exact residual
  (`bytes_before − bytes_after − moved_bytes`), making the reconciliation check `x === x`; loss inside a rewritten
  (non-dropped, non-sidecar) column would be silently absorbed and reported `preserved:true`. Dispatched for repair.
- 🟠 `reconcile-assertion-vacuous` MUST-FIX — accepted. The case-(p) byte assertion read `normalized_bytes` back out
  of the same manifest it was defined from, so it could never fail. Dispatched for repair.
- 🔵 `status-kind-passthrough`, 🔵 `on-disk-manifest-lacks-gate`, 🔵 `negative-control-scope`,
  🔵 `red-annotations-partial` — all CUT/FOLLOW-UP severity, refuted for this round (spec doesn't require them / not
  loss-causing / not evidenced by a fixture); left as-is, not escalated.

## Repair round (r2)
Prompt = original hand prompt + the two 🟠 findings verbatim. Hand extended the post-loop `dropped` scan to every
non-verbatim-moved column's cells (exempting Status under the same rule as the existing lossy check), computed
`normalized_bytes` from the script's own normalisers (bold/padding/period-strip) instead of as a residual, added a
separate `synthesized_bytes` count for schema fills, and reconciled `preserved = (dropped.length===0) &&
(bytes_before === bytes_after + moved_bytes + normalized_bytes − synthesized_bytes)`. Added a lossy-row test case
(oversized Source cell, no sidecar move) asserting `preserved` flips to `false`, and an independently-computed
expected-`normalized_bytes` check in case (p) instead of reading it back from the manifest. Not re-reviewed by a
second decorrelated pass (one repair round only, per brief); verified by direct execution below instead.

## Verify (run directly against the r2 worktree, all foreground, `< /dev/null`)
```
rc=0  bash hooks/tests/migrate-backlog-entries.test.sh   -> PASS [migrate-backlog-entries] 98 assertions
rc=0  bash hooks/tests/check-backlog-entries.test.sh     -> PASS [check-backlog-entries] 31 assertions
rc=0  node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
rc=0  node scripts/migrate-backlog-entries.js --backlog docs/BACKLOG.md --json
rc=0  bash scripts/sync-codex-plugin-skills.sh --check
rc=0  node scripts/check-js-syntax.js
```

## Consumer sweep (evidence-discipline sec37/sec39)
`grep -lE 'runCheck|migrate-backlog-entries|check-backlog-entries' hooks/tests/*.test.sh` minus the two Verify
suites -> no other consumer suites found. Sweep log empty (no rows to run).

## Not done / notes
- Blue findings not addressed (by design - CUT/FOLLOW-UP, not MUST-FIX): worth a future BACKLOG row if the on-disk
  manifest (vs stdout) is ever asserted on by a consumer.
- No BACKLOG-row text found to be wrong; the four confirmed defects and the doc contradiction (backlog-entry.md:29)
  matched the fired row exactly.
- Allowed-files constraint held: diff touches only `scripts/migrate-backlog-entries.js`,
  `scripts/check-backlog-entries.js` (export only), `references/backlog-entry.md`, their codex mirrors, and
  `hooks/tests/migrate-backlog-entries.test.sh`. `docs/BACKLOG.md` and `.claude/backlog-config.md` untouched.
