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

<!-- AUTOPILOT_CODEX_LIFECYCLE_ADAPTER_V1 -->

## Codex lifecycle adapter (normative override)

This section overrides any later host-specific lifecycle or dispatch spelling in the canonical skill
body. Resolve `<plugin-root>` as the installed Autopilot plugin directory that contains this skill.

When using the packaged managed CLI, enter through the existing explicit marker command:

```text
node "<plugin-root>/scripts/session-mode.js" set --level <l3|l4|l5|l6> --entry-level <requested-level> --repo-root <git-root>
```

The production Codex package currently registers only its `PostCompact` recovery hook. It does not
ship a Codex-thread-bound `PreToolUse` direct-mutation gate, and this shell command must not be
described as receiving or exporting a `CODEX_THREAD_ID` binding. The marker is an explicit
CLI/Engine admission artifact; it is not a production hook admission proof. A marker from another
explicitly bound session is not reusable when the managed CLI validates it.

Continue only when the emitted marker contains `mission_routing.status: "READY"`, `admitted: true`, and
`would_block: false`. Managed implementation then follows the existing Mission admission, sealed
campaign, and `AUTOPILOT_LEVEL=<level> node
"<plugin-root>/bin/autopilot.js" engine implement-review ...`
route. Repairs attach to and resume that same engine/campaign lineage. A Codex implementer launched
inside that route receives a credentials-only isolated `CODEX_HOME`, never the controller plugin or
configuration.

Codex in this package does not provide `TaskCreate`, `TaskUpdate`, `TaskStop`, native `Agent`, or
`subagent_type`. Do not imitate them with Markdown tickets, inline managed implementation, a new
branch/session, or a replacement graph. If an exact mapping is unavailable, stop with the existing
precondition or abort receipt; do not invent another lifecycle authority.

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
- 工頭等 leaf 只能用 `run_in_background`／子 Agent 的 task-notification 喚醒並結束回合；禁止 `sleep` 迴圈、禁止 `cat`/`tail` leaf output 進自己 context（只收 schema 判準表）、禁止用 Monitor 等 leaf；工頭 Bash 上限 40 次。

**Capability profile (shadow):** `/l4` fixes foreman topology only. When the host supplies a current
verified envelope/grant/profile payload, forward it unchanged; never infer guidance density from
the level or model name. A late mismatch requires a fresh-session handoff.
The canonical `profile-session.js` lane proves only no-effect context isolation. An adaptive child
also needs an independently witnessed effectful adapter for the exact grant; otherwise retain this
level's existing guided dispatch path and report the adaptive row as unverified.

**MUST-READ**: [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(§ The foreman, § Depth-0 control loop, § Run-summary ledger) — dispatch mechanics,
outcome→action table, and worktree-base rules live there, not here.
