# Rubric — 2026-09-15-final-panel-per-seat-pins.md

> Source plan: docs/plans/_archive/2026-09-15-final-panel-per-seat-pins.md

R1: `engine-capability-state.js pin-seat --role qc_panel` keeps one row per engine+runner+endpoint (two different engines → two rows; same tuple twice → one row with the second reason); every other role keeps exactly one row per role (replacement unchanged).
R2: `unpin-seat --role qc_panel --engine X --runner Y [--endpoint E]` removes exactly that row; without a selector it removes all qc_panel rows and reports the count; a selector on any other role exits non-zero naming the rule.
R3: `resolve-review-loop.sh` looks up override file and standing pins for every `qc_panel[N]` seat and records an admission in `override_admitted_seats` as the exact index-bearing string `qc_panel[N]`.
R4: A `qc_panel[N]` seat with no override/pin is NOT refused by the resolver (exit 0, stderr note); the existing `UNQUALIFIED_RUNNERS` refusal (exit 3) is unchanged; the pin lookup uses the caller-scoped store only (isolated `--store` in tests, never the host store).
R5: `finalPanelSeatQualified(roster, seat, index)` lives in one module (`src/engine/final-panel-qualification.js`) imported by both the engine's final panel and campaign intake; it admits incumbent, exact `fallback_ladder` tuple, or `override_admitted_seats` containing exactly `qc_panel[<index>]` — `qc_panel` alone, a different index, or an absent key admits nothing by that path.
R6: `runCampaignIntake` evaluates every `qc_panel_seats[i]` with that function BEFORE the Mission claim adapter; any failing seat yields `status:'blocked'`, `rejection.code:'final_panel_seat_unqualified'`, `pre_spend_no_effect_receipt:null`, the claim adapter is never called, and the message names each failing seat as `qc_panel[i] engine/runner@endpoint` plus the `pin-seat` remedy.
R7: A roster whose panel seats are all admitted proceeds to the claim exactly as before (happy path preserved); a roster without `override_admitted_seats` still validates.
R8: Every change-pinning assertion is recorded red against the base sha in the test header; preservation guards are labelled as such and green at base.
R9: `dispatch-contract.js` and `resolve-dispatch-topology.js --resolve-live` behaviour is byte-identical (their suites pass unchanged); the pin store row shape (eight keys, `expires: null`) is unchanged.
R10: `references/hetero-dispatch.md` (≤ 600 B added) states the three admission paths, the `pin-seat --role qc_panel` command, and that intake refuses pre-spend; `skills/l5/references/hetero-impl-loop.md` gains the pre-`mission prepare` pin check bullet; `docs/scripts-inventory.md` row updated.
R11: No file outside the sealed `output_paths` changes; codex mirrors of every touched `scripts/**`, `src/**`, `references/**` file are byte-identical (`sync-codex-plugin-skills.sh --check`); `check-js-syntax.js`, `check-reference-sizes.js`, `check-claude-md-inventory.js` clean.
