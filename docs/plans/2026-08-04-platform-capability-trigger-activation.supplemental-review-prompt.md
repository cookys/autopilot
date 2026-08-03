Reserved R3 plan-review prompt; this planning/admission revision does not dispatch it.

Review the exact current bytes of these two files without editing anything:

- `/home/cookys/projects/autopilot-wt-platform-capability-trigger-activation/docs/plans/2026-08-04-platform-capability-trigger-activation.md`
- `/home/cookys/projects/autopilot-wt-platform-capability-trigger-activation/docs/plans/2026-08-04-platform-capability-trigger-activation.rubric.md`

Logical plan: `platform-capability-trigger-activation-2026-08-04-r3`.
Expected plan SHA-256: `6bd4bf5c3857928e3d0c806d0e5f535211bc7202b8540bb20130b68bfaa631de`.
Expected rubric SHA-256: `c5e0228093da7f0cb39fea4e7e132ac8aeb246b49dcfabe21798e9daac34df51`.
Stop with a blocking R2 finding if either digest differs.

Review only against frozen rubric IDs R1–R8. Do not schedule another review generation. Return one
JSON object with only `verdict` and `findings`. Each finding uses: `rubric_id`, `class`, `severity`,
`affected_surface`, `claim`, `evidence`, `evidence_reference`, `repair`,
`blocks_next_slice_or_immediate_integrity`, and `cannot_defer_to_spike`.

Allowed verdicts are `READY`, `CONDITIONAL`, and `STOP`; allowed classes are `decision-now`,
`implementation-spike`, and `future`; allowed severities are `blocking` and `non-blocking`.
