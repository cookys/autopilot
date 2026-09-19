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
  but concurrently would not, the campaign completes; the same fixture at base blocks `campaign_wall_budget`.
  Neither station's `--timeout` shrinks because the other started.
- **KR3 (snapshot is a contract)** — on resume, a snapshot whose recomputed digest (all fields, including
  `review_station`) differs from the file is `blocked` at intake with `qc_panel_snapshot_drift` naming the field(s),
  not `step.live_drift`; a live roster flip of `qc_panel_seats_complete` after sealing is journaled
  (`qc_panel_snapshot_live_flip`) and the sealed station still runs; the snapshot is written AFTER the Mission claim
  and a rejected claim leaves no file.
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
| `src/engine/implementation-campaign.js` | D1: `full_suite`/`dispatch_review` ledger rows carry `started_at`/`ended_at` (already) — assert only; no reducer change expected |
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
   (no verification-cache hit for the candidate tree), dispatch `full_suite` and `full_diff_review` via
   `Promise.all` on the two adapters with one `startedAt`; push both trace rows; a failure in either station keeps
   today's failure shape for that station (the other's receipt is still recorded, never discarded). `adjudicate`
   waits on both. When `reviewStation === 'single'` or the suite is a cache hit, the order and timings are
   byte-identical to base (KR4).
3. Budget: both adapters compute their `--timeout`/deadline from `campaignWallRemainingSeconds` read once at
   `startedAt` (panel with `consumer:'panel'`, suite without); neither re-reads after the other finishes. Run
   summary gains `station_overlap`. The wall-expiry terminalization of v2.36.71 (`terminalizeWallExpiry`) applies to
   whichever station reports exhaustion first; the other station's result is still journaled.
4. GREEN: KR1 (entries ≤ 5 s apart; adjudicate after both), KR2 (clock fixture completes; base blocks), KR4
   (single control unchanged, cache-hit control unchanged). Codex mirrors; `references/blind-dispatch.md` paragraph.
   Acceptance: `autopilot-engine-station-overlap`, `autopilot-engine`, `implementation-campaign-routing`,
   `autopilot-engine-park-reserve`, `autopilot-engine-wall-expiry`, `mission-runtime-v2`, `campaign-dispatch-projection`
   green; sync-check; consumer sweep of `full_suite|reviewPanel|runPanel|station_overlap`.

### D2 — `snapshot-contract` (S-size deliverable)
1. RED (`implementation-campaign-state-snapshot-contract.test.sh`): (a) intake step order shows `qc_panel_snapshot`
   before `mission` (fixture `implementation-campaign-state.test.sh:3047`) and a rejected claim still leaves the file;
   (b) an `EEXIST` snapshot with a mutated `min_panel_size` but same `campaign_id`/`contract_digest` is accepted with
   `step.live_drift` only; (c) a live roster flip after sealing is invisible in the journal.
2. Move the snapshot write after a successful `missionClaimAdapter` (a rejected claim → no file; `panel-snap-write`
   and the step-order fixture updated to the new order — the ONLY existing assertions that change, each with a RED
   note explaining the reorder). On `EEXIST`, recompute the digest over every field the file carries (2-B fields +
   `review_station` when present) and reject `qc_panel_snapshot_drift` naming the differing fields; the pre-2-C
   snapshot without `review_station` is digested without it (2-C's rule, unchanged).
3. `snapshotStation`: read the live `qc_panel_seats_complete`; when it differs from what the snapshot implies,
   journal `qc_panel_snapshot_live_flip {sealed_station, live_seats_complete}` and run the SEALED station.
4. GREEN: KR3; `panel-snap-write`/`panel-snap-drift`/`review_station_snapshot` updated only where the order or the
   drift severity is the assertion under test; everything else byte-identical. Codex mirrors.
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
  measure `full_suite_seconds` on the first live campaign; if it grows > 20 % vs the serial baseline, D1 gets a
  `station_overlap: off` escape in the contract (a follow-up, not this cut).
- Moving the snapshot write after the claim changes intake step order; a consumer that indexed steps positionally
  breaks. Mitigation: grep `steps[` / `steps.find` consumers before D2 step 2; the RED case names them.
- Reader asymmetry: a rejected `qc_panel_snapshot_drift` at resume leaves the campaign parked — verify (as C did in
  v2.36.71) that the rejection path does not terminalize.

## 7. Out of scope

- **The single seat as a fast pre-pass** (2-C §1.3 item 2). `in_rail_review` has no free enum value and there is
  no evidence that a single seat's verdict predicts the panel's on the same candidate; a pre-pass that skips the panel
  on SHIP-AS-IS would weaken the quorum without a measurement behind it. Deferred to a Spike row: measure, on the next
  five panel campaigns, how often the panel's union verdict equals the single reviewer seat's, before designing the knob.
- Per-seat weights / majority (forbidden). Any reducer change. Any new contract knob.

## 8. Open questions (Board)

1. D1 overlaps `full_suite` with the panel. The leading `focused_verification` (~21 min measured) stays serial
   because the candidate must be verified before the packet is worth reviewing — confirm, or ask for the bolder cut
   (packet build + panel dispatch racing focused verification, with the panel's verdict held until verify passes).
2. Is a `station_overlap: off` contract escape wanted in this cut, or only if the CPU-contention risk materialises?

## Review log

- R0 2026-09-19 (depth-0, author). `logical_plan_id`: `blind-review-2d-overlap`. Manifest and frozen rubric: to be
  written beside this plan before the G1 seat dispatch (`docs/plans/2026-09-19-blind-review-2d-overlap.manifest.json`).
