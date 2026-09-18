# Implementation brief — panel-review-station (blind review redesign cut 2-C, deliverable 1 of 2)

ONE managed deliverable. The harness commits; never push, never `git stash`, never touch files outside the sealed
`output_paths`, never run a real reviewer model. Base for RED evidence and byte-identity: `ae7ea5ce`.
This campaign ships plan §1.1 ONLY (the panel as the loop's review station). §1.2 (shared packet) is a later
campaign — do not touch `src/runners/*`.

## Read first
1. `docs/plans/2026-09-18-blind-review-panel-station.md` — §0, §1.1 items 1–5 NORMATIVE, §2.1, §2.5 (first list),
   §2.6, §4, §4.1. The plan wins over this brief. Then `.rubric.md` R1–R3, R6–R8.
2. Code named in §0: `campaign-composition.js` `runCampaignComposition` (`full_diff_review` station ~:1822-2004,
   loop adjudication ~:2530-2695, terminal `joint_review`/`final_panel` block ~:2718-2936), `autopilot-engine.js`
   `performReview`, `performFinalPanel`, the adapters at ~:8019 (`review`) and the adjudicate closure ~:8019-8050,
   `campaign-intake.js` `buildQcPanelSnapshot` + snapshot block, `resolve-review-loop.sh`/`.js` field tables,
   `review-loop-contract.schema.json` `x-field-order`/`properties`/`required`.

## Product (plan §1.1 normative)
1. KNOB. Resolver field `in_rail_review` (`auto|single|panel`, default `auto`) in schema (three tables, same cut),
   `resolve-review-loop.sh` (read_field, validation, both printf templates) and `resolve-review-loop.js` (derived from
   schema; oracle parity). `auto` → `panel` iff `qc_panel_seats_complete === true`, else `single`; `panel` with an
   incomplete panel → resolver refusal (fail-closed message names the field). Both review-loop-config documents get
   the row + one comment line.
2. SNAPSHOT. `buildQcPanelSnapshot` adds `review_station: 'panel'|'single'` (digested) from the resolved
   `input.roster.in_rail_review`; the `qc_panel_snapshot` step detail carries `review_station`. A snapshot WITHOUT the
   key (2-B) resolves to `single` and its identity check is unchanged (never re-digested). Intake only ever writes a
   snapshot when the panel is complete (2-B), so `panel` implies a snapshot exists.
3. STATION. In `runCampaignComposition` the `full_diff_review` station reads `campaignControl.qc_panel_snapshot.
   review_station` (never the live roster): `panel` → call a new adapter `reviewPanel(reviewInput)` (wired beside
   `review` in `autopilot-engine.js`; it runs the SAME fan-out `performFinalPanel` uses — factor `performFinalPanel`
   into `runPanel(reviewInput, { station })` used by both) and consume its receipt exactly where the single review's
   receipt is consumed. The receipt keeps the review shape (`reviewed`, `success`, `verdict` = the panel aggregation,
   `findings` = merged findings as the normalized JSON string, `review_digest` = the panel digest, `packet_hash`) PLUS
   the 2-B panel fields (`sealed_min_panel_size`, `final_panel_count`, `final_panel_seat_receipts`,
   `final_panel_quorum_met`, `sealed_required_review_families`, `implementer_family`, `budget_source`,
   `seat_timeout_seconds`). Gate-journal kind stays `full_diff_review`; add `station` to the gate input identity.
   Ledger `full_diff_review` row: `station`, `seat_count`, `budget_source`, `seat_timeout_seconds`.
   Budget: the station panel is budgeted like the terminal panel today — consumer `panel` (wall remainder, else the
   sealed pocket → `budget_source: pocket`; neither → block `final_panel_budget_exhausted` before any seat is
   prepared). `single` keeps consumer `review`. NEVER fall back to a single seat: a panel below quorum blocks with the
   2-B reason (`final_panel_below_minimum` / `final_panel_families_below_minimum` / first failure); when the reason is
   seat faults (no_verdict/transport) park durably as the single-seat `review_no_verdict` path does.
   Finding ids: when two seats report the same `finding_id` with different digests, qualify BOTH as `s<seatIndex>.<id>`;
   identical reports keep one unqualified id (2-A dedupe). `unresolved_findings`/`findings_snapshot` carry the ids as
   written. The loop adjudication then works unchanged: must-fix → `repair_authorized` → the station runs the panel
   again on the repaired candidate; no authority → `awaiting_disposition`.
4. TERMINAL REUSE. In the terminal block, before dispatching `final_panel`, look up the last in-loop panel receipt
   for the same `candidate_tree_sha` + `reviewer_roster_digest` + `packet_hash`; when found, `final_panel` is
   `final_panel_gate_reused` from it (persist the gate result as today, no fan-out); else dispatch as today (pre-cut
   receipts, or a resume that adopted a candidate the station never reviewed). `final_adjudicate` unchanged.
5. `single`/no-snapshot inputs: byte-identical trace, ledger and receipts (pin with a control case).
6. Docs: `references/blind-dispatch.md` "Panel execution" gains "The panel as the review station (2-C)";
   `skills/l5/references/hetero-impl-loop.md` step 9 one sentence; `docs/BACKLOG.md` row "final panel has no repair
   loop" Status → `shipped v2.36.68 2026-09-18`; redesign row Context (≤240 B, measure with `wc -c`) → `packet (tree +
   git diff + spec, deny-list); packet/cleanroom tiers; intake canary; verify-once; parallel seats; quorum + snapshot;
   panel station. Shipped: 1a-A..2-B v2.36.59-66, 2-C station v2.36.68. Open: shared packet.`
7. `sync-codex-plugin-skills.sh` then `--check`. Do NOT touch CHANGELOG.md or version manifests.

## Tests (RED-first, `# RED at base ae7ea5ce: <observed>`; never weaken)
routing (`proof_parity_run` or a sibling scenario): three stub seats at the station, first panel FIX-THEN-SHIP with a
must-fix + acceptance-bound policy → `repair_authorized` → repaired candidate → panel again → converged →
`final_panel_gate_reused`, exactly two fan-outs (count via the injected dispatcher); `single` control byte-identical
trace; below-quorum station → blocked/durable, never a single seat; wall nearly exhausted at the station with a pocket →
completes with `budget_source: pocket`; neither → `final_panel_budget_exhausted`; colliding finding id across two seats →
both qualified, park on them, resume with dispositions keyed by the qualified ids. engine: station panel through the
REAL fan-out path with the 2-A stubs; terminal reuse asserts the terminal `final_panel_count`/receipts equal the
station's. state: snapshot carries `review_station`; a 2-B fixture snapshot without the key resolves to `single` and
passes identity; drift on a flipped live value. resolve-review-loop: field, `auto` rule, refusal, oracle parity.
Save each RED observation as `red-<suite>.txt` text in your final report (depth-0 files it). Run each suite at base
BEFORE edits.

## Verify (§4.1; one at a time, foreground, all exit 0)
```
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/review-packet.test.sh
bash hooks/tests/review-runner.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat ae7ea5ce -- src/runners scripts/lib scripts/dispatch-review.sh scripts/resolve-dispatch.sh  # empty
```

## Sealed output_paths (ONLY files you may change; every `platforms/codex/plugin/...` twin is sealed too — sync, don't hand-edit)
```
src/engine/campaign-composition.js
src/engine/autopilot-engine.js
src/engine/campaign-intake.js
src/engine/resolve-review-loop.js
scripts/resolve-review-loop.sh
schemas/review-loop-contract.schema.json
schemas/implementation-campaign-receipt.schema.json
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-state.test.sh
hooks/tests/resolve-review-loop.test.sh
references/blind-dispatch.md
.claude/review-loop-config.md
project-config-template/review-loop-config.md
skills/l5/references/hetero-impl-loop.md
docs/BACKLOG.md
```
Finish with a clean tree; report RED-at-base messages and suite counts.
