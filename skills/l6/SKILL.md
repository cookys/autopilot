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

Terse front-door into `autopilot:ceo-agent` at **Level 6**: identical to `/l5`
except verification AUTHORING is ALSO leaf-dispatched to a heterogeneous engine;
depth-0 remains pure orchestration.

Hard rules:
- **Delegate the labor, never the trust**: depth-0 still EXECUTES committed
  artifacts, runs the mechanical checks, judges convergence-by-verification, and
  holds merge authority. A dispatched green or reviewer pass is never
  authoritative by itself.
- Verification authoring goes through `dispatch-author.sh` (the raw-prompt rail —
  NOT `dispatch-review.sh`) on a DIFFERENT family than the implementer engine.
- All dispatch parameters come from `resolve-review-loop.sh`; no manual
  hardcoding of model/runner/effort.
- `--solo` (or a foreman that cannot dispatch reliably) → fall back to `/l3` inline.
- **Depth-0 context discipline**: depth-0 never authors implementation or verification content inline — even verification-prompt authoring is dispatched (dispatch-author.sh). Inline execution only via --solo or a recorded precondition_failed fallback.

**MUST-READ**: [`references/full-dispatch-pipeline.md`](references/full-dispatch-pipeline.md)
(per-unit pipeline, machinery, authoring-rail rationale) and
[`../ceo-agent/references/level-front-door.md`](../ceo-agent/references/level-front-door.md)
(loop governance, qc@depth-0, ledger).
