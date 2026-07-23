---
name: l3
description: >
  Terse CEO front-door — Level 3: full autonomy, CEO executes inline on this thread, escalate only
  at the DOA boundary. Use when: "/l3 <goal>", "L3 <goal>", you want the "全權處理 / get it done"
  behavior as one command without the CEO startup Q&A. Presets involvement=just-results, scope=Hold,
  red-lines=none (override -x / --expand). Not for: offloading to a background foreman (→ /l4), hetero
  impl engine (→ /l5), participatory planning (→ dev-flow), research-only (→ survey).
---

# /l3 — CEO autonomy, inline

> Routing overlap? If this intent better matches a sibling skill, redirect per [references/routing-tiebreaks.md](../../references/routing-tiebreaks.md) (prefer explicit commands over conversational autonomy).

Terse front-door into `autopilot:ceo-agent` at **Level 3**: the CEO executes the
goal **itself on this thread** and escalates only at the DOA boundary.

Hard rules:
- Startup pre-filled, never re-asked on a clean goal: OKR from `<goal>`;
  involvement=3 just-results; scope=Hold (`--expand` → Expand); red-lines=none (`-x <csv>`).
- Posture: **inline** — no foreman dispatch. `/l3` is also the `--solo` degradation
  target for `/l4`/`/l5`/`/l6`.
- The front-door changes startup ONLY — every `ceo-agent` gate (size → project setup
  → phases → finish-flow) still applies.

**MUST-READ**: [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(front-door semantics) and [`../ceo-agent/SKILL.md`](../ceo-agent/SKILL.md) (DOA,
Prime Directives, quality gates).
