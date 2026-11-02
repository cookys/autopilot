# Rubric — 2026-11-03-routing-successor.md

> Source plan: docs/plans/2026-11-03-routing-successor.md

R1: the routing config points at a successor graph and its sources manifest, and the previous graph file stays byte-identical.
R2: every path the successor graph names (outputs, required paths, spec, verification commands) exists in both trees.
R3: an l5 session-mode set passes in the tree before P1 and in the tree after P1, and a graph that names a missing path is refused.
R4: No new output is created by the successor node; the single output is the routing config itself.
R5: The previous graph, its sources manifest and its rubric are not edited.
R6: No version bump, no changelog or backlog edit.
R7: Run the graph check against the successor graph and its sources manifest.
R8: Run the admission path through a temporary session-mode directory, never the real marker directory.
