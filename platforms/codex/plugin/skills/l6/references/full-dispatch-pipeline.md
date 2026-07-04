# /l6 — full-dispatch verification pipeline (per-level reference)

> Level-specific long-form for the `/l6` shell. Common front-door semantics and the
> `/l5` hetero loop it extends live in
> [`../../ceo-agent/references/level-front-door.md`](../../ceo-agent/references/level-front-door.md)
> and [`../../l5/references/hetero-impl-loop.md`](../../l5/references/hetero-impl-loop.md) —
> read those FIRST. This file covers only what `/l6` adds on top of `/l5`.

## What /l6 changes vs /l5

Verification AUTHORING is additionally leaf-dispatched through the canonical
`engine implement-review` implementation-review loop. This includes independent
harness authoring and its review loops, and the verification-writer family is
constrained to DIFFER from the implementer family. Depth-0 is still pure
orchestration.

**Hard invariant — delegate the labor, never the trust**: depth-0 delegates the
*labor* of impl and verification authoring, but still EXECUTES committed artifacts,
runs the mechanical checks, judges convergence-by-verification, and holds merge
authority. A dispatched green or reviewer pass is not authoritative by itself.

## Machinery (existing only — /l6 adds no new scripts)

- [`../../../bin/autopilot.js`](../../../bin/autopilot.js) (`engine implement-review`, canonical)
- [`../../../scripts/dispatch-hetero.sh`](../../../scripts/dispatch-hetero.sh) (write rail)
- [`../../../scripts/dispatch-author.sh`](../../../scripts/dispatch-author.sh) (authoring rail)
- [`../../../scripts/dispatch-review.sh`](../../../scripts/dispatch-review.sh) (diff-review rail)
- [`../../../scripts/resolve-review-loop.sh`](../../../scripts/resolve-review-loop.sh) (roster)

Execution control and ledger behavior remain as in `/l5` and the front-door.

## Per-unit pipeline (authoritative flow)

1. Resolve the roster ONCE with `resolve-review-loop.sh` and treat its output as the
   only source of truth.
2. Dispatch implementation via `engine implement-review` (internally
   `dispatch-hetero.sh`) with immutable `--base` and outcome-driven worktree commit
   logic. The CLI fails closed on absent/false reviewer qualification by default
   (`--require-qualified-reviewer` is accepted for explicitness/backward
   compatibility); use `--allow-unqualified-reviewer` only as an explicit, recorded
   escape hatch.
3. Dispatch verification AUTHORING via `dispatch-author.sh` on a different family
   than the implementer engine.
4. Run decorrelated review on implementation and harness outputs per resolved
   review fields.
5. Depth-0 executes committed implementation + harness artifacts, runs all required
   checks, and compares the results.
6. Convergence-by-verification gates continue/rework; merge only after the
   QC-Verdict is earned.

## Why authoring has its own rail (recorded rationale)

From this repo's 2026-07-02 incident: `dispatch-review.sh` wraps prompts as
`You are a code reviewer` + `Diff under review`, which is structurally correct for
verifier isolation but incompatible with AUTHORING. In the N2 repro, this caused
Gemini to reject spec text as "not a spec diff". Authoring therefore runs on the
dedicated raw-prompt rail (`dispatch-author.sh`); `dispatch-review.sh` stays
diff-reviews-only.
