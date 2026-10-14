# v2.36.112 review follow-ups (🔵, not blocking)

Source: per-row reviews (`run2/*.review.json`) and the combined landing review (review-1791009315-986223-583f).

- **Trigger**: next touch of the respective file.
- **run.sh summary**: does not surface `SKIP [` lines (mission-terminal-rollover's vacuous-run SKIP is invisible there).
- **mission-terminal-rollover**: the zero-assertion guard is unexercised on the normal path in a registry-less clone.
- **Seat sweep**: reaps `terminal` regardless of lock; verify TERMINAL_EVENT_TYPES against an "abandoned" event (vocabulary).
- **Sweep env**: `RUN_LEDGER_MAX_ROTATIONS` is read from the sweep's environment.
- **verify-red-green**: optional refusal of an in-repo symlink that escapes the repo; the item-2 test pins VALIDATED:0 where the spec premise said INCONCLUSIVE.
- **B3 rejection code** is not pinned by a test.
- **`finish_reason=length`** with whitespace-only content is not covered.
- **Row E** (closed 2026-10-14, intent confirmed, no code change): root_run_id/work_order_id stay inside the boundary receipt digest body. A verifier re-derives the digest by dropping only `at`/`digest` from the persisted row (`hooks/tests/campaign-boundary-receipt-e2e.test.sh`), and the transcript audit needs the tuple on every row; the rationale is in the `boundaryReceiptBody` comment in `src/engine/campaign-composition.js`. The "outside" wording in the w112 brief (`docs/plans/evidence/2026-10-03-v112-boundary-terminal-and-test-hygiene/bundle-w112.md`) is superseded. Nothing recomputes the digest on resume, and `campaign_id` already makes it run-specific. dispatch_result_digest keeps the rail's raw candidate_ref: a non-hex ref yields no `git_candidate`, so the weakly bound value is never consumed.
- **Cosmetic**: `test-suite-finalize-gate.test.sh` comment still lists autopilot-engine-boundary-resume under ALWAYS-GREEN.
- **Effort**: S
