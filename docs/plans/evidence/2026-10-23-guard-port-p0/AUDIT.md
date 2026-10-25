# Guard port Phase 0 audit (read-only)

Plan: `docs/plans/2026-10-23-guard-port.md` section 4 Phase 0. Tree: develop at `a10bceef5` plus Phase 1 (`ffee03326`). Method: grep of each hook source for stdin reads, `process.exit`, `exitCode`, `process.on`, `process.chdir`, `process.env` assignment, and state paths. No paid measurement was run.

## Pending items

- Re-baseline B pending, depth-0 runs it on a quiet host before Phase 2 merges. It needs `scripts/benchmark-hook-latency.js`, which spends money, so this audit does not run it.
- KR2 feasibility gate (floor F against 0.76 * B) is pending for the same reason: it is the same harness on a scratch checkout. Until B and F exist, KR2 is neither met nor unreachable.
- KR1 is a count and needs no run: PostToolUse spawns for an unmatched tool go from 7 to 5 under depth-0 ruling (a), not to the plan's original target of 3 or fewer. KR1 as written (<= 3) is therefore missed by the ruling; reload-watch and failure-escalation stay separate because the host reads PostToolUse stdout as JSON only when it is one JSON object.

## Behavioural audit

Every cell carries `file:line` evidence (lines are in `hooks/<hook>.js`, current positions after the Phase 1 export refactor). "Export form" means Phase 1 turned the hook into `runHook(stdinText) -> status` with an unchanged CLI wrapper (`if (require.main === module)`). State column: files read and written, or `none`. All twelve state paths below are under the live-state base or `~/.autopilot` unless stated.

### PostToolUse observers (in scope for the chain, plus the other PostToolUse registrations)

| Hook | Event / matcher | stdin | process.exit | Exit codes | Fail mode | State files (read / write) |
|---|---|---|---|---|---|---|
| intent-capture | PostToolUse `.*` | fd 0, then `/dev/stdin` (`:195-197`) | export form: only the CLI wrapper exits (`:289`) | 0 only (`:237,240` early returns 0, `:284` final return 0; catch `:275-279`) | open; failure counter then disable flag (`:275-279`) | write `~/.autopilot/intent/<sha1>.json` (`:48`), `.intent-capture-failures` (`:50`, write `:122`), `intent-capture.disabled` (`:49`, write `:164`), `$TMPDIR/claude-intent-tool-count-*` (`:51`); reads the same |
| reload-watch | PostToolUse `.*` | fd 0, then `/dev/stdin` (`:75-77`) | export form, wrapper `:130` | 0 only (`:90,118` returns 0; catch returns 0 at `:119-121`) | open | read `~/.claude/plugins/installed_plugins.json`, `$PWD/.claude/dispatch-config.md`, `$PWD/.claude/settings.local.json` (`:32-34`); read and write `~/.claude/plugins/.reload-watch-state.json` (`:37`, read `:53`, write `:61`) |
| audit-log | PostToolUse `.*` | fd 0, then `/dev/stdin` (`:29-31`) | export form, wrapper `:79` | 0 only (`:58,70` returns 0; catch returns 0 at `:71-73`) | open | append `~/.claude/bash-commands.log` (`:68`); live-state writers hosted via awaiting-owner / ask-decision / merge-task-status (`:44-53`) |
| log-error | PostToolUse `.*` | fd 0, then `/dev/stdin` (`:22-24`) | export form, wrapper `:75` | 0 only (`:39,66` returns 0; catch returns 0 at `:67-69`) | open | append `~/.claude/error-log.md` (`:64`) |
| failure-escalation | PostToolUse `.*` | fd 0, then `/dev/stdin` (`:173-175`) | export form, wrapper `:233` | 0 only (`runHook` returns 0, catch `:224`; plan cite `:219-223` predates the refactor) | open | read and write `~/.autopilot/.failure_count_<sessionHash>` (`:46`, `:61`, write `:74`) |
| context-budget | PostToolUse `.*` | `JSON.parse(fs.readFileSync(0))` (`:304`) | many `process.exit(0)` (`:299,308,310`), final `process.exit(exitCode)` (`:488`); `process.on('exit', releaseLock)` (`:323`) | 0; advisory 2 (`:409`, `:473`); error resets to 0 (`:483-486`) | open | read and write `~/.autopilot/context-budget/<sid>.json` via tmp + rename (`:233-234`), lock file (`:323`); reads the live statusline file (`:79`) |
| opt-in-multiplexer | Pre/PostToolUse | `fs.readFileSync(0)` (`:91`) | `process.exit` (`:81,126,130,181,187`) | 0; child exit 2 passed through (`:126`) | open (`:186-188`) | none of its own (children keep theirs); search of `writeFileSync` / `appendFileSync` finds no write in the file |
| suggest-compact | PostToolUse `Write\|Edit` | fd 0, fallback `/dev/stdin` (`:50`) | `process.exit(0)` (`:61,100`) | 0 (`process.exit(0)` `:100`, catch `:97-99`) | open (catch writes one stderr line `:97-99`) | read and write `$TMPDIR/claude-tool-count-<sid>` (`:67`, write `:77`) |
| session-tasks | PostToolUse `TaskCreate\|TaskUpdate\|TaskList` | `L.readStdinJson()` (`:117`) | `process.exit(0)` (`:153`) | 0 (catch `:152`, exit `:153`) | open via `L.failOpen` (`:152`) | read and write the per-session `tasks` file from `L.sessionFile(p, 'tasks')` under the live base, under `L.withLock`, atomic JSON write (`:119-121,148`) |
| run-approval-gate | PostToolUse `Task\|Agent` (and PreToolUse) | fd 0 (`:182`) | `process.exit(0)` throughout (`:177,184-206`) | 0; asks via `emitAsk`, never 2 | open (`:184` bad JSON, `:206` catch) | read and write `<live base>/run-approval/<sid>.json` (or `$AUTOPILOT_RUN_APPROVAL_DIR`; `:106-110`), tmp + rename mode 0600 (`:148-152`), pending written `:134`, approved `:144`, checked `:196` |

### PreToolUse guards (not changed by Phase 2)

| Hook | Event / matcher | stdin | process.exit | Exit codes | Fail mode | State files (read / write) |
|---|---|---|---|---|---|---|
| ask-decision | PreToolUse `AskUserQuestion` | `L.readStdinJson()` (`:117`) | `process.exit(0)` (`:118`) | 0 | open via `L.failOpen` (`:117`) | write a pointer `<live>/ask-decision/<sid>.json` via `L.atomicWriteJson(L.sessionFile(p, 'ask-decision'), ...)` (`:87`); append an entry to the open-decision file through `openDecision` (`:77-82`, same lock + atomic rename); PostToolUse side reads and removes the pointer (`:92-99`) |
| foreman-guard | PreToolUse `Bash\|Monitor` | fd 0 (`:617`) | `process.exit(0)` (`:615,619-625,643,675-687`) | 0; deny is JSON on stdout (`:684`) | open; crash `:687`; lock timeout runs without the lock (`:521`) | read and write `~/.autopilot/foreman-guard/<sid>-<agent>.json` (or `$AUTOPILOT_FOREMAN_GUARD_DIR`; `:455-459`), tmp + rename (`:469-472`), lock file `<file>.lock` (`:508-521`), GC stamp file in the same dir (`:478-483`); reads the agent transcript head (`:296`) |
| cost-fuse | PreToolUse `Bash\|Edit\|Write\|MultiEdit\|NotebookEdit` | fd 0 (`:278`) | `process.exit(0)` (`:274-355`) | 0; deny JSON (`:324`) | open (`:280` bad JSON, `:355` catch); lock timeout runs without lock (`:89`) | read and write `~/.autopilot/cost-fuse/<sid>.json` (or `$AUTOPILOT_COST_FUSE_DIR`; `:35-39`), tmp + rename (`:64-67`), lock (`:76-89`); reads costs ledger `~/.claude/metrics/costs.jsonl` (`:285`) and the transcript (`:171`); warn mode creates the dir at `:332` |
| dispatch-model-guard | PreToolUse `Task\|Agent` | fd 0, fallback `/dev/stdin` (`:243-245`) | `process.exit(0)` (`:39,172-363`) | 0; deny is JSON | open on payload errors (`:251-255`, `:359-362`); config garbage falls back closed (`:133,140,147`) | none written (no `writeFileSync` / `appendFileSync` in the file); reads `<cwd>/.claude/dispatch-guard-config.md` and other config candidates (`:96-103`) |
| subagent-budget | PreToolUse `Task\|Agent` | fd 0 (`:544`) | `process.exit(0)` (`:549`) | 0 | open with stderr note (`:546-549`) | read and write transcript-scan cache `<live>/subagent-budget/cache/<sid>.json` (`:246`, tmp + rename mode 0600 at `:259-262`); read and write card pointer `<live>/subagent-budget/cards/<sid>-<key>.json` under `L.withLock` (`:400-407`) |
| depth0-delegate-gate | PreToolUse `WebFetch\|WebSearch\|Read\|Grep\|Glob\|Bash\|Agent\|Task\|Skill` | fd 0 (`:218`) | `process.exit(0)` (`:215-348`) | 0 | open (`:348`); lock timeout runs without lock (`:189`); bad JSON `:220` | read and write `<live base>/depth0-gate/<sid>.json` (or `$AUTOPILOT_DEPTH0_GATE_DIR`; `:144`, dir created `:280`), tmp + rename (`:159-162`), lock (`:176-189`) |
| run-approval-gate | PreToolUse `Task\|Agent` | see PostToolUse table | see above | 0 | see above | see above (same file `:106-110`; pending state written `:131-134` on ask) |

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
