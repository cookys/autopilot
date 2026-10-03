# v2.36.111 review follow-ups (🔵, not blocking)

Source: per-row and landing reviews under `docs/plans/evidence/2026-10-03-v111-resume-and-review-budget/*.review.json`. The reviewer-output-budget follow-ups (openai rail, bracketed raw-log match) live in their own BACKLOG row; items already fixed in the release are omitted.

- **Trigger**: next touch of the respective file.
- **Finalize gate** (`hooks/tests/test-suite-finalize-gate.test.sh`): `[ "$FAIL" -eq 0 ] || exit 1` is accepted on any line, including inside a heredoc stub or an uncalled function; `finalize_test` is recognised only as a line-start command (a `trap finalize_test EXIT` shape reads as a violator).
- **Intake vs cli cap predicate**: `src/engine/campaign-intake.js` skips the changed-file cap on `phase === REVIEWING`, `src/campaign/cli.js` on `reviewingResumable` (REVIEWING with a bound candidate). Equivalent today; align them.
- **xproc suite** (`hooks/tests/final-panel-seat-resume-xproc.test.sh`): no RED-at-base record (which assertions fail at f197fc09, no seat store); `drive()` echoes `$?` after `node | tail -1`, so it reports tail's status; use `${PIPESTATUS[0]}`. Live `packet_hash` stability across processes is unproven.
- **verify-red-green** (`scripts/verify-red-green.sh`): no negative control for a symlink planted inside the repo (`$REPO/link -> /outside`, `--verify-cmd $REPO/link/x.sh`); the pwd -P resolution should classify it external.
- **Dispatch-review rail test**: assert `[call=4 max_tokens=16384]` for the dispatch-review.sh case too.
- **Cosmetic**: `campaign-resume-reviewing-phase.test.sh` keeps dead fixture setup (unused imports and options); `a2` suite engine options define `repairLineageCleanupTransaction` twice.
- **Effort**: S
