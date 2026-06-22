---
name: l3
description: >
  Terse CEO front-door — Level 3: full autonomy, CEO executes inline on this thread, escalate only
  at the DOA boundary. Use when: "/l3 <goal>", "L3 <goal>", you want the "全權處理 / get it done"
  behavior as one command without the CEO startup Q&A. Presets involvement=just-results, scope=Hold,
  no-go=none (override -x / --expand). Not for: offloading to a background foreman (→ /l4), hetero
  impl engine (→ /l5), participatory planning (→ dev-flow), research-only (→ survey).
---

# /l3 — CEO autonomy, inline

Terse front-door into `autopilot:ceo-agent` at **Level 3**: the CEO executes the
goal **itself on this thread** and escalates only at the DOA boundary.

## On invocation

1. Invoke `autopilot:ceo-agent` with the four startup questions **pre-filled** (do
   not re-ask on a clean goal):
   - **OKR**: derived from `<goal>` (restate a verifiable end-state if the goal lacks one).
   - **Involvement**: 3 = just-results (full autonomy, notify on done).
   - **Scope mode**: Hold (override: `--expand` → Expand).
   - **No-go zones**: none (override: `-x <csv>`, e.g. `-x payments,auth`).
2. Execution posture: **inline** — no foreman dispatch. This is the `/l3` engine
   (and the `--solo` degradation target for `/l4`/`/l5`).
3. Then follow `ceo-agent` Execution exactly (size → project setup if L → phases →
   finish-flow). The front-door only changes startup; it does not skip any gate.

See [`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
for the full front-door semantics and [`../ceo-agent/SKILL.md`](../ceo-agent/SKILL.md)
for DOA, Prime Directives, and quality gates.
