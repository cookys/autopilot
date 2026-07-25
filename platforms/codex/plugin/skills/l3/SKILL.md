---
name: l3
description: >
  Terse CEO front-door — Level 3: full autonomy, CEO executes inline on this thread, escalate only
  at the DOA boundary. Use when: "/l3 <goal>", "L3 <goal>", you want the "全權處理 / get it done"
  behavior as one command without the CEO startup Q&A. Presets involvement=just-results, scope=Hold,
  project red lines plus -x additions (override --mode / --expand). Not for: offloading to a background foreman (→ /l4), hetero
  impl engine (→ /l5), participatory planning (→ dev-flow), research-only (→ survey).
---

# /l3 — CEO autonomy, inline

> Routing overlap? If this intent better matches a sibling skill, redirect per [references/routing-tiebreaks.md](../../references/routing-tiebreaks.md) (prefer explicit commands over conversational autonomy).

Terse front-door into `autopilot:ceo-agent` at **Level 3**: the CEO executes the
goal **itself on this thread** and escalates only at the DOA boundary.

Hard rules:
- Startup pre-filled, never re-asked on a clean goal: OKR from `<goal>`;
  involvement=3 just-results; scope=Hold (`--expand` → Expand); governance mode from the project
  default (`--mode` changes only this run); project red lines plus `-x <csv>` additions.
- Posture: **inline** — no foreman dispatch. `/l3` is also the `--solo` degradation
  target for `/l4`/`/l5`/`/l6`.
- The front-door changes startup ONLY — every `ceo-agent` gate (size → project setup
  → phases → finish-flow) still applies.

### P3.0 shadow translation

When the consuming project explicitly has `.claude/owner-kernel-governance.json` **and an
explicit Autopilot source path**, it may resolve the read-only mapping before work. In this example,
`<autopilot-source>` is a literal absolute source checkout or project-provided installed copy, not
an assumed environment variable:

```bash
node <autopilot-source>/scripts/owner-kernel.js translate-level \
  --config .claude/owner-kernel-governance.json --level l3 [--expand] [-x <red-line-csv>] --check
```

Treat the result as a frozen topology preference and red-line disclosure, never as an approval,
action permit, or acceptance result. Do not fall back to Autopilot's own dogfood config when the
consuming project has no config or no explicit source path. A host that provides
`ShadowTranslationRuntime` may record the same mapping as a witnessed `translation_used` event; a
shell/skill invocation cannot mint that event and must not claim telemetry when no host bridge is
configured.

P3.0 does not replace the existing `/l3` lifecycle, DOA, independent QC, or finish-flow rails.
`/l4` through `/l6` remain on their present strict worktree/dispatch paths until the supervised
engine bridge is complete.

**MUST-READ**: [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(front-door semantics) and [`../ceo-agent/SKILL.md`](../ceo-agent/SKILL.md) (DOA,
Prime Directives, quality gates).
