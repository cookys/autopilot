# Review-Loop Config (generation-adversarial heterogeneous pipeline)

Per-project engine roster + loop policy for the `/l5`-style pipeline:

> subagent writes plan/acceptance → **decorrelated reviewer** xhigh loop-to-convergence
> → **heterogeneous implementer** → reviewer xhigh loop + depth-0 adversarial harness
> → qc-gate subagent.

This file turns that hand-typed prompt into **data**: copy it to
`.claude/review-loop-config.md` (in the consuming project, or autopilot's own
`.claude/` for dogfood) and `/l5` reads the roster instead of you re-typing it.
Resolved by [`scripts/resolve-review-loop.sh`](../scripts/resolve-review-loop.sh)
(same precedence chain as `resolve-qc-gate.sh` / `resolve-doa.sh`).

The point is **decorrelation**: the GENERATOR (a Claude subagent / the hetero
implementer) and the REVIEWER are DIFFERENT engines, so their failure modes don't
correlate — the reviewer catches what the generator's own green tests miss
([[feedback_delegate-selftest-false-green]]). `/l5`'s default qc is homogeneous
Claude; set `reviewer_engine` here to make the review heterogeneous too.

## Settings

- reviewer_engine: gpt-5.5
- reviewer_effort: xhigh
- reviewer_runner: codex
- implementer_engine: gpt-5.3-codex-spark
- implementer_effort: high
- implementer_runner: auto
- loop_max_rounds: 5
- loop_convergence_verdict: SHIP-AS-IS
- spec_review: on
- independent_harness: on

## Field reference

| Field | Meaning | Values |
|-------|---------|--------|
| `reviewer_engine` | the **decorrelated** adversarial reviewer (spec + impl loops) | a model name (e.g. `gpt-5.5`); resolved via `reviewer_runner` |
| `reviewer_effort` | reviewer reasoning effort | `low\|medium\|high\|xhigh\|max` |
| `reviewer_runner` | how the reviewer is invoked | `codex` (→ `codex exec -m <engine> -c model_reasoning_effort=<effort>`) |
| `implementer_engine` | the heterogeneous implementer | a model name (e.g. `gpt-5.3-codex-spark`, `Gemini 3.5 Flash (High)`) |
| `implementer_effort` | implementer reasoning effort (codex only) | `low\|medium\|high\|xhigh\|max` |
| `implementer_runner` | dispatch-hetero runner | `auto\|codex\|agy` (→ `dispatch-hetero.sh --runner`) |
| `loop_max_rounds` | adversarial-loop convergence cap per phase | integer (default 5) |
| `loop_convergence_verdict` | the reviewer verdict that ENDS a loop | `SHIP-AS-IS` (loop continues on `FIX-THEN-SHIP`/`RECONSIDER`) |
| `spec_review` | run the reviewer loop on the spec BEFORE dispatching impl | `on\|off` |
| `independent_harness` | depth-0 builds its OWN adversarial harness (never trusts the implementer's green) | `on\|off` |

## Gotchas (carried from the test-integrity-l1 ship)

- **`agy` is unreliable for the autopilot repo itself** — it writes its plugin
  install copy, not the worktree ([[project_agy-writes-install-dir]]). For this
  repo set `implementer_runner: codex` / `implementer_engine: gpt-5.3-codex-spark`.
- The implementer's own passing tests are **not** the criterion — keep
  `independent_harness: on` so depth-0 builds adversarial cases the implementer
  didn't write (this is what caught vitest-blind / go multi-pkg build-fail / the
  override forgeability the implementer's green missed).
