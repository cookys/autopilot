# Plan — guard port: cut the per-tool-call hook spawns

> Status: 計畫審查 G2 CONDITIONAL 於世代上限；depth-0 裁決後修訂 G2 blockers，未重審（2026-10-24） / Owner: cookys / Branch: not yet created / Frame: autopilot hooks only
> Source: P2 of [mods-visible-dispatch](2026-10-03-mods-visible-dispatch.md); verdict `open_guard_port_plan`; BL-0241 in `docs/BACKLOG.md`.

## 0. Context / thesis

The P2 measurement (`scripts/benchmark-hook-latency.js`, evidence in `docs/plans/evidence/2026-10-23-hook-latency-p2/`) applied its pre-registered rule: enabled minus zero p95 >= 150 ms AND >= 5 spawns per call opens this plan. PostToolUse measured 7 spawns per call with call p95 197 ms (instrument valid, marker p95 247 ms; host load about 40, so absolutes run high). PreToolUse measured 2 spawns per call, call p95 142 ms. The thesis, stated as a hypothesis to test in Phase 0 rather than a fact: fewer processes per call lowers the call latency, without changing what any guard decides. The harness defines a call's latency as the max of its concurrent hook intervals (`scripts/benchmark-hook-latency.js:15-16`, `:91-92`). The baseline's PostToolUse aggregate (`arms.enabled.per_event.PostToolUse`: p50 64 ms, p95 124 ms) pools 4200 hook intervals with no per-hook or per-spawn split; the call p95 of 197 ms is the p95 of the per-call max of seven concurrent intervals, not a sum.

## 1. Problem

Every tool call pays one `node` start per registered hook. The hooks of one event run concurrently, so latency is the slowest start, not the sum; more concurrent starts raise the chance that one is slow, especially under host load (about 40 in the P2 run). Fewer spawns per call should lower that tail, but how much is unmeasured: the baseline has no per-hook split (only the pooled interval percentiles in § 0). The goal is fewer spawns per call with identical guard behaviour; the latency gain is a bet that Phase 0 must size before Phase 2 starts.

## 2. OKR / KRs

Metrics are pre-registered here, before any code, and measured with the same harness as P2 (`scripts/benchmark-hook-latency.js`, same workload, N=30, haiku, `--max-usd 1.5`), baseline file `docs/plans/evidence/2026-10-23-hook-latency-p2/hook-latency-baseline.json`.

- KR1: PostToolUse spawns per call drops from 7 to <= 3 (the unmatched-tool case).
- KR2: with B = the Phase 0 same-host re-baseline of the unchanged tree and R = the Phase 4 result (both harness JSON files, designated by the rule below), KR2 is met iff `R.arms.enabled.per_event.PostToolUse.call_p95_ms <= 0.76 * B.arms.enabled.per_event.PostToolUse.call_p95_ms` (0.76 is the 197 to 150 ms drop of the P2 run, kept as a ratio so host load cancels).
- KR3: PreToolUse spawns per call in R do not exceed those in B (2 in P2), and `R.…PreToolUse.call_p95_ms <= 1.10 * B.…PreToolUse.call_p95_ms`.
- The historical 197, 150 and 142 ms figures are background only; no KR is judged against them.
- KR4: zero behaviour change: the fail-open/fail-closed table in § 2.5.1 holds, proven by a differential test that feeds the same payload corpus to the old chain and to the new path.
- Result-selection rule (fixed now): load is the 1-minute load average sampled at the start and at the end of each harness run. The first run is the result unless either sample is above 10; then exactly one rerun is made and that rerun is the result if both its samples are at most 10. If the rerun is also above 10, KR1 (a count, load-independent) is still judged and KR2 and KR3 are reported as "unmeasured, host noisy", not as met. Both raw runs are kept and KRs are computed only from the designated result. A KR miss is reported as a miss, not re-scoped.
- Baseline rule: B is taken in Phase 0 under the same load rule and is the only baseline for KR2 and KR3. KR1 uses spawn counts (7 in P2; load-independent).
- KR2 feasibility gate (Phase 0): in a scratch checkout (never committed) run the harness with the five chained observers removed from `hooks/hooks.json`, giving a floor F for the call p95 at zero chain cost. If `F > 0.76 * B`, KR2 is unreachable even for a free chain; the plan then reports that to the owner and Phase 2 proceeds only on an owner decision with KR1 as the sole gate.

## 2.5 Global Constraints

- Each guard's exit code, stdout and stderr for the same input are byte-identical to what it produces today when run as its own process. A chain only forwards each hook's bytes in registration order; it never merges, parses or rewrites them (the opt-in multiplexer's JSON merge, which skips non-JSON stdout at `hooks/opt-in-multiplexer.js:136-180`, is not a model for it).
- A guard that fails open today (exit 0 on its own error) still fails open. A guard that blocks (exit 2) today still blocks.
- The registration order within one event is preserved. Hooks of one event run concurrently today, so order carries no sequencing guarantee; keeping it is a conservative rule, and the chain must not make any observer depend on another's side effects.
- ADR-0001 holds (verification by independent re-derivation, no attestation machinery) and the version hold stays in force through every later slice; no phase bumps the version.
- `hooks/hooks.json` stays the single wiring source for `scripts/check-hook-inventory.js`.
- No new dependency.

### 2.5.1 Fail-open / fail-closed table

Read from the hook sources on this branch. Most guards deny with a `permissionDecision` JSON on stdout and exit 0; only the multiplexer and `context-budget.js` exit 2. On an internal error (unreadable stdin, bad JSON, thrown exception, lock timeout) every hook below fails open. The deliberate fail-closed cases are config-value fallbacks in `dispatch-model-guard.js` (lines 133, 140, 147), for garbage config only.

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
- Work units: this unit ends with the approved plan document (docs only). Phases 0 and 1 are a second unit (evidence, the unregistered chain, behaviour-neutral observer refactors and the test harness; no registered behaviour changes); Phases 2 to 4 are a third unit. ADR-0001 and the version hold apply to all three.
- Dependency decision: none (Node standard library only).

## Candidate designs

Prior art: `hooks/opt-in-multiplexer.js` folds the opt-in hooks into one process per event (design D6 A12; `hooks/opt-in-manifest.json`); its harness is `scripts/benchmark-hook-multiplexer.js`, validator `scripts/validate-hook-multiplexer-benchmark.js`. Recorded D6 result (validated: `node scripts/validate-hook-multiplexer-benchmark.js .autopilot/evidence/hook-multiplexer-benchmark.json` prints `ok`): base `f6805529` vs candidate `1e7e5b69`, 50 paired samples after 10 warmups; thresholds at `hooks/tests/fixtures/hook-multiplexer-benchmark.json:42-49`. Median / p95 in ms, base to candidate:

| Report row (generated `.autopilot/evidence/hook-multiplexer-benchmark.json`; thresholds in the fixtures file above) | Base | Candidate | Processes as the D6 report counts them (an enabled run still spawns its children) |
|---|---|---|---|
| `cold-disabled` (line 14) | 98.0 / 116.0 | 50.6 / 58.9 | 2 to 1 |
| `cold-enabled` (line 298) | 94.9 / 114.4 | 94.8 / 110.5 | 2 to 1 |
| `heavy-disabled` (line 582) | 193.0 / 223.6 | 45.6 / 55.9 | 4 to 1 |
| `heavy-enabled` (line 866) | 197.3 / 227.4 | 151.5 / 181.1 | 4 to 1 |

Verdict: the multiplexer passed its D6 gates; it removes disabled-hook spawns and is neutral to modest for enabled hooks (it still `spawnSync`s each enabled child). It never measured folding default-on guards, so it is no evidence for Designs A or B on KR2.

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

- A. One Node chain process for the five contiguous `.*` PostToolUse observers that precede the multiplexer (`intent-capture`, `reload-watch`, `audit-log`, `log-error`, `failure-escalation`), registered at the first one's position. `opt-in-multiplexer.js PostToolUse` and `context-budget.js` stay separate registrations at their positions (order kept; PostToolUse goes from 7 to 3 spawns). None of the five is a callable module: each is a top-level script that reads fd 0 (`intent-capture.js:203`, `reload-watch.js:76`, `audit-log.js:32`, `log-error.js:24`, `failure-escalation.js:175`) and ends with `process.exit` (`:279`, `:113`, `:68`, `:61`, `:219` respectively). `context-budget.js` keeps its own process because it can exit 2 and holds a lock released on exit. Chain contract, each item a Phase 0 predicate:
  - Output: each observer's stdout, stderr and exit code equal its standalone run byte for byte; the chain forwards them in order, with no JSON merge. `failure-escalation.js:208-210` writes plain text and `reload-watch.js:98-103` writes `hookSpecificOutput` JSON, both stay as written. Because one process now concatenates what separate processes emitted, Phase 0 must establish by a real run or an official doc URL that the host reads the concatenation the same way; if not, the observers that write stdout stay separate registrations. The chain exits with the highest per-hook status; Phase 0 confirms all five only ever exit 0 (`reload-watch.js:113,116`, `audit-log.js:68,71`, `log-error.js:61,64`, `failure-escalation.js:219,223`, `intent-capture.js:279`).
  - Order inside a hook is untouched: `audit-log.js:40` calls `awaiting-owner.js` `handle` first, then `ask-decision.onPostToolUse` and `merge-task-status-lib.onPostToolUse` (`:44-46`); an export refactor keeps all three, in that order.
  - Form: the preferred form is to refactor each observer into an exported function taking the stdin text, with an unchanged CLI wrapper. Intercepting `process.exit` with a thrown sentinel is allowed for an observer only if Phase 0 shows no hook-level `catch` can swallow the sentinel and print its own bytes (`reload-watch.js:114` and `audit-log.js:69` have a top-level `catch` that writes stderr, so those two take the export form).
  - Isolation: fd 0 is read once by the chain and passed as text. The five do not assign `process.env`, call `process.chdir` or `process.on` (grep at this commit); Phase 0 re-checks them and their shared libs. A lib required by two of the five that holds mutable module state gets a fresh `require.cache` entry between hooks. Any `process.exit`, stdout or stderr wrapper is restored in a `finally`. Each hook runs in its own try/catch with its own fail-open outcome.
  - Concurrency to sequence: today the five run concurrently, so call latency is their max; in the chain it is one node start plus the sum of their in-process times. This is acceptable only if the KR2 formula still holds at Phase 4, and only if their write sets are disjoint (Phase 0 state-path tuples); that is a premise, and the overlapping-call corpus in Phase 1 is what verifies it; the chain also carries the largest timeout of the five.
- B. Extend `opt-in-multiplexer.js` to run default-on stems in-process too. Reuses the existing tested selector. Risk: it mixes the opt-in and default-on tiers that `check-hook-inventory.js` keeps separate.
- C. Leave spawn count, shrink Node start (V8 compile cache, lazy requires). Lowest risk, smaller gain, may not reach KR1.
- Phase 0 decision table (replaces any earlier selection prose):

| Design | Chosen iff | Otherwise |
|---|---|---|
| A | every chain-contract predicate above holds for all five observers and the host reads concatenated output the same way | an observer that fails stays a separate registration; if the remaining chain gives PostToolUse spawns above 3, go to B or C |
| B | A fails, the owner accepts mixing opt-in and default-on tiers, and every moved observer writes no non-JSON stdout (B inherits the JSON-only multiplexer, so `failure-escalation` cannot move) | C |
| C | owner-approved fallback; KR1 is then expected to miss and is reported as a miss | none |

## 3. File-structure map

- `docs/plans/2026-10-23-guard-port.md` plus its review artifacts (rubric, manifest, findings, dispositions): this unit's only changes.
- Later phases (not in this unit): a new chain entry under `hooks/`, `hooks/hooks.json` rewiring, `hooks/tests/` differential test, and `scripts/check-hook-inventory.js`: its `stemsFromHookBlock` expands a multiplexer's members through `MULTIPLEXER_EVENT_TABLE` and lists `opt-in-multiplexer.js` in `NON_HOOK` (`scripts/check-hook-inventory.js:46-50,67-82,91-96`), so a chain script needs the same treatment (listed as infrastructure, its five stems counted as wired and default-on) or the five files read as disabled orphans and `--check` fails. Hook docs counts follow from that script.

## 4. Phases

- Phase 0 (S): read-only audit. For each hook in the table record: stdin use, `process.exit` use, exit codes, fail-open/closed behaviour, shared state files. Re-run the D6 validator and confirm the cited numbers. Take the same-host re-baseline of the unchanged tree and size the KR2 feasibility gate (§ 2). Done when the audit table (the behavioural tuples of § 2.5.1) and the re-baseline are committed under `docs/plans/evidence/`, the predicates in Candidate designs select A, B or C, and the KR2 feasibility result is recorded.
- Phase 1 (M): build the chain and its adapter (the design the decision table selected) as new files that nothing registers, plus, for the export form, a behaviour-neutral refactor of the observers (exported function plus unchanged CLI wrapper; the harness proves each standalone run unchanged), and the differential harness. `hooks/hooks.json` is untouched, so no registered behaviour changes. The harness runs a baseline side (the current separate processes) and a candidate side (the unregistered chain, run only by the test) on equal isolated fixtures: temporary state directories and environment, controlled time. The corpus has three parts: single payloads; ordered multi-call sequences; and overlapping calls, where two or more tool-call payloads are started within the same few milliseconds against one shared state directory (a start barrier, N repeats, including pairs that both touch `intent-capture` counters, the disable flag, `context-budget` cadence state and lock files). Baseline runs each call's five observers as concurrent processes and candidate runs each call's chain, so the cross-call race on one state file is exercised on both sides. For overlapping calls the final state must equal the state of some serial order of the same calls, accepted on both sides, with identical per-call exit and output bytes; disjoint write sets are only the premise for this test, never its evidence. Host-visible oracle: for each call the baseline's aggregate is the five standalone stdout streams concatenated in registration order, with the exit status the host would see (the highest of the five), and stderr likewise; the chain's single stdout, stderr and exit are compared with that aggregate byte for byte, on fixtures that make `reload-watch` (catalog change), `failure-escalation` (failing Bash at the escalation count) and both together emit, plus a fixture where none emits. Where Phase 0 shows the host reads concatenated output differently, the fixture set instead asserts that the writers stay separate. Comparison matrix: exit code, stdout and stderr are compared raw and are never normalised; state files are compared after a normalisation allowlist limited to the volatile fields Phase 0 enumerates (timestamps, pids, temporary paths); state covers intent records, tool and failure counters, the disable flag, `context-budget` cadence and reminder state, file permissions and lock cleanup. Done when (a) the candidate equals the baseline on the whole corpus, including the host-visible aggregate fixtures and the overlapping-call cases, and (b) a negative control, a candidate mutated to change one exit code, one stdout byte or the aggregate order, or to drop one state write, is shown red; it stays as a permanent test asserting that the harness exits non-zero on the mutant.
- Phase 2 (M): register the Phase 1 chain in `hooks/hooks.json` (removing the five direct commands) and add the `check-hook-inventory.js` expansion. Done when the Phase 1 harness still passes on the registered tree and `node scripts/check-hook-inventory.js --check` is green.
- Phase 3 (S): PreToolUse review. KR3 is at risk iff Phase 2 changed any PreToolUse registration, or an interim harness run shows the KR3 formula failing against B under the load rule. Otherwise record "no change", with `git diff` of the PreToolUse block of `hooks/hooks.json` empty. If at risk, the applied change gets its own done-condition: the Phase 1 harness passes for the touched hooks and the interim run meets the KR3 formula.
- Phase 4 (S): rerun `scripts/benchmark-hook-latency.js` with the same settings; record against KR1-KR3; archive the evidence. Done when each KR is judged by its formula against B, with data.

Dependencies: 0 -> 1 -> 2 -> 3 -> 4.

## 5. Test / validation

Script-gated: the differential test, `check-hook-inventory.js --check`, the P2 harness rerun. Human-gated: owner reads the KR table.

## 6. Risks + inversion

- Guarantee of failure: a chained hook that throws and takes the other hooks down. Mitigation: each hook runs under its own try/catch with its original fail-open or fail-closed outcome.
- Shared module state, `process.exit` inside a hook, or a hook-level catch altering bytes. Mitigation: the chain contract in Design A and the Phase 1 harness.
- Measurement noise (host load). Mitigation: result-selection rule in § 2.
- Hook counts drift in docs. Mitigation: `check-hook-inventory.js --check`.

## 7. Out of scope

- P4 `progress.json` and the work-round projection stay parked per owner ruling d-585003b0 (no consumer until radar asks).
- Withdrawn P3 items (wake-events, idle-observe, declare-idle).
- Changing what any guard decides or removing any logical guard coverage (later units may consolidate physical command registrations in `hooks/hooks.json`); Codex and OpenCode hook paths.
- Any code or hook change in this unit: it is docs-only.

## 8. Open questions

- Does the owner accept Design A as the default, and the table's fallback to C with a KR1 miss if A and B both fail?

## Review log

- R0: author draft 2026-10-23.
- G2 revision (2026-10-24): 計畫審查 G2 CONDITIONAL 於世代上限；depth-0 裁決後修訂 G2 blockers，未重審。Dispositions in `2026-10-23-guard-port.g2-dispositions.json`.
- G2 (2026-10-24): artifact `2026-10-23-guard-port.g2-artifact.json`; sol CONDITIONAL, grok STOP, minimax STOP, qwen READY; 11 blocking findings were open before the depth-0 revision. Generation cap reached; depth-0 adjudicated and the dispositions are in the G2 revision line above.
- G1 (2026-10-24): rubric `2026-10-23-guard-port.rubric.md`, manifest `2026-10-23-guard-port.plan-review-manifest.json`, artifact `2026-10-23-guard-port.g1-artifact.json`. Seats: sol CONDITIONAL, grok STOP, minimax STOP, qwen CONDITIONAL. Dispositions in `2026-10-23-guard-port.g1-dispositions.json`; every blocker was re-derived against the repo and folded.
