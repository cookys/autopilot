# Reconnaissance and implementation share one leaf bash budget, so a leaf can exhaust it before touching code

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14


- **Trigger**: **NOT FIRED — peer observation, 2026-09-13.** Fires when a leaf under this rail is measured hitting its command cap with zero diff.
- **Context**: `308-db` ran six Agent-worktree leaves on 2026-09-13; three hit the 40-command bash ceiling **after reconnaissance was complete and before a single line changed**. Their reading, which is the right one: a flow defect, not a leaf defect — recon and implementation should not draw from one allowance. Splitting each into two leaves put the first inside budget immediately. Same family as the foreman-rail requests above: a resource contract that the leaf cannot see or negotiate.
- **Not reproduced here.** The 40-cap is the harness's, not this plugin's, but whatever this rail says about leaf budgets (`max_gate_attempts`, `max_repair_generations`) has the same blind spot: none of them distinguish "spent reading" from "spent writing".
- **Effort**: S to measure on this host; design after.
- **Source**: `308-db` via the local session mesh, 2026-09-13.

