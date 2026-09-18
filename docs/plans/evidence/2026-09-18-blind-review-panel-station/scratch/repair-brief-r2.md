Engine: sonnet

# Repair round r2 — mission branch `mission/07f86eff432f/panel-review-station-a1`

Work ONLY in the worktree `/tmp/hetero-mission-07f86eff432f-panel-review-station-a1-48yi2l` (HEAD `316c1d4b`).
Use `git -C <worktree>` for every git command; never touch `/home/cookys/projects/autopilot`. Never `git stash`,
never push. Do NOT export AUTOPILOT_SESSION_ID / AUTOPILOT_LEVEL / AUTOPILOT_ROOT_RUN_ID when running suites
(`env -u AUTOPILOT_SESSION_ID bash …` if your shell has it — `mission-runtime-v2.test.sh` fails under that variable).
Commit ONE commit on that branch when the verify list is green. Node built-ins only. After editing `src/` or
`scripts/` run `bash scripts/sync-codex-plugin-skills.sh` then `--check` (exit 0); mirrors go in the same commit.

Allowed files: the sealed list in `docs/plans/2026-09-18-blind-review-panel-station.md` §2.5 (`panel-review-station`)
— nothing else, nothing created.

## Fixes (second-family review findings, adjudicated by depth-0; RED-first where a test is named)

A. **Terminal panel byte-identical to base** (`autopilot-engine.js` `runPanel`): the new `aggregatedVerdict`,
   `success`, `packet_hash`, and the not-reviewed `reason`/`phase` keys must exist ONLY when `stationKind === 'panel'`.
   The terminal branch (`station: 'terminal'`) returns exactly what base `performFinalPanel` returned (verdict
   `'SHIP-AS-IS'` when reviewed, no `success`, no `packet_hash`, no `reason`/`phase`). Test in
   `autopilot-engine.test.sh`: the `single` control case compares the terminal `final_panel` receipt object
   (minus run nonces) against a fixture captured from base `ae7ea5ce` (build it by running the same case at base
   in a scratch checkout — `git -C <worktree> worktree add --detach /tmp/base-ae7 ae7ea5ce` — and paste the
   normalized object), not against another head run.
B. **Single-mode gate identity unchanged** (`campaign-composition.js`): spread `station` into `gateInput` and the
   extra `lastReview` keys (`success`, `station`, `candidate_tree_sha`, `reviewer_roster_digest`, `packet_hash`)
   ONLY when `reviewStation === 'panel'`; in `single` mode `gateInput` and `lastReview` are byte-identical to base
   (a pre-cut `full_diff_review` gate journal must still be reusable on resume). Pin: routing-suite `single` control
   asserts the gate-journal `full_diff_review` input digest equals the base value (capture at base as in A).
C. **Reuse for a one-seat panel** (`campaign-composition.js` `stationPanelReuse`): `final_panel_seat_receipts.length >= 1`.
D. **Reuse needs a real packet identity**: `stationPanelReuse` requires `typeof lastReview.packet_hash === 'string'`
   and 64-hex (`isCanonicalSha256`), never `null`; a station panel without a packet hash is NOT reused (terminal
   dispatches as today). Pin in the routing suite: a station receipt with `packet_hash: null` → terminal fan-out
   runs (count it), no `final_panel_gate_reused`.
E. **Restore the 2-B assertion** in `implementation-campaign-state.test.sh`: put back
   `assert_contains "$BLIND_INTAKE_OUT" "incomplete_roster_no_snapshot=true" …` beside the new `review_station_snapshot=true`.
F. **Below-quorum station test strength** (routing suite `station_below_quorum`): assert the concrete 2-B reason
   (`final_panel_below_minimum` or `final_panel_families_below_minimum` as the fixture produces) and the phase
   (`blocked` at `full_diff_review`, or the durable wait when the fixture is a seat fault) — not just
   `reviewCalls === 0`.
G. **Finding-id qualification across three seats** (`runPanel` merge): track every digest per `finding_id`
   (array of `{seatIndex, digest}`); when ANY two differ, every occurrence is qualified `s<seatIndex>.<id>` (an
   occurrence identical to an already-qualified one is folded into that qualified id, not silently deduped against
   the unqualified key); when all agree keep one unqualified id. Pin: engine case with three seats — A: `dup-1` (x),
   B: `dup-1` (y), C: `dup-1` (x) → merged ids exactly `s0.dup-1`, `s1.dup-1` (C folded into `s0.dup-1`).
H. Cosmetic: `hetero-impl-loop.md` (+ mirror) four stray spaces before "Panel seats".

Refuted (no change): "station panel journals `generation: undefined`" — `reviewPayload` carries `repair_generation`
(`campaign-composition.js:1825`), so `reviewInput.repair_generation` is defined at the station.

## Verify (sequentially, all exit 0; paste the tail of each)
```
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/resolve-review-loop.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
```
Commit first line: `fix(panel-station): terminal panel and single-mode identity byte-identical to base; reuse for one seat with a real packet hash; 2-B assertion restored; below-quorum reason pinned; three-seat id qualification (2-C repair r2)`.
Report: commit sha, `git -C <wt> diff --stat 316c1d4b..HEAD`, RED observations for A/B/D/G, verify tails. If the brief
disagrees with the code, stop and say so.
