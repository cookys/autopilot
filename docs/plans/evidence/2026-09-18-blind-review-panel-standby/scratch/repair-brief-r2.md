Engine: sonnet

# Repair round r2 — mission branch `mission/1077fd40c74c/blind-review-panel-standby-2026-09-18-a1`

Work ONLY in the worktree `/tmp/hetero-mission-1077fd40c74c-blind-review-panel-standby-2026-09-18-a1-f0Opkc`
(branch above, HEAD `3641cbef`). Never touch `/home/cookys/projects/autopilot`. Never `git stash`, never push,
never rebase. Commit on that branch when done (one commit, message below). Node built-ins only.

Allowed files (sealed; nothing else, nothing created):
```
src/engine/autopilot-engine.js            + platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-composition.js        + platforms/codex/plugin/src/engine/campaign-composition.js
src/engine/campaign-intake.js             + platforms/codex/plugin/src/engine/campaign-intake.js
hooks/tests/implementation-campaign-receipt.test.sh
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-state.test.sh
```
Mirrors: after editing `src/engine/*.js` run `bash scripts/sync-codex-plugin-skills.sh` (no `--check`) so the
`platforms/codex/plugin/` copies are byte-identical, then `bash scripts/sync-codex-plugin-skills.sh --check` must exit 0.

## Fixes (adjudicated second-family review findings; every one has a RED-first test where noted)

A. **Validator diversity threshold keys off REVIEWED rows** (`campaign-composition.js` `validateFinalPanelReceipt`,
   currently `const panelRequiresDiversity = receipt.final_panel_seat_receipts.length > 1 || expectedMinimum > 1;`).
   The engine's predicate `terminalPanelCrossFamilySatisfied(panelRoster, reviewedSeats)` uses `seats.length > 1` over
   the reviewed subset, so with `min_panel_size: 1`, two seats and one failure the engine emits
   `final_panel_quorum_met: true` and the validator derives false → `final_panel_quorum_flag_mismatch`.
   Change to `reviewedSeats.length > 1 || expectedMinimum > 1` (move the `reviewedSeats` const above it if needed).
   RED-first case in `hooks/tests/implementation-campaign-receipt.test.sh`: min 1, two seats (different families,
   neither equal to `implementer_family`), one `transport_failed` row with `load_bearing:false`, one reviewed row
   `load_bearing:true`, `final_panel_quorum_met: true`, `final_panel_count: 1` → validator passes. Confirm the case
   FAILS with `final_panel_quorum_flag_mismatch` before the fix and passes after; say so in the commit body.

B. **One family classifier.** `campaign-intake.js` has `modelFamilyOfEngineName` (a copy of the engine's
   `modelFamilyOfEngine`, with a duplicated `(qwen|qoder)` arm). Make `campaign-intake.js` the single home: rename
   its function to `modelFamilyOfEngine`, fold the two qwen arms into ONE `if (/(qwen|qwq|qoder)/.test(normalized)) return 'alibaba';`
   placed where the first arm was, export it from `module.exports`. In `autopilot-engine.js` DELETE the local
   `function modelFamilyOfEngine` (around `:389-400`) and add `modelFamilyOfEngine` to the existing
   `require('./campaign-intake')` destructuring at the top (`:30-34`). Every existing call site keeps the name; grep
   shows no other definition. `autopilot-engine.js` must not gain a circular-import problem: `campaign-intake.js`
   does not require the engine — verify with `node -e "require('./src/engine/autopilot-engine')"`.
   Test in `hooks/tests/autopilot-engine.test.sh`, in the existing `panel-snap-write` case: assert the `final_panel`
   ledger row has NO `roster_drift` key and the result trace contains no `final_panel_roster_drift` entry (an
   undrifted roster must not read as drift).

C. **Gate-reuse branch must not manufacture undefined keys** (`campaign-composition.js` `runCampaignComposition`,
   the `final_panel_gate_reused` branch that now sets `final_panel_quorum_met`, `sealed_required_review_families`,
   `implementer_family` unconditionally from `reusableJ.result`). A gate result persisted before this cut has no such
   keys; spreading them as `undefined` makes `hasOwnProperty` true and the validator returns
   `final_panel_metadata_incomplete` — legacy receipts must keep validating under the unanimity rule. Spread each
   field only when `Object.prototype.hasOwnProperty.call(reusableJ.result, <key>)` (same pattern as the final
   receipt near the end of the function). No new test required if the existing routing/state suites cover the reuse
   path; if a cheap assertion fits an existing reuse case, add it.

D. **Snapshot only a complete roster** (`campaign-intake.js`, the snapshot block guarded by
   `if (qcSeats && qcSeats.length > 0 && contractPath && rawContractDigest)`). Add
   `&& input.roster.qc_panel_seats_complete === true` so an incomplete roster (base engine refuses such a panel) never
   gets a snapshot with a hard-coded `seats_complete: true`; without a snapshot the engine keeps the live-roster
   behaviour. Add an assertion in `hooks/tests/implementation-campaign-state.test.sh` OR `autopilot-engine.test.sh`
   wherever intake with a roster is already driven: with `qc_panel_seats_complete: false` no
   `qc_panel_snapshot.json` is written and no `qc_panel_snapshot` step appears.

E. Cosmetic: `hooks/tests/implementation-campaign-state.test.sh` assertion text "contract validation occupies the
   second intake slot" → "third intake slot" (the expected order now leads with `qc_panel_snapshot`).

## Verify (all must exit 0, run sequentially in the worktree, paste the tail of each in your final report)
```
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
```

Commit message (first line exactly):
`fix(panel): validator diversity over reviewed rows; one family classifier; guarded gate-reuse fields; snapshot only complete rosters (2-B repair r2)`
Body: one line per fix A–E, including the RED→GREEN observation for A and B.

Report: the commit sha, `git diff --stat 3641cbef..HEAD`, and the seven verify tails. Do not run the full test suite.
If anything in the brief is wrong against the code you read, stop and say so instead of improvising.
