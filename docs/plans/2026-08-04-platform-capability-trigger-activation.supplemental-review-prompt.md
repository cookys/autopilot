Reserved R4 plan-review prompt; this planning/admission revision does not dispatch it. Invoke the
existing controller with `--timeout 12m` while retaining the configured 7,200-second total wall.

Review the exact current bytes of these two files without editing anything:

- `/home/cookys/projects/autopilot-wt-platform-capability-trigger-activation/docs/plans/2026-08-04-platform-capability-trigger-activation.md`
- `/home/cookys/projects/autopilot-wt-platform-capability-trigger-activation/docs/plans/2026-08-04-platform-capability-trigger-activation.rubric.md`

Logical plan: `platform-capability-trigger-activation-2026-08-04-r4`.
Expected plan SHA-256: `cba907b5df38e55f89f3bb2bb8c4ad694aaa56b88eecb5c997d9e0a67bf99b95`.
Expected rubric SHA-256: `b0643fae8891911809af07890c45290821a47c251d657ae094fc8e1690905d1b`.
Stop with a blocking R2 finding if either digest differs.

Review only against frozen rubric IDs R1–R8. Do not schedule another review generation. Return one
JSON object with only `verdict` and `findings`. Each finding uses: `rubric_id`, `class`, `severity`,
`affected_surface`, `claim`, `evidence`, `evidence_reference`, `repair`,
`blocks_next_slice_or_immediate_integrity`, and `cannot_defer_to_spike`.

Allowed verdicts are `READY`, `CONDITIONAL`, and `STOP`; allowed classes are `decision-now`,
`implementation-spike`, and `future`; allowed severities are `blocking` and `non-blocking`.
