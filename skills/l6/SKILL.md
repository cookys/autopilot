---
name: l6
description: >
  Terse CEO front-door — Level 6: like /l5 (worktree-isolated hetero implementer + authoritative
  qc) but the VERIFICATION AUTHORING is also leaf-dispatched to a heterogeneous engine; depth-0 remains
  pure orchestration. Use when: "/l6 <goal>", "L6 <goal>", "全委", "全部派遣", "省 token 全外包",
  "delegate everything incl verification". Presets involvement=just-results, scope=Hold, no-go=none
  (override -x / --expand / --solo). Not for: /l5 when you still want to do verification yourself; /l4
  all-Claude; /l3 inline.
---

# /l6 — CEO autonomy, foreman + full-dispatch verification

Terse front-door into `autopilot:ceo-agent` at **Level 6**: identical to `/l5` except that
verification AUTHORING is additionally leaf-dispatched through the canonical `/l5` / `engine implement-review`
implementation-review loop. This includes independent harness authoring and
its review loops, and the verification-writer family is constrained to differ from the implementer family.
Depth-0 is still pure orchestration.

Hard invariant: depth-0 delegates the *labor* of impl and verification authoring, but never the *trust*.
Depth-0 still executes committed artifacts, runs the mechanical checks, judges convergence-by-verification,
and holds merge authority. A dispatched green or reviewer pass is not authoritative by itself.

This mode uses existing machinery only:
[`../../bin/autopilot.js`](../../bin/autopilot.js) (`engine implement-review`, canonical),
[`../../scripts/dispatch-hetero.sh`](../../scripts/dispatch-hetero.sh),
[`../../scripts/dispatch-review.sh`](../../scripts/dispatch-review.sh),
[`../../scripts/resolve-review-loop.sh`](../../scripts/resolve-review-loop.sh).
Execution control and ledger behavior remain as in `/l5` and
[`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md).

Per-unit pipeline (authoritative flow):
1) Resolve roster once with `../../scripts/resolve-review-loop.sh` and treat its output as the only source of truth.
2) Dispatch implementation via `engine implement-review` (internally `dispatch-hetero.sh`) with immutable `--base` and
   outcome-driven worktree commit logic.
3) Dispatch verification AUTHORING via `../../scripts/dispatch-review.sh` on a different family than the implementer engine.
4) Run decorrelated review on implementation and harness outputs per resolved review fields.
5) Depth-0 executes committed implementation + harness artifacts, runs all required checks, and compares the results.
6) Convergence-by-verification gates continue/rework; merge only after QC-Verdict is earned.

## On invocation

1. Invoke `autopilot:ceo-agent` with the same startup questions/presets as `/l3`/`/l4`/`/l5`
   (involvement=just-results, scope=Hold, no-go=none; override `-x` / `--expand` / `--solo`).
2. No manual hardcoding of model/runner/effort: all dispatch parameters come from `../../scripts/resolve-review-loop.sh`.
3. Keep `/l5` posture for loop governance, isolation, and output ledger, but treat verification drafting as a first-class dispatched unit.
4. If `--solo` is set or the foreman cannot dispatch reliably, fall back to `/l3` inline for safety.
