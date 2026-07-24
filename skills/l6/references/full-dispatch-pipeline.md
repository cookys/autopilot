# /l6 — full-dispatch verification pipeline (per-level reference)

> Level-specific long-form for the `/l6` shell. Common front-door semantics and the
> `/l5` hetero loop it extends live in
> [`../../ceo-agent/references/level-front-door.md`](../../ceo-agent/references/level-front-door.md)
> and [`../../l5/references/hetero-impl-loop.md`](../../l5/references/hetero-impl-loop.md) —
> read those FIRST. This file covers only what `/l6` adds on top of `/l5`.

## Live sensing

Same ritual as `/l5`: pre-assigned run-ledger path + foreman heartbeats +
depth-0 `watch-foreman.js` watcher (front-door § "Live sensing"; report-only).

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

## Capability-state surface rule

Identical to `/l5` — canonical text in
[`../../l5/references/hetero-impl-loop.md`](../../l5/references/hetero-impl-loop.md)
§ "Capability-state surface rule". `/l6` delta: the rule applies before the **verification-authoring**
dispatch too, not only the implementation dispatch, because that leaf runs on a different engine whose
quota and skill-transport state is what the roster is reporting.

## Machinery (existing only — /l6 adds no new scripts)

- [`../../../bin/autopilot.js`](../../../bin/autopilot.js) (`engine implement-review`, canonical)
- [`../../../scripts/dispatch-hetero.sh`](../../../scripts/dispatch-hetero.sh) (write rail)
- [`../../../scripts/dispatch-author.sh`](../../../scripts/dispatch-author.sh) (authoring rail)
- [`../../../scripts/dispatch-review.sh`](../../../scripts/dispatch-review.sh) (diff-review rail)
- [`../../../scripts/resolve-review-loop.sh`](../../../scripts/resolve-review-loop.sh) (roster)

Execution control and ledger behavior remain as in `/l5` and the front-door.
The `/l5` verify-first wiring rule applies unchanged: when roster resolution
emits `verify_first: true`, pass dispatcher-authored `--verify-cmd` for the
unit objective check. Treat `verify_first_signal_unused: true` as a protocol
deviation; bench 2026-07-07 showed verify-first avoids 4-12x cost/regression.

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

The `/l6` verification-author handoff is strict roster-only and must use:

`scripts/dispatch-author.sh --strict-roster --repo-root <consuming-repo> --prompt-file <file>`

`--bin <test-seam>` is only a test seam. `/l6` never passes `--runner`, `--model`,
`--effort`, or `--endpoint` to that call. The authorized tuple, derived family tags,
and named endpoint ID come from `<consuming-repo>/.claude/review-loop-config.md`
via `resolve-review-loop.sh`; named-endpoint readiness and credentials are resolved
separately after authorization, and secret values never enter result provenance.

Failure modes are fail-closed: unresolved/malformed strict roster state (including
same-family, unknown-family, or endpoint-unready) preconditions abort before runner
start and emit `status=precondition_failed`.

### Outcome → action table (R3 recovery branch)

When the foreman itself fails or is killed before emitting a normal outcome, depth 0 uses:

| Outcome | Depth-0 action |
|---------|----------------|
| `failed`/`killed` (no normal outcome) | Run `scripts/run-ledger.sh resume --ledger <path> --run-id <run_id> --idempotency-key <key>`: locate the last committed stage, bump generation with `stage-acquire --allow-reopen` (fencing stale writers), hold resource locks, run `stage-reconcile` and adopt if `git_truth`/terminal result exists, then **only** dispatch `dispatch-review` if `review_round_owed=true` in the resume payload. |

## Why authoring has its own rail (recorded rationale)

From this repo's 2026-07-02 incident: `dispatch-review.sh` wraps prompts as
`You are a code reviewer` + `Diff under review`, which is structurally correct for
verifier isolation but incompatible with AUTHORING. In the N2 repro, this caused
Gemini to reject spec text as "not a spec diff". Authoring therefore runs on the
dedicated raw-prompt rail (`dispatch-author.sh`); `dispatch-review.sh` stays
diff-reviews-only.

## Level 6's depth-0 context discipline

Depth-0 never authors implementation or verification content inline; even verification-prompt authoring is dispatched via `dispatch-author.sh`. Inline execution is restricted to `--solo` runs or a recorded `precondition_failed` fallback. This discipline ensures depth-0 acts purely as a long-running brain, preserving its context window for high-level orchestration and final quality control, while treating any inline authoring as a deviation to be recorded in the run-summary ledger.
