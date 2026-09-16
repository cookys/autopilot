Design question (autopilot managed campaign rail, Node.js: src/engine/campaign-composition.js,
src/engine/autopilot-engine.js, src/engine/implementation-campaign.js reducer).

Defect measured twice end-to-end (cuda 2026-09-16 campaign-v1-48ffc2fd…; openclaw 2026-09-16
campaign-v1-cfadd975…): the campaign's `campaign_verification` fails (verify_cmd red, `retriable`
not false) → the engine STILL dispatches the full-diff review (reviewer returns FIX-THEN-SHIP /
SHIP-AS-IS) → applying `review_completed` fails with
`cannot apply review_completed while campaign is VERTICAL_VERIFICATION` → the composition stops →
TERMINAL_STOP, no repair generation, the reviewer spend is wasted.

Mechanism (verified in code):
1. Reducer (`implementation-campaign.js` ~966): `VERTICAL_VERIFICATION` accepts `vertical_verified`
   ONLY with `passed:true` + evidence digest (`VERTICAL_EVIDENCE_REQUIRED` otherwise) → `REVIEWING`.
   `REVIEWING` accepts `review_completed` → `ADJUDICATING`. `REPAIR_AUTHORIZED` is accepted from
   BOTH `ADJUDICATING` and `VERTICAL_VERIFICATION` (registry_complete + repair_gate_passed digests,
   generation+1, budget check) → `REPAIRING`. So "red verification → repair" already has a
   reducer-valid path that never passes through REVIEWING.
2. Engine verify adapter (`autopilot-engine.js` ~7231-7420): journals `VERTICAL_VERIFIED` only when
   the receipt is GREEN (`recordGreenVerification`); on RED it journals nothing to the campaign
   ledger (only an engine `ledger` entry `campaign_verification failed` with tree_sha +
   receipt_digest; stdout/stderr are not journaled — separate BACKLOG row, out of scope here).
3. Composition (`campaign-composition.js` ~2158-2200): on `verification.passed !== true` and
   retriable and below the repair ceiling, it calls `ensureFullDiffBarrier(true)` — comment:
   "Contract: first candidate still gets authoritative full-diff before any repair, including
   when vertical verification failed" — then scope_before_repair → convergence (whose engine
   adapter journals `REPAIR_AUTHORIZED`) → `mutate('vertical_repair', [{id:'vertical-acceptance',
   claim: verification.reason}])`.
4. Engine review adapter `performReview` (~4728-4975) receives `vertical_failed: true` in its
   payload (it is part of the review authority digest) but the journaling block at ~4949
   unconditionally appends `REVIEW_COMPLETED` when `scope !== 'final'` → reducer refuses because
   the phase is `VERTICAL_VERIFICATION`, the adapter returns `{reviewed:false, phase:
   'campaign_event_journal'}`, the barrier stops the composition.

Note the review findings from the red-candidate review are NOT fed into the vertical repair: the
mutate call passes only the `vertical-acceptance` claim. So today the pre-repair review on a red
candidate has no consumer of its findings (they may land in the finding registry via
syncRepairFindingState — verify) and no reducer home for its event.

Candidate fixes:
(a) Engine-only: in `performReview`, when `vertical_failed === true` do not journal
    `REVIEW_COMPLETED` (the campaign phase is VERTICAL_VERIFICATION; the review is advisory input
    to the repair); record the review digest in the controller gate journal only (already done by
    the composition's gate entry) and continue. The reducer and composition are untouched; the
    existing `REPAIR_AUTHORIZED`-from-VERTICAL_VERIFICATION path carries the campaign to REPAIRING.
(b) Reducer + engine: accept `vertical_verified` with `passed:false` (+ evidence digest) from
    VERTICAL_VERIFICATION into REVIEWING with a `verification_failed` marker in state; then
    `review_completed` → ADJUDICATING; REPAIR_AUTHORIZED from ADJUDICATING as today. Engine
    journals the red verification. Consequence: an ADJUDICATING state whose candidate is red;
    TERMINAL_READY from ADJUDICATING would need a guard (`verification_failed` must block READY).
(c) Composition-only: skip `ensureFullDiffBarrier(true)` when verification is red (repair first,
    review the repaired candidate). Contradicts the stated contract comment; saves a reviewer
    spend per red candidate; the repair loses the review's findings (which it does not consume
    today anyway).

Questions:
1. Which option should ship, and what concrete failure does each rejected option let through?
   Weigh: durability of evidence (a red-candidate review digest never reaches the campaign
   ledger under (a)/(c)); reducer/schema churn under (b); the contract comment under (c).
2. Under (a): is there any reader (resume, inspect, terminalization ladder, repair-scope, next
   generation's review reuse via `findReusableGate`) that expects a REVIEW_COMPLETED event for
   generation N before REPAIR_AUTHORIZED for N+1? Name the code path if so.
3. Red-first test: which existing suite hosts the composition-level case (hooks/tests/
   implementation-campaign-state.test.sh drives the composition with stub adapters; the engine-level
   P3 blocks live in implementation-campaign-routing.test.sh)? What must it assert so it
   discriminates the fix from a patch that merely swallows the journal error: e.g. after a red
   verify + review, the campaign ledger projection shows generation 1 with REPAIR_AUTHORIZED and
   phase REPAIRING (or the repaired candidate verified), the trace contains
   `verify, full_diff_review, scope_before_repair, convergence, <mutate>`, exactly one reviewer
   call for the red candidate, and — for (a) — NO review_completed event at generation 0 while a
   review_completed exists for the repaired generation if it goes green.
4. Should the red verification itself be journaled durably (a new event or reusing MUTATION_FAILED
   semantics) in this deliverable, or is that the separate "verify stdout/stderr not journaled"
   row? Keep the scope minimal but say what the minimal durable marker would be if any.
Answer with a recommendation and precise assertions; do not emit a ship/no-ship verdict.
