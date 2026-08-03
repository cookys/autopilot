Reserved R4 generation 2 plan-review prompt; this planning/admission revision does not dispatch it.
Generation 1 accepted R8 fingerprint
`e9f817092f3b54635588d1c76aca049615ff918c5ef4e3c4e5f373d951c88645` through immutable
`docs/plans/2026-08-04-platform-capability-trigger-activation.r4-g1-disposition.json`. Invoke the
existing controller in the same R4 lineage with `--timeout 12m` while retaining the configured
7,200-second total wall.

Review the exact current bytes of these two files without editing anything:

- `/home/cookys/projects/autopilot-wt-platform-capability-trigger-activation/docs/plans/2026-08-04-platform-capability-trigger-activation.md`
- `/home/cookys/projects/autopilot-wt-platform-capability-trigger-activation/docs/plans/2026-08-04-platform-capability-trigger-activation.rubric.md`

Logical plan: `platform-capability-trigger-activation-2026-08-04-r4`.
Expected plan SHA-256: `08d89358d78b7487cb9daf0b9c537bcef68045125c564c960808b565f338dea6`.
Expected rubric SHA-256: `b0643fae8891911809af07890c45290821a47c251d657ae094fc8e1690905d1b`.
Stop with a blocking R2 finding if either digest differs.

Review only against frozen rubric IDs R1–R8. Do not schedule another review generation. Return one
JSON object with only `verdict` and `findings`. Each finding uses: `rubric_id`, `class`, `severity`,
`affected_surface`, `claim`, `evidence`, `evidence_reference`, `repair`,
`blocks_next_slice_or_immediate_integrity`, and `cannot_defer_to_spike`.

Allowed verdicts are `READY`, `CONDITIONAL`, and `STOP`; allowed classes are `decision-now`,
`implementation-spike`, and `future`; allowed severities are `blocking` and `non-blocking`.
