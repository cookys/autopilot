# v2.36.114 review follow-ups (🔵, not blocking)

Source: w114 landing reviews (round 1 review-1791023311-96700-dcac, round 2 review-1791024600-335312-08ba).

- **Trigger**: next touch of src/engine/implementation-campaign.js / campaign-intake.js.
- **AWAITING_CONVERGENCE_ADJUDICATION**: kept on `>=`. The second `campaignMutationBudgetStatus` call site (~:10458) is a dead call site for admitted campaigns; leave the phase on `>=` pending evidence that its resume can authorize another repair round (then add it to REPAIR_RESUME_PHASES and pass `{ repair: kind !== 'initial' }` there).
- **Advisories**: surface `control.advisories` (`campaign_file_cap_no_first_pass_headroom`) in intake CLI/report output; check consumers that deep-equal the control shape.
- **Fixture naming**: rename the `a_vertical_at_cap` fixture key; fixtures use cap=4 / cap=1 rather than N=12 (predicate is N-independent).
- **Parity**: cli.js vs campaign-intake.js predicate parity is tested by helper plus source check, not side by side per phase.

## Closed 2026-10-14 (lane/bl0103-w114-followups, merged)

AWAITING_CONVERGENCE_ADJUDICATION stays on `>=`, documented at REPAIR_RESUME_PHASES in `src/engine/implementation-campaign.js`. Advisories go to stderr via `formatCampaignAdvisories`. The fixture is renamed to `a_repair_phase_over_cap_blocked`. Stage F of `hooks/tests/campaign-repair-at-file-cap.test.sh` runs cli.js and campaign-intake.js side by side per phase, including a true row at cap 4/4; M1-M4 mutation receipts are in its header (M3 re-run at merge: only the REVIEWING parity row fails).

## Still open

- **CLI stderr**: the advisory channel is pinned only by a source-string check (test :571). Run the CLI and assert `ADVISORY` on stderr and `JSON.parse`-able stdout.
- **Mutation record wording**: M1 names at/below/over rows, but only the at-cap rows plus churn and wall fail; M4 says all `a_*` rows, but IMPLEMENTING_at_cap exits before the predicate.
- **Label**: the Stage F asserts sit under the `# D. advisory` label.
- **Trailing colon**: an advisory without a message prints a trailing colon.
