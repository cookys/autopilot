# context-budget-gate

**Target version**: v2.32.58 | **Branch**: `feat/v2.32.58-context-budget-gate` | **Size**: L
**Plan**: [`docs/plans/2026-07-25-context-budget-gate.md`](../../plans/2026-07-25-context-budget-gate.md)

## Project Goal

> **Final goal**: Make oversized input to a small-context-window engine a *blocked, deliberate
> decision* instead of a silent 41%-of-all-tokens cost sink, by adding an engine-aware
> context-window gate to all three hetero dispatch rails.
>
> **Success criteria** (each with threshold + verification method):
> 1. `bash hooks/tests/context-window.test.sh` exits 0 — and is proven RED on base / GREEN on
>    head (artifact, not self-report). See § Red-green evidence: done manually because
>    `verify-red-green.sh` structurally cannot validate this repo's own test suite.
> 2. `bash hooks/tests/run.sh` shows zero new failures vs. the pre-change baseline
>    (classified by `scripts/verify-preexisting.sh` if any failure appears).
> 3. All three rails (`dispatch-hetero.sh`, `dispatch-review.sh`, `dispatch-author.sh`) refuse
>    an over-budget dispatch with a non-zero exit and no runner spawn — verified by a test that
>    asserts the runner binary was never invoked.
> 4. `--context-window off` still dispatches (escape hatch verified by test).
> 5. An unknown model is NOT blocked by default; `--strict` does block it (both verified).
> 6. `node scripts/check-claude-md-inventory.js --json` passes (new script is inventoried).
> 7. `bash scripts/sync-codex-plugin-skills.sh --check` passes (Codex payload mirrored).
> 8. `node scripts/sync-version.js --check` passes at v2.32.58.
>
> **Scope boundary**: see plan § Scope boundary. In: the 5 phases + Codex mirror. Explicitly
> out: output compaction (rtk), round-count reduction (data refutes it as a lever), agy/opencode
> telemetry ingestion, engine-scorecard importer, grok implementer tuning.

## L-1.5 Scope Completeness Audit

| Dimension | Applies | Coverage |
|-----------|---------|----------|
| Source code + tests | YES | P0–P4; `hooks/tests/context-window.test.sh` (auto-registered — `run.sh` globs `hooks/tests/*.test.sh`) |
| User-facing docs | YES | P4 — `references/hetero-dispatch.md` gets a Context-window gate section |
| API / interface reference | YES | P4 — `check-context-window.js --help`; new dispatch flag `--context-window` documented in each rail's header |
| Config templates / examples | YES | P4 — threshold override documented; env `AUTOPILOT_CONTEXT_WINDOW_GATE` |
| CHANGELOG entry | YES | P4 |
| Version bump (semver) | YES | PATCH → v2.32.58 (new script + hardening of existing behavior; not a new user-invoked surface, per CLAUDE.md bump table) |
| Version sync verification (grep) | YES | P4 — `sync-version.js --check`; grep old version across **all tracked files**, never enumerate from memory |
| Migration guide / notes | NO | Additive; default `block` mode is a behavior change but only on dispatches that would previously have silently burned tokens. Escape hatch ships in the same commit. |
| Dependent repos / external consumers | YES | P4 — `platforms/codex/plugin/scripts/` mirror via `sync-codex-plugin-skills.sh` |
| Credit / attribution | NO | No external OSS or prior art absorbed; the default window table is derived from local tool-run telemetry |
| Dogfood target | YES | autopilot dispatches through these rails itself; the gate applies to its own `/l4`–`/l6` runs |

## User-stated requirements ledger

| # | Verbatim | Mapped to |
|---|----------|-----------|
| 1 | 「我主要想處理的是想節省 autopilot 的派且磨耗」 | Whole project |
| 2 | 「看能不能大幅降低 heto engin 派遣過程的 token 消耗」 | P0–P1 (targets the measured 41%) |
| 3 | 「或是往返 loop review 的摩擦降到最低」 | **Investigated and refuted as a cost lever** — measured: a 76-round cluster cost 7.9M vs a 41-round cluster at 60.9M; cost tracks single-turn input size, not round count. Recorded in plan § Scope boundary with the evidence. |
| 4 | 「grok / agy / opencode 這台有的畫一併列入統計」 | **Delivered** in the analysis phase; results in plan § Motivation (grok cross-engine table) and § Scope boundary (agy has no token fields; opencode is 99% calibrate) |
| 5 | 「我現在 implementer 很愛用 grok」 | Measured: grok's 71 autopilot-dispatched sessions are all read-only (review 59 / author 12); its implementer usage runs outside the dispatch rails today. No dispatch-side lever exists yet — recorded in plan § Scope boundary. The gate is engine-agnostic, so grok benefits automatically once it is dispatched as implementer. |
| 6 | 「ok go」 | Approval for the 3-item proposal → P0/P1 (gate), P2 (capability dimension), P3 (routing consumption) |

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| P0 | `scripts/check-context-window.js` — estimator + window resolution + verdict JSON | ✅ Done |
| P1 | Wire gate into `dispatch-hetero.sh` / `dispatch-review.sh` / `dispatch-author.sh`; replace the hardcoded 96 KB advisory | ✅ Done |
| P2 | `context_window` capability dimension (`engine-capability-state.js` + schema) | ✅ Done |
| P3 | `resolve-review-loop.sh --input-bytes` reports over-budget seats | ✅ Done (redesigned — see below) |
| P4 | Tests, wire-in (CLAUDE.md inventory, references, Codex + OpenCode mirrors), CHANGELOG, version, INDEX, BACKLOG | ✅ Done |

## Decisions taken during execution

1. **P3 redesigned away from a new contract field.** The plan proposed surfacing the window
   in the resolver contract. Reading the code showed `resolve-review-loop.sh` is a *resolver,
   not an executor* — even an exhausted quota only yields `quota_status` + a warning, and the
   CONSUMER acts per `on_engine_unavailable`. Adding window fields would also create a second
   source of window truth alongside `check-context-window.js`. Final shape: `--input-bytes N`
   reports over-budget seats into the existing `capability_warnings` array. **Zero new contract
   fields** (still 44), zero schema risk, and the single-source-of-truth rule holds.
2. **Renamed from `context-budget` to `context-window`.** A pre-existing opt-in hook is already
   named `context-budget` (it watches depth-0's OWN session context growth via PostToolUse) and
   owns `AUTOPILOT_CONTEXT_WINDOW_GATE_T1/T2/MODE`. The first draft used `AUTOPILOT_CONTEXT_WINDOW_GATE`,
   which would have collided in the same namespace for a different concept. Renamed script, lib,
   test, flag (`--context-window`) and env (`AUTOPILOT_CONTEXT_WINDOW_GATE`).
3. **`UNKNOWN_WINDOW` emits no resolver warning.** 2 of the 3 default roster seats (MiniMax-M3,
   Gemini 3.5 Flash) have no recorded window, so warning on unknown would be constant noise that
   drowns the real `OVER_BUDGET` signal. No window value was invented for them — inventing one
   would violate the CLAUDE.md "don't claim platform facts without verification" rule.

## Bugs found and fixed en route

- **`dispatch-review.sh` `die_precondition` emitted invalid JSON** for any message containing a
  double quote (it interpolated `$RUNNER`/`$MODEL`/message with no escaping; the two sibling
  rails already escaped theirs). Pre-existing defect, surfaced because a model id appears quoted
  inside the new gate's reason string. Fixed via the canonical `json_escape`.
- **Shell word-splitting on space-containing model ids** in the first P3 draft turned
  `"Gemini 3.5 Flash (High)"` into phantom seats named `3.5`, `Flash` and `(High)`. Fixed with
  parallel arrays; a regression assertion guards it.
- **The gate corrupted the rails' machine-parsable result channel** (caught only by the full
  suite — 5 `dispatch-author` test files went red, which the focused test could not see). The
  rails' callers do `OUT="$(dispatch-... 2>&1)"` and then JSON-parse `OUT`; the gate printed a
  `WARNING:` line to stderr on `UNKNOWN_WINDOW` — the normal state for any model without a
  recorded window, i.e. every fake model the tests use — and broke `json.loads`, leaving
  `raw_log` empty. Fixed by routing all advisory output through a helper that respects the
  rails' pre-existing `DISPATCH_QUIET` convention, and by making `UNKNOWN_WINDOW` silent
  outright (matching the same call already made on the resolver side). Regression assertion
  added. **Lesson**: a focused test on the new component passed all 48 assertions while the
  component was actively breaking five unrelated test files — the full-suite baseline
  comparison is what caught it, not the new test.

## Red-green evidence

`scripts/verify-red-green.sh` returned `NOT_RED_ON_BASE` — **a tool defect, not a test defect**.
`run_verify_cmd` `cd`s into the base worktree but executes `$VERIFY_CMD` by the CALLER's absolute
path (deliberate, per its header comment). autopilot's `hooks/tests/*.test.sh` all derive
`REPO_ROOT` from `$0` through `lib.sh`, so the "base" run actually exercised the head tree and
was trivially green. Recorded in `docs/BACKLOG.md` with two candidate fixes.

Manual procedure with the same artifact discipline:

```bash
git worktree add --detach $WT d90433b            # base SHA, product code untouched
git diff d90433b..HEAD -- hooks/tests/context-window.test.sh > testonly.patch
git -C $WT apply testonly.patch                  # ONLY the test file crosses over
cd $WT && bash hooks/tests/context-window.test.sh # relative path ⇒ $0 resolves to base
```

| Tree | Product code present | Result |
|------|---------------------|--------|
| base + test-only patch | `check-context-window.js` **absent** (verified) | **exit 1 — RED** (runner spawned, worktree created, branch leaked, resolver silent) |
| head | present | **48 assertions PASS — GREEN** |

The base failures are exactly the behaviors the gate exists to prevent, which is what makes the
test load-bearing rather than tautological.

## Progress

| Date | Event |
|------|-------|
| 2026-07-25 | Project created; branch cut from `develop` @ `d90433b`; plan written |
| 2026-07-25 | P0–P4 complete (`9bc1059`). Baseline captured in a detached worktree at base SHA: **157/158 test files pass**; the single failure (`dispatch-output-quiescence`, a timing-sensitive flake the just-merged `d90433b` was itself trying to kill) is **PRE_EXISTING**, reproduced on untouched base under load. |
| 2026-07-25 | Full suite caught a **real regression** the focused test could not see: 5 `dispatch-author` files red from stderr chrome corrupting the rails' `2>&1` JSON channel. Fixed + regression-tested (`03389f9`). |
| 2026-07-25 | **Final: `bash hooks/tests/run.sh` → ALL 159 test files PASS, EXIT=0.** Better than baseline — the pre-existing `dispatch-output-quiescence` flake also passed under lower load, confirming it as timing-sensitive rather than a real failure. `sync-all.sh --check` all green. Red-green: base RED / head GREEN (manual, see § Red-green evidence). |

## Evidence base

Telemetry scan is read-only and aggregate-only (no transcript content leaves the machine).
Scan scripts live in the session scratchpad, not in the repo — they are analysis tooling, not
shipped product. Key figures are reproduced in the plan's Motivation table; the durable
artifact of this investigation is the plan document plus this README.
