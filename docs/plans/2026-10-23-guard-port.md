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
- KR4: zero behaviour change: the fail-open/fail-closed table in § 2.5 holds, proven by a differential test that feeds the same payload corpus to the old chain and to the new path.
- Rerun rule: the measurement is rerun once on a quiet host if the load average is above 10, and both runs are kept. A KR miss is reported as a miss, not re-scoped.

## 2.5 Global Constraints

- Each guard's exit code and stdout/stderr for the same input are byte-identical before and after.
- A guard that fails open today (exit 0 on its own error) still fails open. A guard that blocks (exit 2) today still blocks.
- Hook order within one event is preserved.
- `hooks/hooks.json` stays the single wiring source for `scripts/check-hook-inventory.js`.
- No new dependency.

## 2.6 Change-policy decisions

- Compatibility impact: internal-only; hook behaviour and the plugin's user-facing contract are unchanged.
- Dependency decision: none (Node standard library only).

## Candidate designs

Existing prior art: `hooks/opt-in-multiplexer.js` already folds the opt-in hooks into one process per event (design D6 A12; manifest `hooks/opt-in-manifest.json`). The D6 harness `scripts/benchmark-hook-multiplexer.js`, its validator `scripts/validate-hook-multiplexer-benchmark.js` and the fixture `hooks/tests/fixtures/hook-multiplexer-benchmark.json` compare base and candidate commits. Phase 0 reads those reports for numbers and cites them; this draft does not restate results it has not re-read. Note the multiplexer still `spawnSync`s each enabled child, so it removes disabled spawns only, not enabled ones.

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

- Phase 0 (S): read-only audit. For each hook in the table record: stdin use, `process.exit` use, exit codes, fail-open/closed behaviour, shared state files. Read the D6 multiplexer reports and cite them. Done when the audit table is committed under `docs/plans/evidence/` and Design A/B/C is confirmed.
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
