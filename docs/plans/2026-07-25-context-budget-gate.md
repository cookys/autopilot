# Context-window gate for hetero dispatch

**Date**: 2026-07-25
**Target version**: v2.32.58
**Size**: L

## Motivation — measured, not assumed

A read-only scan of 90 days of local engine transcripts (`~/.codex/sessions`, 1611 sessions;
1231 of them headless `codex_exec` dispatch carrying real `event_msg.token_count` telemetry)
produced the following:

| Signal | Value |
|--------|-------|
| Total dispatch token consumption | 788.0M (input 775.7M / output 11.8M) |
| Input share of cost | **98.4%** |
| Cached-input hit rate | 92.4% (uncached increment 58.8M) |
| Sessions hitting a context wall (compaction) | **53 (4.3%)** |
| Token burned by those 53 sessions | **322.9M = 41.0% of the total** |
| Of those 53, model = `gpt-5.3-codex-spark` | **52** (its `model_context_window` = 121.6k) |
| Concentration | top 50 sessions (4.1%) consume 42.4% |

Cross-engine comparison on the one commensurable axis (context pressure), from
`~/.grok/sessions/*/signals.json` (369 sessions):

| Engine | context window | context usage p50 | wall-hit rate |
|--------|---------------|-------------------|---------------|
| `gpt-5.3-codex-spark` | 121.6k | (cumulative semantics) | 4.3% → **41% of all tokens** |
| `grok-4.5` | **500k** | 10% of window | 6.3% (2 sessions) |

The conclusion that drives this plan: **the dominant dispatch cost is oversized input fed to
a small-window engine**, not output volume, not review-loop round count. Round count is
explicitly NOT the lever — a measured 76-round cluster cost 7.9M while a 41-round cluster cost
60.9M, because the latter fed 5.4M / 15.9M single-turn inputs into a 121.6k window.

## Current state

- `scripts/dispatch-review.sh:407` has a **hardcoded 96 KB diff warning** that is advisory only
  and engine-agnostic.
- `scripts/dispatch-hetero.sh` / `dispatch-author.sh` have **no input-size gate at all** — only
  `ARG_MAX` plumbing (a shell limit, not a model limit).
- `scripts/resolve-review-loop.sh` routing considers family decorrelation, scorecard, quota and
  capability state — but **never context window**.
- `scripts/engine-capability-state.js` allows exactly two capability dimensions:
  `quota` and `skill_transport`.

## Design

### P0 — `scripts/check-context-window.js` (new)

Deterministic, Node built-ins only (runs inside dep-minimal sandboxes per CLAUDE.md language rule).

```
check-context-window.js --model <id> [--prompt-file F] [--diff-file F] [--extra-bytes N]
                        [--ratio R] [--window N] [--json]
```

- Estimates tokens from byte length with a documented, deliberately conservative divisor
  (under-estimating tokens would defeat the gate; the estimator must round *up*).
- Resolves the model's context window: explicit `--window` > observed capability state >
  built-in default table > `unknown`.
- Emits `{model, window, window_source, estimated_tokens, ratio, threshold, verdict, reason}`
  where verdict ∈ `OK` / `OVER_BUDGET` / `UNKNOWN_WINDOW`.
- **Fail-closed contract**: an unknown window is NOT a pass. It emits `UNKNOWN_WINDOW`, and the
  caller decides — the gate defaults to allowing it through with a warning (an unknown engine
  must not become undispatchable), but `--strict` turns `UNKNOWN_WINDOW` into a block.

The built-in default table is seeded from **observed runtime values**, not vendor claims:
`gpt-5.3-codex-spark` = 121600 and `grok-4.5` = 500000 both come from the telemetry above.
Every entry carries a provenance comment. This respects the CLAUDE.md "don't claim platform
facts without a URL or a real tool run" rule — these are tool-run-derived.

### P1 — Wire the gate into the three dispatch rails

`dispatch-hetero.sh`, `dispatch-review.sh`, `dispatch-author.sh` call the gate after
precondition checks and before the runner is spawned.

- Over budget ⇒ **fail-closed**, non-zero exit, structured reason, no spend.
- `dispatch-review.sh`'s existing 96 KB advisory is *replaced* by the engine-aware gate (the
  hardcoded constant loses its meaning once the real window is known).
- Escape hatch: `--context-window off|warn|block` (default `block`) plus
  `AUTOPILOT_CONTEXT_WINDOW_GATE` env. Depth-0 keeps authority to override deliberately; the point
  is to make oversized dispatch a *decision*, not an accident.

### P2 — `context_window` as a capability dimension

Add `context_window` to `engine-capability-state.js`'s allowed capability set and to
`schemas/engine-capability-state.schema.json`, following the existing per-field merge
discipline (`unknown` never clobbers a valid observation).

### P3 — `resolve-review-loop.sh` consumes it

> **REVISED DURING EXECUTION.** The original design below proposed new contract fields. Reading
> the code showed `resolve-review-loop.sh` is a *resolver, not an executor* — even an exhausted
> quota only yields `quota_status` + a warning, with the CONSUMER acting per
> `on_engine_unavailable`. New window fields would also create a second source of window truth
> alongside `check-context-window.js`. **Shipped instead**: `--input-bytes N` reports
> over-budget seats into the existing `capability_warnings` array. Zero new contract fields
> (still 44), zero schema risk. `UNKNOWN_WINDOW` deliberately emits no warning — 2 of the 3
> default seats have no recorded window, so it would be constant noise.

~~Surface the resolved window in the resolver contract so routing can prefer a large-window
engine when the measured diff is large. Additive fields only; the always-on contract in
`schemas/review-loop-contract.schema.json` is extended in lockstep (gated by
`scripts/check-contract-schema.js`).~~

### P4 — Wire-in and release hygiene

CLAUDE.md inventory row, `references/hetero-dispatch.md` section, Codex plugin payload mirror
(`scripts/sync-codex-plugin-skills.sh`), CHANGELOG, version bump + mirrors, INDEX row.

## Verification contract (dev-flow mandatory answer)

**"What command objectively proves this is done?"**

```bash
bash hooks/tests/context-window.test.sh      # new, focused
bash hooks/tests/run.sh                      # full suite, no regressions
```

Red-green: the new test file must be **RED on base** (the gate does not exist there) and
**GREEN on head** — artifact, not self-report.

> **Executed manually, because `scripts/verify-red-green.sh` cannot validate this repo's own
> test suite.** Its `run_verify_cmd` `cd`s into the base worktree but invokes `$VERIFY_CMD` by
> the CALLER's absolute path (deliberate, per its header); autopilot's tests derive `REPO_ROOT`
> from `$0` via `lib.sh`, so the base run actually exercises the head tree and is always green
> (`NOT_RED_ON_BASE`). Manual procedure used instead: detached worktree at base → apply ONLY the
> test-file patch → `cd` in → run by relative path. Result: **base exit 1 (RED), head 48
> assertions PASS (GREEN)**. Tool defect recorded in `docs/BACKLOG.md`.

Negative controls the test must include:
- an over-budget prompt is **blocked** (not merely warned),
- `--context-window off` still dispatches (escape hatch is real),
- an unknown model does **not** become undispatchable by default,
- `--strict` does block an unknown model,
- the estimator never under-estimates a known fixture's token count.

## Scope boundary

**In scope**: the five phases above; all three dispatch rails; Codex payload mirror.

**Out of scope** (documented, not silently dropped):
- Compressing tool *output* (rtk-style) — already in `docs/BACKLOG.md` with a measured ~11%
  ROI ceiling; a different lever from input budgeting.
- Reducing review-loop round count — the data explicitly refutes this as a cost lever.
- agy / opencode telemetry ingestion — agy has **no token fields at all** (91% of its
  transcripts additionally carry `truncated_fields`), so it cannot be measured yet; opencode's
  372 token-carrying sessions are 99% `swe-calibrate`, not the daily dispatch path.
- An `engine-scorecard` importer for the four engines' transcripts — real value, but separable;
  goes to BACKLOG with this plan as its source.
- Grok implementer tuning (toolFailure 28%, zero-commit 72%, effort A/B) — grok currently has
  only 71 autopilot-dispatched sessions, all read-only (review/author); its implementer usage
  happens outside the dispatch rails today, so there is no dispatch-side lever yet.

## Review Loop History

(to be filled during execution)
