# Pre-existing reds found landing v2.36.100 (context-budget live-dir fix)

Confirmed red against `origin/develop` (`0ecc19b2`) in a throwaway worktree, before the v2.36.100
diff landed — neither is introduced or touched by that change. Both reconfirmed red again on the
final r3 diff (`b8d0aa43`); base did not move between the two review rounds. Details:
`docs/plans/evidence/2026-09-28-context-budget-live-dir/REPORT-land.md`.

## `hooks/tests/engine-qualify-verdict-stability.test.sh`

D6 honest/parity grader-hash drift: `Error: impl evaluation grader drifted from its pinned hash`.
Unrelated to live-dir resolution or permission logic.

## `hooks/tests/migrate-backlog-entries.test.sh`

The real `docs/BACKLOG.md` migratable-entry count is one short of the suite's `>= 100` gate (a
`node -e 'process.exit(N>=100?0:1)'` check with no printed FAIL line — a silent red, not routed
through the assert wrapper). The count moves with `docs/BACKLOG.md` row churn, including the two
rows this landing itself added/removed net-zero.
