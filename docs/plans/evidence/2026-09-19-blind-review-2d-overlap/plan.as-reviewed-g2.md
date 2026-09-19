# Blind review redesign — cut 2-D: the post-review suite runs alongside the panel, and the panel snapshot is a contract

> Status: draft for plan hetero loop · Size: L (two independent deliverables) · Base: `b3e7b6f6` (v2.36.72) · Parent:
> `docs/plans/2026-09-18-blind-review-panel-station.md` §1.3 "Not in this cut (2-D candidates)" (`:135-138`) and the
> design consult `evidence/2026-09-16-blind-review-redesign/consult-claude-fable-5-1.md` §3 "Speed cuts" ("overlap").
> 2-C (v2.36.68/69) shipped the panel as the loop's review station and one packet per candidate; its own §1.3 named
> this cut. Evidence dir: `docs/plans/evidence/2026-09-19-blind-review-2d-overlap/`.

## 0. What is actually true today (verified 2026-09-19 at base, `src/engine/campaign-composition.js` unless noted)

- **Per-generation station order is serial**: `focused_verification` (`:2200-2371`) → `full_diff_review`
  (`:2092`; `reviewPanel` when `input.reviewStation === 'panel'`, `:2070-2079`) → optional
  `focused_review_supplement` (`:2425-2478`) → **`full_suite`** (`:2484-2593`, a second independent verification
  pass; comment `:2483` "Identity, not timeline … a focused receipt cannot match argv_hash") → `adjudicate`
  (`:2686`). The two stations that could overlap are `full_diff_review` (panel, ~9 min measured) and `full_suite`
  (the post-review suite; unmeasured — the only measured verify split is scope+focused-verify ≈ 21 min,
  `evidence/2026-09-18-blind-review-shared-packet/README.md:13-17`). Neither feeds the other: the review packet is
  built from candidate tree/diff/spec only (`src/runners/review-packet.js`), and `full_suite` consumes
  `verificationCache` keyed by `request_digest` (`autopilot-engine.js:8228-8281`, `reused_from:
  'campaign_verification'`). `adjudicate` is the only reader of both (`lastReview`/`fullDiff` from `:2092+`,
  `verification.passed` from `:2337+`).
- **One wall clock, drawn down serially**: `campaignWallBudgetStatus` (`autopilot-engine.js:1485-1512`) reads
  `campaignClockElapsedSeconds` (`implementation-campaign.js`, paused only in `awaiting_disposition`); the panel's
  `consumer: 'panel'` adds `final_panel_reserve_seconds` (`:1497-1500`), verify's default consumer does not. Seat
  `--timeout` = `campaignWallRemainingSeconds(..., {consumer:'panel'}).seconds` at dispatch (`:5497`,
  `budget_source: wall|pocket`). Two stations started at the same instant read the same `elapsed` and the same
  `remaining` — the clock itself needs no change; only the sequencing does.
- **The panel snapshot is sealed before the Mission claim and is advisory on resume**: intake writes
  `qc_panel_snapshot.json` with `O_EXCL` at `campaign-intake.js:2071-2073`, BEFORE `missionClaimAdapter`
  (`:2227-2230`); on `EEXIST` it checks only `campaign_id` + `contract_digest` (`:2107-2113`); a freshly built live
  snapshot's digest mismatch becomes `step.live_drift` (`:2124-2141`) and blocks nothing (`panel-snap-drift`,
  `hooks/tests/autopilot-engine.test.sh:6222-6247` — panel still runs). `runPanel` prefers the durable snapshot and
  falls back to the live roster only when the snapshot is null/incomplete (`:5387-5401`); `snapshotStation` reads
  `qc_panel_snapshot.review_station` (`:7099-7102`) and never reconciles against a live `qc_panel_seats_complete`
  flip — the gap the 2-C evidence README names (`…panel-station/README.md:42`).
- **`in_rail_review` is exhaustively `auto|single|panel`** (`schemas/review-loop-contract.schema.json:246-254`;
  resolver rule `scripts/resolve-review-loop.sh:851-861`); `resolveReviewStation` (`campaign-intake.js:361-367`)
  resolves once at intake. No code path runs a single seat and then a panel. Per-seat weights / majority do not
  exist and are forbidden (`project-config-template/review-loop-config.md:96-98,196`).

## 1. Problem

A managed campaign spends its wall serially on two stations that do not depend on each other. On the one measured
campaign (`5d7ad66a`) the panel took 9 min after verification; a repair round re-pays every station, and v2.36.71's
park-time estimate (`repair_round_estimate_seconds`) now shows the operator exactly how often the remaining wall
cannot fit one. The cheapest wall to recover is the serial gap between the post-review suite and the panel.
Separately, the panel snapshot that 2-B introduced to freeze the panel's composition is written before the claim
exists, re-verified only by two fields, and ignored when the live roster flips — a "contract" that binds nothing.

## 2. OKR / KRs

- **KR1 (overlap)** — on a campaign whose panel and `full_suite` both run, `ledger.full_suite.started_at` and
  `ledger.dispatch_review.started_at` differ by ≤ 5 s, and `adjudicate` starts after BOTH `ended_at`; the run summary
  carries `station_overlap: {panel_seconds, full_suite_seconds, saved_seconds = min(panel, full_suite)}`. On the
  first live campaign after the merge, `saved_seconds > 0` is recorded in the evidence README (live proof one
  lineage late — evidence-discipline §38).
- **KR2 (no double spend)** — with a clock injected so that panel + suite serially would exceed `max_wall_seconds`
  but concurrently would not, the campaign completes; the same fixture at base blocks at the `full_suite` pre-station
  wall check (`autopilot-engine.js:7842`, `campaign wall budget exhausted before verification`, phase
  `campaign_wall_budget`, since v2.36.71 terminalized `wall_expired`) because the panel already consumed the wall
  before the suite's check ran. There is no summed estimate anywhere — each station checks the shared elapsed clock
  when it starts; overlap only moves the suite's check to the same instant as the panel's. Neither station's
  `--timeout` shrinks because the other started. The RED comment records the exact block payload observed at base.
- **KR3 (snapshot is a contract)** — on `EEXIST` at intake, the file's stored `digest` is recomputed over the fields the
  file carries (2-C's rule: `review_station` only when present) and a file whose stored digest does not match its own
  fields, or whose identity (`campaign_id`, `contract_digest`) does not match the run, is `blocked` at intake with
  `qc_panel_snapshot_drift` naming the field(s) and the campaign stays parked (no terminalization — verified as in
  v2.36.71 C). `step.live_drift` (live roster vs sealed file) keeps its 2-B/2-C meaning and stays non-blocking. A
  live roster flip of `qc_panel_seats_complete` after sealing is journaled (`qc_panel_snapshot_live_flip`) and the
  sealed station still runs. The write stays BEFORE the Mission claim (O_EXCL, unchanged); when the claim this intake
  just minted is rejected, the intake unlinks the file it wrote in this same call (never a file it found) — so a
  rejected claim leaves no file and there is no claim-held-without-snapshot window to reason about.
- **KR4 (byte-identical elsewhere)** — single-station campaigns (`review_station: single`), campaigns without a
  `full_suite` (verification cache hit), and every pre-2-D journal replay are unchanged: `station_single_control`
  (`implementation-campaign-routing.test.sh:3482`) and the 2-B/2-C fixtures stay green untouched.

## 2.5 Global Constraints (copied verbatim into every dispatch)

- ADR-0001: a reviewer's verdict is a claim until depth-0 re-derives it from the reviewer's JSON artifact and the
  exact base..head range it reviewed; an implementer's green is a claim, never a gate.
- The panel's aggregation stays `union-on-verified-critical`; no per-seat weights, no majority — anywhere.
- The wall clock (`campaignClockElapsedSeconds`) is the single source of elapsed time; no station keeps its own
  accumulator; nothing writes `elapsed_wall_seconds` except the reducer.
- Every new schema field is optional and every pre-2-D journal replays byte-identically; `additionalProperties:false`
  schemas gain the field in the same commit as the code, twin included.
- Codex mirrors via `bash scripts/sync-codex-plugin-skills.sh` in the same commit; `--check` clean before review.
- RED-first: every new case records the observed base output in a `# RED at <base sha>: …` comment; no existing
  assertion is weakened; new `*.test.sh` are executable and go through `run.sh <filter>` once.

## 2.6 Change-policy decisions

- **Compatibility impact**: `internal-only` — no CLI flag, no config knob, no contract field changes; the run summary
  and the intake steps gain optional fields; the snapshot file's write moves after the claim (same content, same
  path).
- **Dependency decision**: `none` — built-ins only.

## 3. File-structure map

| File | Responsibility in this cut |
|---|---|
| `src/engine/campaign-composition.js` | D1: start `full_suite` and `full_diff_review` (panel station only) together, join before `adjudicate`; `station_overlap` on the trace |
| `src/engine/autopilot-engine.js` | D1: adapters `fullSuite`/`reviewPanel` accept a shared `startedAt`; summary field; D2: `snapshotStation` reconciles against the live flip and journals it |
| `src/engine/campaign-intake.js` | D2: snapshot write after `missionClaimAdapter`; full-digest re-verify on `EEXIST` → `qc_panel_snapshot_drift` rejection; live-flip journal |
| `src/engine/implementation-campaign.js` | not touched: no reducer change; if the `full_suite`/`dispatch_review` ledger rows turn out to lack `started_at`/`ended_at`, D1 stops and re-plans instead of editing the reducer |
| `schemas/implementation-campaign-receipt.schema.json` | D1: optional `station_overlap` on the run receipt (if the receipt schema is closed) |
| `hooks/tests/autopilot-engine-station-overlap.test.sh` (new) | D1 KR1/KR2/KR4 cases |
| `hooks/tests/implementation-campaign-state-snapshot-contract.test.sh` (new) | D2 KR3 cases (reordered step order fixture, drift rejection, live flip) |
| `references/blind-dispatch.md` | station-order narrative: "panel and post-review suite overlap; join before adjudicate" |
| codex twins under `platforms/codex/plugin/` | sync script |

## 4. Phases (two independent deliverables; D2 has no dependency on D1)

### D1 — `verify-panel-overlap` (L-size deliverable, one managed campaign)
1. RED (`autopilot-engine-station-overlap.test.sh`, injected `fullSuite` and `reviewPanel` adapters that record
   `Date.now()` on entry and sleep 200 ms): at base the two entries are ≥ 200 ms apart and in the order
   review → suite; KR2's clock fixture blocks `campaign_wall_budget` at base.
2. In `runCampaignComposition`, when `reviewStation === 'panel'` and the generation will run `full_suite`
   (no verification-cache hit for the candidate tree), start two chains at one `startedAt`: chain A =
   `full_diff_review` (panel) followed, when configured, by `focused_review_supplement` (it consumes the review
   output, so it stays strictly after the panel and inside chain A); chain B = `full_suite`. Join with
   `Promise.allSettled([A, B])` — never `Promise.all` — and both adapters return failure receipts rather than
   throwing; the composer pushes both trace rows after the join and `adjudicate` waits on both. A failure in either
   chain keeps today's failure shape for that station and the other chain's receipt is still recorded (RED case:
   injected `reviewPanel` throws → base loses the suite row; GREEN the `full_suite` receipt is still in trace and
   ledger). When `reviewStation === 'single'` or the suite is a cache hit, the order and timings are byte-identical to
   base (KR4). Spike step recorded in the evidence README before coding: both adapters are async and
   child-process backed at base (`fullSuite:` / `reviewPanel:` wiring at `autopilot-engine.js:8401-8402`), so in-process
   overlap is real; the serial `full_suite_seconds` baseline is read from the last pre-merge campaign's ledger.
3. Budget: both adapters compute their `--timeout`/deadline from `campaignWallRemainingSeconds` read once at
   `startedAt` (panel with `consumer:'panel'`, suite without); neither re-reads after the other finishes. Budgeting
   keeps the existing pocket rule unchanged: the panel keeps `final_panel_reserve_seconds` via `consumer:'panel'`, the
   suite draws only the unreserved remainder, and neither adapter re-derives its deadline after the join. Run summary
   gains `station_overlap`. Wall expiry (`terminalizeWallExpiry`, v2.36.71) fires when the first chain reports
   exhaustion; the sibling chain is allowed to finish within its own already-computed deadline (its seat/suite
   processes carry that deadline as `--timeout`, so nothing outlives it) and its receipt is journaled before the
   terminal event; RED case: after terminalization no seat process for the campaign survives (pin via the runner's
   own pid/manifest listing, `dispatch-status.js --run <seat>`).
4. GREEN: KR1 (entries ≤ 5 s apart; adjudicate after both), KR2 (clock fixture completes; base blocks), KR4:
   `station_single_control` (`implementation-campaign-routing.test.sh:3482`) untouched; the verification-cache-hit
   path has no existing control — add one in the new suite (`fullSuite` returns `reused_from: 'campaign_verification'`
   → serial order and base timings, RED note with the observed base trace), and a pre-2-D journal replay control
   (replay the `panel-standby`/2-C fixture journal from `autopilot-engine.test.sh:6148-6186` through
   `projectCampaign`, assert byte-identical projection). Codex mirrors; `references/blind-dispatch.md` paragraph.
   Acceptance: `autopilot-engine-station-overlap`, `autopilot-engine`, `implementation-campaign-routing`,
   `autopilot-engine-park-reserve`, `autopilot-engine-wall-expiry`, `mission-runtime-v2`, `campaign-dispatch-projection`
   green; sync-check; consumer sweep of `full_suite|reviewPanel|runPanel|station_overlap`.

### D2 — `snapshot-contract` (S-size deliverable)
1. RED (`implementation-campaign-state-snapshot-contract.test.sh`, all new cases; no existing suite edited): (a) a
   rejected Mission claim leaves the snapshot file this intake just wrote on disk (observed base: file present,
   step order `qc_panel_snapshot, mission, …` from the fixture at `implementation-campaign-state.test.sh:3047`);
   (b) an `EEXIST` file with a mutated `min_panel_size` but unchanged stored `digest` and same
   `campaign_id`/`contract_digest` is accepted with only `step.live_drift`; (c) a live roster flip after sealing is
   invisible in the journal. Record the observed base outputs in the RED comments.
2. Intake: keep the O_EXCL write before the claim; remember whether THIS call created the file; when the claim minted
   in this call is rejected, unlink only a file this call created (a found file is never touched) — a rejected claim
   leaves no file, and a crash between write and claim leaves a file whose identity/digest the next intake verifies
   exactly as any other `EEXIST` file. On `EEXIST`: verify identity (as today) AND recompute the digest over the
   fields the file carries (2-C's rule — `review_station` only when present; pre-2-C files without it digest without
   it, exactly as 2-C already does — no new stored field is needed because every 2-B+ file already carries `digest`)
   and compare with the file's stored `digest`; a mismatch is `blocked` with `qc_panel_snapshot_drift` naming the
   fields, campaign parked, no terminalization (assert both). `step.live_drift` unchanged.
3. `snapshotStation`: read the live `qc_panel_seats_complete`; when it differs from what the sealed `review_station`
   implies, journal `qc_panel_snapshot_live_flip {sealed_station, live_seats_complete}` and run the SEALED station.
4. GREEN: KR3 in the new suite only; `panel-snap-write`, `panel-snap-drift`, `review_station_snapshot` and the
   step-order fixture are byte-identical (no existing assertion changes in D2). Codex mirrors.
   Acceptance: new suite, `autopilot-engine`, `implementation-campaign-state`, `implementation-campaign-routing`,
   `mission-runtime-v2`, `mission-routing-campaign-bridge` green; sync-check; consumer sweep of
   `qc_panel_snapshot|live_drift|snapshotStation`.

## 5. Test / validation

Script-gated: every acceptance list above, run one suite at a time in a scratch clone, then the §37 consumer sweep
(one Bash call, `< /dev/null`), then `hooks/tests/run.sh` with the host-red set attributed at base. Human-gated:
the live proof of KR1 (`saved_seconds > 0`) is observable only on the NEXT managed campaign after the merge
(evidence-discipline §38) — record it one lineage late in the evidence README.

## 6. Risks + inversion

- **Guaranteed failure**: overlapping stations that share a mutable object (e.g. `campaignControl` written by both
  adapters) → racing writes. Mitigation: adapters return receipts; the composer is the only writer, after the join.
- The panel's pocket (`final_panel_reserve_seconds`) was sized for a panel that starts AFTER the suite; starting
  earlier only leaves more wall — but a suite that overruns now competes with seat processes for CPU. Mitigation:
  the serial `full_suite_seconds` baseline is recorded from the last pre-merge campaign before coding (D1 step 2
  spike); the first live campaign after the merge records the overlapped value; if it grows > 20 % the follow-up
  BACKLOG row (a `station_overlap: off` contract knob) is filed with that measurement as its trigger. No knob in
  this cut.
- Unlinking a snapshot on claim rejection must never remove a file another intake wrote. Mitigation: the unlink is
  gated on the O_EXCL write having succeeded in this call; the RED case seeds a foreign file and asserts it survives
  a rejected claim.
- Reader asymmetry: a rejected `qc_panel_snapshot_drift` at resume leaves the campaign parked — verify (as C did in
  v2.36.71) that the rejection path does not terminalize.

## 7. Out of scope

- Any new contract knob (incl. `station_overlap: off`) and any reducer change — unconditionally, in this cut.

- **The single seat as a fast pre-pass** (2-C §1.3 item 2). `in_rail_review` has no free enum value and there is
  no evidence that a single seat's verdict predicts the panel's on the same candidate; a pre-pass that skips the panel
  on SHIP-AS-IS would weaken the quorum without a measurement behind it. Deferred to a Spike row: measure, on the next
  five panel campaigns, how often the panel's union verdict equals the single reviewer seat's, before designing the knob.
- Per-seat weights / majority (forbidden). Any reducer change. Any new contract knob.

## 8. Open questions (Board)

1. D1 overlaps `full_suite` with the panel. The leading `focused_verification` (~21 min measured) stays serial
   because the candidate must be verified before the packet is worth reviewing — confirm, or ask for the bolder cut
   (packet build + panel dispatch racing focused verification, with the panel's verdict held until verify passes).
2. (closed by G1, R5) No contract knob in this cut; a `station_overlap: off` escape is a follow-up row triggered by the
   measured > 20 % overrun.

## Review log

- R0 2026-09-19 (depth-0, author). `logical_plan_id`: `blind-review-2d-overlap-2026-09-19`. Manifest
  `docs/plans/2026-09-19-blind-review-2d-overlap.plan-review-manifest.json`, frozen rubric `…2d-overlap.rubric.md` (R1–R7).
- Plan hetero loop G1 2026-09-19 (GLM-5.2 CONDITIONAL, claude-fable-5-1 CONDITIONAL; 4 blockers R1/R2/R4/R6 + 4
  non-blocking; `evidence/2026-09-19-blind-review-2d-overlap/g1-*`, `plan.as-reviewed-g1.md`): all eight accepted —
  join is `allSettled` over chain A (panel→supplement) and chain B (suite), adapters never throw; the KR2 gate is named
  (`autopilot-engine.js:7842`, nothing sums stations); the snapshot write stays before the claim and a rejected claim
  unlinks only the file this intake created (no claim-held-without-snapshot window), digest verified against the file's
  own stored digest; D2 edits no existing assertion; pocket sentence, cache-hit/replay controls, §8 Q2 closed, async
  spike noted. Growth 1.24×.
