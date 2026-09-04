---
name: hetero-review
description: >
  Thin router for dual heterogeneous review loops across independent model families on a plan or code diff.
  Use when: "叫 autopilot plan loop review hetero" or "coding 完成後過 hetero loop review", or when
  instructed to engage hetero engine review.
  ADR-0001 governs both loops: a reviewer's verdict is a claim until depth-0 re-derives it from the
  reviewer's JSON artifact and the exact base..head range it reviewed; an implementer's green is a claim,
  never a gate. The plan loop reviews frozen rubrics via dispatch-plan-review, while the code loop runs
  hetero review via hetero-review-loop.
  Not for: implementation work (→ /l4 through /l6 slash commands), asking a model for an opinion
  (→ consult seat), or messaging a running session (→ agent-call skill).
---

# Hetero Review — Multi-Family Verification Loops

Thin router for heterogeneous multi-model review. Under ADR-0001, a review verdict is a claim until depth-0 re-derives it from the reviewer's JSON artifact and the exact base..head range it reviewed; a hetero implementer's green is a claim, never a gate.

The three knobs `plan_review`, `hetero_review`, and `consult_dispatch` each take off/on/auto:
- `off`: stage is skipped, an opt-out receipt is written, and a `capability_warnings` line is emitted.
- `on`: an explicit tuple is required; incomplete or invalid tuple exits 3 with existing message shape.
- `auto`: with ≥1 qualified seat expands tuple from topology and stamps `resolved_from: topology`; with absent file, malformed JSON, or zero seats falls back to native claude-native seat, stamps `resolved_from: native-fallback`, emits a `capability_warnings` line, and the stage still runs (never `on` with an empty tuple, never silently skipped).

Receipt verdict tokens are strictly `SHIP-AS-IS` and `FIX-THEN-SHIP`. Severities use existing vocabulary (Critical/Major/Minor/Suggestion).

## Routing Decision

| Input Shape | Target Loop | Reference |
|---|---|---|
| Plan file path (e.g. `docs/plans/*.md`) | Plan Loop | [`references/plan-loop.md`](references/plan-loop.md) |
| Branch, diff, or current phase (e.g. `phase-1`, git diff) | Code Loop | [`references/code-loop.md`](references/code-loop.md) |
| Ambiguous / neither clear | Clarify Target | Ask user whether input is a plan file or phase/branch code diff |

## Plan Loop Protocol

Prose execution sequence for plan files (see [`references/plan-loop.md`](references/plan-loop.md) for judgment rules):

1. Scaffold the rubric: run `node scripts/plan-rubric-scaffold.js --plan <file>` unless a rubric already exists.
2. Build the reviewer manifest by reading `bash scripts/resolve-review-loop.sh --field plan_reviewer_engine` and the matching `plan_reviewer_runner` / `plan_reviewer_effort` fields for the chair seat, and the `plan_deep_reviewer_*` fields for the deep seat, adding a third seat only when `bash scripts/resolve-review-loop.sh --field plan_review_resolved_from` prints topology and the topology's plan review panel has three seats.
3. Run `node scripts/dispatch-plan-review.js` with a 20 minute timeout, generation 1 then at most one more generation.
4. Depth-0 (the calling session, not this skill) writes a disposition per finding, either accept-and-fold or refute-with-rationale, and never defers a blocker.
5. The loop freezes once `node scripts/check-phase-review-receipt.js --plan-artifact <file> --dispositions <file>` exits 0.
6. Record the artifact paths in the project ledger.
7. When the `plan_review` knob resolves to `off`, write the opt-out receipt via `node scripts/hetero-review-loop.js opt-out --knob plan_review` instead of running the loop.

## Code Loop Protocol

Prose execution sequence for code phases and diffs (see [`references/code-loop.md`](references/code-loop.md) for judgment rules):

1. Run `node scripts/hetero-review-loop.js collect --phase <p> --generation <n> ...` to snapshot the range and collect reviewer outputs.
2. Depth-0 writes dispositions for all candidate findings.
3. Run `node scripts/hetero-review-loop.js finalize --phase <p> --generation <n> --dispositions <file>` to aggregate verdicts.
4. On a `FIX-THEN-SHIP` verdict, dispatch the emitted hands brief through the topology using `bash scripts/dispatch-hetero.sh` at rung 0, then collect the next generation over the delta and finalize again, repeating until `SHIP-AS-IS`.
5. Run `node scripts/check-phase-review-receipt.js` in receipt mode.
6. The eventual merge commit carries the existing `QC-Verdict` trailer unchanged.
7. When the `hetero_review` knob resolves to `off`, write the opt-out receipt via `node scripts/hetero-review-loop.js opt-out --knob hetero_review` instead of running the loop.

**MUST-READ**: [`references/plan-loop.md`](references/plan-loop.md) and
[`references/code-loop.md`](references/code-loop.md) — read both before routing, even when the
input shape only calls for one loop: the code loop's freeze predicate and the plan loop's
receipt rules cross-reference each other.
