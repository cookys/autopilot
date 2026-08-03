You are the architecture-contract supplemental seat for a terminal plan-review controller run whose
Codex transport failed before model invocation because its scratch cwd was not trusted.

Review the exact current bytes of these two files without editing anything:

- `/home/cookys/projects/autopilot/docs/plans/2026-08-04-platform-capability-trigger-activation.md`
- `/home/cookys/projects/autopilot/docs/plans/2026-08-04-platform-capability-trigger-activation.rubric.md`

The expected plan SHA-256 is
`db897d8f0a6f9c44a89596fb5c69d54fbf4be9fe9f7497a3df0b0467b61ce613` and the expected rubric
SHA-256 is `84bf0b4e4881964f67802b8b4f08dd1dd6206b1c73a21e243c4bf9ebbd9e6c8b`. Stop with a blocking
R2 finding if either digest differs.

Review only against frozen rubric IDs R1, R2, R3, R4, R5, R6, R7, R8. Do not schedule another
review generation. Return one JSON object with only `verdict` and `findings`. Each finding uses:
`rubric_id`, `class`, `severity`, `affected_surface`, `claim`, `evidence`, `evidence_reference`,
`repair`, `blocks_next_slice_or_immediate_integrity`, `cannot_defer_to_spike`.

Allowed verdicts are `READY`, `CONDITIONAL`, and `STOP`; allowed classes are `decision-now`,
`implementation-spike`, and `future`; allowed severities are `blocking` and `non-blocking`.
