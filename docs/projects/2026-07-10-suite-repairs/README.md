# Suite Repairs (2026-07-10) — /l6 workstreams B + C

**Status**: in progress (depth-1 foreman, /l6 B+C).
**Base**: v2.32.16 `8639587`.

## OKR

Bring the pre-existing full-suite failures green and confirm `dispatch-author.sh --endpoint`
parity — without deleting/weakening any test.

## Findings summary

- **Unit B** (`dispatch-author.sh --endpoint`): already shipped + tested at base
  (`2a5d7fa`, `feat/eb-w2`). `dispatch-author.test.sh` 65 assertions green. No work.
- **Unit C** (pre-existing suite failures): 3 of the 4 named files already green on
  develop (BACKLOG stale). Only `contract-parity.test.sh` red (11 assertions) — one
  root cause: JS twin `src/engine/resolve-review-loop.js` missing the
  `on_engine_unavailable` field the shell resolver emits. PRODUCTION-side twin-sync fix.

See [`repro.md`](repro.md) for the reproduction detail.

## Ledger

Tracked in the foreman's completion report (dispatched engine outcomes verified by git artifacts).
