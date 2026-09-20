# Implementer ladder (unit_class start, red repair climb)

Status: implemented on `feat/implementer-ladder` (not merged).

## Background

revival.3d cost split: implementer work should use the cheapest engine that is sufficient for the
unit's determinacy. Repair that stays red climbs one rung. Today the roster has a single
`implementer_engine` and repair re-dispatches the same tuple.

Source: `docs/BACKLOG.md` 2026-08-28 foreman cost item 2.

## Spec

1. Optional `implementer_ladder` in `.claude/review-loop-config.md`: comma list of
   `engine/effort@runner`. Missing field ⇒ `implementer_ladder: []` and the three existing
   implementer fields are the single implicit rung. Each runner is validated against the existing
   `implementer_runner` enum. Resolver JSON includes `implementer_ladder` on both printf paths.
2. Optional campaign contract `unit_class: mechanical | judgment` (default `judgment`).
   Mechanical starts at rung 0; judgment starts at rung 1; a one-rung ladder uses that rung for both.
3. Repair generation `r` (0-based) uses `min(start + r, top)`. Top + still red uses existing
   convergence adjudication. No new campaign state. Dispatch ledger records the actual tuple and
   `implementer_ladder_rung`.
4. `on_engine_unavailable` is unchanged (availability axis).

## Tests

- `scripts/implementer-ladder.test.js`: resolver parse + invalid runner reject + absent = `[]`;
  rung selection (mechanical r0/r1/r2, judgment, single rung); planted negative that empty ladder
  dispatch argv equals the pre-ladder three-field tuple.
- Run: `node --test scripts/`

## Out of scope

- Foreman polling / Workflow conversion (backlog item 1).
- Changing revival.3d's live `review-loop-config.md`.
