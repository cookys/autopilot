# Suite Repairs (2026-07-10) — /l6 workstreams B + C

**Status**: Complete — merged to develop; scoped repairs and integrity gate verified.
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

## Outcome

### Unit C fix — `contract-parity.test.sh` (PRODUCTION-side, JS twin sync)

`c443eec` (grok-4.5 impl `e4456d6`, gpt-5.5 review SHIP-AS-IS): added `on_engine_unavailable`
to `REVIEW_LOOP_FIELDS` + a value-level `assertOneOf(... ['ask','solo-fallback','wait-reset'])`
in `src/engine/resolve-review-loop.js`. Codex plugin payload mirror synced. contract-parity
17/11 → 28/0.

### Regression discovered + fixed — `autopilot-engine.test.sh` + `review-loop-runner.test.sh`

The twin-sync made `on_engine_unavailable` a REQUIRED field (consistent with the shell always
emitting it, exactly like `min_panel_size`). Two test files carried inline config fixtures that
predate the field, so they regressed (base: both GREEN → post-fix: both RED, "missing field:
on_engine_unavailable"). This is a stale-fixture freshness issue, not a production defect.

`e0a3c60` (grok-4.5 impl `b47fe1d`, gpt-5.5 review SHIP-AS-IS): additive fixture refresh —
`on_engine_unavailable: 'ask'` after each `min_panel_size` line (1 in autopilot-engine.test.sh,
7 in review-loop-runner.test.sh). No assertion deleted/weakened/skipped. Both back to base
assertion counts (320 / 35).

### Full-suite result

Known base failures (verified per-file at `8639587`): `contract-parity` (17/11) +
`resolve-endpoint` (55/1). Final HEAD umbrella suite (119 files): **only
`resolve-endpoint.test.sh` fails** — PRE-EXISTING (identical 55/1 at base, unrelated to this
scope: a GLM token-env fail-closed assertion), NOT one of the four named files. Net:
contract-parity fixed, autopilot-engine + review-loop-runner regressions (introduced then
repaired within this run) green, zero net-new failures.

The other three originally-named files (`autopilot-cli`, `review-runner`,
`intent-capture-basic-write`) were already GREEN at base — the v2.31.10 PRE_EXISTING
classification had been fixed on develop; no work needed.

### Anti-gaming gate

`check-test-integrity validate --range 8639587..HEAD`: ok=true, violations=[], surface_touches=[],
L1=ok (executed test set did not shrink). No deletions, skips, or `.only` markers.
