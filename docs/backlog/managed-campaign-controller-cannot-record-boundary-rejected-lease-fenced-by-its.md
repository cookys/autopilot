# Managed-campaign controller cannot record `BOUNDARY_REJECTED` — lease-fenced by its own synthesized stage identity

Source: docs/BACKLOG.md@05f97302492d26112f877bc2a97acb2578aca8df, migrated 2026-09-14

- **Trigger**: any `engine implement-review` campaign whose implementer commit is boundary-rejected (unauthorized output path / diff cap) — reproduced 2026-08-29 (`campaign-v1-3b6a9770…`, replayed through the real reducer).
- **Context**: `src/engine/autopilot-engine.js:6477` writes composition events with `controller-<event>:<gen>` stage identities; `src/engine/implementation-campaign.js:886/738` lease-fences `BOUNDARY_REJECTED` (and `AWAITING_CONVERGENCE`, `:971`) against `live_lease.stage_identity` (`campaign-mutation:0`), so the rejection is unrecordable, the journal strands at `IMPLEMENTING` with a held lease, controller durable state diverges (`boundary_rejected` vs journal `IMPLEMENTING`), and neither `--resume` (`campaign-intake.js:780 campaign_state_lease_open`) nor a repair round nor terminalization is reachable. The terminal path already uses the real lease identity (`:2756`) — do the same for lease-releasing bridge events; regression test: IMPLEMENTING + boundary rejection ⇒ `BOUNDARY_REJECTED`, never `LEASE_FENCED`.
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1-20260829T1804Z campaign attempt 2; debugger replay 2026-08-29.

