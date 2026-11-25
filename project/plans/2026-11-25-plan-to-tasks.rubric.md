# Frozen rubric — plan-to-tasks (logical_plan_id: plan-to-tasks-2026-11-25)

Frozen 2026-11-25 before G1. Reviewers judge the plan against these items only. Citations in the plan are provenance, not reading assignments: judge the plan text as written.

- R1: [machine-readable-and-idempotent] The phase table is decidable by a script, the child-task creation derives only from the frozen plan bytes, a re-run cannot create duplicates, and the freeze condition is mechanically checkable.
- R2: [gate-coverage-and-no-false-block] The fleet-task gate covers every background-engine dispatch path of every lane, keeps legitimate exempt cases working, and has an explicit stated behaviour when fleet is unavailable.
- R3: [replaces-not-adds] Each new or changed gate names the scattered rule it retires or replaces, and no second canonical statement of the same rule is left behind.
- R4: [negative-control-and-live-probe] Every gate has a negative control that must fail first and a live reverse probe that deliberately violates it; each is runnable by a zero-context engineer with the named command.
- R5: [triage-correctness] The look-versus-skip routing has reachable, decidable inputs; a UI, interactive, outward-facing or first-live change cannot be routed to skip; the three finish cells cannot be satisfied by a stub.
- R6: [executability-and-order] Steps name files, functions and commands concretely; the dependency map matches phase contents; each phase can land on develop alone without breaking existing tests or users.
- R7: [scope-and-risk] Risks and inversions are real and mitigated; out-of-scope items do not undercut the goal; the transition knob has an end date or removal step.
