# Implementation brief — blind-review-panel-standby-2026-09-18 (cut 2-B)

ONE managed deliverable. The harness commits; never push, never `git stash`, never touch files outside the
sealed `output_paths`, never run a real reviewer model. Base for RED evidence and byte-identity: `<BASE>`.

## Read first
1. `docs/plans/2026-09-18-blind-review-panel-standby.md` — §0 (all anchors), §1 items 1–2 NORMATIVE, §2, §2.5,
   §2.6, §4, §4.1. The plan wins over this brief. Then `.rubric.md` R1–R8.
2. Code named in §0: `autopilot-engine.js` `performFinalPanel` (seat sourcing, `allReviewed`, `panelReviewed`,
   `finalPanelSeatReceipt`, `terminalPanelCrossFamilySatisfied`), `campaign-composition.js` `validateFinalPanelReceipt`,
   `campaign-intake.js` qc seat block + admitted result, `implementation-campaign-receipt.schema.json` finalPanelSeat +
   terminal object. Tests named in §0/§2.

## Product (plan §1 normative)
1. QUORUM. In `performFinalPanel`: `reviewedCount >= min_panel_size` AND cross-family predicate over the REVIEWED
   seats (reuse `terminalPanelCrossFamilySatisfied` on the reviewed subset; failure → `final_panel_families_below_minimum`)
   AND findings consistent AND packet hash one value over REVIEWED outcomes ⇒ `reviewed`. The pre-dispatch
   cross-family check over all seats stays. Every dispatched seat keeps its receipt row; add `load_bearing` to each row
   (quorum met: reviewed ⇒ true, failed ⇒ false; quorum not met: all true, first failure is the reason as today).
   Terminal object adds `final_panel_quorum_met` (boolean), `sealed_required_review_families` (int), `implementer_family`
   (string). `final_panel_count` stays = reviewed seats.
2. VALIDATOR (`validateFinalPanelReceipt`): when the terminal object carries `final_panel_quorum_met`, RE-DERIVE
   `quorum_met_derived` from rows + sealed fields (count ≥ min ∧ families(reviewed rows) ≥ max(2, sealed_required)
   when >1 seat ∧ some reviewed family ≠ implementer_family); flag ≠ derived → `final_panel_quorum_flag_mismatch`;
   `firstFailure` blocks only when derived is false; `load_bearing` pattern checked row by row (else
   `final_panel_metadata_incomplete`); packet-hash all-or-none/one-value over REVIEWED rows only. Without the flag
   (legacy receipt): today's unanimity rule, byte-identical.
3. SCHEMA: the four new fields OPTIONAL (`additionalProperties:false` stays; no new status values). Mirror.
4. SNAPSHOT. `campaign-intake.js`: after qualification admits the seats, write `qc_panel_snapshot.json` beside the
   sealed contract (dir of `contractPath`) with `O_EXCL` — `{ schema_version:1, campaign_id, contract_digest, seats:
   [admitted seat objects in order], seats_complete:true, min_panel_size, required_review_families, implementer_family,
   digest }` (digest = canonical over everything but `digest`). If the file exists (resume): read it, require
   `campaign_id`/`contract_digest` equal to the sealed ones (else reject `qc_panel_snapshot_identity_invalid` before
   any claim/spend), NEVER rewrite; if the live roster's seats/minimum digest differs record
   `step('qc_panel_snapshot','ready',{ digest, seat_count, path, live_drift:<live digest> })`, else the step without
   `live_drift`. Put the parsed snapshot on the admitted result as `qc_panel_snapshot` (beside `steps`).
   `performFinalPanel`: when `campaignControl.qc_panel_snapshot` is present take seats/seats_complete/min/families/
   implementer_family from it, do NOT re-run `finalPanelSeatQualified` against the live roster (intake's decision is
   sealed); if the live roster differs push trace `final_panel_roster_drift` (both digests) and set
   `roster_drift:true` on the `final_panel` ledger row. No snapshot ⇒ live roster, byte-identical.
5. `sync-codex-plugin-skills.sh` then `--check`.

## Tests (RED-first, `# RED at base <BASE>: <observed>`; never weaken)
qc-panel-honesty: min 3 + 4 seats + one transport_failed → ready, count 3, quorum true, that row load_bearing:false;
min 3 + 3 seats + one failed → blocked with that reason; min 3 + 4 seats where the only second-family seat failed →
final_panel_families_below_minimum. receipt: engine-produced receipt carries the four fields; flag mismatch →
final_panel_quorum_flag_mismatch; failed row load_bearing:true while quorum met → metadata incomplete; legacy receipt
(no flag) validates under unanimity; packet-hash rule ignores failed rows. engine: stub 4-seat panel, one stub seat
returns a transport failure → panel reviewed, final_panel row count 3; snapshot: first intake writes the file (second
write attempt refused), resume with a roster that swaps C for D → live_drift step, panel dispatches A,B,C, trace
final_panel_roster_drift, row roster_drift:true; contract_digest mismatch → blocked before spend; no snapshot → live
roster byte-identical. routing: `proof_parity_run` gains a standby scenario (4 seats, one no_verdict → ready) and asserts
the qc_panel_snapshot step. state: snapshot step shape. Run each suite at base BEFORE edits.

## Docs
`references/blind-dispatch.md` Panel execution: add "Quorum and standby" + "Snapshot at intake" (mirror);
`.claude/review-loop-config.md` and `project-config-template/review-loop-config.md` `min_panel_size` row: "list one
more seat than the minimum to get a standby" (template mirror); `skills/l5/references/hetero-impl-loop.md` step 6b one
sentence (mirror); `docs/BACKLOG.md` redesign row Context EXACTLY `packet (tree + git diff + spec, deny-list);
packet/cleanroom tiers; intake canary; verify-once; parallel seats. Shipped: 1a-A..1c v2.36.59-64, 2-A v2.36.65, 2-B
v2.36.66. Open: 2-C (in-rail off, panel repair, shared packet).` (224 bytes; Status `open`). Do NOT touch
CHANGELOG.md or version manifests.

## Verify (§4.1; one at a time, foreground, all exit 0)
```
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/status-task.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat <BASE> -- src/runners scripts/lib scripts/dispatch-review.sh scripts/resolve-review-loop.sh src/engine/resolve-review-loop.js  # empty
```

## Sealed output_paths (ONLY files you may change; every `platforms/codex/plugin/...` twin is sealed too — sync, don't hand-edit)
```
src/engine/autopilot-engine.js
src/engine/campaign-composition.js
src/engine/campaign-intake.js
schemas/implementation-campaign-receipt.schema.json
hooks/tests/qc-panel-honesty.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-state.test.sh
references/blind-dispatch.md
.claude/review-loop-config.md
project-config-template/review-loop-config.md
skills/l5/references/hetero-impl-loop.md
docs/BACKLOG.md
```
Finish with a clean tree; report RED-at-base messages and suite counts.
