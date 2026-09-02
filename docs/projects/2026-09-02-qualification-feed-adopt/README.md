# Qualification feed: adopt `--from`, effort in the seat, environment ≠ exam identity

**Plan**: [`docs/plans/2026-09-02-qualification-feed-adopt.md`](../../plans/2026-09-02-qualification-feed-adopt.md)
**Started**: 2026-09-02
**Branch**: `feat/qualification-feed-adopt`
**Status**: Phase 1 — in progress

Handed off from the llm-playground session on `cookys-7840hs` (plan pushed as `8a177cf0`);
authorized by the operator in this session. Report back to instance
`01M1G0G3C35PY9AQNC5HQDJ1MB` with the commit sha.

## Phases

| # | Phase | Size | Status |
|---|-------|------|--------|
| 1 | `effort` joins the seat identity — scorecard identity, `seatIdentityHash`, the `engine-capability-state.js seat-hash` mirror, seat-status/strike surfaces | M | in progress |
| 2 | Exam identity vs environment — `harness_version`/`runner_version` become recorded-and-warned, never gating | M | not started |
| 3 | Feed artifact: additive fields + schema + `build-qualification-defaults --check` green | M | not started |
| 4 | `adopt-qualification-defaults.js list\|adopt --from <url\|path>` + `--priors` + optional config key | L | not started |
| 5 | Test-isolation guard + fix the test that wrote into the real store | M | not started |
| 6 | Docs wiring (4 places), release | S | not started |

## Non-negotiables carried from the plan

- **No calendar gate.** Revocation is strikes / model_version change / new corpus-or-prompt
  contract. Expiry stays advisory (`expiry_warning`), matching `engine-scorecard.js` today.
- **No signing/attestation** — ADR-0001.
- **Never auto-adopt**, never on a timer.
- Legacy rows without `effort` keep matching as their own partition. Extending
  `current --effort`'s existing "omit only for legacy rows" semantics, not inventing a second rule.

## Hazards specific to this change (verified in-tree before touching anything)

- `evidence_hash`/`evidence_id` is `sha256(canonicalJson(body))` over the WHOLE evidence body
  (`src/engine/capability-evidence.js:1636`). **Adding any field to that body invalidates every
  recorded evidence row.** The exam-vs-environment split must therefore derive its hash on the fly
  from the already-present `identity` object, never by adding a stored field.
- `seatIdentityHash(engine, runner, role)` (`engine-scorecard.js:1610`) is duplicated by
  `engine-capability-state.js`'s `seat-hash`, deliberately, from "the identical two-line algorithm".
  A mismatch silently orphans every strike from its projection. Effort must therefore enter the hash
  **only when present**, so every existing 3-field hash stays byte-identical.
