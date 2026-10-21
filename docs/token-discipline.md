# Token discipline

Advisory only. Nothing in this document blocks a tool call, a commit, or a session. Each machine keeps the `context_budget` thresholds and `autoCompactWindow` it already configures. Defaults stay unchanged.

## Five rules

1. Hand off by each machine's own `context_budget` setting. Do not copy another machine's token count.
2. Read a file enough in one read. A second read of the same range is waste.
3. Do not sleep-then-check poll. Use a background run with a wake-up, or Monitor, and wait for that wake-up.
4. Subagents doing light work use a cheap model at low effort, and at most 3 at once.
5. Accumulate peer messages, then reply once.

## Resident seats

A resident seat has a fixed fleet address and cannot change thread. Codex Astra is one example. Keep a state file. After compaction, read the state file first. Keep only its path and the unfinished items.

With `context_budget.seat` set to `resident`, the context-budget T2 reminder says to update that state file and to confirm that after compaction only the state file path and unfinished items remain. It does not ask for a handoff. `session` is the default. An unknown value is treated as `session`.

## Known per-harness facts

These figures are the ones a reporter gave. This document does not remeasure them.

Codex Astra, not remeasured here: the main thread used 1.64B tokens, about 10,000 calls, an average of 180K, and 190 compactions. After compaction the median is 128K, against 43K for a new thread.

Codex settings to spike, all unverified: `model_auto_compact_token_limit`, `default_subagent_model`, `default_subagent_reasoning_effort`, `max_concurrent_threads_per_session`, `compact_prompt`, `model_post_turn_compact_threshold_percent`, `compact_token_budget`.

Whether agy reads `AGENTS.md` or `GEMINI.md` at runtime is unmeasured. That question is open.

agy (c4140 argon, gemini-4-argon, a single conversation) made 5532 calls, with an average context of 157K, about 25K after compaction, and compaction at about 290K, for 89 compactions in total. The fields were inferred from the conversations database protobuf and there is no official schema. The agy subagent configuration follows the official documentation at antigravity.google/docs/subagents: global `~/.gemini/config/agents/NAME.md` and workspace `.agents/agents/NAME.md`, YAML frontmatter fields `name` and `description` (both required), `model` (`inherit`, `flash`, or `pro`), `tools`, `subagent`, `mainAgent`, `commandExecutionPolicy`, `mcpServers`, `skills`. There is no per-subagent effort and no concurrency cap (the nesting depth cap is 10). A misspelled tool name makes the subagent hang. Whether `flash` maps to `gemini-3.8-flash` is untested, so that mapping is unverified.

`autoCompactWindow` and the T2 threshold stay as each machine configures them. Defaults stay unchanged.
