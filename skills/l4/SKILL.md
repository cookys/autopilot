---
name: l4
description: >
  Terse CEO front-door — Level 4: dispatch ONE background, worktree-isolated sub-orchestrator
  "foreman" that runs dev-flow unattended and returns a verdict; CEO context stays clean and the
  authoritative qc verdict is held at depth 0. Use when: "/l4 <goal>", "L4 <goal>", you want a long
  autonomous run offloaded off the main thread. Presets involvement=just-results, scope=Hold,
  no-go=none (override -x / --expand / --solo). Not for: inline execution (→ /l3), hetero impl
  engine (→ /l5).
---

# /l4 — CEO autonomy, dispatched foreman

Terse front-door into `autopilot:ceo-agent` at **Level 4**: the CEO dispatches
**ONE sub-orchestrator "foreman"** (background + worktree-isolated) that runs
dev-flow, while the CEO holds the **depth-0 control loop** and the
**authoritative qc verdict**.

## On invocation

1. Invoke `autopilot:ceo-agent` with the four startup questions **pre-filled**
   (same presets as `/l3`: OKR from `<goal>`; involvement=3 just-results;
   scope=Hold via `--expand`; no-go=none via `-x <csv>`).
2. Execution posture: **offload**. Dispatch the foreman and run the depth-0
   control loop exactly per
   [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md):
   - Foreman = `sub-orchestrator` (depth 1), background + `isolation:worktree`,
     dev-flow inline, impl/review leaf-dispatched to depth-2 workers.
   - Depth-0 control loop the CEO owns: budget cap (rounds + wall-clock,
     fail-closed → `TaskStop` + escalate), outcome→action table, **qc@depth-0**
     (authoritative, reads artifacts — distinct from the foreman's first-pass qc),
     merge-back owned by depth 0 (conflict → rebase-once-else-escalate), worktree
     GC (`git worktree remove --force`).
   - Record the **run-summary ledger** (step → runner/model → verdict → artifact)
     in the final CEO Report.
3. **`--solo`** → fall back to the `/l3` inline engine (also the automatic
   degradation when the foreman returns `precondition_failed`).

Engine: Claude (foreman + workers). For impl → agy/Gemini, use `/l5`.
See [`../ceo-agent/SKILL.md`](../ceo-agent/SKILL.md) for DOA and quality gates.
