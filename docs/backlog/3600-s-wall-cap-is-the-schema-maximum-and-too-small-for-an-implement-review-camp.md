# 3600 s wall cap is the schema maximum and too small for an implement+review campaign on a real deliverable — SHIPPED in U3 (branch `u3-wallcap-20260831`), ceiling 14400 by CEO decision 2026-08-31

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: any deliverable whose implementer alone needs > ~40 min (D1–D3, D4, D5 all did: 42–55 min grok-4.5 runs), leaving no wall for the review round.
- **Context**: `schemas/mission-execution-graph.schema.json` caps `campaign.max_wall_seconds` at 3600 and `max_engine_attempts` at 3. Either raise the schema ceiling (with governance `max_wall_seconds` still the aggregate bound) or make the wall cover implementation only and give review rounds their own budget. Until then every real campaign closes through the depth-0 salvage path.
- **Effort**: S (schema + one test) — but a governance decision.
- **Source**: phases 1–2, 2026-08-29/30.

