---
name: l4
description: >
  Terse CEO front-door — Level 4: dispatch ONE background, worktree-isolated sub-orchestrator
  "foreman" that runs dev-flow unattended and returns a verdict; CEO context stays clean and the
  authoritative qc verdict is held at depth 0. Use when: "/l4 <goal>", "L4 <goal>", you want a long
  autonomous run offloaded off the main thread. Presets involvement=just-results, scope=Hold,
  project red lines plus -x additions (override --mode / --expand / --solo). Not for: inline execution (→ /l3), hetero impl
  engine (→ /l5).
---

# /l4 — CEO autonomy, dispatched foreman

Terse front-door into `autopilot:ceo-agent` at **Level 4**: dispatch **ONE**
background, worktree-isolated sub-orchestrator "foreman" that runs dev-flow
unattended; the CEO holds the **depth-0 control loop** and the **authoritative
qc verdict**.

Hard rules:
- Startup presets identical to `/l3`; engine all-Claude (hetero implementer → `/l5`).
- Before any TaskCreate, branch, worktree, runner, or model effect, run
  `node <plugin>/scripts/session-mode.js set --level l4 --repo-root <repo>`. `--solo` uses
  `set --level l3 --entry-level l4 --fallback solo`; a recorded precondition degradation uses
  `--fallback precondition_failed`. The command admits canonical Mission policy/graph/source
  coverage before writing the marker. Topology may change; its admission digest may not.
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
- Only admitted graph nodes become implementation tasks. Plan phase headings, modules, tests,
  review seats, and retries stay inside the owning deliverable.
- 工頭等 leaf 只能用 `run_in_background`／子 Agent 的 task-notification 喚醒並結束回合；禁止前景 `sleep` 輪詢與把 leaf raw output 灌回 context（背景 `run_in_background` until-loop 等外部條件是允許的，一次通知；只收 schema 判準表）、禁止用 Monitor 等 leaf；工頭 Bash 上限 40 次。

**Capability profile (shadow):** `/l4` fixes foreman topology only. When the host supplies a current
verified envelope/grant/profile payload, forward it unchanged; never infer guidance density from
the level or model name. A late mismatch requires a fresh-session handoff.
The canonical `profile-session.js` lane proves only no-effect context isolation. An adaptive child
also needs an independently witnessed effectful adapter for the exact grant; otherwise retain this
level's existing guided dispatch path and report the adaptive row as unverified.

**MUST-READ**: [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(§ The foreman, § Depth-0 control loop, § Run-summary ledger) — dispatch mechanics,
outcome→action table, and worktree-base rules live there, not here.
