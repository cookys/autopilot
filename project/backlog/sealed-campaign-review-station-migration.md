# Sealed-campaign review-station migration

- **Context**: `in_rail_review` (single|panel|auto) is one binary per-campaign choice sealed at intake (`campaign-intake.js:360-367`, digest `:381`). `in_rail_review: single` with a full terminal panel IS supported, set at intake. The gap is only switching an already-sealed campaign's `review_station` in place (e.g. panel to single-per-repair with terminal panel).
- **Design sketch**: a third value such as `panel_terminal` would run `review` per repair barrier (`campaign-composition.js:717`, `:2111-2120`) and keep `finalPanel` full. It must keep the sealed roster digest, implementer-family decorrelation, repair cap and gate charging, a distinct station tag in the gate input (`:2030`), and legacy snapshots unchanged.
- **Also**: `auto` resolves to panel whenever `qc_panel_seats_complete`; this surprised the peer and is documented in `skills/l5/references/hetero-impl-loop.md`.
- **Source**: peer-reported cuda/chatgpt-tunnel 2026-10-03; report `docs/plans/research/2026-10-03-repair-review-cadence-query.md`.
