# subagent-budget: nested dispatch uncounted; clock override live in production

Source: budget code review generation 1 (327a284d, d2081fa3), 2026-10-18.

## Gaps
1. When a subagent dispatches another subagent, the hook's `transcript_path` is that subagent's own `agent-*.jsonl`. The directory derived from it does not exist, so the hook allows the call and counts nothing. Nested dispatch (`meta.json` carries `spawnDepth`) can bypass the relay and turn ceilings.
2. `AUTOPILOT_SUBAGENT_BUDGET_NOW_MS` (a test clock override) is honoured in production. A stray value freezes the one-hour window and makes the root hourly ceiling inaccurate.

## Fix direction
- Detect `transcript_path` of the form `/<sid>/subagents/agent-*.jsonl` and use its containing directory (resolve to the root session accordingly).
- Honour the clock override only in a test environment (e.g. also require an explicit test flag).
- Add negative controls: a nested-dispatch case that must be counted, and a production-mode case where the override must be ignored.

Effort S. Trigger: a session with nested dispatch, or the next edit of `hooks/subagent-budget.js`.
