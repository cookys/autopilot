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
- `reviewer_engine_low_risk` / `reviewer_effort_low_risk` — risk-tiered overlay: BOTH
  set AND computed `review_risk=low` ⇒ the per-round loop reviewer is this pair (same
  runner); high risk or any empty key ⇒ `reviewer_engine`/`reviewer_effort`. qc_panel
  is unaffected. (Selection rule canonical in front-door § roster notes; the engine
  CLI applies it automatically in `reviewDiff`.)
- `implementer_engine` / `implementer_effort` / `implementer_runner`
- `review_diff_scope` (`full` default; `incremental-mitigated` semantics — including
  the mandatory full re-reads and the full-suite harness requirement — are specified
  in front-door § "Heterogeneous engine loop details (/l5 and /l6)")
- `on_family_conflict` (`fallback` default) — same-family reviewer×implementer conflicts
  substitute a cross-family qualified scorecard-ladder row instead of hard-blocking the
  in-loop review (guards + allowlist in front-door § roster notes; `block` restores the
  pre-v2.32.25 hard block)
- `independent_harness`, `qc_panel`, `qc_panel_aggregation`
- `reviewer_endpoint` / `implementer_endpoint` (declarative `--endpoint`; credentials
  populate from `~/.autopilot/endpoints.env` via `load-endpoints-env.sh` +
  `resolve-endpoint.sh` — an empty field means no `--endpoint`, byte-identical env path)

## Live sensing

Foreman dispatch is never fire-and-forget: depth-0 pre-assigns the run-ledger
path, the foreman heartbeats it, and depth-0 watches
`node scripts/watch-foreman.js --ledger <path>` (Monitor on CC, `--once` poll
elsewhere). Ritual + report-only discipline: front-door § "Live sensing".

## Capability-state surface rule

Before the **first implementation dispatch** of a unit, surface these roster values to the operator
when present. They describe one situation — the capability picture the run is about to proceed under —
so they are one rule, not five; a healthy run surfaces nothing.

- every string in `capability_warnings` (an engine was demoted, or lacks native skill support);
- `quota_reset_at` when non-null — say **a** configured engine's quota is constrained and when it
  clears. **Do not name a role**: the roster emits no per-role quota value, so the role the producer
  selected is not recoverable and any attribution would be invented;
- `capability_state_source` when it is exactly `none` — "capability-state consultation is off for this
  project; these values were not read from the capability store". Only `none`: the resolver
  distinguishes it from `unknown`, which means consulted-but-no-fresh-data;
- `skill_mode_requested` when it is `auto` **and** `skill_mode_effective` is `off` — skill transport was
  requested automatically and resolved to none. Only that pair: `off`/`prompt`/`native` pass through
  unchanged, so `auto` is the only mode that can diverge, and `auto → prompt` is ordinary resolution;
- `domain_source` whenever `work_domain` is reported, so a reader knows whether the domain was declared
  or inferred.

Rationale and evidence: `docs/plans/2026-07-25-roster-field-report.md` §1c — a plain path, not a
link: `docs/` is outside the Codex plugin payload, so a relative link here escapes it (`codex-plugin-package` test).

## Stage-3 coordination boundary

`watch-foreman.js` remains a report-only sensor. If a depth-0 controller is
explicitly authorized to use adaptive recovery, it must call the ledger
`stage-coordinate` rail with the exact generation/nonce and preserve the fixed
inquiry → bounded wait → identity re-observation → bounded termination →
reconciliation → one same-lineage replacement order. The gate is off by default;
unreadable identity, D-state, held resources, or stale quietness without an
inquiry is `unknown` and cannot be acted on. See the canonical Stage-3 contract
in [`references/orchestrator-state-machine.md`](../../../references/orchestrator-state-machine.md).

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
