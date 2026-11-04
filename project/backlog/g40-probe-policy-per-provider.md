# G40 probe policy per provider (build) (BL-0375)

Build the per-provider probe policy recorded in [the plan's amendment of 2026-11-04](../plans/2026-11-03-g40-agent-lane-quota.md) (operator decision d-2d6a93aa, relayed by the PM). It runs on the P4 probe path, which is still gated off, and is ordered after BL-0372 Tasks 0-3.

Scope:
- The adapter manifest gains a confidence field (provisional name `starts_window_confidence: low|medium|high`; the build round settles the name).
- `starts_window = false` with `high` confidence and an evidence path enables a periodic probe, about every 30 minutes, only when the alias has no newer observation.
- Every other case (`true`, `unknown`, `false` below `high`) probes only on demand, just before pick, when the data is stale.
- New evidence flips the setting through the manifest, with no new operator decision.
- Residual accepted by the PM (minor): an on-demand probe may start a window and `pick` then refuse the alias.

Red-light cases (each must be shown red before green):
- A provider with `starts_window` `unknown` or `true` must never be placed on the periodic probe schedule.
- A provider with `starts_window = false` and confidence below `high` (or no evidence) must probe only on demand.
- `false` + `high` without an evidence path fails the manifest checker.

Source: operator decision d-2d6a93aa (via the PM), 2026-11-04.
