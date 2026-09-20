# Blind review redesign — cut 2-C: the panel is the review station, and one packet per candidate

> Status: draft for plan hetero loop · Size: L (two independent deliverables) · Base: `9a0dac5b` (v2.36.67) · Parent:
> `docs/plans/_archive/2026/09/2026-09-16-blind-review-packet.md` §7 item 4 (`:311-312`) and the design consult
> `evidence/2026-09-16-blind-review-redesign/consult-claude-fable-5-1.md` §3 "Speed cuts" (`:31-35`: "delete the
> in-rail single-seat review when a final panel is configured", "overlap", "run each verification suite once") and
> §4 migration (`:44-48`). 2-B (v2.36.66) shipped the quorum panel and the intake snapshot; 2-B's plan §1.3 named
> this cut: in-rail review off when a panel exists + a panel-driven repair round (BACKLOG "final panel has no
> repair loop"), and one packet per candidate shared by every seat (BACKLOG "`verifyTreeIntegrity` … 21 s").
> Evidence dir: `docs/plans/evidence/2026-09-18-blind-review-panel-station/`.

## 0. What is actually true today (verified 2026-09-18 at base, `src/engine/campaign-composition.js` unless noted)

- **Two review stations, one of which can repair.** The composition trace is `preflight` (`:1188`) → `implement`
  (`:1399`) → `scope_after_mutation` (`:1751`) → `full_diff_review` (`:1970`, the single in-rail seat
  `roster.reviewer_engine`, adapter `review` = `performReview`, `autopilot-engine.js:8019`) → `full_suite`
  (`:2464`) → `adjudicate` (`:2557`, `final: false`) → on `must_fix_now` + `repair_gate_passed` (`:2643-2660`) a
  repair generation (`repair_authorized` `autopilot-engine.js:8104-8119`, branch `<b>-repair-r<N>-<sha7>`
  `:1151`, budget `max_repair_generations` `:2652-2660`) loops back to `implement`; after the loop
  `scope_before_acceptance` (`:2703`) → `convergence` (`:2716`) → **`final_panel`** (`:2830`, `performFinalPanel`,
  2-A parallel fan-out, 2-B quorum + snapshot) → `final_adjudicate` (`:2936`, `final: true`). Only the in-loop
  adjudication can authorise a repair; the panel's adjudication happens after the loop has exited and can only
  produce `ready` or `follow_up` (`:2958-2967`); a panel FIX-THEN-SHIP with no disposition provider stops the rail
  at `final_adjudication: final finding registry is incomplete` (`:2933-2935`) — the 1b-A campaign, and the
  documented path is l3 degrade + a depth-0 hand repair.
- **No knob switches the in-rail seat off**: `grep in_rail|review\.in_rail|spec_review|independent_harness` in
  `campaign-composition.js`, `autopilot-engine.js`, `src/mission/runtime.js` → nothing; `spec_review` /
  `independent_harness` in the contract schema (`:18-24`) are implementation-loop switches. The in-rail verdict is
  consumed by: the loop adjudication (`:2530-2535` → `retainAdjudication`, `must_fix_now`, `repair_gate_passed`,
  `convergence('review_findings')` `:2665-2671`, `repairGeneration` `:2683`); the panel payload
  (`stableReviewGatePayload(lastReview)` → `panelPayload.focused_review` `:2718-2722`, digested into the
  `joint_review` gate identity `full_diff_payload_digest` `:2739`); the durable wait (`unresolved_findings`,
  `findings_snapshot` on `AWAITING_DISPOSITION` `:2610-2621`); resume (`lastReview = resume.review` `:1783`,
  `resume_replay_bound_review` `:1789-1791`); the `full_diff_review` gate-journal kind (`:1983-2004`, reused by
  `findReusableGate(…, 'full_diff_review', …)` `:1874`).
- **Every seat builds its own packet.** `performFinalPanel` calls `performReview` once per seat
  (`autopilot-engine.js:5367`), each `reviewDiff({ packet })` (`:4998`) → `prepareReviewLaunch`
  (`src/runners/review.js:209`) → `buildReviewPacket` (`review.js:233`, `src/runners/review-packet.js`) in a fresh
  `mkdtemp` (`review.js:227`); `verifyTreeIntegrity` (`review-packet.js:264`, called `:443`) hashes every tracked
  file with one `git hash-object` process each (21 s for 4236 files, BACKLOG) — once per seat, plus once for the
  in-rail seat: four builds per candidate on a three-seat panel. `packet_hash` is produced per build
  (`review.js:260,460`), copied to the outcome (`autopilot-engine.js:5210,5246-5248`) and compared across seats
  (`:5466-5476`: all-or-none, one value); there is no cache keyed on the packet identity
  (`{repo, baseSha, candidateSha, diffFile, specFile, denyList}`, `review.js:233-249`).
- **The clock now pauses while parked** (v2.36.67, `implementation-campaign.js` `WALL_CLOCK_PAUSED_STATES` =
  `{awaiting_disposition}`, `campaignClockElapsedSeconds`): a depth-0 disposition wait no longer burns the wall,
  so a panel-driven `awaiting_disposition` inside the loop is a usable path, not a trap. The 2-A pocket
  (`final_panel_reserve_seconds`) is now projected into the contract by `mission grant` (v2.36.67).
- Tests: `implementation-campaign-routing.test.sh` (trace order `:498`, `full_diff_review` gate journal
  `:2005,2011,2886,2985`, no_verdict durable wait `:594-605`, packet-hash panel cases `:3133-3142`,
  `proof_parity_run` standby scenario), `autopilot-engine.test.sh` 2-A/2-B panel block (`panel_order`,
  `panel_timeout`, `real_batch_panel`, `panel-standby`, `panel-snap-*`), `review-packet.test.sh`,
  `review-runner.test.sh`, `p6d-gates-repair-ladder.test.sh`, `check-repair-scope.test.sh`.

## 1. Ruling and shape

Two deliverables, independent, each its own campaign.

### 1.1 Deliverable `panel-review-station` — when a panel is sealed, the panel IS the loop's review station

1. **One review station, not two.** When intake sealed a panel snapshot (2-B `qc_panel_snapshot.json` with
   `seats_complete: true`) the composition's `full_diff_review` station dispatches the PANEL (the 2-A fan-out,
   2-B quorum, seats from the snapshot) instead of the single `roster.reviewer_engine` seat, and the single seat
   is not dispatched at all. The station's receipt keeps the shape every downstream consumer reads today
   (`reviewed`, `verdict`, `findings` as the normalized array string, `review_digest`, `packet_hash`) plus the
   panel fields (`sealed_min_panel_size`, `final_panel_count`, `final_panel_seat_receipts`,
   `final_panel_quorum_met`, `sealed_required_review_families`, `implementer_family`, `budget_source`,
   `seat_timeout_seconds`): `verdict` = the panel aggregation (`union-on-verified-critical`, as `performFinalPanel`
   computes it), `findings` = the merged findings, `review_digest` = the panel digest over the seat receipts.
   Finding ids: when two seats report the same `finding_id` with different digests, the station qualifies BOTH by
   seat index (`s<i>.<id>`); identical reports keep one unqualified id (2-A dedupe); `unresolved_findings`,
   `findings_snapshot` and a disposition authority use the ids as the station wrote them. So
   the loop adjudication (`adjudicate`, `final: false`) sees a panel review exactly as it sees a single review:
   `must_fix_now` → `repair_authorized` → repair generation → the station runs the panel AGAIN on the repaired
   candidate (one more fan-out; bounded by `max_repair_generations` and the wall); findings without an authority →
   `awaiting_disposition` (durable, clock paused) with the panel's merged findings as the registry; a
   panel below quorum → the station is `blocked` with the 2-B reason (`final_panel_below_minimum` /
   `final_panel_families_below_minimum` / the first failure), a durable wait when the reason is a seat fault
   (`review_no_verdict` semantics of v2.36.43, one row per seat in the receipt), never a silent single-seat fallback.
2. **The terminal panel reuses the station's last panel.** After the loop, the `final_panel` station looks up
   its `joint_review` gate as today (`:2733-2749`); with the panel as the station the last in-loop panel receipt
   IS the joint review for the same `candidate_tree_sha` + roster digest + packet identity, so `final_panel` is
   `final_panel_gate_reused` from that receipt (no second fan-out, no second spend); it dispatches a fresh panel
   only when no in-loop panel receipt exists for the final candidate tree (cannot happen after a repair — the
   station ran on it — and cannot happen on the first candidate either; the branch stays for receipts produced
   before this cut and for a resume that adopts a candidate the station never reviewed). The terminal receipt
   (`final_adjudicate`) is unchanged in shape; `follow_up` still means the adjudication left follow-ups.
3. **The knob is sealed in the snapshot.** Resolver field `in_rail_review` (`review-loop-contract.schema.json` +
   `resolve-review-loop.sh` + `resolve-review-loop.js`, values `auto|single|panel`, default `auto`; `auto` → `panel`
   when the panel is complete, else `single`; `single` keeps today's two stations; `panel` with an incomplete
   panel is a resolver refusal). Intake writes the resolved value into `qc_panel_snapshot.json` as
   `review_station: "panel"|"single"` (snapshot digest covers it); the composition reads
   `campaignControl.qc_panel_snapshot.review_station`, never the live roster, so a resume cannot flip stations
   mid-campaign (a live value that differs is `live_drift`, 2-B). No snapshot (unmanaged loop, hand-built control,
   pre-2-B receipts) → `single`, byte-identical to today. **A snapshot written before this cut** (2-B, no
   `review_station` key) resolves to `single`; its identity check is the 2-B check over the fields present — it is
   never re-digested with the new key, so an in-flight 2-B campaign resumes after the upgrade byte-identically.
4. **Cost is bounded and visible, and the pocket is the station's.** A repair round now costs a panel, not a
   seat: the ledger `full_diff_review` row carries `station: "panel"`, `seat_count`, `budget_source`,
   `seat_timeout_seconds`. Because the station panel is the only panel that runs, it is budgeted exactly as
   `performFinalPanel` budgets the terminal panel today (2-A): consumer `panel` — the wall remainder, and when that
   is below the sealed pocket the pocket (`final_panel_reserve_seconds`) with `budget_source: pocket`; when neither
   suffices the station blocks with `final_panel_budget_exhausted` before any seat is prepared (2-A rule) — never a
   silently starved fan-out. The single station (`review_station: single`) keeps consumer `review`.
5. **Not in this deliverable**: a smarter aggregation than `union-on-verified-critical`; running the rail's suites
   concurrently with the panel (consult "overlap"); the single seat as a cheap first pass before the panel.

### 1.2 Deliverable `shared-packet` — one packet build per candidate, one private materialisation per seat

1. **Build once.** `prepareReviewLaunch` is split so the packet build (`buildReviewPacket`, including
   `verifyTreeIntegrity`) is a separate step keyed by the packet identity `{repo, baseSha, candidateSha,
   diffFile bytes, specFile bytes, denyList}` → `{ packet_dir, packet_hash, manifest }`. `performFinalPanel` (and
   the station of 1.1) builds the packet ONCE per candidate and hands every seat the built packet; `performReview`
   for the single seat is a batch of one over the same path (byte-identical hash for the same identity — pinned
   by test: the hash of a shared build equals the hash of a per-seat build at base).
2. **Materialise per seat — a real copy, verified before launch.** Each seat launches against its OWN
   materialisation of the built packet directory in the seat's `mkdtemp`, never the shared directory. A
   materialisation is a plain per-file copy (`fs.copyFileSync`; `COPYFILE_FICLONE` reflink is allowed only because
   it is copy-on-write — the call falls back to a byte copy by itself); **hardlinks are forbidden** (a hardlink
   shares the inode, so an in-place write by one tools-capable seat would change the bytes every other seat reads
   while the shared hash stayed the same — G1 blocker). Before any seat launches, its directory is re-hashed with the
   packet builder's own hash function and must equal the shared `packet_hash` (mismatch → that seat is
   `precondition_failed` before spend, receipt row with the reason); after the batch nothing is re-hashed (a seat may
   write into its own view; that is the point of a private copy). `packet_hash` is the shared build's hash on every
   seat receipt, so the 2-B all-or-none/one-value rule holds by construction and stays in the validator; the
   cleanroom launcher's bind/HOME rules (1b-A) are unchanged.
3. **Hash the tree once.** `verifyTreeIntegrity` batches: one `git hash-object --stdin-paths --no-filters`
   process for regular files whose path contains neither LF nor CR (`--stdin-paths` is newline-delimited); a name
   containing LF or CR goes through today's per-file hasher; symlinks hashed in-process as today; results are
   compared in tracked-file order so the first mismatch names the same file as base, with the same error text
   `tree integrity: <rel>`; measured on this repo's HEAD in the evidence README (baseline 21 s).
4. **Not in this deliverable**: a cross-process packet cache (a packet lives as long as its `performFinalPanel`
   call); changing what a packet contains (deny-list, spec, diff — 1a-A/1c own that).

### 1.3 Not in this cut (2-D candidates)
Running verification concurrently with the panel; the single seat as a fast pre-pass; per-seat weights or majority
aggregation (forbidden by the config contract); the 2-B follow-ups (snapshot written after claim, snapshot digest
re-verified on resume, snapshot read when the live roster flips `qc_panel_seats_complete`).

## 2. Changes by file (+ codex mirrors)

### 2.1 `panel-review-station`
- `src/engine/campaign-composition.js`: the `full_diff_review` station takes `input.reviewStation`
  (`'panel'|'single'`, from the snapshot) and calls `reviewPanel` (new adapter) when `panel`; gate-journal kind
  stays `full_diff_review` with `station` in the input identity; the terminal `final_panel` block reuses the last
  in-loop panel receipt when its identity matches (candidate tree, roster digest, packet hash), else dispatches as
  today; `AWAITING_DISPOSITION` payload from a panel review carries the merged findings.
- `src/engine/autopilot-engine.js`: `performFinalPanel` factored so the loop station and the terminal station call
  the same fan-out (`runPanel(reviewInput, { station })`) and the station returns the review-shaped receipt of
  §1.1.1; the `reviewPanel` adapter wired beside `review` (`:8019`); ledger `full_diff_review` row fields.
- `src/engine/campaign-intake.js`: `review_station` in `buildQcPanelSnapshot` (digested), resolved from
  `input.roster.in_rail_review`; step detail `review_station`.
- `schemas/review-loop-contract.schema.json`, `scripts/resolve-review-loop.sh`, `src/engine/resolve-review-loop.js`:
  field `in_rail_review` (`x-field-order`, `properties`, `required`), resolver `auto` rule and the `panel`-with-
  incomplete-panel refusal; `.claude/review-loop-config.md` + `project-config-template/review-loop-config.md`.
- `schemas/implementation-campaign-receipt.schema.json`: `full_diff_review` ledger row optional `station`,
  `seat_count`; the review receipt object may carry the panel fields (optional).
- Tests (RED-first): `implementation-campaign-routing.test.sh` (`proof_parity_run` panel-station scenario: three
  stub seats at the station, FIX-THEN-SHIP → `repair_authorized` → repaired candidate → panel again → converged
  → `final_panel_gate_reused`, exactly two fan-outs; `single` control byte-identical trace; panel below quorum at
  the station → blocked/durable, never a single seat; wall nearly exhausted at the station with a pocket → the
  station panel completes with `budget_source: pocket`; neither suffices → `final_panel_budget_exhausted`; a
  colliding finding id across two seats → both qualified, park on them, resume with dispositions keyed by the
  qualified ids); `autopilot-engine.test.sh` (station panel via the real
  fan-out path with the 2-A stubs; terminal reuse asserts `final_panel_count` and receipts equal the station's);
  `implementation-campaign-state.test.sh` (snapshot carries `review_station`, drift on a flipped live value; a
  2-B fixture snapshot without the key resolves to `single` and passes the identity check unchanged);
  `resolve-review-loop.test.sh` + oracle parity (field, `auto` rule, refusal).
- Docs: `references/blind-dispatch.md` "Panel execution" gains "The panel as the review station (2-C)";
  `skills/l5/references/hetero-impl-loop.md` step 9 sentence; BACKLOG rows "final panel has no repair loop" →
  shipped, redesign row Context (≤240 B, `wc -c`).

### 2.2 `shared-packet`
- `src/runners/review.js`: `buildPacketOnce(identity)` + `prepareReviewLaunch(options, { packet })` taking a
  pre-built packet (materialise into the seat's dir); `dispatchReviewJsonBatch` accepts a shared packet for all
  jobs; batch of one unchanged when no packet is passed (byte-identical).
- `src/runners/review-packet.js`: `verifyTreeIntegrity` batched via `--stdin-paths`; `materializePacket(src, dst)`
  (per-file copy, no hardlinks, returns the re-derived hash) and `hashPacketDir(dir)` (the builder's own function,
  exported so the pre-launch check and the test use the same digest).
- `src/engine/autopilot-engine.js`: `performFinalPanel` (and the 1.1 station, if 1.1 lands first — the two
  deliverables touch disjoint functions in this file; the graph lists the file under both `output_paths` and the
  second campaign bases on the first's merge) builds once, passes the packet to every seat.
- Tests (RED-first): `review-packet.test.sh` (batched hashing equals per-file hashing on a fixture tree with
  symlinks, a NUL-unsafe name and a newline-bearing name; mismatch text and first-mismatch order unchanged; materialised copy is a distinct inode tree — every
  regular file's `ino` differs from the source's — with equal bytes and hash; **mutating a file in one seat dir
  leaves the other seat dirs and the shared hash unchanged**, and a seat dir whose pre-launch re-hash differs is
  refused as `precondition_failed`); `review-runner.test.sh` (three jobs, one packet: `packet_hash` equal on all, three distinct
  launch dirs, exactly ONE `buildReviewPacket` invocation and N `hashPacketDir` calls counted separately); `autopilot-engine.test.sh`
  (`real_batch_panel` asserts one packet build for three seats).
- Docs: `references/blind-dispatch.md` packet paragraph; BACKLOG `verifyTreeIntegrity` row → shipped;
  `docs/scripts-inventory.md` only if a new script appears (none planned).

### 2.5 Sealed `output_paths` (exact; re-check mirrors at base)

`panel-review-station`:
```
src/engine/campaign-composition.js
platforms/codex/plugin/src/engine/campaign-composition.js
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-intake.js
platforms/codex/plugin/src/engine/campaign-intake.js
src/engine/resolve-review-loop.js
platforms/codex/plugin/src/engine/resolve-review-loop.js
scripts/resolve-review-loop.sh
platforms/codex/plugin/scripts/resolve-review-loop.sh
schemas/review-loop-contract.schema.json
platforms/codex/plugin/schemas/review-loop-contract.schema.json
schemas/implementation-campaign-receipt.schema.json
platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-state.test.sh
hooks/tests/resolve-review-loop.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
.claude/review-loop-config.md
project-config-template/review-loop-config.md
platforms/codex/plugin/project-config-template/review-loop-config.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
docs/BACKLOG.md
```
`shared-packet`:
```
src/runners/review.js
platforms/codex/plugin/src/runners/review.js
src/runners/review-packet.js
platforms/codex/plugin/src/runners/review-packet.js
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
hooks/tests/review-packet.test.sh
hooks/tests/review-runner.test.sh
hooks/tests/autopilot-engine.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
docs/BACKLOG.md
```
Nothing created. `max_changed_files` sealed at 27 / 13.

### 2.6 Global constraints
- The panel station never falls back to a single seat; a panel below quorum blocks or parks, visibly.
- No second panel spend on the final candidate: the terminal station reuses the in-loop receipt by identity.
- Inputs without a snapshot, or with `review_station: single`, are byte-identical to base in trace, ledger and
  receipts.
- A seat never launches against a directory another seat can write; every seat receipt's `packet_hash` is the
  shared build's hash.
- `scripts/dispatch-review.sh`, `scripts/lib/cleanroom-launch.sh`, `scripts/lib/review-fanout.js`, resolvers
  other than `resolve-review-loop.*` are byte-identical.

## 3. Out of scope
§1.3; a cross-process packet cache.

## 4. Acceptance
| id | criterion | evidence |
|----|-----------|----------|
| `station` | with a sealed panel the loop's review station is the panel; FIX-THEN-SHIP authorises a repair and the panel runs again on the repaired candidate; the terminal panel is reused, exactly N fan-outs for N candidates; `single` and no-snapshot controls byte-identical | routing + engine suites |
| `station-safety` | a below-quorum station panel blocks/parks with the 2-B reason; never a single-seat dispatch; the station is budgeted like the terminal panel (pocket, `budget_source`) | routing suite |
| `knob` | `in_rail_review` resolves (`auto` rule, refusal), is sealed in the snapshot, drift recorded | resolver + state suites |
| `packet-once` | one `buildReviewPacket` per candidate for a panel; per-seat private dirs; equal `packet_hash` on every row; hash equal to base's per-seat build | runner + engine suites |
| `tree-hash-batch` | batched integrity equals per-file on a fixture with symlinks; timing on this repo recorded | packet suite + evidence |
| `no-regression` | §4.1 all exit 0 at each candidate; base recorded | evidence |
| `scope-integrity` | diff ⊆ §2.5 per deliverable; §2.6 byte-identical files | command output |

### 4.1 No-regression commands (exact; also the graph's `verification_commands`)
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
```
Base record: `evidence/…-panel-station/base-suites-<base>.txt` (detached checkout, sequential). Evidence files
(base/head suite records, the timing README, one `red-<suite>.txt` per new case carrying the exact base assertion
message) are depth-0 artefacts committed OUTSIDE the campaign, as in 2-A/2-B; they are not in §2.5.

## 5. Dogfood proof (depth-0)
The `shared-packet` campaign (second) runs on the `panel-review-station` merge with four qc seats
(claude-fable-5-1, GLM-5.2, MiniMax-M3 + one more family, pinned first) and `min_panel_size: 3`, `in_rail_review:
auto`: its ledger shows ONE `full_diff_review` row with `station: panel` and four seat receipts, no single-seat
review, `final_panel_gate_reused`, and — if a seat returns FIX-THEN-SHIP — a `repair_authorized` round followed by a
second station panel; `full_diff_review` rows carry one `packet_hash` across seats. This also produces the 2-B §5
live proof (four seats, quorum) and, with the v2.36.67 projection, the 2-A §5 pocket proof (`budget_source:
pocket` when the terminal panel is not reused — expected NOT to occur; record whichever happens).

## 6. Risks + inversion
- **A repair round costs a panel** — bounded by `max_repair_generations` (2) and the wall; the station row makes
  it visible; `single` keeps today's cost.
- **Terminal reuse hides a stale panel** — reuse is by candidate tree + roster digest + packet hash; a repaired
  candidate has a new tree and was reviewed by the station.
- **A shared build leaks between seats** — never shared: private per-file copies (no hardlinks), each re-hashed
  against the shared `packet_hash` before launch; the mutation-isolation and hash-equality cases pin it.
- **Batched hashing changes a verdict** — pinned equal to per-file hashing on symlinks and odd names; same error.

## 7. Where this sits
1a-A ✓ → 1a-B ✓ → 1b-A ✓ → 1b-B ✓ → 1c ✓ → 2-A ✓ → 2-B ✓ → **2-C (this: station, packet)** → 2-D (overlap, pre-pass).

## Review log
- Plan hetero loop G1 2026-09-18 (GLM-5.2 STOP: 1 blocker; claude seat fell to the MiniMax-M3 fallback, READY, no
  findings; `g1-*`, `plan.as-reviewed-g1.md`): accepted — hardlink materialisation is not isolation (shared inode);
  §1.2.2 now requires plain per-file copies (reflink only as copy-on-write), forbids hardlinks, re-hashes every seat
  dir against the shared `packet_hash` before launch, and §2.2 pins the mutation-isolation case.
- G2 2026-09-18 (terminal at the cap; GLM-5.2 READY, claude-fable-5-1 CONDITIONAL: 1 blocker + 6 non-blocking;
  `g2-*`, `plan.as-reviewed-g2.md`): all seven accepted — the station panel is budgeted like the terminal panel
  (pocket, `budget_source`, `final_panel_budget_exhausted`; §3 clause removed); a 2-B snapshot without
  `review_station` is `single` with its digest checked over the fields present; newline/CR names bypass the batched
  hasher with order preserved; colliding finding ids qualified by seat index; the runner case counts
  `buildReviewPacket` (1) and `hashPacketDir` (N) separately; evidence files live outside the campaign; `red-<suite>.txt`
  per new case. Growth 1.07×. Zero unaddressed blockers, zero deferred.
