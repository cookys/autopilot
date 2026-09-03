# Qualification feed: adopt `--from`, effort in the seat, environment ≠ exam identity

**Plan**: [`docs/plans/2026-09-02-qualification-feed-adopt.md`](../../plans/2026-09-02-qualification-feed-adopt.md)
**Started**: 2026-09-02
**Branch**: `feat/qualification-feed-adopt`
**Status**: all six phases shipped — v2.35.9

Handed off from the llm-playground session on `cookys-7840hs` (plan pushed as `8a177cf0`);
authorized by the operator in this session. Report back to instance
`01M1G0G3C35PY9AQNC5HQDJ1MB` with the commit sha.

## Phases

| # | Phase | Size | Status |
|---|-------|------|--------|
| 1 | `effort` joins the seat identity | M | ✅ `95c115bb` — and the real find was that `strike-seat`/`invalidate-strike` needed `--effort` too, or no strike could ever be counted against an effort-partitioned seat |
| 2 | Exam identity vs environment | M | ✅ `85e17494` — derived on the fly, no migration, no new stored field (the evidence body is hashed whole) |
| 3 | `seat.effort` in the shipped artifact + schema + `--check` green | M | ✅ (landed with Phase 1: the artifact's `seat_hash` had to move in lockstep; recipe_version 2026-08-23 → 2026-09-02) |
| 4 | `list\|adopt --from <url\|path>` + `--priors` + optional config key | L | ✅ `186dd428` |
| 5 | Test-isolation guard + the polluting test | M | ✅ `5f6d6870` — found a SECOND, larger, still-active instance here |
| 6 | Docs wiring (4 places), release | S | ✅ v2.35.9 |

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

## What the work turned up that the plan did not predict

- **`strike-seat` could not name an effort.** Adding effort to the seat without adding it to the
  strike-writing CLI would have made every strike against an effort-partitioned seat unrecordable —
  written to the legacy hash, read from the effort one. Found by a fixture that went red for the
  right reason, not by reading the plan.
- **A second, larger, still-active store-pollution instance on this host.** 356 of 404 rows in the
  real `qualification-evidence.jsonl`, from `qualify-scorecard-vocabulary.test.sh`, two more per
  suite run. A static grep for the store env vars did NOT find it — that file never names them. The
  suite-level guard found it on its first run, which is the argument for the guard existing.
  Operator authorized the cleanup; removed after verifying no scorecard row anchored to any deleted
  evidence event_id.
- **The live feed advertises a pre-effort `seat_hash`.** Reported precisely (naming the three-field
  basis we can reproduce) rather than as a vague disagreement; the producer accepted option (A) and
  is adding `effort` to `strikes[]`.
- **The live feed's advertised `digest` does not match a sha256 of its bytes.** Five plausible bases
  were tried and none reproduce it. Reported to the producer as a fact; harmless here because the
  cache key and the recorded provenance are always our own hash.
