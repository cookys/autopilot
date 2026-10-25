# Guard port Phase 0 audit (read-only)

Plan: `docs/plans/2026-10-23-guard-port.md` section 4 Phase 0. Tree: develop at `a10bceef5` plus Phase 1 (`ffee03326`). Method: grep of each hook source for stdin reads, `process.exit`, `exitCode`, `process.on`, `process.chdir`, `process.env` assignment, and state paths. No paid measurement was run.

## Pending items

- Re-baseline B pending, depth-0 runs it on a quiet host before Phase 2 merges. It needs `scripts/benchmark-hook-latency.js`, which spends money, so this audit does not run it.
- KR2 feasibility gate (floor F against 0.76 * B) is pending for the same reason: it is the same harness on a scratch checkout. Until B and F exist, KR2 is neither met nor unreachable.
- KR1 is a count and needs no run: PostToolUse spawns for an unmatched tool go from 7 to 5 under depth-0 ruling (a), not to the plan's original target of 3 or fewer. KR1 as written (<= 3) is therefore missed by the ruling; reload-watch and failure-escalation stay separate because the host reads PostToolUse stdout as JSON only when it is one JSON object.

## Behavioural audit (in-scope PostToolUse observers)

Columns: stdin = how fd 0 is read; exit = process.exit or returned status; state = files written. "Export form" means Phase 1 turned the hook into `runHook(stdinText) -> status` with an unchanged CLI wrapper (`if (require.main === module)`).

| Hook | Event / matcher | stdin | exit use | Exit codes | Fail mode | State written |
|---|---|---|---|---|---|---|
| intent-capture | PostToolUse `.*` | `readStdinCli` fd 0, fallback `/dev/stdin` (`:195-197`) | export form, `process.exit(runHook(...))` at `:289`, no exit inside the body | 0 only | open; failure counter then disable flag | `~/.autopilot/intent/<sha1>.json`, `.intent-capture-failures`, `intent-capture.disabled`, `$TMPDIR/claude-intent-tool-count-*` |
| reload-watch | PostToolUse `.*` | `readStdinCli` (`:75-77`) | export form, `process.exit(runHook(payload))` at `:130` | 0 only | open | `~/.claude/plugins/.reload-watch-state.json` (reads installed_plugins.json, `$PWD/.claude/*`) |
| audit-log | PostToolUse `.*` | `readStdinCli` (`:29-31`) | export form, `:79` | 0 only | open | `~/.claude/bash-commands.log` (append); live-state writers via awaiting-owner |
| log-error | PostToolUse `.*` | `readStdinCli` (`:22-24`) | export form, `:75` | 0 only | open | `~/.claude/error-log.md` (append) |
| failure-escalation | PostToolUse `.*` | `readStdinCli` (`:173-175`) | export form, `:233` | 0 only | open | `~/.autopilot/.failure_count_<sessionHash>` |
| context-budget | PostToolUse `.*` | `JSON.parse(fs.readFileSync(0))` (`:304`) | many `process.exit(0)`, final `process.exit(exitCode)` (`:488`); `process.on('exit', releaseLock)` (`:323`) | 0, advisory 2 (`:409`, `:473`); error resets to 0 (`:486`) | open | `~/.autopilot/context-budget/<sid>.json` via tmp + rename, lock file |
| opt-in-multiplexer | Pre/PostToolUse | `fs.readFileSync(0)` (`:91`) | `process.exit` at `:81,126,130,181,187` | 0, child exit 2 passthrough (`:126`) | open | none of its own |
| suggest-compact | PostToolUse `Write\|Edit` | fd 0 then `/dev/stdin` (`:50`) | `process.exit(0)` (`:61,100`) | 0 | open | counter state |
| session-tasks | PostToolUse `TaskCreate\|TaskUpdate\|TaskList` | `L.readStdinJson()` (`:117`) | `process.exit(0)` (`:153`) | 0 | open via `L.failOpen` | task status files |
| run-approval-gate | Pre/PostToolUse `Task\|Agent` | fd 0 (`:182`) | `process.exit(0)` throughout; asks via `emitAsk` | 0 | open | approval state file |

PreToolUse guards (read only, not changed by Phase 2):

| Hook | stdin | Exit codes | Fail mode |
|---|---|---|---|
| ask-decision | `L.readStdinJson()` (`:117`) | 0 (`:118`) | open via `L.failOpen` |
| foreman-guard | fd 0 (`:617`) | 0 (deny is JSON on stdout, `:684`) | open; lock timeout open |
| cost-fuse | fd 0 (`:278`) | 0 (`:274-355`) | open |
| dispatch-model-guard | fd 0 then `/dev/stdin` (`:243-245`) | 0 | open on payload errors; config garbage falls back closed (`:133,140,147`) |
| subagent-budget | fd 0 (`:544`) | 0 (`:549`) | open with stderr note |
| depth0-delegate-gate | fd 0 (`:218`) | 0 (`:346-348`) | open; lock timeout open |

Findings relevant to the chain:

- The five observers hold no `process.on`, `process.chdir` or `process.env` assignment of their own (only `context-budget` registers `process.on('exit')`, and it stays a separate registration). The chain still snapshots and restores process state around each member.
- Write sets are disjoint across the three chained hooks: intent-capture writes under `~/.autopilot/intent` and its counters; audit-log appends `bash-commands.log` and live state; log-error appends `error-log.md`. failure-escalation and reload-watch use their own files and stay separate.
- Line numbers for the five observers in plan section 2.5.1 predate the Phase 1 export refactor; this audit cites current positions. Exit status and fail-open behaviour were re-read from the grep above, not re-run.

## D6 validator re-run

Command: `node scripts/validate-hook-multiplexer-benchmark.js /home/cookys/projects/autopilot/.autopilot/evidence/hook-multiplexer-benchmark.json` printed `ok` (the report is gitignored and lives in the main checkout; it was read, not modified). Base `f6805529`, candidate `1e7e5b69`. Median / p95 in ms, read from the report:

| Row (line in report) | Base | Candidate | Plan cites |
|---|---|---|---|
| cold-disabled (14) | 98.0 / 116.0 | 50.6 / 58.9 | match |
| cold-enabled (298) | 94.9 / 114.4 | 94.8 / 110.5 | match |
| heavy-disabled (582) | 193.0 / 223.6 | 45.6 / 55.9 | match |
| heavy-enabled (866) | 197.3 / 227.4 | 151.5 / 181.1 | match |

All four rows and their line numbers agree with the plan's table. Thresholds in `hooks/tests/fixtures/hook-multiplexer-benchmark.json` lines 42-49 read as cited.

## Design decision as recorded

Depth-0 ruling (a), 2026-10-25: chain intent-capture, audit-log, log-error only; reload-watch and failure-escalation remain separate registrations. PostToolUse `.*` goes from 7 to 5 spawns.
