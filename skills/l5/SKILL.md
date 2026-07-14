---
name: l5
description: >
  Terse CEO front-door — Level 5: like /l4 (background worktree-isolated foreman, depth-0 control
  loop + authoritative qc) but the IMPLEMENTER is orchestrated by the engine CLI and dispatched
  through the canonical `engine implement-review` path. Use when: "/l5 <goal>", "L5 <goal>", you want cost-arbitrage
  or a decorrelated second engine doing the mechanical impl. Presets involvement=just-results,
  scope=Hold, no-go=none (override -x / --expand / --solo). Not for: all-Claude run (→ /l4), inline
  (→ /l3).
---

# /l5 — CEO autonomy, foreman + hetero implementer

Terse front-door into `autopilot:ceo-agent` at **Level 5**: identical to `/l4`
except the IMPLEMENTER is a heterogeneous engine driven through the canonical
`engine implement-review` path (`bin/autopilot.js` → `dispatch-hetero.sh`).

Hard rules:
- At entry run `node <plugin>/scripts/session-mode.js set --level l5` (`--solo` ⇒
  `set --level l3`) — arms the orchestrator-edit-gate + context-budget hooks
  (level-front-door § "Session-mode marker").
- The roster from [`../../scripts/resolve-review-loop.sh`](../../scripts/resolve-review-loop.sh)
  is the ONLY source of truth — never hardcode model/runner/effort inline.
- Implementation dispatch uses an **immutable base SHA**; verification is by **git
  artifacts** (commit/diff/cleanliness), never agent self-report.
- Review is DECORRELATED: the reviewer is a different engine family than the implementer.
- `--solo` → the `/l3` inline engine (also the degradation on `precondition_failed`).

**MUST-READ**: [`references/hetero-impl-loop.md`](references/hetero-impl-loop.md)
(this level's loop: roster fields, harness/telemetry, wired runners) and
[`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(§ Heterogeneous engine loop details — diff scopes, loop governance).
