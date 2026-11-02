# Plan - mission routing hands over to a successor graph before the relayout P1 merge

> Status: frozen. Pre-lane of the 3.0.0 relayout phase P1. Plan only: the routing pointer edit ships with this plan. Version stays 3.0.0 (owner hold).

## 0. Context

The relayout phase P1 moves the work records out of the old docs tree. The routing config names a completed, byte-sealed graph whose outputs include a work record P1 moves. With owner-kernel enforcement on, a session-mode set at level l3 to l6 is refused once an output of the routed graph is missing. The owner chose the regular retirement path: a successor graph that the routing config points to.

## 1. Problem

- After P1, the routed graph names an output that no longer exists, so every l3 to l6 admission fails.
- The successor must stay admissible in both trees: the tree before P1 and the tree after it.

## 2. OKR / KRs

- KR1: the routing config points at a successor graph and its sources manifest, and the previous graph file stays byte-identical.
- KR2: every path the successor graph names (outputs, required paths, spec, verification commands) exists in both trees.
- KR3: an l5 session-mode set passes in the tree before P1 and in the tree after P1, and a graph that names a missing path is refused.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- No new output is created by the successor node; the single output is the routing config itself.
- The previous graph, its sources manifest and its rubric are not edited.
- No version bump, no changelog or backlog edit.

## 3. Out of scope

Runtime state under the git common dir is handled by depth-0 after the merge, not by this plan.

## 4. Deliverable contract

The routing config names the successor graph and sources manifest. The successor graph has one node whose only output path is the routing config, and whose verification command is the graph check on the successor itself.

## 5. Acceptance

The graph check passes on the successor, the admission path passes in both trees, and a graph naming a missing path is refused.

## 6. Verification constraints

- Run the graph check against the successor graph and its sources manifest.
- Run the admission path through a temporary session-mode directory, never the real marker directory.
