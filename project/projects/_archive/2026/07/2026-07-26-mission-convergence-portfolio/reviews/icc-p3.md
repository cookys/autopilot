# ICC Phase 3 — Bounded Heto Review

> Candidate: `4837983..dba2668`
>
> Status: READY
>
> Repair cap: one admitted generation, followed by one terminal panel

## Frozen Checklist

Only a concrete, evidence-backed violation of one of these items may block Phase 3:

1. **Canonical routing** — `/l5`, `/l6`, CEO-agent, and dev-flow name
   `engine implement-review --campaign-contract` as the only workflow-level mutation entry.
   Low-level dispatch remains internal/diagnostic.
2. **Durable resume** — campaign identity automatically journals reducer events. A new process
   adopts the exact Git candidate and durable focused-review digest without repeating
   implementation, resetting generation/budgets, or accepting branch/tree drift.
3. **Mechanical transport truth** — the closed `RunnerTransportEnvelope` schema contains only
   request binding, exit/signal/error classification, output digests, and an optional private raw
   reference. It contains no verdict, finding, readiness, or other semantic authority.
4. **Separate disposition authority** — non-empty findings require an external depth-0 artifact or
   explicitly selected deterministic policy. The artifact is exact-campaign, exact-contract, and
   exact-review-digest bound; missing, stale, incomplete, or reviewer-shaped input fails closed.
5. **Purpose-bound review normalization** — structured findings and the bounded severity/id line
   grammar normalize deterministically. Empty, duplicate, contradictory, or ambiguous prose has no
   authority.
6. **Honest raw status** — campaign status derives phase/activity/generation/budget/growth and leaf
   state from durable records. It never invents Mission, merge, push, residue, `can_merge`,
   `can_close`, or a lifecycle receipt.
7. **Regression and containment** — existing focused suites and repository invariants remain green;
   secrets/raw semantic output do not enter durable public artifacts; the change does not implement
   PRO, WLB, Mission, LSM, PRS, CTR, or ICC Phase 4.

## Disposition Rules

- `must-fix-now`: reproducibly violates a checklist item and cannot be deferred without making the
  Phase 3 contract false.
- `follow-up`: valuable refactor, hardening, usability improvement, or later-phase feature that
  does not invalidate a checklist item.
- `reject-out-of-scope`: unsupported claim, duplicate, preference-only nit, or another phase's
  owned concern.
- Severity alone has no scheduling authority. Reviewers do not expand the rubric.
- The pre-existing four `autopilot-engine-resilience` failures reproduce at `4837983`; they are not
  a Phase 3 regression without new causal evidence.
- Codex generated-mirror drift is intentionally synchronized once from the final canonical tree in
  portfolio Phase 33, not by each intermediate phase.

## Deterministic Evidence

- Focused tests: 1,236 assertions pass across campaign routing/state/composition/receipt, engine,
  review runners, dispatcher, resolver, and CLI suites.
- P3 cross-process oracle: 29 assertions; resumes `ADJUDICATING` with exact review authority,
  implementation dispatch count remains zero, terminal lease closes, and a third process reports
  completed status.
- `validate.sh`, version/agent/hook/canonical/README invariants, completeness scan, error-path scan,
  secret scan, and committed-range test-integrity checks pass.

## Panel Results

### Generation 1

| Seat | Transport | Semantic verdict | Depth-0 disposition |
|---|---|---|---|
| GPT-5.6 Sol high | reviewed | `FIX-THEN-SHIP` | Two Major findings admitted below. |
| Qwen3.8-Max-Preview high | reviewed | `SHIP-AS-IS` | Redundant ternary suggestion rejected as preference-only; no checklist behavior changes. |
| GLM-5.2 high | reviewed | `SHIP-AS-IS` | No findings. |
| Grok 4.5 high | exhausted after two attempts | none | Transport-only; never counted as a semantic verdict. |

Admitted findings:

1. A caller-authored authority file could label itself `deterministic-policy`, bypassing the
   explicit compiled policy rail. This violated checklist item 4.
2. Status counted `quarantined`/`stale_ignored` leaf states as completed and omitted a leased leaf
   whose process was dead from the dead count. This violated checklist item 6.

Both were repaired in `d2020dc`. The repair additionally snapshots each leaf liveness observation
once, so one projection cannot classify the same leaf differently across counters.

### Terminal Checklist

1. An authority file accepts only `authority: depth-0`; deterministic policy remains available
   only through `--campaign-disposition-policy`.
2. Successful leaf states alone count as completed. `stale_ignored`, `quarantined`, `dead`, and a
   dead leased leaf count as dead; unknown leased liveness is reported separately.
3. The repair does not change campaign transition, mutation, review, or transport behavior.
4. The aggregate candidate still satisfies all seven frozen checklist items.

### Terminal Results

| Seat | Scope | Verdict | Findings |
|---|---|---|---|
| GPT-5.6 Sol high | `dba2668..d2020dc` repair delta | `SHIP-AS-IS` | none |
| Qwen3.8-Max-Preview high | `4837983..d2020dc` full aggregate | `SHIP-AS-IS` | none |

The terminal generation admitted no new finding and opened no further repair.

## Residual Baseline

`hooks/tests/autopilot-engine-resilience.test.sh` still reports the same four run-ledger recovery
assertion failures reproduced at the Phase 2 closure commit `4837983`. P3 neither changes their
surface nor claims them as green. They remain pre-existing debt, not evidence for weakening this
phase's gates.

## Final Verdict

`READY`. All seven frozen checklist items pass, both admitted generation-1 findings are repaired,
the bounded terminal panel is clean, and no reviewer-created topic expanded the phase.
