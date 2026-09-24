# B1 review-loop-resolver-a — foreman REPORT

Clone: `.../scratchpad/b1/clone` (BASE_SHA `56189ee6`, carries the clone-local shadow commit only — never landed).
All 7 rows executed in plan order P1..P7. One repair round (54-r2) was needed for row 7's codex-mirror drift.

## Per-row results

### LAND 23 — hands/b1/23 @ 789c7f6a
`probe-unknown.js classify` spawns `resolve-review-loop.sh` up to seven times per call.
- Diff: `hooks/tests/review-loop-resolver-a.test.sh` (+50, new file), `scripts/probe-unknown.js` (+30), `platforms/codex/plugin/scripts/probe-unknown.js` (+30). 3 files, 110 insertions, 0 deletions.
- RED: base spawned 7x for a full classify call; fix memoizes one no-`--field` resolver snapshot, falling back to per-field spawn only on snapshot failure/missing key.
- Review: SHIP-AS-IS (2 CUT/FOLLOW-UP, no MUST-FIX).

### LAND 36 — hands/b1/36 @ 09a47301
resolve-review-loop.sh: audit every remaining runner comparison for codex-cli/codex canonicalisation.
- Diff: `scripts/resolve-review-loop.sh` (+17/-5), codex mirror (+17/-5), test suite append (+28). 3 files, 50 insertions, 12 deletions.
- RED: a scorecard row recorded as "codex-cli" failed to match a query passed as "codex" (and vice versa) in the engine-scorecard tier lookup, the --check-scorecard admissibility check, and the override/pin matchers.
- Review: SHIP-AS-IS (2 CUT/FOLLOW-UP, no MUST-FIX).

### LAND 41 — hands/b1/41 @ 2678cf10
resolve-review-loop.test.sh capability-warning assertion messages still say "no warning" while expecting the topology fallback lines.
- Diff: `hooks/tests/resolve-review-loop.test.sh` (wording only, +7/-7), test suite append (+10). 2 files, 17 insertions, 7 deletions.
- RED: stale "no warning"/"no operational capability warning" description strings still present alongside assert_eq values that are the three-line fallback-warnings array; reworded to accurately describe the populated array.
- Review: SHIP-AS-IS (2 CUT/FOLLOW-UP, no MUST-FIX).

### LAND 42 — hands/b1/42 @ e4c3e1dc
`normalize_agy_alias()` rewrites config-side seat names before the qc-exclusion match in `consult_dispatch: auto`.
- Diff: `scripts/resolve-review-loop.sh` (+4/-4), codex mirror (+4/-4), test suite append (+51). 3 files, 57 insertions, 4 deletions.
- RED: a qc_panel seat recorded under an alias (e.g. "gemini-flash") was wrongly re-admitted as the consult seat because the ladder-side engine name (topology) was never canonicalized to match the already-normalized config-side exclusion set; added engine-alias normalization on both sides.
- Review: SHIP-AS-IS (2 CUT/FOLLOW-UP, no MUST-FIX).

### LAND 43 — hands/b1/43 @ 65527b86
`resolve-review-loop.sh` `auto` knobs read a stale `~/.autopilot/topology.json` and fall back natively.
- Diff: `scripts/resolve-review-loop.sh` (+30/-8), codex mirror (+30/-8), test suite append (+33). 3 files, 101 insertions, 8 deletions.
- RED: a cached topology missing a role's ladder key entirely (vs. genuinely empty) produced the same generic "no qualified seat" warning as a real empty ladder; added a distinct diagnostic naming the missing key and pointing at `resolve-dispatch-topology.js`, for plan_review/hetero_review/consult_dispatch.
- Review: SHIP-AS-IS (2 CUT/FOLLOW-UP, no MUST-FIX).

### LAND 44 — hands/b1/44 @ 28b25cb8
`contract-parity` / `resolve-review-loop-consult-discuss-switch` tests read the real `~/.autopilot/topology.json`.
- Diff: `hooks/tests/contract-parity.test.sh` (+4), test suite append (+12). 2 files, 16 insertions, 0 deletions.
- RED: contract-parity.test.sh never pinned `AUTOPILOT_TOPOLOGY_FILE`, so its auto-resolved fields depended on host state; ported the switch test's hermetic pin (a guaranteed-absent path) to the top of the file.
- Review: SHIP-AS-IS (1 CUT/FOLLOW-UP, no MUST-FIX). Re-verified contract-parity.test.sh still passes end to end post-change.

### LAND 54 — hands/b1/54 @ 82e9dc04, repaired at hands/b1/54-r2 @ 05f4f20e
`resolve-review-loop-consult-discuss-gate` case (xix) mutates the canonical evals corpus.
- Diff (54): `scripts/lib/qualification-applicability-scope.js` (+13/-1), `hooks/tests/resolve-review-loop-consult-discuss-gate.test.sh` case (xix) only (+12/-6), test suite append (+41). 3 files, 61 insertions, 8 deletions.
- RED: case (xix) chmod-000'd the real tracked `evals/consult-capability-evidence-corpus.json` file for the duration of two script runs, a flakiness hazard for any concurrent pooled test needing that corpus; added per-role env-var overrides (`AUTOPILOT_CONSULT_CORPUS_FILE` / `AUTOPILOT_DISCUSS_CORPUS_FILE`) so the applicability-scope manifest path can be redirected, then repointed case (xix) at a scratch copy under `$TEST_TMP` instead of the tracked file. Tracked file's mode/content verified unaffected by the run.
- Review (54): SHIP-AS-IS (2 CUT/FOLLOW-UP, no MUST-FIX).
- Repair round r2: the final aggregate `sync-codex-plugin-skills.sh --check` caught that row 54's hand had not regenerated the codex mirror for `scripts/lib/qualification-applicability-scope.js`. Dispatched one repair hand on `hands/b1/54-r2` (base = `hands/b1/54`) that regenerated only `platforms/codex/plugin/scripts/lib/qualification-applicability-scope.js` via the sync script — no other file touched.
- Review (54-r2): SHIP-AS-IS ("none" findings, no MUST-FIX).

## Accepted-heads stack (final)
```
23  hands/b1/23     789c7f6a
36  hands/b1/36     09a47301
41  hands/b1/41     2678cf10
42  hands/b1/42     e4c3e1dc
43  hands/b1/43     65527b86
44  hands/b1/44     28b25cb8
54  hands/b1/54-r2  05f4f20e   (r2 repair: codex mirror sync)
```
Final head for depth-0 cherry-pick purposes: `hands/b1/54-r2` @ `05f4f20e`.

## Aggregate verify (throwaway worktree at 05f4f20e, solo runs, env-prefixed, `< /dev/null`)

| Check | rc |
|---|---|
| hooks/tests/review-loop-resolver-a.test.sh (11 assertions) | 0 |
| hooks/tests/resolve-review-loop.test.sh (441 assertions) | 0 |
| hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh (59 assertions) | 0 |
| hooks/tests/contract-parity.test.sh (42 assertions) | 0 |
| hooks/tests/resolve-review-loop-consult-discuss-gate.test.sh (65 assertions) | 0 |
| hooks/tests/probe-unknown.test.sh (76 assertions) | 0 |
| node scripts/check-js-syntax.js (682 files) | 0 |
| bash scripts/sync-codex-plugin-skills.sh --check | 0 |

All green. Worktree removed after verification. No CHANGELOG/version/BACKLOG edit, no merge, no push performed.
