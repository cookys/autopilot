> Status: research, not a plan; nothing built. Date: 2026-10-03.
> Source: autopilot maintenance session (fable depth-0), run3 closeout; original at session scratchpad research/peer-repair-review-cadence.md.

# Repair-round review cadence (read-only investigation, develop v2.36.112+)

## 1. Supported route? YES, but contract-time only (not for the already-sealed campaign)
Knob: `in_rail_review: single` in review-loop-config (template project-config-template/review-loop-config.md:64-65,
doc row :198; resolver src/engine/resolve-review-loop.js:97,156, scripts/resolve-review-loop.sh:636,1312).
- `single` => resolveReviewStation (src/engine/campaign-intake.js:361-367) returns 'single'; intake seals
  review_station:'single' into qc_panel_snapshot (campaign-intake.js:2158, buildQcPanelSnapshot :394-409).
- In composition (campaign-composition.js:717) station=single => each full_diff_review barrier (initial AND every
  repair generation, :2111-2120) dispatches ONE `review` adapter seat = roster.reviewer_engine (the decorrelated
  reviewer; cross-family enforced by the resolver), not the panel.
- Terminal `finalPanel` / joint_review is independent of the station and still runs the FULL sealed panel
  (campaign-composition.js:2961-3040; the stationPanelReuse shortcut only fires when station==='panel').
  references/blind-dispatch.md:391-398 documents this ("in_rail_review=single ... stay the two-station path").
- Sealed roster, min_panel_size, cumulative repair cap (maxRepairs, :2418) and gate limits are untouched.
Already-sealed campaign: NO. Station is read from the SEALED snapshot (autopilot-engine.js:7261-7264,
reviewStation: snapshotStation :7288), not from live config. Changing in_rail_review live only emits a
`qc_panel_snapshot_live_flip` ledger note (autopilot-engine.js:7277-7285) and, via live-digest drift
(autopilot-engine.js:5510-5525, campaign-intake.js:2512), flags roster drift. The snapshot is O_EXCL and
digest-bound (includes review_station, campaign-intake.js:381); editing it = seal edit (out of bounds). So the
operator must set in_rail_review: single BEFORE first admitted intake of a new Mission/Work Order (new contract).
Note default is `auto` => panel whenever qc_panel_seats_complete (template :65) -- that is why the peer got panel.

## 2. (Only if they want it on THIS sealed campaign / want a real per-repair-single + sealed-panel mode)
No cadence field exists: grep for repair_review / per_repair_reviewer / review_cadence / panel_cadence: zero hits
in src, scripts, templates, skills, references. Station choice is one binary per campaign, not per generation.
Pick point: campaign-composition.js:717 (`reviewStation`), consumed at :2030, :2111-2120, :2246 (station tag on
lastReview), :2961 (reuse). Source of value: autopilot-engine.js:7261 -> :7288.
Narrowest change (prose): add a third sealed station value (e.g. review_station:'panel_terminal') or a separate
sealed field; in the full-diff barrier use panel only when the barrier is the first one (generation 0) -- or never
-- and `review` single seat for repair generations (barrierGeneration logic already at :1457-1465); keep
finalPanel full and drop the stationPanelReuse path for that mode (no in-loop panel receipt to reuse). Intake
(resolveReviewStation + snapshot schema + identity body :371-385) must accept/seal the value; resume must read it
from snapshot only.
Invariants: sealed roster/digests unchanged (jointReviewRosterDigest); single seat must be reviewer_engine with
family != implementer_family (resolver cross_family check); repairGeneration/maxRepairs and gate_journal/budget
charging (chargeEffect :2038) unchanged; gate_input must include station so a panel receipt is never reused as a
single one and vice versa (:2030 only adds station for panel -- needs a distinct tag); terminal panel still
quorum-checked at minPanelSize; below-quorum never falls back to one seat.
Tests: composition unit test with fake adapters: station=X, panel FIX-THEN-SHIP then repair -> assert
reviewPanel call count 1 at gen0 (if kept), review (single) called per repair, finalPanel called once with full
seats; negative: legacy snapshot without field unchanged; intake test sealing+drift digest; resume test that
live in_rail_review flip does not change sealed mode. Effort: M (contract/snapshot schema + intake + composer +
doc/inventory/hash chain + version bump; mechanism is small, sealing/back-compat dominate).

## 3. Mismatches in the peer's description
- "after a REPAIR the full-diff barrier always runs the review PANEL": true only because the snapshot sealed
  review_station:panel; it is a per-campaign sealed choice, not an always (campaign-composition.js:717, :2111).
  Documented intent: hetero-impl-loop.md:215-217 and blind-dispatch.md:391-396 ("a repair round reruns the panel").
- "no CLI station override": correct for the CLI; the override IS config (in_rail_review), just sealed at intake.
- "plan/config wants ONE decorrelated reviewer per repair": that is exactly in_rail_review=single (+ terminal panel),
  so if their accepted config said single, the seal should have said single; check roster.in_rail_review at intake
  (default `auto` upgrades to panel when seats are complete, campaign-intake.js:364-366). A config/seal mismatch
  at intake is the likely root cause, not a missing feature.
- "reuses the candidate at first": resume reuse of the candidate is by gate_journal (findReusableGate :2032),
  and the station reuse (stationPanelReuse :2961) applies only to the TERMINAL panel, not to repair re-review.
- No git history on repair review cadence beyond 316c1d4b (panel as review station, 2-C); recent commits
  (w111/w112) touch final-panel seat resume and boundary receipts, not station selection.
