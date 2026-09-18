# Implementation brief — blind-review-panel-parallel-2026-09-18 (cut 2-A)

ONE managed deliverable. The harness commits; never push, never `git stash`, never touch files outside the
sealed `output_paths`, never run a real reviewer model. Base for RED evidence and byte-identity: `7f5d6ee8`.

## Read first
1. `docs/plans/2026-09-18-blind-review-panel-parallel.md` — §0 (every anchor you need), §1 items 1–3 NORMATIVE,
   §2, §2.5, §2.6, §4, §4.1. The plan wins over this brief. Then `.rubric.md` R1–R8.
2. Code named in §0: `src/runners/review.js` `dispatchReview`; `src/engine/autopilot-engine.js` wall fns,
   `reviewDispatcher` seam, `performReview`, `buildReviewArgs`, `finalPanelSeatReceipt`, `performFinalPanel`,
   verification cache, `fullSuite`; `campaign-verification.js` `reusableGreenReceipt`; `campaign-intake.js`
   limits sealing; `mission-execution-graph.js`, `mission-convergence.js` (budget → contract),
   `campaign-dispatch-projection.js`; both schemas. Tests named in §0/§2.

## Product (plan §1 normative)
1. `scripts/lib/review-fanout.js` (NEW, `chmod +x`, Node built-ins): stdin JSON `{ jobs: [{ id, argv, cwd, env,
   stdin_file, timeout_seconds }] }` → spawn ALL at once; per job: capture stdout/stderr as strings under a 1 MiB
   maxBuffer (overflow → `status: null` + `error`), `timeout_seconds` = SIGTERM at that instant, SIGKILL 5 s
   later, reported as `signal`; record per-job `started_at`/`ended_at`; print ONE JSON array in job order
   `{ id, status, signal, error, stdout, stderr, started_at, ended_at }`; exit 0 whenever the array was produced;
   a job failure is a row, never a throw. Mirror.
2. `review.js`: split `dispatchReview` into `prepareReviewLaunch(options)` (packet build, args, prompt, env, blind
   dir; sync) / launch / `finishReviewLaunch(prepared, raw)` (envelope, parse, packet fields, blind-dir cleanup);
   add `dispatchReviewBatch(optionsList)` = prepare each → ONE `spawnSync` of the helper → finish each in order;
   `dispatchReview(options)` = `dispatchReviewBatch([options])[0]`, field-by-field identical to today. Mirror.
3. Engine: `campaignWallBudgetStatus`/`campaignWallRemainingSeconds(control, now, { consumer })`
   (`'review'` default = today; `'panel'` = limit + `initial_state.limits.final_panel_reserve_seconds`);
   `performReview` gains `budget_consumer` (default `'review'`) used for BOTH its exhaustion check and clamp;
   `performFinalPanel`: after the cross-family check, ONE refusal check against `'panel'`
   (`final_panel_budget_exhausted`, before any prepare); then prepare every qualified seat with
   `budget_consumer: 'panel'` and `review_timeout_seconds` = the WHOLE panel remainder, launch the batch (or,
   when `this.reviewDispatcher` was injected, call it per seat in index order), finish in seat-index order;
   every panel seat ledger row and the `final_panel` row carry the batch `started_at`/`ended_at` (no per-seat
   timing anywhere); `final_panel` row gains `budget_source: 'wall'|'pocket'`, `seat_timeout_seconds`.
   `fullSuite`: consult `verificationCache` with `reusableGreenReceipt(cached, suiteRequest)` unless
   `initial_state.limits.full_suite_reuse === false` → on hit: ledger `full_suite` `passed` with
   `reused_from: 'campaign_verification'`, `receipt_digest`, `tree_sha`; trace `full_suite_reused_verification`;
   no worktree; rewrite the comment at :7634-7636 to the identity argument. Mirror.
4. Plumbing (pass-through, default when absent): `final_panel_reserve_seconds` int 0..1800 (default 0) and
   `full_suite_reuse` bool (default true) through graph node `campaign.*` (graph checker + graph schema),
   projection budget, `mission-convergence.js` contract build, contract schema, intake → `initial_state.limits`.
   Receipt schema: `full_suite` row optional `reused_from`; `final_panel` row optional `budget_source`,
   `seat_timeout_seconds`. Mirrors.
5. `sync-codex-plugin-skills.sh` then `--check`.

## Tests (RED-first, `# RED at base 7f5d6ee8: <observed>`; never weaken)
review-runner: three stub `dispatch-review.sh` sleeping 2/3/4 s → rows in job order, `max(started_at) <
min(ended_at)`, wall < sum − 1 s; a job past `timeout_seconds` → `signal` set, others reviewed; batch of one
field-by-field == pre-split single result on a fixture. autopilot-engine: 3-seat panel via stub dispatcher →
receipts + panel `review_digest` equal a sequential run; stubs called in index order; every seat `--timeout` ==
whole remainder and == helper `timeout_seconds`; pocket: wall exhausted + reserve 300 → `budget_source: pocket`,
reserve 0 → `final_panel_budget_exhausted` before any dispatcher call; verify-once: hit → no worktree + trace +
ledger fields, changed tree → fresh, RED receipt → fresh, `full_suite_reuse: false` → fresh. dogfood: `115s`
in-rail pin unchanged, panel seat = remainder. routing: `proof_parity_run` still passes. receipt: new optional
fields admitted, unknown rejected. projection + convergence: reserve 0/900/1801 → admitted/admitted/refused,
absent ⇒ 0; `full_suite_reuse` absent ⇒ true.

## Docs
`references/blind-dispatch.md` "Panel execution (v2.36.65)" paragraph (+ mirror); `skills/l5/references/hetero-impl-loop.md`
recipe step 3 (verify-once) and 9 (parallel panel, pocket) sentences (+ mirror); `docs/scripts-inventory.md` one row
for `lib/review-fanout.js`; `CLAUDE.md` Dispatch rails group add `lib/review-fanout.js` (keep lines ≤ 800 B);
`docs/BACKLOG.md`: redesign row Context EXACTLY `packet (tree + git diff + spec, deny-list); packet/cleanroom tiers;
intake canary; verify-once; parallel seats. Shipped: 1a-A v2.36.59, 1a-B v2.36.61, 1b-A v2.36.62, 1b-B v2.36.63, 1c
v2.36.64, 2-A v2.36.65. Open: 2-B (standby, snapshot, in-rail off). Detail in the pointer.` (Status `open`); the
"final-panel seats starve" row Status → `shipped v2.36.65 2026-09-18`. Do NOT touch CHANGELOG.md, version manifests.

## Verify (§4.1; one at a time, foreground, all exit 0)
```
bash hooks/tests/review-runner.test.sh
bash hooks/tests/autopilot-engine.test.sh
bash hooks/tests/implementation-campaign-dogfood.test.sh
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/qc-panel-honesty.test.sh
bash hooks/tests/review-packet.test.sh
bash hooks/tests/contract-parity.test.sh
bash hooks/tests/campaign-dispatch-projection.test.sh
bash hooks/tests/mission-convergence.test.sh
node scripts/check-js-syntax.js
node scripts/check-claude-md-inventory.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
git diff --stat 7f5d6ee8 -- src/runners/review-packet.js scripts/dispatch-review.sh scripts/lib/cleanroom-launch.sh scripts/resolve-review-loop.sh src/engine/resolve-review-loop.js  # empty
```

## Sealed output_paths (ONLY files you may change; the two review-fanout.js paths are CREATED; every
`platforms/codex/plugin/...` twin of a listed path is also sealed — sync, don't hand-edit)
```
scripts/lib/review-fanout.js
src/runners/review.js
src/engine/autopilot-engine.js
src/engine/campaign-intake.js
src/engine/mission-execution-graph.js
src/engine/mission-convergence.js
src/engine/campaign-dispatch-projection.js
schemas/mission-execution-graph.schema.json
schemas/implementation-campaign-contract.schema.json
schemas/implementation-campaign-receipt.schema.json
hooks/tests/review-runner.test.sh
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-dogfood.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
hooks/tests/campaign-dispatch-projection.test.sh
hooks/tests/mission-convergence.test.sh
references/blind-dispatch.md
skills/l5/references/hetero-impl-loop.md
docs/scripts-inventory.md
CLAUDE.md
docs/BACKLOG.md
```
Finish with a clean tree; report RED-at-base messages and suite counts.
