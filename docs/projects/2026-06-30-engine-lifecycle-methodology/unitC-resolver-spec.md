# Build task: extend scripts/resolve-review-loop.sh (scorecard validation + fallback ladder)

Read docs/plans/2026-06-30-hetero-engine-lifecycle-methodology.md § "Stage 3 — Roster + routing" for the exact fail-closed semantics. Modify ONLY
scripts/resolve-review-loop.sh + its existing test (add cases). Preserve ALL current behavior/fields (byte-compatible default output).

## GOAL
Teach the resolver to consult scripts/engine-scorecard.js for the pinned reviewer engine and fail closed if unqualified.

## NEW BEHAVIOR (additive, behind a flag so default output is unchanged)
- New flag `--check-scorecard`: when set, after resolving reviewer_engine + reviewer_runner, call
  `node scripts/engine-scorecard.js current --role reviewer` and find the row matching (engine,runner).
  * status "qualified"  => proceed; ADD field "reviewer_qualified": true and "fallback_ladder": <output of `engine-scorecard.js ladder --role reviewer`>.
  * status "failed"/"expired"/absent => FAIL-CLOSED: ADD "reviewer_qualified": false, still emit "fallback_ladder",
    and with `--enforce` exit 3 (mirror the existing --enforce hard-gate pattern already in this script); without --enforce, exit 0 (data mode) but reviewer_qualified:false.
- WITHOUT --check-scorecard: output is BYTE-IDENTICAL to today (no new fields). This is the compatibility invariant.

## ACCEPTANCE (add to the existing test)
1. No --check-scorecard => output unchanged (diff against current behavior = empty).
2. --check-scorecard with a qualified reviewer row in a temp ENGINE_SCORECARD_DIR => reviewer_qualified:true + fallback_ladder present.
3. --check-scorecard with NO matching row => reviewer_qualified:false; +--enforce => exit 3; without => exit 0.
4. fallback_ladder is the engine-scorecard.js ladder output (an array).

## BOUNDARIES
Reuse engine-scorecard.js (don't reimplement). ENGINE_SCORECARD_DIR overridable for tests. Keep config-resolution order intact. Don't break any existing assertion.
