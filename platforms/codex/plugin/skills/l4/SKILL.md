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

Terse front-door into `autopilot:ceo-agent` at **Level 4**: dispatch **ONE**
background, worktree-isolated sub-orchestrator "foreman" that runs dev-flow
unattended; the CEO holds the **depth-0 control loop** and the **authoritative
qc verdict**.

Hard rules:
- Startup presets identical to `/l3`; engine all-Claude (hetero implementer → `/l5`).
- **qc@depth-0 is THE gate**: reviewer families/panel come from
  `scripts/resolve-review-loop.sh` (`qc_panel` / `required_review_families` /
  `min_panel_size`); resolver unavailable → fall back to 3 reviewers. A
  homogeneous (all-Claude) panel must not drop below the resolver's
  **`min_panel_size`** (default 3) — panel size is emitted separately from
  families because lens diversity ≠ family decorrelation (same-family lenses
  can share blind spots). Reviewers read the branch diff, synthesized +
  fix-before-integrate — NEVER a CEO self-read, and distinct from the
  foreman's first-pass qc.
- Merge-back and worktree GC are owned by depth 0; budget cap is fail-closed
  (`TaskStop` + escalate). Record the run-summary ledger in the final CEO Report.
- `--solo` → the `/l3` inline engine (also the automatic degradation when the
  foreman returns `precondition_failed`).

**MUST-READ**: [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(§ The foreman, § Depth-0 control loop, § Run-summary ledger) — dispatch mechanics,
outcome→action table, and worktree-base rules live there, not here.
