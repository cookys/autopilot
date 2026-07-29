# Repair Lineage Convergence

## Deliverable contract

Repair the implementation-campaign retry lifecycle exposed by the P3 transcript. One logical
implementation campaign must not create a successor branch, checkout, or model conversation for
every reviewer round.

Required behavior:

1. an initial implementation and every authorized repair use one stable branch and one retained
   dispatcher-owned worktree until the campaign reaches a terminal outcome;
2. when the selected implementer runner exposes a verified resume mechanism, repairs resume the
   exact prior model session; otherwise the receipt records a fail-closed non-reuse reason;
3. every repair prompt carries the exact prior commit, unresolved normalized finding IDs, already
   accepted invariants, no-regression assertions, and whether review input is a full diff or a
   focused delta;
4. a normalized finding lineage that recurs once authorizes only a bounded finding-specific patch;
   recurrence again, or two rounds without measurable finding reduction, stops automatically as
   `awaiting_convergence_adjudication` before further model spend;
5. campaign output and durable state expose one lineage identity with branch, worktree, provider
   session, generation, inherited churn, delta churn, and reuse status;
6. terminal cleanup removes the retained clean worktree exactly once while preserving the branch
   and commit for depth-0 merge authority; dirty or unverifiable state fails closed.

The historical `fix/pro-p3-kimi-*` chain is the regression shape: eleven linearly related repair
branches must classify as one lineage, not eleven independent tasks.

## Scope

Expected production surfaces:

- `src/engine/autopilot-engine.js`
- `src/engine/implementation-campaign.js`
- `scripts/dispatch-hetero.sh`
- deterministic helpers under `scripts/lib/`
- campaign and dispatcher tests under `hooks/tests/`
- lifecycle contract documentation under `references/` and `skills/l6/`

Generated Codex skill mirrors may change only through the canonical synchronization script.

## Acceptance

- Focused tests prove stable branch/worktree identity across initial plus two repair attempts.
- A fake Grok runner proves the first call creates a session and the repair resumes that exact ID.
- Recurrent semantically identical findings stop before a third mutation dispatch.
- A changed finding set may continue within the frozen campaign generation budget.
- Terminal success removes the retained clean worktree; failure leaves an explicit disposition
  rather than silently creating a successor.
- Existing implementation-campaign, dispatcher, continuation, worktree-budget, and compaction
  suites remain green.
- Full repository validation and the 256-file hook suite pass before merge.

## Constraints

- One implementation worktree for this deliverable. Reviewer repair returns to the same worktree
  and model session.
- No raw `--keep-worktree` lease: retained state must have campaign owner, reason, and terminal
  disposition.
- No new generic scheduler, phase framework, or duplicate convergence state machine.
- Reuse existing normalized finding IDs, campaign event journal, Work Order continuation identity,
  and worktree marker/lock mechanisms.
- Depth-0 remains the sole verifier and merge authority.
- User-owned dirty Codex hook-probe files and the untracked historical handoff are out of scope.
