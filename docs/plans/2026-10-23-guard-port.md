# Plan — guard port: cut the per-tool-call hook spawns

> Status: draft, generation 1 plan review folded (verdict CONDITIONAL, four seats; see Review log) / Owner: cookys / Branch: not yet created / Frame: autopilot hooks only
> Source: P2 of [mods-visible-dispatch](2026-10-03-mods-visible-dispatch.md); verdict `open_guard_port_plan`; BL-0241 in `docs/BACKLOG.md`.

## 0. Context / thesis

The P2 measurement (`scripts/benchmark-hook-latency.js`, evidence in `docs/plans/evidence/2026-10-23-hook-latency-p2/`) applied its pre-registered rule: enabled minus zero p95 >= 150 ms AND >= 5 spawns per call opens this plan. PostToolUse measured 7 spawns per call with call p95 197 ms (instrument valid, marker p95 247 ms; host load about 40, so absolutes run high). PreToolUse measured 2 spawns per call, call p95 142 ms. The thesis, stated as a hypothesis to test in Phase 0 rather than a fact: fewer processes per call lowers the call latency, without changing what any guard decides. The harness defines a call's latency as the max of its concurrent hook intervals (`scripts/benchmark-hook-latency.js:15-16`, `:91-92`), and every single PostToolUse hook interval has p95 124 ms and p50 64 ms in the baseline, so the call p95 of 197 ms is the slowest of seven concurrent starts, not a sum.

## 1. Problem

Every tool call pays one `node` start per registered hook. The hooks of one event run concurrently, so latency is the slowest start, not the sum; more concurrent starts raise the chance that one is slow, especially under host load (about 40 in the P2 run). Fewer spawns per call should lower that tail, but how much is unmeasured: the baseline has no per-hook breakdown, and a single spawn already sits at p95 124 ms. The goal is fewer spawns per call with identical guard behaviour; the latency gain is a bet that Phase 0 must size before Phase 2 starts.

## 2. OKR / KRs

Metrics are pre-registered here, before any code, and measured with the same harness as P2 (`scripts/benchmark-hook-latency.js`, same workload, N=30, haiku, `--max-usd 1.5`), baseline file `docs/plans/evidence/2026-10-23-hook-latency-p2/hook-latency-baseline.json`.

- KR1: PostToolUse spawns per call drops from 7 to <= 3 (the unmatched-tool case).
- KR2: PostToolUse call p95 (enabled minus zero) drops from 197 ms to < 150 ms, which closes the verdict rule's latency leg.
- KR3: PreToolUse spawns per call does not rise above 2; its call p95 does not regress above 142 ms.
- KR4: zero behaviour change: the fail-open/fail-closed table in § 2.5.1 holds, proven by a differential test that feeds the same payload corpus to the old chain and to the new path.
- Result-selection rule (fixed now): load is the 1-minute load average sampled at the start and at the end of each harness run. The first run is the result unless either sample is above 10; then exactly one rerun is made and that rerun is the result if both its samples are at most 10. If the rerun is also above 10, KR1 (a count, load-independent) is still judged and KR2 and KR3 are reported as "unmeasured, host noisy", not as met. Both raw runs are kept and KRs are computed only from the designated result. A KR miss is reported as a miss, not re-scoped.
- Baseline rule: the historical file above stays the reference for KR1 and KR4, but KR2 and KR3 are judged against a same-host re-baseline of the unchanged tree taken in Phase 0 under the same load rule, so a quieter host cannot be credited to the port.
- KR2 feasibility gate (Phase 0): before Phase 2, Phase 0 derives the floor for the latency leg from the re-baseline (the p95 of one single-spawn call) and the in-process cost of the chained observers; if the demonstrated saving cannot exceed 47 ms (197 to under 150), the plan reports KR2 as unreachable to the owner and Phase 2 proceeds only on an owner decision with KR1 as the sole gate.

## 2.5 Global Constraints

- Each guard's exit code and stdout/stderr for the same input are byte-identical before and after.
- A guard that fails open today (exit 0 on its own error) still fails open. A guard that blocks (exit 2) today still blocks.
- The registration order within one event is preserved. Hooks of one event run concurrently today, so order carries no sequencing guarantee; keeping it is a conservative rule, and the chain must not make any observer depend on another's side effects.
- ADR-0001 holds (verification by independent re-derivation, no attestation machinery) and the version hold stays in force through every later slice; no phase bumps the version.
- `hooks/hooks.json` stays the single wiring source for `scripts/check-hook-inventory.js`.
- No new dependency.

### 2.5.1 Fail-open / fail-closed table

Read from the hook sources on this branch. "Block" means how the guard denies today: most emit a `permissionDecision` JSON on stdout and still exit 0; only the multiplexer and `context-budget.js` exit 2. On an internal error (unreadable stdin, bad JSON, thrown exception, lock timeout) every hook below fails open; no guard fails closed on its own error. The deliberate fail-closed cases are config-value fallbacks inside `dispatch-model-guard.js` (lines 133, 140, 147), which apply to garbage config, not to an internal error.

| Hook | Event | Current behaviour on internal error | Evidence (file:line) | Invariant the port keeps |
|---|---|---|---|---|
| `opt-in-multiplexer.js` | Pre/Post | Fail-open, exit 0; a child's exit 2 is propagated | `hooks/opt-in-multiplexer.js:126` (exit 2), `:186-188` (catch, exit 0) | Child exit-2 passthrough and catch-all exit 0 |
| `ask-decision.js` | PreToolUse | Fail-open via `L.failOpen`, exit 0 | `hooks/ask-decision.js:117-118` | Throw leads to exit 0 |
| `foreman-guard.js` | PreToolUse | Fail-open; deny is JSON plus exit 0; lock timeout also fails open | `hooks/foreman-guard.js:684` (deny), `:687` (catch), `:521` (lock) | Deny stays JSON plus exit 0; crash never blocks |
| `cost-fuse.js` | PreToolUse | Fail-open, exit 0 | `hooks/cost-fuse.js:324` (deny), `:355` (catch), `:280` (bad JSON) | Same |
| `dispatch-model-guard.js` | PreToolUse | Fail-open with stderr note; config garbage fails closed | `hooks/dispatch-model-guard.js:251-255` (payload), `:359-362` (catch), `:133`, `:140`, `:147` (config fail-closed fallbacks) | Both the fail-open paths and the config fail-closed fallbacks |
| `run-approval-gate.js` | Pre/Post | Fail-open, exit 0; asks via `emitAsk`, never exit 2 | `hooks/run-approval-gate.js:184` (bad JSON), `:206` (catch) | Ask stays exit 0; error leads to exit 0 |
| `subagent-budget.js` | PreToolUse | Fail-open with stderr note, exit 0 | `hooks/subagent-budget.js:546-549` | Same |
| `depth0-delegate-gate.js` | PreToolUse | Fail-open, exit 0; lock timeout fails open | `hooks/depth0-delegate-gate.js:336` (catch), `:184` (lock), `:215` (bad JSON) | Same |
| `intent-capture.js` | PostToolUse | Fail-open; failure counter then disable flag; exit 0 | `hooks/intent-capture.js:270-279` | Counter and breaker semantics unchanged |
| `reload-watch.js` | PostToolUse | Fail-open, exit 0 | `hooks/reload-watch.js:114-116` | Same |
| `audit-log.js` | PostToolUse | Fail-open, exit 0 | `hooks/audit-log.js:69-71` | Same |
| `log-error.js` | PostToolUse | Fail-open, exit 0 | `hooks/log-error.js:62-64` | Same |
| `failure-escalation.js` | PostToolUse | Fail-open, exit 0 | `hooks/failure-escalation.js:220-223` | Same |
| `context-budget.js` | PostToolUse | Fail-open: error resets `exitCode = 0`; its deliberate advisory exit is 2 | `hooks/context-budget.js:483-486` (catch, `exitCode = 0`), `:409` and `:473` (`exitCode = 2`) | Advisory exit 2 kept; error exit 0 kept |
| `suggest-compact.js` | PostToolUse | Fail-open, exit 0 | `hooks/suggest-compact.js:94-97` | Same |
| `session-tasks.js` | PostToolUse | Fail-open via `L.failOpen`, exit 0 | `hooks/session-tasks.js:152-153` | Same |

This table is the summary. Phase 0 expands each in-scope row into a behavioural tuple (event and matcher, trigger or error condition, stdin handling, exit code, exact stdout, exact stderr, state or file mutation, registration position) with file and line, and the Phase 1 harness is built from those tuples.

Because a single in-process chain shares one try/catch scope unless each hook gets its own, the port must wrap each hook separately so one throw cannot skip the rest or change another hook's exit code.

## 2.6 Change-policy decisions

- Compatibility impact: internal-only; hook behaviour and the plugin's user-facing contract are unchanged.
- Work units: this unit ends with the approved plan document (docs only). Phases 0 and 1 are a second unit (evidence and test harness, no hook change); Phases 2 to 4 are a third unit. ADR-0001 and the version hold apply to all three.
- Dependency decision: none (Node standard library only).

## Candidate designs

Existing prior art: `hooks/opt-in-multiplexer.js` already folds the opt-in hooks into one process per event (design D6 A12; manifest `hooks/opt-in-manifest.json`). The D6 harness `scripts/benchmark-hook-multiplexer.js`, its validator `scripts/validate-hook-multiplexer-benchmark.js` and the fixture `hooks/tests/fixtures/hook-multiplexer-benchmark.json` compare base and candidate commits. Recorded D6 result (validated: `node scripts/validate-hook-multiplexer-benchmark.js .autopilot/evidence/hook-multiplexer-benchmark.json` prints `ok`, exit 0). The report compares base `f6805529` with candidate `1e7e5b69` over 50 paired samples after 10 warmups; thresholds are in `hooks/tests/fixtures/hook-multiplexer-benchmark.json:42-49`; the harness is `scripts/benchmark-hook-multiplexer.js` (351 lines, last changed by `1e7e5b69a`). Median / p95 in ms, base to candidate:

| Report row (generated `.autopilot/evidence/hook-multiplexer-benchmark.json`; thresholds in the fixtures file above) | Base | Candidate | Processes as the D6 report counts them (an enabled run still spawns its children) |
|---|---|---|---|
| `cold-disabled` (line 14) | 98.0 / 116.0 | 50.6 / 58.9 | 2 to 1 |
| `cold-enabled` (line 298) | 94.9 / 114.4 | 94.8 / 110.5 | 2 to 1 |
| `heavy-disabled` (line 582) | 193.0 / 223.6 | 45.6 / 55.9 | 4 to 1 |
| `heavy-enabled` (line 866) | 197.3 / 227.4 | 151.5 / 181.1 | 4 to 1 |

Verdict: the multiplexer passed its D6 gates; it removes disabled-hook spawns (about halving or better) and is neutral to modest for enabled hooks. It never measured folding default-on guards, so it gives no evidence for Designs A or B on KR2; the P2 baseline stays the reference. Design rationale: `docs/plans/2026-08-03-next-touch-debt-retirement.md:207-215`. Note the multiplexer still `spawnSync`s each enabled child, so it removes disabled spawns only, not enabled ones.

Per-call spawns today (from `hooks/hooks.json`):

| Event | Matcher | Hooks |
|---|---|---|
| PreToolUse | `.*` | `opt-in-multiplexer.js PreToolUse` |
| PreToolUse | `AskUserQuestion` | `ask-decision.js` |
| PreToolUse | `Bash\|Monitor` | `foreman-guard.js` |
| PreToolUse | `Bash\|Edit\|Write\|MultiEdit\|NotebookEdit` | `cost-fuse.js` |
| PreToolUse | `Task\|Agent` | `dispatch-model-guard.js`, `run-approval-gate.js PreToolUse`, `subagent-budget.js` |
| PreToolUse | `WebFetch\|WebSearch\|Read\|Grep\|Glob\|Bash\|Agent\|Task\|Skill` | `depth0-delegate-gate.js` |
| PostToolUse | `.*` | `intent-capture.js`, `reload-watch.js`, `audit-log.js`, `log-error.js`, `failure-escalation.js`, `opt-in-multiplexer.js PostToolUse`, `context-budget.js` |
| PostToolUse | `Write\|Edit` | `suggest-compact.js` |
| PostToolUse | `Task\|Agent` | `run-approval-gate.js PostToolUse` |
| PostToolUse | `TaskCreate\|TaskUpdate\|TaskList` | `session-tasks.js` |

The 7 measured PostToolUse spawns are the seven `.*` entries.

- A. One Node chain process for the five contiguous `.*` PostToolUse observers that precede the multiplexer (`intent-capture`, `reload-watch`, `audit-log`, `log-error`, `failure-escalation`), registered at the first one's position. `opt-in-multiplexer.js PostToolUse` and `context-budget.js` stay separate registrations at their current positions, so the order is preserved and PostToolUse goes from 7 to 3 spawns (KR1 holds exactly at its limit). Cuts 5 spawns to 1. None of the five is a callable module today: each is a top-level script that reads fd 0 (`intent-capture.js:203`, `reload-watch.js:76`, `audit-log.js:32`, `log-error.js:24`, `failure-escalation.js:175`) and ends with `process.exit` (`intent-capture.js:279`, `reload-watch.js:113`, `audit-log.js:68`, `log-error.js:61`, `failure-escalation.js:219`), so a bare `require` would consume stdin and end the chain at the first hook. The in-process adapter is therefore a named Phase 2 deliverable: read stdin once and replay it to each hook, intercept `process.exit` and map it to that hook's own status without ending the chain, capture each hook's stdout and stderr and merge them as `opt-in-multiplexer.js` does, and run each hook in its own try/catch. The alternative is to refactor each hook into an exported function plus an unchanged CLI wrapper (`audit-log.js:44-46` already `require`s `ask-decision.js` and `merge-task-status-lib.js` this way for their `onPostToolUse`). `context-budget.js` keeps its own process because it can exit 2 and holds a lock released on exit.
- B. Extend `opt-in-multiplexer.js` to run default-on stems in-process too. Reuses the existing tested selector. Risk: it mixes the opt-in and default-on tiers that `check-hook-inventory.js` keeps separate.
- C. Leave spawn count, shrink Node start (V8 compile cache, lazy requires). Lowest risk, smaller gain, may not reach KR1.
- Chosen provisionally: A, with B rejected unless Phase 0 shows A cannot reuse the selector. Phase 0 confirms or flips this with explicit predicates: A is confirmed iff, for each of the five observers, the audit shows the stdin replay, `process.exit` interception and per-hook state paths can keep exit code, stdout, stderr and state effects identical, and the order-preserving topology above holds; if any observer fails that, it stays a separate registration (which may break KR1) or the design flips to B or C and the owner is told.

## 3. File-structure map

- `docs/plans/2026-10-23-guard-port.md` plus its review artifacts (rubric, manifest, findings, dispositions): this unit's only changes.
- Later phases (not in this unit): a new chain entry under `hooks/`, `hooks/hooks.json` rewiring, `hooks/tests/` differential test, and `scripts/check-hook-inventory.js`: its `stemsFromHookBlock` expands a multiplexer's members through `MULTIPLEXER_EVENT_TABLE` and lists `opt-in-multiplexer.js` in `NON_HOOK` (`scripts/check-hook-inventory.js:46-50,67-82,91-96`), so a chain script needs the same treatment (listed as infrastructure, its five stems counted as wired and default-on) or the five files read as disabled orphans and `--check` fails. Hook docs counts follow from that script.

## 4. Phases

- Phase 0 (S): read-only audit. For each hook in the table record: stdin use, `process.exit` use, exit codes, fail-open/closed behaviour, shared state files. Re-run the D6 validator and confirm the cited numbers. Take the same-host re-baseline of the unchanged tree and size the KR2 feasibility gate (§ 2). Done when the audit table (the behavioural tuples of § 2.5.1) and the re-baseline are committed under `docs/plans/evidence/`, the predicates in Candidate designs select A, B or C, and the KR2 feasibility result is recorded.
- Phase 1 (M): differential test harness with a baseline side (the current separate processes) and a candidate side (the new path), run on equal isolated fixtures: temporary state directories and environment, controlled time, and normalisation of process-dependent values. A payload corpus, including multi-call sequences, is fed to both sides, and the harness compares per hook the exit code, stdout, stderr and the resulting state (intent records, tool and failure counters, the disable flag, `context-budget` cadence and reminder state, file permissions, lock cleanup). Done when (a) it passes with the baseline run against itself, and (b) a negative control, a candidate that deliberately changes one exit code or one stdout byte, or drops one state write, is shown red and kept as a fixture, then removed.
- Phase 2 (M): implement the chosen design for the PostToolUse `.*` observers, including the adapter and the `check-hook-inventory.js` expansion; update `hooks/hooks.json`. Done when the Phase 1 harness is identical on every compared channel and `node scripts/check-hook-inventory.js --check` is green.
- Phase 3 (S): PreToolUse review. KR3 is at risk iff Phase 2 changed any PreToolUse registration, or an interim run of the harness shows PreToolUse spawns per call above 2 or call p95 above 142 ms under the load rule. Otherwise record "no change", with `git diff` of the PreToolUse block of `hooks/hooks.json` empty. If at risk, the applied change gets its own done-condition: the Phase 1 harness passes for the touched hooks and the interim run is back within KR3.
- Phase 4 (S): rerun `scripts/benchmark-hook-latency.js` with the same settings; record against KR1-KR3; archive the evidence. Done when each KR is marked met or missed with data.

Dependencies: 0 -> 1 -> 2 -> 3 -> 4.

## 5. Test / validation

Script-gated: the differential test, `check-hook-inventory.js --check`, the P2 harness rerun. Human-gated: owner reads the KR table.

## 6. Risks + inversion

- Guarantee of failure: a chained hook that throws and takes the other hooks down. Mitigation: each hook runs under its own try/catch with its original fail-open or fail-closed outcome.
- Shared module state or `process.exit` inside a hook ending the whole chain early. Mitigation: Phase 0 audit and adapter.
- Measurement noise (host load). Mitigation: rerun rule in § 2.
- Hook counts drift in docs. Mitigation: `check-hook-inventory.js --check`.

## 7. Out of scope

- P4 `progress.json` and the work-round projection stay parked per owner ruling d-585003b0 (no consumer until radar asks).
- Withdrawn P3 items (wake-events, idle-observe, declare-idle).
- Changing what any guard decides; adding or removing hooks; Codex and OpenCode hook paths.
- Any code or hook change in this unit: it is docs-only.

## 8. Open questions

- Does the owner accept Design A as the default, or require the opt-in multiplexer extension (B)?

## Review log

- R0: author draft 2026-10-23.
- G1 (2026-10-24): rubric `2026-10-23-guard-port.rubric.md`, manifest `2026-10-23-guard-port.plan-review-manifest.json`, artifact `2026-10-23-guard-port.g1-artifact.json`. Seats: sol (CONDITIONAL), grok (STOP), minimax (STOP), qwen (CONDITIONAL). Dispositions in `2026-10-23-guard-port.g1-dispositions.json`; all blockers were re-derived against the repo and folded (concurrency of one event's hooks, chain order, process.exit and stdin in the hooks, KR2 feasibility, result-selection rule, negative control, state comparison, inventory expansion, wrong context-budget lines).
