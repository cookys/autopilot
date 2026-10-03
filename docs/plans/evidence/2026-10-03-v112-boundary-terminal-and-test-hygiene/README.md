# v2.36.112 (w112): boundary-rejected terminal success, finalize gate, seat reap

Evidence for the 2026-10-03 landing at `dabdd20e`. Files: hand common brief, per-unit briefs (`unit-*.md`), the bundle, per-row review JSON (`*.review.json`), the landing review (`landing.w112.review.json`), the landing brief and report (`land-brief.md`, `REPORT-land.md`), and the closeout brief.

- **Pipeline**: four parallel sonnet hands E/F/G/H, one fable review per row.
- **Repairs**: F x2, G x2, E x1 (depth-0-ordered), then landing repair R2.
- **Caught by per-row review**:
  - the F finalize gate counted a bare `[ "$FAIL" -eq 0 ]` followed by `exit 0` as finalizing
  - F also shipped a dead zero-assertion guard
  - G kept seat rows whose decision reason was empty.
- **Caught by depth-0 beyond review**: the G seat reader hard-coded rotations `.1..4` while `run-ledger.sh` rotations are configurable, so a parked campaign's rows could rotate out and its artifacts be swept. The reviewer had rated this a blue suggestion; depth-0 re-derived it as real.
- **Caught by the landing full suite**: a new fixture needed Population B registration (`resolve-review-loop-consult-discuss-switch.test.sh`). Second release in a row. Root cause: the rule lived only in `land-brief.md`, not in the hand template; it is now in `hand-brief-common.md`.
- **verify-red-green symlink question**: depth-0 re-derived from `scripts/verify-red-green.sh:606` that INCONCLUSIVE keys on bound-artifact identity, not location, so it is not a hole (a hardening refusal stays a blue follow-up).
- **Follow-ups**: `docs/backlog/v2-36-112-review-follow-ups.md`.
