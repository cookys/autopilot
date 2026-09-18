# Blind review redesign — cut 2-A: verify once per tree, panel seats in parallel, a sealed panel pocket

> Status: draft for plan hetero loop · Size: L · Base: `aab9523d` (v2.36.64) · Parent:
> `docs/plans/2026-09-16-blind-review-packet.md` §7 item 4 (`:311-312`: "verify once per tree, in-rail single
> review off when a panel exists, seats in separate processes concurrently, one standby seat, panel snapshot
> at intake") and the design consult `evidence/2026-09-16-blind-review-redesign/consult-claude-fable-5-1.md`
> "3. Speed cuts" (`:31-35`, migration `:44`). This cut ships the first three mechanisms that the 1c campaign
> proved necessary (BACKLOG "final-panel seats starve on the sealed wall budget", `docs/BACKLOG.md:163-169`);
> standby seat, panel snapshot and in-rail-off are **2-B**. Evidence dir:
> `docs/plans/evidence/2026-09-18-blind-review-panel-parallel/`.

## 0. What is actually true today (verified 2026-09-18 at base `aab9523d`)

- `src/engine/autopilot-engine.js` `performFinalPanel` (`:5181-5296`) runs seats **sequentially** with a
  synchronous `seats.map` (`:5207`); the comment at `:5203-5206` says so. Each seat's `--timeout` is
  `floor(remainingNow / seatsNotYetRun)` (`:5208-5215`) where `remainingNow` is the live remainder of the
  sealed `max_wall_seconds` (`campaignWallRemainingSeconds` `:1488-1494`, from `campaignWallBudgetStatus`
  `:1460-1480`, limit = `initial_state.limits.max_wall_seconds`). `performReview` clamps every seat to the
  live remainder (`:4912-4942`, invariant comment `:4921-4925`); `buildReviewArgs` appends `--timeout`
  (`:866-872`). A seat transport failure does not skip later seats (`finalPanelSeatReceipt` `:5144-5176`
  classifies it; `final_panel_seat_transport_failed` is a receipt reason, not a control-flow gate). The
  panel `review_digest` is a digest over `seatReceipts` **in array order** (`:5287-5291`) — the one
  order-sensitive spot; the validator (`campaign-composition.js:350-424`) is order-agnostic (`seat_index`,
  tuple dedupe). `packet_hash` mixed/mismatch check `:5271-5282`.
- Only review consumers read the wall: `performReview` and `performFinalPanel`. Implementation,
  verification and `full_suite` never check `campaignWallBudgetStatus` — so on the 1c campaign the three
  earlier stations consumed ~110 of 120 minutes and the panel split ~10 minutes three ways (two seats
  rc=124). The contract schema caps `max_wall_seconds` at 7200
  (`schemas/implementation-campaign-contract.schema.json:104-108`); the graph checker admits 14400
  (`mission-execution-graph.js:260`) and the projection 10..14400 (`campaign-dispatch-projection.js:243-248`).
- The whole composer is synchronous: `src/engine/campaign-composition.js` has zero `await`; `reviewDiff` →
  `dispatchReview` is `spawnSync` (`src/runners/review.js:264`). Concurrency cannot be added by making the
  composer async without touching every station.
- No shared state between concurrent reviews: `review.js` uses a per-call `mkdtemp` blind dir (`:218-219,
  :276`, removed in `finally`); `dispatch-review.sh` uses only `mktemp -t/-d` scratch paths, no `flock`, no
  `.autopilot/` writes; the packet builder is read-only git (`review-packet.js:492,500`); the diff provider
  is a per-round `mkdtemp` (`autopilot-engine.js:1837-1860`). The only repo-level concurrency precedent is
  `dispatch-hetero.sh` mutating refs (BACKLOG `:59-64`, shipped v2.36.44) — not on this path.
- Verification runs **twice per candidate tree**: the `campaign_verification` station builds a
  `createVerificationRequest({ treeSha, verifyCmd, env, envAllowlist })` (`:7448-7452`), consults the
  in-process `verificationCache` keyed by `request_digest` (`:4540`, `:7454-7455`, set at `:7596`) with
  `reusableGreenReceipt` (`campaign-verification.js:424-444`: GREEN, exit 0, writer lease closed, detached
  checkout, argv attested, digests present, identity equal); `full_suite` (`:7632-7690`) builds the
  **identical** request from the same `verifyCmd` (`:7641-7645`) and deliberately never consults the cache
  (comment `:7634-7636`: "a focused/cached verification receipt cannot impersonate this execution"); its
  only reuse is gate-journal re-entry (`campaign-composition.js:2367-2377`, trace `full_suite_gate_reused`).
  Both stations run every verification command on a fresh detached worktree.
- Tests: `implementation-campaign-dogfood.test.sh:775-812` pins the N=1 timeout split (`115s,115s`);
  `implementation-campaign-routing.test.sh:3068-3092` (`proof_parity_run`) drives the panel through a
  synchronous stubbed `reviewDispatcher`; `qc-panel-honesty.test.sh:24-255` is order-agnostic; no test
  covers N>1 seat timeouts or a second-station verification reuse.

## 1. Ruling and shape

1. **Verify once per tree.** `full_suite` consults the same `verificationCache` under the same
   `reusableGreenReceipt` predicate as the verification station. Because `full_suite` builds its request
   from the sealed `verifyCmd` — the complete declared command set — a receipt whose `request_digest`
   equals the suite's binds the same tree, the same full argv and the same env fingerprint; a focused
   receipt has a different `argv_hash` by construction and can never match. Both stations read the SAME
   `verificationEnvironment` snapshot (taken once per run at `:6589`, passed at `:7451` and `:7644`) and the
   same allowlist, so the env fingerprint is equal whenever the tree and argv are. Identity is content, not
   timeline: a repair generation whose tree returns to a previously green tree has the same bytes, and the
   verification station already reuses across generations on exactly this rule (`:7454-7455` →
   `recordGreenVerification(cached, repairGeneration)`); "stale" means identity mismatch and nothing else.
   On a hit `full_suite` emits its
   ledger row as `passed` with `reused_from: 'campaign_verification'`, `receipt_digest` = the cached
   receipt's digest and `tree_sha`, pushes trace `full_suite_reused_verification`, creates no worktree and
   runs nothing. On a miss (any repair generation whose tree changed, a RED receipt, or identity mismatch)
   it runs exactly as today. The comment at `:7634-7636` is rewritten to state the identity argument.
   Sealed knob `full_suite_reuse: true|false` in the campaign contract (default `true`; `false` forces the
   fresh run); it is sealed at intake like every other limit.
2. **Panel seats in separate processes, concurrently, below a synchronous composer.** "Identical to a
   sequential run" means every digested body: the seat receipt body (`finalPanelSeatReceipt` `:5156-5176`:
   `seat_index`, runner, model, effort, endpoint, family, status, verdict, `review_digest`, reason, optional
   `raw_log`/`packet_hash` — it carries no timestamp), the panel `review_digest` over those seat digests in
   index order, and the receipt validator's view. No artifact records per-seat timing: the panel's seat
   ledger rows all carry the batch's `started_at` and `ended_at` (the panel launched and finished as one
   unit), and the `final_panel` row carries the same pair — so completion order is not observable in any
   ledger row, receipt or digest. Per-job timing exists only in the fan-out helper's stdout, which the
   engine discards after parsing; the review-runner suite reads it to prove concurrency, and depth-0 may
   copy it into the evidence dir (§5), never into a campaign artifact. The composer stays
   synchronous. Concurrency lives in ONE new Node helper, `scripts/lib/review-fanout.js` (built-ins only):
   it reads a JSON job list on stdin (`{ jobs: [{ id, argv, cwd, env, stdin_file, timeout_seconds }] }`),
   `spawn`s every job at once, enforces each job's own timeout (SIGTERM, then SIGKILL after 5 s), and
   prints one JSON array in **job order** (`{ id, status, signal, timed_out, stdout, stderr }`), exit 0
   whenever it produced the array. `src/runners/review.js` splits `dispatchReview` into three pure phases
   — `prepareReviewLaunch(options)` (packet build, args, prompt, env; sync, per seat), a launch, and
   `finishReviewLaunch(prepared, raw)` (envelope, parse, packet fields; sync, per seat) — and gains
   `dispatchReviewBatch(optionsList)`: prepare each, ONE `spawnSync` of the fan-out helper with all launches,
   finish each in order. `dispatchReview(options)` becomes `dispatchReviewBatch([options])[0]`. The helper is
   the ONLY production launch path (the batch of one goes through it too). The engine's `reviewDispatcher`
   constructor option (`autopilot-engine.js:2490`, used at `:3448`) is a test seam that replaces
   `dispatchReviewJson` wholesale before `review.js` is ever reached — it is not a second launch path; in
   batch mode the engine calls an injected dispatcher once per seat in index order, so the routing/dogfood
   stubs keep working unchanged. Byte identity of the batch of one means the helper reproduces the
   observable contract of the `spawnSync` it replaces: `stdout`/`stderr` captured as strings under the same
   1 MiB `maxBuffer` (overflow → `status: null` + `error`, as `spawnSync` reports it), `status`/`signal`
   exactly as the child ended, and the same `cwd`/`env`/`stdin` plumbing; the review-runner suite pins this
   with a fixture compared field-by-field against the pre-split result. Timeouts: a production seat is
   bounded by `dispatch-review.sh`'s own `--timeout` (rc=124 from inside, the 1c shape); the helper's job
   timeout is the SAME number as the seat's `--timeout` (no margin): at that instant SIGTERM, SIGKILL 5 s
   later, reported as `signal` the way `spawnSync`'s `timeout` does. In the normal case the child has
   already exited 124 by then; the helper's kill is the fail-closed guarantee for a child that ignores its
   own cap. The 5 s kill grace is process teardown, not budget: no seat is ever *handed* more than its
   consumer's remainder, and the engine test asserts both the `--timeout` argv and the helper's
   `timeout_seconds` are that same number. The engine mirrors the split: `performFinalPanel` prepares every qualified
   seat, launches the batch, finishes each seat in **seat-index order**. Each seat's `--timeout` is the
   **whole** panel remainder (§1.3), not a share: with concurrent seats the panel's wall cost is the slowest
   seat, not the sum.
3. **A sealed panel pocket.** New sealed contract field `final_panel_reserve_seconds` (integer, default 0,
   max 1800, sealed at intake with the other limits). The panel's budget is `max_wall_seconds +
   final_panel_reserve_seconds` measured from the same `started_at`; every other wall consumer keeps
   `max_wall_seconds`. `campaignWallBudgetStatus`/`campaignWallRemainingSeconds` take `{ consumer:
   'panel' | 'review' }` (default `'review'`, byte-identical). There is ONE definition of "remaining": the
   consumer's. `performReview` gains a `budget_consumer` input (default `'review'`) and uses it for BOTH
   its exhaustion check and its clamp (`:4912-4942`); `performFinalPanel` passes `budget_consumer: 'panel'`
   with every seat, so the clamp and the seat timeout read the same pocket, and the in-rail seat (which
   never passes it) is byte-identical. So a campaign whose earlier stations ate the whole wall still runs
   its panel inside the pocket. The refusal
   (`final_panel_budget_exhausted`) is ONE check at the top of `performFinalPanel`, after the cross-family
   check (`:5195`) and before any seat is prepared (no packet, no blind dir, no process), against the
   `'panel'` consumer; only when the pocket is gone too. The ledger's `final_panel` row records
   `budget_source: 'wall' | 'pocket'` and `seat_timeout_seconds`. With reserve 0 nothing changes. The
   reserve is its OWN field with its own cap (0..1800) at every layer it passes through — graph node
   `campaign.final_panel_reserve_seconds` (`mission-execution-graph.js:260` neighbourhood +
   `schemas/mission-execution-graph.schema.json:147` neighbourhood), the projection
   (`campaign-dispatch-projection.js:243-248` neighbourhood), the contract built from the node
   (`mission-convergence.js:1465`), the contract schema, and intake sealing into `initial_state.limits` —
   pass-through everywhere, default 0 when absent; the three existing `max_wall_seconds` caps (7200 /
   14400 / 10..14400) are untouched and out of scope, so the reserve can never be admitted by one checker
   and rejected by another: every checker applies the same 0..1800 to the same field.
4. **Not in this cut** (2-B): standby seat, panel snapshot at intake, turning the in-rail single review off
   when a panel exists, overlapping packet build with the implementer's commit.

## 2. Changes by file (+ codex mirrors)

- `scripts/lib/review-fanout.js` (NEW, `test -x`, Node built-ins): job-list in, ordered results out; per-job
  timeout; never throws on a job failure (a failed job is a row). `docs/scripts-inventory.md` one row;
  `CLAUDE.md` Dispatch rails group gains `lib/review-fanout.js`.
- `src/runners/review.js`: the three-phase split; `dispatchReviewBatch`; `dispatchReview` = batch of one;
  `packet` handling unchanged; the blind dir is created in prepare and removed in finish (per seat).
- `src/engine/autopilot-engine.js`: `performFinalPanel` batch path (§1.2) with the timeout rule (§1.3);
  `campaignWallBudgetStatus`/`campaignWallRemainingSeconds` consumer parameter; `fullSuite` reuse (§1.1);
  `performReview` unchanged for the in-rail seat except that its dispatcher call now goes through the same
  batch-of-one API.
- `src/engine/campaign-intake.js`: seal `final_panel_reserve_seconds` and `full_suite_reuse` into
  `initial_state.limits` (defaults when absent).
- `src/engine/mission-execution-graph.js` + `schemas/mission-execution-graph.schema.json`,
  `src/engine/mission-convergence.js` (`:1465` budget), `src/engine/campaign-dispatch-projection.js`
  (+ mirrors): pass `final_panel_reserve_seconds` (0..1800, default 0) and `full_suite_reuse` (default
  true) from the graph node through the projection into the contract — pass-through validation only.
- `schemas/implementation-campaign-contract.schema.json` (+ mirror): the two fields (optional, defaults);
  `implementation-campaign-receipt.schema.json` (+ mirror): `full_suite` row optional `reused_from`,
  `final_panel` row optional `budget_source`, `seat_timeout_seconds`.
- Tests (RED-first, `# RED at base <sealed base>: <observed>`): `review-runner.test.sh` (batch of three
  stub `dispatch-review.sh` scripts sleeping 2/3/4 s → results in job order; concurrency asserted from the
  helper's per-job `started_at`/`ended_at`: `max(started_at) < min(ended_at)` (all three overlapped) and
  total wall < sum − 1 s — load-tolerant, no "≈ slowest" comparison; one job past its backstop → its row
  `signal` set and the others reviewed; batch of one field-by-field identical to the pre-split single
  result on a fixture); `autopilot-engine.test.sh` (panel of three through a stub
  dispatcher: receipts in seat-index order, panel `review_digest` equal to the sequential digest; seat
  timeout = whole remainder; pocket: wall exhausted + reserve 300 → panel runs with `budget_source:
  'pocket'`, reserve 0 → `final_panel_budget_exhausted`; `full_suite` reuse hit → no worktree, trace and
  ledger fields; miss on a changed tree → fresh run; `full_suite_reuse: false` → fresh run);
  `implementation-campaign-dogfood.test.sh` (the `115s,115s` pin becomes: in-rail 115s, panel = remainder);
  `implementation-campaign-routing.test.sh` (`proof_parity_run` stubs still called per seat in order);
  `implementation-campaign-receipt.test.sh` (schema admits the new optional fields, rejects unknown ones);
  `campaign-dispatch-projection.test.sh` / `mission-convergence.test.sh` (reserve 0/900/1801 → admitted /
  admitted / refused at each layer; absent ⇒ 0; `full_suite_reuse` absent ⇒ true);
  `contract-parity.test.sh` / `check-contract-schema.js` unchanged and green.
- Docs: `references/blind-dispatch.md` (+ mirror) "Panel execution (v2.36.65)" paragraph (concurrency
  below the composer, pocket, verify-once identity argument); `skills/l5/references/hetero-impl-loop.md`
  (+ mirror) recipe step 3/9 sentences; `docs/BACKLOG.md` redesign row Context → `… 1c v2.36.64, 2-A
  v2.36.65. Open: 2-B (standby, snapshot, in-rail off). …` (≤240 B, Status `open`) and the starvation row
  → `shipped v2.36.65 2026-09-18`.

### 2.5 Sealed `output_paths` (exact; re-check mirrors at base)

```
scripts/lib/review-fanout.js
platforms/codex/plugin/scripts/lib/review-fanout.js
src/runners/review.js
platforms/codex/plugin/src/runners/review.js
src/engine/autopilot-engine.js
platforms/codex/plugin/src/engine/autopilot-engine.js
src/engine/campaign-intake.js
platforms/codex/plugin/src/engine/campaign-intake.js
src/engine/mission-execution-graph.js
platforms/codex/plugin/src/engine/mission-execution-graph.js
src/engine/mission-convergence.js
platforms/codex/plugin/src/engine/mission-convergence.js
src/engine/campaign-dispatch-projection.js
platforms/codex/plugin/src/engine/campaign-dispatch-projection.js
schemas/mission-execution-graph.schema.json
platforms/codex/plugin/schemas/mission-execution-graph.schema.json
schemas/implementation-campaign-contract.schema.json
platforms/codex/plugin/schemas/implementation-campaign-contract.schema.json
schemas/implementation-campaign-receipt.schema.json
platforms/codex/plugin/schemas/implementation-campaign-receipt.schema.json
hooks/tests/review-runner.test.sh
hooks/tests/autopilot-engine.test.sh
hooks/tests/implementation-campaign-dogfood.test.sh
hooks/tests/implementation-campaign-routing.test.sh
hooks/tests/implementation-campaign-receipt.test.sh
hooks/tests/campaign-dispatch-projection.test.sh
hooks/tests/mission-convergence.test.sh
references/blind-dispatch.md
platforms/codex/plugin/references/blind-dispatch.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
docs/scripts-inventory.md
CLAUDE.md
docs/BACKLOG.md
```

`authorized_creates`: the two `review-fanout.js` paths. Thirty-four paths, `max_changed_files` sealed at 35.

### 2.6 Global constraints

- Reviewers: this plan is self-contained; `file:line` citations are provenance for depth-0, never a reading
  assignment.
- The composer stays synchronous; concurrency exists only inside the fan-out helper, which is the single
  launch path for every review dispatch (batch of one included).
- Ordering is by seat index everywhere a digest, ledger row or receipt is produced; completion order is
  never observable in an artifact.
- A seat is never handed more than its consumer's remaining budget; the pocket is sealed, bounded, and
  visible in the ledger.
- Verify-once reuses only a receipt whose full identity (tree, full argv, env) equals the suite's request;
  no other receipt shape is ever accepted; the knob can only force a fresh run, never a reuse.
- `review-packet.js`, `dispatch-review.sh`, `cleanroom-launch.sh`, `resolve-review-loop.*` byte-identical.

## 3. Out of scope
2-B items (§1.4); raising the 7200 contract cap; any change to how implementation or verification
stations budget their own time; the in-rail review seat's timeout rule.

## 4. Acceptance
| id | criterion | evidence |
|----|-----------|----------|
| `fanout` | three jobs with distinct sleeps return in job order in ≈ the slowest job's time; a job past its timeout is a `timed_out` row while the others complete; the helper exits 0 with an array on every job outcome | review-runner suite |
| `batch-identity` | batch of one is byte-identical (result JSON, envelope, packet fields) to the pre-split single dispatch on the same fixture | review-runner suite |
| `panel-order` | three-seat panel: receipts and panel `review_digest` equal a sequential run's regardless of completion order; stub dispatchers are called per seat in index order | autopilot-engine + routing suites |
| `panel-timeout` | each panel seat's `--timeout` is the whole panel remainder; N=1 in-rail pin unchanged | dogfood + engine suites |
| `pocket` | wall exhausted + reserve → panel runs with `budget_source: pocket` and the in-panel clamp reads the pocket; reserve 0 → refused at the single pre-prepare check; reserve capped 0..1800 identically at graph, projection, contract and intake | engine + receipt + projection + convergence suites |
| `verify-once` | `full_suite` reuses an identity-equal GREEN receipt (no worktree, trace + ledger fields); changed tree, RED receipt, or `full_suite_reuse: false` → fresh run | engine suite |
| `no-regression` | §4.1 all exit 0 at candidate; base recorded | evidence |
| `scope-integrity` | diff ⊆ §2.5; helper `test -x`; packet builder/rail/launcher/resolver byte-identical; `CLAUDE.md` names the helper | command output |

### 4.1 No-regression commands (exact; also the graph's `verification_commands`)
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
```
Base record: `evidence/…-panel-parallel/base-suites-<base>.txt` (detached checkout, sequential).

## 5. Dogfood proof (depth-0)
The next managed campaign on this repo (2-B or a BACKLOG row) runs with `final_panel_reserve_seconds: 900`:
its ledger shows `full_suite` with `reused_from: campaign_verification`, a `final_panel` row whose wall
(`ended_at − started_at`) is well under the sum of the three seats' historical durations (1b-A panel raw
logs: 3 + 4 + 3 min), and — if the earlier stations overran — `budget_source: pocket`; the helper's
per-job timings captured from the depth-0 host run go in the evidence dir. Before that, on this host: a three-seat panel through the real fan-out
helper against MiniMax, GLM and claude-native on a small packet, timings in the evidence dir.

## 6. Risks + inversion
- **Order nondeterminism** — index-ordered finish; the engine test compares digests against a sequential run.
- **Helper as a new launch path** — batch of one is the same path, so the single-seat suites exercise it.
- **Reuse impersonation** — identity equality over the full sealed argv; the focused-receipt case has a
  different `argv_hash`, tested.
- **Pocket as a loophole** — bounded (≤1800), sealed, ledger-visible, panel-only.
- **Three concurrent model calls** — rate limits: a 429 is a transport failure like today; no retry added.

## 7. Where this sits
1a-A ✓ → 1a-B ✓ → 1b-A ✓ → 1b-B ✓ → 1c ✓ → **2-A (this)** → 2-B.

## Review log
- Unknown-escalation probe (`ladder-classify.json`): U1 (four coined names, zero repo hits); consult rail
  attempted and failed on the codex quota (`consult-codex-quota-rail-failed.json`, ladder `rail-failed`).
- Plan hetero loop G1 2026-09-18 (GLM-5.2 READY, claude-fable-5-1 CONDITIONAL: 5 blockers + 3
  non-blocking; `g1-*`, `plan.as-reviewed-g1.md`): all eight accepted — one budget definition (`budget_consumer`
  through `performReview`), identity = digested bodies, single pre-prepare refusal + reserve plumbing
  graph→projection→contract under one cap (six more sealed paths + two suites), the helper as the only
  launch path with `spawnSync`'s observable contract, env snapshot + content identity for reuse,
  timestamp-overlap assertions, projection/convergence suites, template sentence dropped.
- G2 2026-09-18 (terminal at the cap; GLM-5.2 CONDITIONAL, MiniMax-M3 (fallback for the claude seat)
  CONDITIONAL; 2 non-blocking; `g2-*`, `plan.as-reviewed-g2.md`): both accepted — the helper backstop is the
  seat's own `--timeout` (no margin; kill grace is teardown, not budget); no artifact records per-seat
  timing (batch timestamps on every panel ledger row; per-job timing lives only in the helper's stdout).
  Growth 1.26× over the G2-reviewed bytes. Zero unaddressed blockers, zero deferred.
