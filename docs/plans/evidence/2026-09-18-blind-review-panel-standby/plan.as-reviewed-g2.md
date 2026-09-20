# Blind review redesign — cut 2-B: a quorum panel with standby seats, and the panel snapshot at intake

> Status: draft for plan hetero loop · Size: M · Base: `aeea2ca7` (v2.36.65) · Parent:
> `docs/plans/_archive/2026/09/2026-09-16-blind-review-packet.md` §7 item 4 (`:311-312`) and the design consult
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
   today). The validator RE-DERIVES the quorum from the rows and refuses a receipt whose flag disagrees: the terminal
   object gains `sealed_required_review_families` (integer) and `implementer_family` (string) beside
   `sealed_min_panel_size`, so `quorum_met_derived = reviewed rows ≥ sealed_min_panel_size ∧ families(reviewed
   rows) ≥ max(2, sealed_required_review_families) when more than one seat ∧ some reviewed family ≠
   implementer_family` is computable from the receipt alone; `final_panel_quorum_met !== quorum_met_derived` →
   `final_panel_quorum_flag_mismatch`; `firstFailure` blocks only when `quorum_met_derived` is false; every
   reviewed row must be `load_bearing: true` and every failed row `load_bearing: false` when the quorum is met
   (all rows `true` when it is not) — any other pattern is `final_panel_metadata_incomplete`. The cross-family pre-check over all seats stays (a roster that cannot
   satisfy families even if every seat returns is refused before spend), and the post-batch check over reviewed
   seats is added (`final_panel_families_below_minimum` when the surviving seats lack a second family). The
   packet-hash rule — all-or-none and one value — is scoped to REVIEWED rows in both the engine (`:5433`, already
   over `reviewedOutcomes`) and the validator (`:416-433`, today over every row): a failed row never carries
   `packet_hash` (v2.36.61) and must not trip the rule.
2. **Snapshot at intake, resolve from the snapshot.** The snapshot is a durable file written ONCE:
   `qc_panel_snapshot.json` beside the sealed contract (the directory of `contractPath`, the same attempt directory
   that holds `campaign.json` and `campaign.seal.json`), created with `O_EXCL` by the first intake that admits the
   panel, after the tier/probe/qualification block. Contents: `{ schema_version, campaign_id, contract_digest,
   seats: [the admitted seat objects in order — role, runner, model, effort, endpoint, family — exactly as the
   roster carried them past qualification], seats_complete: true, min_panel_size, required_review_families,
   implementer_family, digest }` (digest = canonical over everything but itself). Intake also records
   `step('qc_panel_snapshot', 'ready', { digest, seat_count, path })` in its receipt and puts the parsed snapshot on
   the admitted result beside `steps` (`campaign-intake.js:2180-2194`), so `campaignControl.qc_panel_snapshot`
   exists at panel time (`autopilot-engine.js:9278`). **On resume intake never re-snapshots**: if the file exists
   it is read, its `campaign_id`/`contract_digest` must equal the sealed ones (else `qc_panel_snapshot_identity_invalid`,
   blocked before spend), and it is used as-is; a live roster whose seats/minimum differ is recorded as
   `step('qc_panel_snapshot', 'ready', { …, live_drift: <live digest> })` and ignored. `performFinalPanel` takes
   seats, `seats_complete`, minimum and family requirement from the snapshot when `campaignControl.qc_panel_snapshot`
   is present — the seat objects carry everything the 2-A prepare step reads (`:5323-5334`, `:5345-5378`: runner,
   model, effort, endpoint, family), and intake's qualification decision is the sealed one, so `finalPanelSeatQualified`
   is not re-run against the live roster (a pin removed after intake cannot un-admit a seat; a pin added cannot
   admit one). If the live roster differs it pushes trace `final_panel_roster_drift` with both digests, records
   `roster_drift: true` on the `final_panel` ledger row, and proceeds with the snapshot (consult `:32`). Inputs
   without a snapshot (unmanaged loops, hand-built controls, receipts from before this cut) keep the live roster,
   byte-identical. The live roster never wins — on first admission, on resume, or at the panel.
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
- `src/engine/campaign-intake.js`: write-once `qc_panel_snapshot.json` beside the contract (`O_EXCL`; identity
  check on read; never re-snapshot), the `qc_panel_snapshot` step (with `live_drift` on resume), the parsed
  snapshot on the admitted result.
- `schemas/implementation-campaign-receipt.schema.json`: `finalPanelSeat.load_bearing` (boolean, OPTIONAL),
  terminal `final_panel_quorum_met` (boolean), `sealed_required_review_families` (integer ≥ 1),
  `implementer_family` (string) — all OPTIONAL in the schema so receipts and fixtures produced before this cut
  still validate, under LEGACY semantics: a terminal object without `final_panel_quorum_met` is validated by
  today's unanimity rule (any failure blocks), a seat row without `load_bearing` is treated as reviewed ⇒ true /
  failed ⇒ false. The engine ALWAYS writes all four (the receipt suite pins that a receipt produced by the engine
  carries them); no new status values. The receipt suite's `extraSeat` case (`:1018-1025`) is the duplicate-tuple
  case and is unchanged.
- Tests (RED-first, `# RED at base <sealed base>: <observed>`): `qc-panel-honesty.test.sh` (min 3, 4 seats, one
  `transport_failed` → ready, count 3, quorum met, the failed row `load_bearing:false`; min 3, 3 seats, one failed →
  blocked with that reason as today; min 3, 4 seats, the only second-family seat failed →
  `final_panel_families_below_minimum`); `implementation-campaign-receipt.test.sh` (schema requires the two
  booleans; a failed row marked `load_bearing:true` while quorum met → metadata incomplete; quorum false with a
  failure → blocked); `autopilot-engine.test.sh` (stub 4-seat panel with one stub seat returning a transport
  failure → panel reviewed, ledger row `final_panel` count 3; snapshot: intake with seats A,B,C writes the file; a second intake (resume) with a roster that swaps C for D reads
  it, records `live_drift`, and the panel dispatches A,B,C with trace `final_panel_roster_drift` and row
  `roster_drift:true`; a snapshot whose `contract_digest` differs → blocked `qc_panel_snapshot_identity_invalid`;
  no-snapshot control → live roster, byte-identical); `implementation-campaign-routing.test.sh` (`proof_parity_run`
  gains a `standby` scenario: 4 seats, one no_verdict → ready; and asserts the intake receipt's
  `qc_panel_snapshot` step); `implementation-campaign-state.test.sh` (snapshot step shape).
- Docs: `references/blind-dispatch.md` (+ mirror) "Panel execution" paragraph gains "Quorum and standby" and
  "Snapshot at intake"; `.claude/review-loop-config.md` + `project-config-template/review-loop-config.md` (+ mirror)
  `min_panel_size` row: "list one more seat than the minimum to get a standby"; `skills/l5/references/
  hetero-impl-loop.md` (+ mirror) step 6b sentence; `docs/BACKLOG.md` redesign row Context → EXACTLY `packet (tree + git diff + spec, deny-list); packet/cleanroom tiers; intake canary; verify-once; parallel seats. Shipped: 1a-A..1c v2.36.59-64, 2-A v2.36.65, 2-B v2.36.66. Open: 2-C (in-rail off, panel repair, shared packet). Pointer has detail.` (244 bytes, Status
  `open`; `v2.36.66` is the release-commit pin depth-0 re-stamps if the number differs).

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
| `receipt` | engine-produced receipts carry the four fields; validator re-derives the quorum (count + families from the sealed terminal fields) and refuses a disagreeing flag; blocks on failure only below the derived quorum; packet-hash rule over reviewed rows only; legacy receipts validate under the unanimity rule | receipt suite |
| `snapshot` | first intake writes the file once (second write refused) and the step; resume with a different live roster reads the file, records `live_drift`, and the panel still reviews the snapshot's seats; identity mismatch → blocked before spend; no snapshot → live roster byte-identical | engine + routing + state suites |
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
- **Schema widening, not tightening** — the four new fields are optional with legacy semantics when absent, so the
  nine suites that hand-build `final_panel_seat_receipts` (controller-execution-independent, receipt, engine,
  state, honesty, routing, status-task, next-touch-validation, dogfood) keep passing untouched; the engine always
  emits them and the receipt suite pins that.

## 7. Where this sits
1a-A ✓ → 1a-B ✓ → 1b-A ✓ → 1b-B ✓ → 1c ✓ → 2-A ✓ → **2-B (this)** → 2-C (in-rail off + panel repair, shared packet).

## Review log
- (pending)
