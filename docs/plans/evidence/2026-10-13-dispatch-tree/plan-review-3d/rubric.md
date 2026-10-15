# Rubric — dispatch tree step 3d (child parent record)

Scope: the 2026-10-15 revision only (D10, step 3d, §6 rule 5, §7 row l, the row d2 note). Earlier steps are frozen and out of scope except where 3d changes them.

- R1: [leak-closed] With 3d landed, a session started from a long-lived shell that kept a rail child's environment cannot record that rail's parent session as its own parent, on every SessionStart path that writes a marker.
- R2: [true-edges-kept] A child the rail actually launched and can name still records its parent, on every rail branch the plan says mints an id; no branch that records a parent today loses it without the plan saying so and saying why.
- R3: [no-inherited-id] No launch path passes an inherited child id to a process whose id the rail did not choose, including nested rails, detached re-exec, foreman hands, the kimi transport and probes.
- R4: [claims-true] Every cited file:line and every statement about current behaviour in the revision matches the code on develop.
- R5: [verifiable] Each claim of the revision has an acceptance case that is red on develop and green after, and each guard has a negative control that would actually turn red if that guard were removed.
- R6: [order-and-compat] Old environments, rollback and the interaction with steps 5 and R are stated, the failure direction is "not traced" rather than a wrong edge, and no earlier conclusion (step 5 blocked, R waiting on kimi/agy/opencode) is silently changed.
- R7: [scope-and-adr] The revision adds no heuristic or trust machinery (ADR-0001), changes no version, and touches no surface outside the dispatch-tree plan's stated scope.
