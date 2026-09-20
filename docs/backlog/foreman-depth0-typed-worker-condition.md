# Foreman ↔ depth-0 coordination: typed `worker_condition` (never built)

Plan `docs/plans/_archive/2026/08/2026-08-02-foreman-depth0-coordination-r6.md` (+ rubric) was frozen into
mission graph `docs/mission-backlog-actionable-successor-execution-graph.json` and never implemented:
`git grep`/`git log -S` for `worker_condition` and the typed-condition identifiers return nothing in history
(2026-09-20 orphan triage). Not superseded by foreman-no-polling (different problem: that one removes polling,
this one types the wait condition a hand reports so the foreman can wake on it).

Re-open when: a foreman wait loop has to distinguish "hand parked on a question" from "hand still working"
without reading the transcript — see the plan's §2 for the condition vocabulary.
