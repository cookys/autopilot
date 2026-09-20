# Blind review redesign — cut 2-B: a quorum panel with standby seats, and the panel snapshot at intake

> Status: draft for plan hetero loop · Size: M · Base: `aeea2ca7` (v2.36.65) · Parent:
> `docs/plans/_archive/2026-09-16-blind-review-packet.md` §7 item 4 (`:311-312`) and the design consult
> `evidence/2026-09-16-blind-review-redesign/consult-claude-fable-5-1.md` (`:32` snapshot, `:46` standby seat,
> `:54-55` knobs). Sibling 2-A (v2.36.65) shipped the fan-out, the pocket and verify-once. This cut ships the two
> mechanisms that need no repair-loop change; "in-rail review off when a panel exists" is **2-C** together with a
> panel-driven repair round (BACKLOG "final panel has no repair loop" `docs/BACKLOG.md:195-201`) — switching the
> in-rail seat off today would remove the campaign's only repair signal. Evidence dir:
> `docs/plans/evidence/2026-09-18-blind-review-panel-standby/`.

## 0. What is actually true today (verified 2026-09-18 at base `aeea2ca7`)

- `performFinalPanel` (`src/engine/autopilot-engine.js:5260-5457`): seats = `roster.qc_panel_seats` when
  `qc_panel_seats_complete === true` (`:5262-5265`); `minPanelSize = roster.min_panel_size` (`:5261`, resolver field
  `min_panel_size`, default 3, `resolve-review-loop.sh:96,704`, schema `:394`); cross-family gate
  `terminalPanelCrossFamilySatisfied(roster, seats)` runs BEFORE dispatch over ALL seats (`:5274-5281`; predicate
  `:1187-1207`: families ≥ max(2, `required_review_families`) when the panel has >1 seat, and one family ≠ the
  implementer's). Every qualified seat is prepared and launched in one batch (2-A, `:5345-5378`).
  `reviewedOutcomes` (`:5393`), **`allReviewed = reviewedOutcomes.length === outcomes.length`** (`:5421`),
  `panelReviewed = allReviewed && findingsConsistent && packetHashesConsistent` (`:5433`),
  `final_panel_count: reviewedOutcomes.length` (`:5450`), `final_panel_seat_receipts` = one row per dispatched seat
  (`:5391-5392`, `finalPanelSeatReceipt` `:5223-5258`, statuses `reviewed|no_verdict|transport_failed|parser_failed|
  precondition_failed`). So **one failed seat fails the panel even when more seats than `min_panel_size` were
  dispatched** — the 1c campaign lost its panel to two rc=124 seats, the 1b-A campaign would have needed only one.
- The receipt validator (`campaign-composition.js:357-445`) enforces the same twice: `firstFailure` — any
  failure-status seat — blocks with that seat's reason regardless of how many seats reviewed (`:411,437`);
  `final_panel_count` counts reviewed seats only (`:400-406`) and must equal the receipt's (`:434-436`); below
  `sealed_min_panel_size` → `final_panel_below_minimum` (`:438-440`, `>=`, so extra REVIEWED seats already pass —
  `qc-panel-honesty.test.sh:90-92` `overMinimum`); tuple dedupe (`:389-399`); packet-hash all-or-none + one value
  (`:416-433`). Schema `implementation-campaign-receipt.schema.json` `finalPanelSeat` (`:213-240`) is
  `additionalProperties:false` with the five statuses (`:228-231`); the terminal object requires
  `sealed_min_panel_size`, `final_panel_count`, `final_panel_seat_receipts` (`:61-63,78-83,120`).
- There is **no panel snapshot**: intake reads `input.roster.qc_panel_seats` (`campaign-intake.js:1553-1555`),
  tier-gates and probes each seat (`:1568-1617`), checks qualification (`:1647-1669`), and persists nothing about
  the admitted seats except the `cleanroom_probe` steps (`:1713-1715`). `createCampaignState`
  (`implementation-campaign.js:602-639`) stores no roster. `performFinalPanel` reads the live `roster` from the
  loop input (`autopilot-engine.js:8713`), so nothing checks that the seats reviewed equal the seats admitted; a
  pin change between intake and panel is honoured silently. Precedent for "digest at claim, verify at use":
  `strict_l5_provider_readiness.roster_digest` (`provider-bootstrap.js:486,610,686,696`), stashed on the control
  at `autopilot-engine.js:9280`; the intake result IS `campaignControl` (`:9278`), so a field added to the
  admitted result (`campaign-intake.js:2180-2194`, beside `steps`) is visible at panel time.
- No knob resembling `panel.standby` exists; `spec_review`/`independent_harness`/`l1_required` in the contract
  schema (`:18-24`) are implementation-loop switches, unrelated.
- Tests: `qc-panel-honesty.test.sh:77-110` (undersized, complete, overMinimum, noVerdict at 2/3),
  `implementation-campaign-receipt.test.sh:973-1025` (noVerdict/failedMeta/extraSeat), `autopilot-engine.test.sh`
  2-A panel block (`panel_order`, `panel_timeout`, `real_batch_panel`), `implementation-campaign-routing.test.sh`
  `proof_parity_run` (`:3021-3092`).

## 1. Ruling and shape

1. **Quorum, not unanimity.** `min_panel_size` is the sealed quorum. The panel is `reviewed` when the number of
   `reviewed` seats ≥ `min_panel_size`, the cross-family predicate holds over the REVIEWED seats (re-evaluated
   after the batch, not only before it), findings are consistent and the packet hash is one value. A failed seat
   (transport, format, parser, precondition) is still a receipt row with its status and reason, but it blocks
   only when the quorum is not met. So an operator who lists `min_panel_size + 1` seats has a standby seat with
   **no new knob**: the extra seat is dispatched with the others (2-A parallel, same packet, same timeout) and
   its receipt is kept whatever it says — a reviewed extra seat's findings are merged like any other (more
   evidence, union-on-verified-critical), a failed extra seat is recorded and ignored. `final_panel_count` stays
   "reviewed seats"; the terminal receipt gains `final_panel_quorum_met: true|false` (boolean, required) and each
   seat receipt gains `load_bearing: true|false` (true for every reviewed seat when the quorum is met; false for
   failed seats; when the quorum is NOT met every seat is load-bearing and the first failure is the reason, as
   today). The validator mirrors this exactly: `firstFailure` blocks only when reviewed < `sealed_min_panel_size`
   or `final_panel_quorum_met` is false; a receipt whose `load_bearing` flags disagree with its statuses/count is
   `final_panel_metadata_incomplete`. The cross-family pre-check over all seats stays (a roster that cannot
   satisfy families even if every seat returns is refused before spend), and the post-batch check over reviewed
   seats is added (`final_panel_families_below_minimum` when the surviving seats lack a second family).
2. **Snapshot at intake, resolve from the snapshot.** Intake, after the tier/probe/qualification block admits
   the seats, records `qc_panel_snapshot = { seats: [tuples in order], min_panel_size, required_review_families,
   digest }` (digest = canonical over those three) on the admitted result beside `steps`, plus
   `step('qc_panel_snapshot', 'ready', { digest, seat_count })` in the intake receipt (durable). `performFinalPanel`
   resolves its seats, minimum and family requirement from `campaignControl.qc_panel_snapshot` when present; if the
   live roster's tuples/minimum differ it pushes trace `final_panel_roster_drift` with both digests, records
   `roster_drift: true` on the `final_panel` ledger row and proceeds with the snapshot (consult `:32`: "log it and
   proceed with the snapshot"). Legacy inputs without a snapshot (unmanaged loops, hand-built controls) keep the
   live roster, byte-identical. On resume the intake re-runs and re-snapshots from the live roster; if its digest
   differs from the recorded step's, it records `step('qc_panel_snapshot', 'ready', { …, redrawn_from: <old> })`
   — visible, never silent.
3. **Not in this cut** (2-C): `in_rail_review` off when a panel exists + a panel-driven repair round; packet built
   once per candidate and shared by every seat (BACKLOG `verifyTreeIntegrity` row); a `panel.standby` knob that
   names which seat is the spare (the quorum rule makes it unnecessary).

## 2. Changes by file (+ codex mirrors)

- `src/engine/autopilot-engine.js`: `performFinalPanel` quorum predicate, post-batch family check, `load_bearing`
  on seat receipts (`finalPanelSeatReceipt` takes the quorum outcome), `final_panel_quorum_met` on the terminal
  object, snapshot resolution + drift trace/row field; `terminalPanelCrossFamilySatisfied` reused over the
  reviewed subset.
- `src/engine/campaign-composition.js`: `validateFinalPanelReceipt` quorum-aware (`firstFailure` only below
  quorum; `load_bearing` consistency; `final_panel_quorum_met` required).
- `src/engine/campaign-intake.js`: `qc_panel_snapshot` on the admitted result + the `qc_panel_snapshot` step.
- `schemas/implementation-campaign-receipt.schema.json`: `finalPanelSeat.load_bearing` (boolean, required),
  terminal `final_panel_quorum_met` (boolean, required); no new status values.
- Tests (RED-first, `# RED at base <sealed base>: <observed>`): `qc-panel-honesty.test.sh` (min 3, 4 seats, one
  `transport_failed` → ready, count 3, quorum met, the failed row `load_bearing:false`; min 3, 3 seats, one failed →
  blocked with that reason as today; min 3, 4 seats, the only second-family seat failed →
  `final_panel_families_below_minimum`); `implementation-campaign-receipt.test.sh` (schema requires the two
  booleans; a failed row marked `load_bearing:true` while quorum met → metadata incomplete; quorum false with a
  failure → blocked); `autopilot-engine.test.sh` (stub 4-seat panel with one stub seat returning a transport
  failure → panel reviewed, ledger row `final_panel` count 3; snapshot: intake with seats A,B,C then a loop input
  whose roster swaps C for D → the panel dispatches A,B,C, trace `final_panel_roster_drift`, row `roster_drift:true`;
  no-snapshot control → live roster, byte-identical); `implementation-campaign-routing.test.sh` (`proof_parity_run`
  gains a `standby` scenario: 4 seats, one no_verdict → ready; and asserts the intake receipt's
  `qc_panel_snapshot` step); `implementation-campaign-state.test.sh` (snapshot step shape).
- Docs: `references/blind-dispatch.md` (+ mirror) "Panel execution" paragraph gains "Quorum and standby" and
  "Snapshot at intake"; `.claude/review-loop-config.md` + `project-config-template/review-loop-config.md` (+ mirror)
  `min_panel_size` row: "list one more seat than the minimum to get a standby"; `skills/l5/references/
  hetero-impl-loop.md` (+ mirror) step 6b sentence; `docs/BACKLOG.md` redesign row Context → `… 2-A v2.36.65, 2-B
  v2.36.66. Open: 2-C (in-rail off + panel repair, shared packet). …` (≤240 B, Status `open`).

### 2.5 Sealed `output_paths` (exact; re-check mirrors at base)

```
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-composition.js
platforms/codex/plugin/src/engine/campaign-composition.js
src/engine/campaign-intake.js
platforms/codex/plugin/src/engine/campaign-intake.js
schemas/implementation-campaign-receipt.schema.json
platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json
hooks/tests/qc-panel-honesty.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-state.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
.claude/review-loop-config.md
project-config-template/review-loop-config.md
platforms/codex/plugin/project-config-template/review-loop-config.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
docs/BACKLOG.md
```

Nothing created. Twenty-one paths, `max_changed_files` sealed at 22.

### 2.6 Global constraints

- Reviewers: this plan is self-contained; `file:line` citations are provenance for depth-0, never a reading
  assignment.
- The quorum is the sealed `min_panel_size`; no code path admits a panel with fewer reviewed seats than it, and no
  code path lets a failed seat block a panel that has the quorum and the families.
- Every dispatched seat has a receipt row; nothing is dropped — "discarded" means not load-bearing, visibly.
- The snapshot is written once at intake and read at panel time; drift is recorded, never resolved silently;
  without a snapshot behaviour is byte-identical.
- No new roster field, no new status value; the fan-out, timeout, pocket and verify-once rules of 2-A are unchanged.
- `review.js`, `review-fanout.js`, `review-packet.js`, `dispatch-review.sh`, resolvers byte-identical.

## 3. Out of scope
2-C items (§1.3); changing `min_panel_size` defaults; per-seat weights or majority aggregation (forbidden by the
config contract); what a standby seat costs (it is a full seat — the operator chooses).

## 4. Acceptance
| id | criterion | evidence |
|----|-----------|----------|
| `quorum` | min 3 + 4 seats + one failure → reviewed, count 3, failed row present with `load_bearing:false`; min 3 + 3 seats + one failure → blocked with that reason; families re-checked over reviewed seats | honesty + engine suites |
| `receipt` | schema requires `load_bearing` and `final_panel_quorum_met`; validator blocks on failure only below quorum; inconsistent flags → metadata incomplete | receipt suite |
| `snapshot` | intake records the snapshot (result + step); the panel resolves from it; live-roster drift → trace + row field, snapshot wins; no snapshot → live roster byte-identical | engine + routing + state suites |
| `no-regression` | §4.1 all exit 0 at candidate; base recorded | evidence |
| `scope-integrity` | diff ⊆ §2.5; runner rail/helper/packet/resolvers byte-identical | command output |

### 4.1 No-regression commands (exact; also the graph's `verification_commands`)
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
```
Base record: `evidence/…-panel-standby/base-suites-<base>.txt` (detached checkout, sequential).

## 5. Dogfood proof (depth-0)
This repo's next managed campaign runs with four qc seats (claude-fable-5-1, GLM-5.2, MiniMax-M3, + one more
family) and `min_panel_size: 3`: the ledger shows four receipts, `final_panel_quorum_met: true`, and — if one seat
faults, as MiniMax and GLM did on 1b-B/1c — the panel still `reviewed` with that row `load_bearing:false`. The
intake receipt carries the `qc_panel_snapshot` step; a deliberate pin change after intake (scratch config) shows
`final_panel_roster_drift` in the trace while the panel reviews the snapshot's seats.

## 6. Risks + inversion
- **Quorum hides a systematic fault** — every failed seat is still a receipt row with its reason; the families
  re-check refuses a panel whose survivors are one family.
- **Snapshot staleness** — the panel reviews the seats the operator sealed at intake, which is the point; drift is
  loud in trace and row.
- **Schema tightening** — two required booleans: every producer in the repo is the engine, and the receipt suite
  pins both shapes; hand-built fixtures in the suites are updated in this cut.

## 7. Where this sits
1a-A ✓ → 1a-B ✓ → 1b-A ✓ → 1b-B ✓ → 1c ✓ → 2-A ✓ → **2-B (this)** → 2-C (in-rail off + panel repair, shared packet).

## Review log
- (pending)
