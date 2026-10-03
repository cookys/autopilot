# v2.36.114 review follow-ups (🔵, not blocking)

Source: w114 landing reviews (round 1 review-1791023311-96700-dcac, round 2 review-1791024600-335312-08ba).

- **Trigger**: next touch of src/engine/implementation-campaign.js / campaign-intake.js.
- **AWAITING_CONVERGENCE_ADJUDICATION**: kept on `>=`. The second `campaignMutationBudgetStatus` call site (~:10458) is a dead call site for admitted campaigns; leave the phase on `>=` pending evidence that its resume can authorize another repair round (then add it to REPAIR_RESUME_PHASES and pass `{ repair: kind !== 'initial' }` there).
- **Advisories**: surface `control.advisories` (`campaign_file_cap_no_first_pass_headroom`) in intake CLI/report output; check consumers that deep-equal the control shape.
- **Fixture naming**: rename the `a_vertical_at_cap` fixture key; fixtures use cap=4 / cap=1 rather than N=12 (predicate is N-independent).
- **Parity**: cli.js vs campaign-intake.js predicate parity is tested by helper plus source check, not side by side per phase.
