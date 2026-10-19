# BL-0257 — BL-0039 notes 7 and 8

From `docs/plans/evidence/2026-10-19-backlog-deletion-audit/d/REPORT.md` section C-3: BL-0039 body items were fixed but the panel notes (7) and (8) were not, and the sidecar was deleted with commit `e05a1edc3`.

- Note (7): the instant2 fixture should be re-anchored (opaque).
- Note (8): the filter does not verify engine, runner or role.

File involved: `hooks/tests/calendar-teeth-negative.test.sh` (instant2).

Trigger: next change to that test's instant2 fixture, or when the capability-evidence producer contract is tightened.

A search of `docs/BACKLOG.md` and `docs/backlog/` found no existing row for this item, nor for the initial_state rename or the ledger-rotation environment question, so those three rows are new.
