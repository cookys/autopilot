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
- qc_panel: gpt-5.5, claude-opus, gemini-flash
- qc_panel_aggregation: union-on-verified-critical
- review_diff_scope: full

> **The terminal qc panel** (`qc_panel`) is the authoritative depth-0 gate — a
> **disjoint-family** panel (OpenAI / Anthropic / Google), distinct from the inner-loop
> `reviewer_engine`. The point is that ≥1 panel family differs from the **implementer's**
> family, so a bug the implementer+its-family-reviewer jointly miss is caught by a different
> vendor (PoLL, arXiv 2404.18796). The resolver WARNS if the panel shares the implementer
> family. Gemini joins read-only via `dispatch-review.sh --runner agy` (agy review is verified
> working — agy's write bug is implementer-only). Aggregation is **`union-on-verified-critical`**:
> any panelist's *verified* Critical blocks; a panelist's empty/no-verdict is fail-closed (NOT a
> pass); **majority vote is forbidden** (it would suppress the single-track blind-spot catch that
> is the whole reason for a panel).

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
| `qc_panel` | the authoritative depth-0 terminal gate — a disjoint-family reviewer panel (≥1 family ≠ implementer) | comma list of model names (e.g. `gpt-5.5, claude-opus, gemini-flash`) |
| `qc_panel_aggregation` | how panel verdicts combine | `union-on-verified-critical` (default; majority is forbidden → falls back to this) |
| `review_diff_scope` | how much the per-round reviewer reads (cost vs regression-catching) | `full` (re-read whole `base..HEAD` each round — safe, O(n) cost growth) `\| incremental-mitigated` (read `prev..HEAD` + full content of files-touched + invariants list + periodic/critical-path full re-read + **mandatory final full review before merge**) |
| `work_domain` | **emitted telemetry, NOT a config/routing knob** — the deterministic dominant domain of a diff (via `--auto-domain`/`--domain`; computed by `scripts/probe-diff-domain.sh`) | `rust\|backend-cli\|frontend\|docs\|mixed` (read-only record; selects no engine — domain routing is BACKLOG'd) |
| `domain_source` | **emitted telemetry** — provenance of `work_domain` | `explicit` (valid `--domain`) `\| auto` (successful `--auto-domain` probe) `\| none` (no flag / non-git / empty diff / probe failure ⇒ `work_domain=mixed`) |

### Risk-tiered review depth (v2.25.11 — emitted by `resolve-review-loop.sh`, not config keys)

`resolve-review-loop.sh` derives a deterministic **`implementation_review_risk`** from runtime
inputs (NOT just who implemented — source-trust is one input, per the design's category-error
correction). Pass them as flags; the resolver emits the policy the depth-0 loop enforces.

| Input flag | Default | Effect |
|------------|---------|--------|
| `--source-trust high\|low` | derived (known cloud family ⇒ high, else low) | low ⇒ high risk |
| `--diff-lines N` | 0 | `>150` ⇒ high risk |
| `--protected-path 0\|1` | 0 | 1 ⇒ high risk |
| `--oracle-available 0\|1` | 1 | 0 (no executable oracle) ⇒ high risk |
| `--security-surface 0\|1` | 0 | 1 ⇒ high risk |

Emitted fields: `review_risk` (low/high), `required_review_families` (1 low / 2 high — PROVISIONAL,
calibrate before flipping the panel default), `l1_required` (decorrelated execution oracle required),
`cross_family_required`, `cross_family_satisfied` (an **unknown-family** panel member never satisfies
it — fail-closed). The cross-family overlap message escalates **WARNING** (low risk) → **ERROR**
(high risk). **`--enforce`** turns the resolver into an opt-in hard gate: exit 3 (JSON still emitted)
when a high-risk change's required cross-family decorrelation is unsatisfied (incl. an empty panel at
high risk). Default stays exit-0 data mode — the resolver REPORTS, the depth-0 loop / pre-push gate
ENFORCES (same pattern as `resolve-doa`/`resolve-qc-gate`). Full design: [`docs/plans/2026-06-26-trust-tiered-review-policy.md`](../docs/plans/2026-06-26-trust-tiered-review-policy.md).

## When to use `incremental-mitigated` (architect-reviewed 2026-06-26)

Default is `full`. Switch to `incremental-mitigated` only for **long** loops (many rounds,
large accumulating diff) where the reviewer cost grows O(n) re-reading the whole diff each
round. The naive "only the incremental diff" is **unsafe** — it can't prove earlier fixes
still hold and misses cross-file regressions in untouched files (the exact class this loop
catches). So it is only allowed WITH all of: re-read the full content of every file touched
this round; carry a standing invariants/prior-findings checklist; do a full `base..HEAD`
re-read every 3–5 rounds or whenever a fix touches shared/critical logic (classifiers,
schemas, fixtures, harness control flow); and ALWAYS a final full `base..HEAD` review before
merge. Real-world lesson (2026-06-26): a too-narrow per-round test/review scope let a
stale-fixture regression in an *untouched* test file slip to the final full sweep — so pair
this with `independent_harness: on` running the **FULL** suite, not just touched-file tests.

## Gotchas (carried from the test-integrity-l1 ship)

- **`agy` as implementer — works now via the v2.25.9 anchor fix.** agy `-p` ignores process
  cwd (Antigravity-CLI #231/#133/#253), so a relative-path prompt made it invent a scratch
  project under `~/.gemini/antigravity-cli/scratch/` and leave the worktree untouched (the old
  `no_op`). `dispatch-hetero.sh` now PREPENDS an absolute-worktree anchor to the agy directive,
  so agy edits in place — verified single- and multi-file, and 3-way concurrent
  ([[project_agy-writes-install-dir]]). So `implementer_runner: agy` is viable again (cost
  arbitrage / a Gemini-family generator). Caveats: agy stays EDIT-ONLY (run_command 10s cap →
  it can't run build/test mid-turn; the harness commits, the panel verifies), and Docker
  headless auth is still broken (#223/#479) so run agy on an interactively-authed host. `codex`/
  `gpt-5.3-codex-spark` remains the default for tasks where the agent must run build/test itself.
- The implementer's own passing tests are **not** the criterion — keep
  `independent_harness: on` so depth-0 builds adversarial cases the implementer
  didn't write (this is what caught vitest-blind / go multi-pkg build-fail / the
  override forgeability the implementer's green missed).
