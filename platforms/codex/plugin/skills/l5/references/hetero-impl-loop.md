# /l5 — hetero implementation loop (per-level reference)

> Level-specific long-form for the `/l5` shell. Common front-door semantics
> (startup presets, foreman topology, depth-0 control loop, qc@depth-0,
> merge-back, worktree GC, run-summary ledger) live in
> [`../../ceo-agent/references/level-front-door.md`](../../ceo-agent/references/level-front-door.md) —
> read that FIRST. This file covers only what `/l5` adds on top of `/l4`.

## What /l5 changes vs /l4

Identical to `/l4` (background worktree-isolated foreman, depth-0 control loop +
authoritative qc) except the IMPLEMENTER is orchestrated by the engine CLI and
dispatched through the canonical `engine implement-review` path:

- **Implementation** is dispatched via [`../../../bin/autopilot.js`](../../../bin/autopilot.js)
  `engine implement-review`, which internally invokes
  [`../../../scripts/dispatch-hetero.sh`](../../../scripts/dispatch-hetero.sh) with an
  **immutable base SHA** and cgroup containment. Verification is by **git artifacts**
  (commit/diff/cleanliness), never agent self-report.
- **Review** (spec and code) runs the resolved decorrelated reviewer engine instead
  of Claude — the reviewer is a DIFFERENT engine family than the generator.
- **Harness & telemetry**: depth-0 runs independent verifications
  (`independent_harness:on` ⇒ depth-0 builds its own adversarial harness and never
  trusts the implementer's green) and captures diff-domain metrics per project config.

## Roster resolution (single source of truth)

Resolve the roster and execution parameters ONCE from
[`../../../scripts/resolve-review-loop.sh`](../../../scripts/resolve-review-loop.sh)
and treat its output as the only source of truth — never hardcode models, effort
levels, or runners inline. Fields consumed by the loop:

- `reviewer_engine` / `reviewer_effort` / `reviewer_runner`
- `implementer_engine` / `implementer_effort` / `implementer_runner`
- `review_diff_scope` (`full` default; `incremental-mitigated` semantics — including
  the mandatory full re-reads and the full-suite harness requirement — are specified
  in front-door § "Heterogeneous engine loop details (/l5 and /l6)")
- `independent_harness`, `qc_panel`, `qc_panel_aggregation`
- `reviewer_endpoint` / `implementer_endpoint` (declarative `--endpoint`; credentials
  populate from `~/.autopilot/endpoints.env` via `load-endpoints-env.sh` +
  `resolve-endpoint.sh` — an empty field means no `--endpoint`, byte-identical env path)

## Verify-first wiring rule

When `resolve-review-loop.sh` emits `verify_first: true`, the foreman MUST pass
`--verify-cmd` to `engine implement-review` using the unit's objective check:
the independent harness command or unit test suite invocation. The dispatcher
authors this command; never derive it from the implementer. Evidence: bench
2026-07-07 found reviewer-judge loops on capable models cost 4-12x or regress,
while verify-first eliminated both. `verify_first_signal_unused: true` in a run
summary is a protocol deviation to record.

## Wired runners

`codex`, `agy`/Gemini, `grok`, `cc-shim` (Anthropic-compatible endpoints — MiniMax-M3,
GLM, …). Recipes, preconditions, and the outcome table live in
[`../../../references/hetero-dispatch.md`](../../../references/hetero-dispatch.md).

## Degradation

`--solo` → fall back to the `/l3` inline engine. This is also the automatic
degradation when the foreman returns `precondition_failed`.
