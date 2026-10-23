# Plan — guard port: cut the per-tool-call hook spawns

> Status: draft, awaiting plan review / Owner: cookys / Branch: not yet created / Frame: autopilot hooks only
> Source: P2 of [mods-visible-dispatch](2026-10-03-mods-visible-dispatch.md); verdict `open_guard_port_plan`; BL-0241 in `docs/BACKLOG.md`.

## 0. Context / thesis

The P2 measurement (`scripts/benchmark-hook-latency.js`, evidence in `docs/plans/evidence/2026-10-23-hook-latency-p2/`) applied its pre-registered rule: enabled minus zero p95 >= 150 ms AND >= 5 spawns per call opens this plan. PostToolUse measured 7 spawns per call with call p95 197 ms (instrument valid, marker p95 247 ms; host load about 40, so absolutes run high). PreToolUse measured 2 spawns per call, call p95 142 ms. The thesis: fewer processes per call lowers latency, without changing what any guard decides.

## 1. Problem

Every tool call pays one `node` start per registered hook. Node start dominates a small guard's cost, and the calls run in sequence, so the per-call latency grows with the spawn count. The goal is fewer spawns per call with identical guard behaviour.

## 2. OKR / KRs

Metrics are pre-registered here, before any code, and measured with the same harness as P2 (`scripts/benchmark-hook-latency.js`, same workload, N=30, haiku, `--max-usd 1.5`), baseline file `docs/plans/evidence/2026-10-23-hook-latency-p2/hook-latency-baseline.json`.

- KR1: PostToolUse spawns per call drops from 7 to <= 3 (the unmatched-tool case).
- KR2: PostToolUse call p95 (enabled minus zero) drops from 197 ms to < 150 ms, which closes the verdict rule's latency leg.
- KR3: PreToolUse spawns per call does not rise above 2; its call p95 does not regress above 142 ms.
- KR4: zero behaviour change: the fail-open/fail-closed table in § 2.5.1 holds, proven by a differential test that feeds the same payload corpus to the old chain and to the new path.
- Rerun rule: the measurement is rerun once on a quiet host if the load average is above 10, and both runs are kept. A KR miss is reported as a miss, not re-scoped.

## 2.5 Global Constraints

- Each guard's exit code and stdout/stderr for the same input are byte-identical before and after.
- A guard that fails open today (exit 0 on its own error) still fails open. A guard that blocks (exit 2) today still blocks.
- Hook order within one event is preserved.
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
| `dispatch-model-guard.js` | PreToolUse | Fail-open with stderr note; config garbage fails closed | `hooks/dispatch-model-guard.js:251-255` (payload), `:359-362` (catch) | Both the fail-open paths and the config fail-closed fallbacks |
| `run-approval-gate.js` | Pre/Post | Fail-open, exit 0; asks via `emitAsk`, never exit 2 | `hooks/run-approval-gate.js:184` (bad JSON), `:206` (catch) | Ask stays exit 0; error leads to exit 0 |
| `subagent-budget.js` | PreToolUse | Fail-open with stderr note, exit 0 | `hooks/subagent-budget.js:546-549` | Same |
| `depth0-delegate-gate.js` | PreToolUse | Fail-open, exit 0; lock timeout fails open | `hooks/depth0-delegate-gate.js:336` (catch), `:184` (lock), `:215` (bad JSON) | Same |
| `intent-capture.js` | PostToolUse | Fail-open; failure counter then disable flag; exit 0 | `hooks/intent-capture.js:270-279` | Counter and breaker semantics unchanged |
| `reload-watch.js` | PostToolUse | Fail-open, exit 0 | `hooks/reload-watch.js:114-116` | Same |
| `audit-log.js` | PostToolUse | Fail-open, exit 0 | `hooks/audit-log.js:69-71` | Same |
| `log-error.js` | PostToolUse | Fail-open, exit 0 | `hooks/log-error.js:62-64` | Same |
| `failure-escalation.js` | PostToolUse | Fail-open, exit 0 | `hooks/failure-escalation.js:220-223` | Same |
| `context-budget.js` | PostToolUse | Fail-open: error resets `exitCode = 0`; its deliberate advisory exit is 2 | `hooks/context-budget.js:466-469` (catch), `:393`, `:457` (exit 2) | Advisory exit 2 kept; error exit 0 kept |
| `suggest-compact.js` | PostToolUse | Fail-open, exit 0 | `hooks/suggest-compact.js:94-97` | Same |
| `session-tasks.js` | PostToolUse | Fail-open via `L.failOpen`, exit 0 | `hooks/session-tasks.js:152-153` | Same |

Because a single in-process chain shares one try/catch scope unless each hook gets its own, the port must wrap each hook separately so one throw cannot skip the rest or change another hook's exit code.

## 2.6 Change-policy decisions

- Compatibility impact: internal-only; hook behaviour and the plugin's user-facing contract are unchanged.
- Dependency decision: none (Node standard library only).

## Candidate designs

Existing prior art: `hooks/opt-in-multiplexer.js` already folds the opt-in hooks into one process per event (design D6 A12; manifest `hooks/opt-in-manifest.json`). The D6 harness `scripts/benchmark-hook-multiplexer.js`, its validator `scripts/validate-hook-multiplexer-benchmark.js` and the fixture `hooks/tests/fixtures/hook-multiplexer-benchmark.json` compare base and candidate commits. Recorded D6 result (validated: `node scripts/validate-hook-multiplexer-benchmark.js .autopilot/evidence/hook-multiplexer-benchmark.json` prints `ok`, exit 0). The report compares base `f6805529` with candidate `1e7e5b69` over 50 paired samples after 10 warmups; thresholds are in `hooks/tests/fixtures/hook-multiplexer-benchmark.json:42-49`; the harness is `scripts/benchmark-hook-multiplexer.js` (351 lines, last changed by `1e7e5b69a`). Median / p95 in ms, base to candidate:

| Fixture (`.autopilot/evidence/hook-multiplexer-benchmark.json`) | Base | Candidate | Processes |
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

- A. One Node chain process for the `.*` PostToolUse observers (`intent-capture`, `reload-watch`, `audit-log`, `log-error`, `failure-escalation`, `context-budget`) that `require`s each hook module in order inside one process. Cuts 6 spawns to 1. Risk: a hook that calls `process.exit` or reads stdin itself needs an in-process adapter.
- B. Extend `opt-in-multiplexer.js` to run default-on stems in-process too. Reuses the existing tested selector. Risk: it mixes the opt-in and default-on tiers that `check-hook-inventory.js` keeps separate.
- C. Leave spawn count, shrink Node start (V8 compile cache, lazy requires). Lowest risk, smaller gain, may not reach KR1.
- Chosen provisionally: A, with B rejected unless Phase 0 shows A cannot reuse the selector. Phase 0 confirms or flips this.

## 3. File-structure map

- `docs/plans/2026-10-23-guard-port.md`: this plan (the only file this unit changes).
- Later phases (not in this unit): a new chain entry under `hooks/`, `hooks/hooks.json` rewiring, `hooks/tests/` differential test, hook docs counts via `scripts/check-hook-inventory.js`.

## 4. Phases

- Phase 0 (S): read-only audit. For each hook in the table record: stdin use, `process.exit` use, exit codes, fail-open/closed behaviour, shared state files. Re-run the D6 validator and confirm the cited numbers. Done when the audit table is committed under `docs/plans/evidence/` and Design A/B/C is confirmed.
- Phase 1 (M): differential test harness: a payload corpus run through the current chain, recording exit and output per hook. Done when it passes on the unchanged tree.
- Phase 2 (M): implement the chosen design for PostToolUse `.*` observers; update `hooks/hooks.json`. Done when the Phase 1 harness is byte-identical and `node scripts/check-hook-inventory.js --check` is green.
- Phase 3 (S): PreToolUse review: apply only if KR3 is at risk; otherwise record "no change".
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

- R0: author draft 2026-10-23. No review manifest yet.
