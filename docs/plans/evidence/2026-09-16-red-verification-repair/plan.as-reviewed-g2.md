# Red verification takes the repair path: no review_completed under vertical_failed, and the vertical repair is path-bound

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node
> `red-verification-repair-2026-09-16`).
> Source row: `docs/BACKLOG.md` "Managed rail: a failed campaign_verification still dispatches review,
> then review_completed hits VERTICAL_VERIFICATION" (fired 2026-09-16; measured by cuda on
> `campaign-v1-48ffc2fd…` and by openclaw on `campaign-v1-cfadd975…`). Owner instruction 2026-09-16:
> CEO mode, work the fired rows in order via `/l5`.

## 0. What is actually broken (verified in code 2026-09-16, base `d14bfb68`)

1. Reducer (`src/engine/implementation-campaign.js` ~966-1035): `VERTICAL_VERIFICATION` accepts
   `vertical_verified` only with `passed:true` (`VERTICAL_EVIDENCE_REQUIRED` otherwise) → `REVIEWING`;
   `REVIEWING` + `review_completed` → `ADJUDICATING`; `REPAIR_AUTHORIZED` is accepted from BOTH
   `ADJUDICATING` and `VERTICAL_VERIFICATION` → `REPAIRING`. A red verification therefore already has
   a reducer-valid route to repair that never passes through `REVIEWING`.
2. Engine verify adapter (`src/engine/autopilot-engine.js` ~7231-7420) journals `VERTICAL_VERIFIED`
   only on GREEN (`recordGreenVerification`); on RED it journals nothing to the campaign ledger.
3. Composition (`src/engine/campaign-composition.js` ~2158-2200): red + retriable + below the repair
   ceiling → `ensureFullDiffBarrier(true)` (contract: the first candidate gets its authoritative
   full-diff before any repair, even when vertical verification failed; `mutate('vertical_repair')`
   independently requires that barrier via `requireFullDiffBeforeRepair`) → `scope_before_repair` →
   `convergence` (engine adapter journals `REPAIR_AUTHORIZED`) → `mutate('vertical_repair',
   [{ id: 'vertical-acceptance', claim: verification.reason }])`.
4. Engine review adapter `performReview` (`autopilot-engine.js` ~4728-4975) receives
   `vertical_failed: true` (part of the review authority digest) but the journaling block at ~4946
   appends `REVIEW_COMPLETED` for every `scope !== 'final'` review → the reducer refuses
   (`cannot apply review_completed while campaign is VERTICAL_VERIFICATION`) → the adapter returns
   `{ reviewed: false, phase: 'campaign_event_journal' }` → the barrier stops the composition →
   TERMINAL_STOP with the reviewer spend wasted and no repair generation.
5. Adjacent, on the same path (consult finding, verified): the vertical repair's synthetic finding
   carries no path, so `findingBoundRepairPaths` (`autopilot-engine.js:1514`) throws
   `finding vertical-acceptance has no explicit allowed repair path` and the mutate adapter returns
   `phase: 'campaign_repair_scope_seal'` (~6700-6720). Fixing (4) alone moves the stop from the
   review to the repair-scope seal; the operators' expectation ("repair generation or a clean
   terminal") needs both.

## 1. Ruling and shape

Option (a) of the design consult (see Review log), plus the path binding for the vertical repair:

1. **No `REVIEW_COMPLETED` under `vertical_failed`.** In `performReview`, the campaign-event append is
   gated by a predicate — `scope !== 'final' && verticalFailed !== true` — not by catching and
   ignoring the reducer error. The red-candidate review still runs (barrier contract kept), its
   digest/findings/verdict stay durable in the controller full-diff gate journal and the repair
   ticket, and the campaign advances `VERTICAL_VERIFICATION → REPAIR_AUTHORIZED(generation+1) →
   REPAIRING` on the existing reducer edge. The `campaign_resume_review` digest replay branch is
   likewise skipped under `vertical_failed` (it can only apply to an ADJUDICATING resume).
2. **Vertical repair scope = the candidate's own changed paths.** In the mutate adapter, when
   `kind === 'vertical_repair'` and the finding set is exactly the composition's synthetic
   `vertical-acceptance` finding, `findingPaths` is `repairLineage.repair_scope_paths` (the initial
   candidate's changed paths, already required non-empty just above) instead of
   `findingBoundRepairPaths(...)`. Reviewer findings are never given this treatment: any other finding
   set keeps the explicit-path rule. The seal is still created (`createRepairScopeSeal`) with those
   paths and `sourceCommit: currentBase`; the repair prompt names the verify failure as the reason.
3. No reducer, event, ledger-row, CLI, or composition change. A GREEN generation's `REVIEW_COMPLETED`
   journaling is byte-for-byte unchanged and still fail-closed on a journal error.
4. Red-verification durability (journaling the red receipt or its stdout/stderr) is NOT in scope —
   the controller focused-verification gate already records the red receipt digest with its
   tree/argv/env bindings; the campaign-ledger marker is a separate row.

## 2. Changes by file

### 2.1 `src/engine/autopilot-engine.js`

- `performReview` (~4936-4975): wrap the `campaign_resume_review` replay check and the
  `REVIEW_COMPLETED` append in `if (scope !== 'final' && verticalFailed !== true) { … }`; comment
  states the reducer edge used instead.
- mutate adapter (~6700-6725): before calling `findingBoundRepairPaths`, if `kind === 'vertical_repair'`
  and `repairFindings.length === 1 && repairFindings[0].id === 'vertical-acceptance'` (the id the
  composition emits), set `findingPaths = [...repairLineage.repair_scope_paths].sort()`; otherwise
  unchanged. `normalizedFindingIds` is unchanged.

### 2.2 `platforms/codex/plugin/src/engine/autopilot-engine.js`

Byte-identical mirror (`bash scripts/sync-codex-plugin-skills.sh --check`).

### 2.3 Tests

Every change-pinning assertion is recorded RED against base `d14bfb68` in the block header with the
observed message; preservation guards are labelled `(preservation, green at base)`; the engine block
uses the routing suite's existing real-ledger sandbox (never the host ledger).

- `hooks/tests/implementation-campaign-routing.test.sh` — new engine block "red verification takes
  the repair path": an `AutopilotEngine` with the suite's real `campaignEventAppender` (wrapped by a SPY
  that records every attempted `{eventType, generation}` BEFORE delegating), a `verifyCommandRunner`
  whose first run (generation 0) returns RED and whose second (generation 1) returns GREEN, an
  implementation dispatcher stub that commits a real candidate and, on the repair round, a real
  repaired commit touching only the initial changed paths, a review dispatcher stub returning a
  REWORK/FIX-THEN-SHIP verdict with one finding on the red candidate and SHIP-AS-IS on the repaired
  one, and the suite's usual adjudication/final-panel stubs.
  - **T1 (RED at base)** zero attempted `REVIEW_COMPLETED` appends at generation 0 (the spy count,
    not the ledger — an implementation that attempts and swallows the error must fail here); the
    run does not return `phase: 'campaign_event_journal'`.
  - **T2 (RED at base)** exactly one `REPAIR_AUTHORIZED` append at generation 1; the state returned by
    that append has `generation === 1` and `phase === CAMPAIGN_STATES.REPAIRING`; the campaign ledger
    replays (`projectCampaign`) to generation ≥ 1.
  - **T3 (RED at base)** the run does not stop at `campaign_repair_scope_seal`: the repair dispatcher
    was called once with a `repairScopeSeal` whose `allowed_paths` equal the initial candidate's
    changed paths (sorted) and whose `finding_ids` are `['vertical-acceptance']`.
  - **T4 (RED at base)** the repaired generation goes green and is reviewed: ledger events contain
    `repair_completed(1)`, `vertical_verified(1)`, exactly one `review_completed(1)`; no generation-0
    `vertical_verified` or `review_completed` rows exist; the reviewer stub was called exactly once
    for the red candidate (identified by tree_sha) before the repair.
  - **T5 (preservation, green at base)** GREEN generation journaling stays fail-closed: with a
    `campaignEventAppender` that throws on `REVIEW_COMPLETED` at generation 1, the run returns
    `phase: 'campaign_event_journal'` (proves the predicate is conditional, not a blanket swallow).
  - **T6 (preservation, green at base)** a reviewer finding without an explicit path on a NON-vertical
    repair is still refused with `finding … has no explicit allowed repair path` (the existing
    assertion at `implementation-campaign-state.test.sh:2621` region stays; add or reference it).
- `hooks/tests/implementation-campaign-state.test.sh` — extend the R3 composition case (~4146): assert
  the ordered trace subsequence `verify, full_diff_review, scope_before_repair, convergence` followed
  by the repair mutation, exactly one generation-0 full-diff review call that received
  `vertical_failed: true`, generation 1's review (if reached) received `vertical_failed: false`, mutation
  kinds exactly `initial` then `vertical_repair` (preservation guards, green at base — they pin the
  composition contract the engine fix relies on).
  - **T7 (R6 evidence; preservation in the composition case, RED-at-base in the engine block only if
    the base run stops before the gate entry is written)**: the returned `controller.gate_journal`
    holds exactly one `full_diff_review` entry for generation 0 whose `result.success === true`,
    whose `result.review_digest` (or the digest field the gate records) equals the review stub's
    digest, and whose `input.vertical_failed === true`; the engine block asserts the same on the
    engine's returned controller after the run, proving the red-candidate review stayed durable
    outside the campaign ledger.

### 2.4 Docs (pinned version **v2.36.56**; canonical `origin/develop` is 2.36.55 at freeze — reseal plan
and rubric together with the freed number if an intervening release lands first)

- `docs/BACKLOG.md`: the fired row → `shipped v2.36.56 2026-09-16`, Context names the real mechanism
  (performReview journals `review_completed` under `vertical_failed`; vertical repair had no path
  binding). The openclaw "verify_cmd runs in a fresh detached worktree; stdout/stderr never reach the
  ledger" row stays open and unchanged.
- `skills/l5/references/hetero-impl-loop.md` step 11 fixed list: "red verification takes the repair
  path v2.36.56"; mirror regenerated.
- `CHANGELOG.md` is NOT a sealed output path (depth-0 release action).

## 3. Out of scope (do not touch)

- `src/engine/implementation-campaign.js` (reducer), `src/engine/campaign-composition.js`,
  `src/engine/campaign-intake.js`, `src/campaign/cli.js`, `src/engine/controller-execution.js`.
- Journaling the red verification receipt / stdout / stderr; fresh-worktree bootstrap for verify_cmd.
- Any change to how reviewer findings are path-bound (only the synthetic vertical finding is special).
- The rail's `acceptance_failed` terminal-journal defect and the `REVOKED` normalization wart.

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `no-review-event-under-vertical-failed` | zero attempted `REVIEW_COMPLETED` appends for a red generation; the run never returns `campaign_event_journal` for it | T1 |
| `repair-authorized-from-vertical` | `REPAIR_AUTHORIZED(1)` appended once, state `REPAIRING`, ledger replays past generation 0 | T2 |
| `vertical-repair-path-bound` | the vertical repair seal's `allowed_paths` are the initial candidate's changed paths; the run does not stop at `campaign_repair_scope_seal` | T3 |
| `repaired-generation-reviewed` | `repair_completed(1)`, `vertical_verified(1)`, one `review_completed(1)`; none at generation 0 | T4 |
| `green-journal-still-fail-closed` | a journal error on a GREEN generation's `review_completed` still blocks at `campaign_event_journal` | T5 |
| `no-regression` | `implementation-campaign-routing`, `implementation-campaign-state`, `implementation-campaign`, `controller-execution-independent`, `p6d-gates-repair-ladder`, `mission-runtime-v2`, `implementation-campaign-receipt` green; `check-js-syntax.js`; `sync-codex-plugin-skills.sh --check`; `check-backlog-entries.js` exit 0 | suite output |

## 5. Dogfood proof (depth-0, after merge)

A managed campaign on this repo whose sealed verify_cmd is red on the first candidate (a deliberately
failing one-line test in the hand's output paths) reaches `REPAIR_AUTHORIZED` and a repair round
instead of TERMINAL_STOP at `campaign_event_journal`; recorded at the row pointer. cuda/openclaw re-run
on their own ledgers is theirs to report.

## 6. Follow-ups filed, not done here

- Campaign-ledger marker for a red verification (`vertical_verified { passed:false }` as a self-loop in
  `VERTICAL_VERIFICATION`, no phase change) + bounded stdout/stderr — folds into the open openclaw row.
- Crash between the red review and `REPAIR_AUTHORIZED` repeats verification and review (failed
  verification gates are not reusable and the review reuse key includes the verification receipt
  digest) — BACKLOG candidate once measured.

## Review log

- Design consult 2026-09-16 (grok 402 → codex gpt-5.6-sol on the raw-prompt rail, evidence
  `docs/plans/evidence/2026-09-16-red-verification-repair/consult-codex-answer.md`): recommends (a)
  as a predicate around the append, rejects (b) (a red candidate in ADJUDICATING can reach
  TERMINAL_READY/FOLLOW_UP) and (c) (`requireFullDiffBeforeRepair` still blocks the repair; blind
  repair spend); audits every reader (resume, inspect, ladder, gate reuse) — none needs
  `REVIEW_COMPLETED(N)` before `REPAIR_AUTHORIZED(N+1)`; names the spy-count assertion and the
  adjacent `findingBoundRepairPaths` blocker. Depth-0 folds the adjacent blocker in as §1.2 (the
  operators' acceptance is a repair generation, not a later stop) with the synthetic-finding-only guard.
- Plan hetero loop G1 2026-09-16 (GLM-5.2 READY, gpt-5.6-sol STOP; evidence `g1-*`): one blocker —
  R6's "digest remains in the controller gate journal" had no assertion — accepted, T7 added to §2.3.
