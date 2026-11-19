# Rubric — 2026-11-19-fleet-stage-graph-binding.md

> Source plan: project/plans/2026-11-19-fleet-stage-graph-binding.md

- R1: The plan's Source section quotes all three operator sentences in Chinese verbatim.
- R2: Section (a) names the exact script or hook that writes size and fleet_task_id into the marker on accept, and states what today's code does instead (cites scripts/session-mode.js and the manual `set --fleet-task`).
- R3: Section (b) has a table where every stage-transition row names the exact re-derivation command or git operation and the refusal code, and for each of plan path@sha, plan-loop verdict, qc receipt, finish merge sha and Used evidence there is one row; no row relies on a lane's assertion.
- R4: The flow graph is drawn (mermaid or ASCII) and also given as a table covering XS, S, M, L, XL, bug, urgent-low, and states when brainstorm (explore) versus survey (research) applies; the table agrees with references/stage-graph.json.
- R5: Section (d) gives the export's schema name, version, file location, the compatibility rule for a major bump, and how fleet detects a tampered or stale export.
- R6: Section (e) is marked INTERFACE with fleet--claude as reviewer, lists the proposed issue fields for 01M7RAMY, and puts (h) and (i) in one interface shared with gate 01M7PMGYS50QEN5JSE8A1K39FA rather than two.
- R7: Section (f) explains how a codex, agy or grok lane writes the marker and receipts without Claude hooks, and states the honest limit.
- R8: Section (g) names the PM plan-gate hook (stem, file, manifest line, test) and gives a retirement step ordered so there is never a window with neither system.
- R9: Sections (h) and (i) specify the plan phase block format, the problems that are reported at freeze, edges as task ids only, who alarms, and each threshold paired with the real case it blocks, including codeforge task 01M7MD5Z.
- R10: Section (j) covers WBS + critical path, kanban WIP limit, budget lines and the two-startable-items rule, with per item only: have now (有 where it exists), the gap, and an owner from {autopilot, fleet, capacity, hangar, pm}.
- R11: Every phase has a dev-flow size, a shipped artifact list, an acceptance, and a Used-by evidence line; an out-of-scope list exists; the plan states ADR-0001 re-derivation and adds no attestation or trust machinery.
