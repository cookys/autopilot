# Frozen review rubric — P6D corrective gates plan

CG1: Gate reachability and caller truth. For each of the three gates, does the plan wire it
at a point the failing flow ACTUALLY passes through (admission for l5/l6; the engine's
commit step; the terminalize/successor API), and does each phase include a caller-side test
proving the gate fires in situ — not merely a unit test of the predicate? A gate nothing
calls is the repo's documented "script existing is not evidence it is running" failure.

CG2: Oracle-completeness predicate validity. KR1 keys on "enumerable output_paths AND
deterministic verify commands". Is that the right mechanical proxy for "a complete
acceptance oracle exists"? Name contracts that satisfy the predicate yet genuinely need
heavy dispatch (discovery-heavy work with incidental path lists?), and contracts that fail
it yet should be blocked. Is `escalation_justification` a real justification or a rubber
stamp — what stops a controller from writing "needs review" boilerplate?

CG3: Manifest gate semantics. Staged-set ⊆ output_paths: is subset the right relation
(vs equality)? How do glob/dir allowlists, renames, deletions, and mode-only changes
behave? Does blocking BEFORE commit interact safely with the engine's existing scope gate
(which fires later) — double gate, or does the earlier one make the later unreachable and
untested?

CG4: Repair-ladder receipt falsifiability. "Same gate re-run with intervening artifact
delta" — can a controller game it with a whitespace amend? Is zero-delta detection
well-defined across worktrees? Does requiring the receipt at terminalize/successor break
any LEGITIMATE terminalization (deadline exhaustion, owner abort, infra death) — enumerate
the terminal reasons and which must bypass the ladder.

CG5: Blast radius and default posture. All three gates default-on where their preconditions
hold. Argue the strongest case that any should be opt-in first (shadow mode), given the
repo's history: v2.34.19 showed rules away from the action point get routed around, but the
expiry incident showed fail-closed gates on the wrong predicate kill rails. Which family is
each gate really in?

CG6: Scope discipline. Does anything in the plan smuggle P6D specifics into policy, inflate
the report budget into product machinery, or carry a verdict map beyond the three measured
failure classes? Is the OQ1 override design (any controller + audit-recorded reason) an
escape hatch that neuters KR3?

CG7: Cheaper alternative. Argue the strongest case AGAINST building any of the three gates
— e.g. the existing scope gate + incident record already changed behavior; or one gate
delivers 80% of the value and the other two are governance growth of exactly the kind
Fable 5 warned about. Which single gate would you ship first if only one?
