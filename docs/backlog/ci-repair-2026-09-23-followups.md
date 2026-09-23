# CI repair 2026-09-23 — follow-ups surfaced while fixing 34 red tests

Context: GitHub CI on `develop` had been red for days at its first step (Detached dispatch ledger smoke),
so the full suite never ran and 32 L2 + 2 L1 tests broke unseen. The repair (merge `afd30094`) split the
work into four clusters (dispatch / qualify / reviewloop / mission); each agent root-caused its tests and
listed design doubts it deliberately did NOT act on. Those are recorded here; the BACKLOG rows point here.

## 1. CI runs only on version bumps
`.github/workflows/test.yml` triggers on `push` to develop/main **only** when `.claude-plugin/plugin.json`
changes (release-gated, deliberate per its header comment). Ordinary pushes never run the suite, so 34
tests rotted between releases. The same repair made later steps `if: !cancelled()` so a red smoke no
longer hides the suite — but that only helps once CI runs at all. Option: a develop-triggered cheap job
(`bash hooks/tests/run.sh dispatch-detach` + `bash scripts/sync-all.sh --check`), full suite still
release-gated. Owner decision (CI minutes vs coverage).

## 2. `auto` consult seat overrides a declared consult seat
`5679a392` (2026-09-04, hetero-loops plan Knob transition table) made `consult_dispatch` default `auto`,
under which topology / sonnet fallback replaces a declared `consult_engine`. Plan chair was switched to
"declared wins" on 2026-09-13; consult was not. Tests (`resolve-review-loop-role-admission`) now pin
`consult_dispatch: off` where they mean "declared seat". Resolver untouched — needs an owner ruling.

## 3. Archive rewriter still rewrites unsealed frozen evidence
`scripts/check-plan-graduation.js` `frozenAssetFiles()` now skips `*.seal.json` targets, the seals,
`lib/qualification-asset-seals.js` PATHS and every `docs/mission-*-sources.json` plan/rubric (and reports
`plan_reference_frozen`). Evidence that is frozen only by convention has no marker: `6559da33` rewrote the
historical `observed_paths` in `docs/projects/_archive/2026/07/2026-07-26-mission-convergence-portfolio/
candidate-path-audit.json` (restored byte-identical by the mission cluster). Needs an explicit frozen
marker (e.g. a seal) rather than a path heuristic.

## 4. dispatch-author forwards qc_panel admission notes
`fa2a0c50` made `resolve-review-loop.sh` print one `⚠ qc_panel[N] … has no recorded operator admission`
line per unpinned final-panel seat. `dispatch-author.sh` calls the resolver on every strict run, so every
author dispatch prints three panel-intake notes that are irrelevant to the author role. Tests now parse
JSON from stdout only (no breakage). Product call: suppress for author rails or keep.

## 5. "park does not consume finding recurrence" has no test
`620ef6ed` (per the pathless-finding BACKLOG spec) falls back task_surface → round changed files → park.
That park does not increment the finding occurrence count is guaranteed only by statement order in
`src/engine/autopilot-engine.js`. Add a probe to `hooks/tests/implementation-campaign-state.test.sh`
where both fallbacks are empty and assert the count is unchanged after park.
