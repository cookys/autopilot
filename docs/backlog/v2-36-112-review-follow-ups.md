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
- **Row E**: root_run_id/work_order_id are stamped inside the boundary receipt digest body (spec said outside); dispatch_result_digest uses the pre-resolution candidate_ref. Confirm intent on next touch of campaign-composition.js.
- **Cosmetic**: `test-suite-finalize-gate.test.sh` comment still lists autopilot-engine-boundary-resume under ALWAYS-GREEN.
- **Effort**: S
