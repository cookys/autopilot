# Managed rail: reviewer no_verdict leaves phase REVIEWING, which `--resume` refuses — durable wait not resumable

Original row from 5f3aa3b1d^:docs/BACKLOG.md:

> ### Managed rail: reviewer no_verdict leaves phase REVIEWING, which `--resume` refuses — durable wait not resumable
> - **Status**: open
> - **Trigger**: any managed campaign whose in-rail reviewer returns no_verdict (format fault) — the next run of that station
> - **Effort**: M
> - **Source**: 1b-B campaign 2026-09-17 (`impl-run1-attempt1-blocked.json` durable_wait:true/resumable:true; `impl-run2-resume-refused.json` campaign_resume_phase_unsupported)
> - **Pointer**: docs/plans/evidence/2026-09-17-blind-review-cleanroom-intake/README.md
> - **Context**: v2.36.43 keeps the claim, but the persisted phase stays REVIEWING, outside NON_SUCCESS_DURABLE_STATES (campaign-intake.js ~:770-788), so resume is refused. Add that phase to the durable set, or re-administer/swap the seat in-rail.
> 

Audit finding: Audit #5: Status open, Effort M, measured on the 1b-B campaign. No later CHANGELOG fix found. Trigger-Type event.

Restored 2026-10-19 from 5f3aa3b1d^; see docs/plans/evidence/2026-10-19-backlog-deletion-audit/REPORT.md
