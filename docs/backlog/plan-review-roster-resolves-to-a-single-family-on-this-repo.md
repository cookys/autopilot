# Plan-review roster resolves to a single family on this repo

- **Context**: `scripts/resolve-review-loop.sh` reported `plan_review_resolved_from=native-fallback`, which yields opus only. The G1 and G2 seats were hand-picked from `qc_panel` in `.claude/review-loop-config.md`.
- **Fix**: make plan review heterogeneous by default (resolve from qc_panel when the plan-review roster is unset).
- **Source**: mods plan G1+G2, `docs/plans/evidence/2026-10-03-mods-visible-dispatch-design/`.
