# Workflow snapshot (what survives a compaction or /clear)

Contract for `scripts/lib/workflow-snapshot.js` and `scripts/task-card.js`. Plan: `docs/plans/2026-10-13-workflow-snapshot-at-compaction.md`.

## What it is

A bounded block of text collected from state already on disk, so a session that was compacted or cleared still knows where it is: dev-flow stage and next legal node, size and level, branch, the task card, the session task list, code review state, the decision tail, dispatches in flight and running subagents. It reads; it never writes and never decides. A source that is missing, malformed, expired or unreadable becomes one `<source>: absent (<reason>)` line. Nothing is guessed.

## Where it is used

| Caller | Event | Form |
|--------|-------|------|
| `hooks/state-checkpoint.js` | PreCompact | file `~/.autopilot/compaction-state-<sid>.md` leads with `## Workflow Snapshot` (6000 bytes); session-start injects the file after the compaction |
| `hooks/state-checkpoint.js` | PreCompact stdout | 3000 bytes, addressed to the summarizer ("preserve verbatim ..."); `AUTOPILOT_PRECOMPACT_STDOUT=0` turns it off |
| `hooks/session-handoff.js` | SessionEnd (`/clear`) | `## Workflow state` section of the machine handoff (4000 bytes) |

PreCompact stdout on exit 0 is merged into the compaction summarizer's custom instructions (Claude Code 2.1.296 binary, `PreCompact` runner; the docs list only UserPromptSubmit, UserPromptExpansion, SessionStart and PostModelSwitch as events whose stdout becomes model context). It never reaches the model directly.

## Sources

| Line | Read from |
|------|-----------|
| session | `${AUTOPILOT_SESSION_MODE_DIR:-~/.autopilot/session-mode}/<sid>.json`, unexpired only |
| next legal node | marker size+stage, else `<live>/stage/<sid>.json`; `scripts/stage-graph.js nextNodes` |
| git | `git status --porcelain=v2 --branch` in the payload cwd |
| task card | `${AUTOPILOT_TASK_CARD_DIR:-~/.autopilot/task-card}/<sid>.json` |
| session tasks | `<live>/tasks/<sid>.json` |
| code review | `<live>/review-rounds/<project_key>.json` (shared by every worktree of the repo; a round recorded at another head than this checkout's HEAD is kept but marked `[head differs ...]`, or `[head not compared; shared by every worktree]` when this checkout's HEAD cannot be read) |
| plan review | not collected (its state key cannot be derived from the session) |
| decision ledger | task card `ledger`, else newest `docs/projects/*/ledger/decisions.jsonl` under 24 h old |
| dispatches | `${AUTOPILOT_DISPATCH_RUNS_DIR:-$TMPDIR/autopilot-dispatch-runs}/*.manifest.json` with the marker root or a campaign root, not ended, pid alive |
| subagents | `<live>/agents/<sid>/*.json`, newest 40 read, un-ended and active in the last 30 min |

## Task card

`node scripts/task-card.js set --goal <text> [--success <text>]... [--plan <path>] [--review-ledger <path>] [--ledger <decisions.jsonl>] [--requirement <text>]...` writes the card for the current session (`show`, `clear` also exist). The collector shows it. Having dev-flow call `set` at intake is a guidance change and needs eval ON/OFF evidence; until then the card exists only when someone writes it.

## PostCompact check

`state-checkpoint.js` also runs on `PostCompact` (payload `compact_summary`). It reads the branch and stage through `facts()` and checks that the summary names both (branch as a substring, stage as a whole word, case-insensitive). It always appends one line to `~/.autopilot/.state-checkpoint.log` (`postcompact_ok` or `postcompact_summary_missing`) and, on a miss, one `compact-summary-lost-state` advisory through `hooks/_shared/advisory-sink.js`. Advisory only: PostCompact has no decision control and the hook never exits non-zero. A source that is absent (no marker, no git work tree) means nothing to check. The stage check is weak for a common word used as a stage name; it is a smoke alarm, not a proof.

## Not done here

`/handoff` reading the snapshot (guidance, eval); capturing the `Agent` description into the roster (touches the PostToolUse host); plan-review state lookup. See the plan, sections 2.4 and 2.5.
