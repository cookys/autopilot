# Token discipline

Advisory only. Nothing in this document blocks a tool call, a commit, or a session. Each machine keeps the `context_budget` thresholds and `autoCompactWindow` it already configures. Defaults stay unchanged.

<!-- install-block begin -->
## Five rules

1. Hand off by each machine's own context-budget setting. Do not copy another machine's token count.
2. Read a file enough in one read. A second read of the same range is waste.
3. Do not sleep-then-check poll. Use a background run with a wake-up, or Monitor, and wait for that wake-up.
4. Subagents doing light work use a cheap model at low effort, and at most 3 at once.
5. Accumulate peer messages, then reply once.

## Resident seats

A resident seat has a fixed fleet address and cannot change thread. Codex Astra is one example. Keep a state file. After compaction, read the state file first. Keep only its path and the unfinished items.
<!-- install-block end -->

With `context_budget.seat` set to `resident`, the context-budget T2 reminder says to update that state file and to confirm that after compaction only the state file path and unfinished items remain. It does not ask for a handoff. `session` is the default. An unknown value is treated as `session`.

## Known per-harness facts

Measured on 2026-10-21. Sources: notes in `src/harness/capabilities/codex.json` and `src/harness/capabilities/agy.json`, and the "2026-10-21 local measurement" section of `docs/backlog/cross-harness-token-discipline.md`. Only confirmed and refuted rows are stated as facts. Runtime effect of the Codex config keys was not observed.

- Confirmed, codex-cli 0.163.0: a global `AGENTS.md` in `CODEX_HOME` is loaded, and that text appeared before the repo `AGENTS.md`. `CODEX_HOME` is the config directory.
- Confirmed, codex-cli 0.163.0, `codex doctor`: `model_auto_compact_token_limit` and `compact_prompt` are accepted at the top level. The official config reference lists both there.
- Refuted at the top level and confirmed inside `[agents]`, codex-cli 0.163.0, `codex doctor`: `default_subagent_model`, `default_subagent_reasoning_effort`, and `max_concurrent_threads_per_session` are each reported ignored at the top level, and accepted with no warning under `[agents]`. The official reference lists `agents.default_subagent_model`, `agents.default_subagent_reasoning_effort`, and `agents.max_concurrent_threads_per_session`. `agents.max_threads` is the legacy alias; setting both yields a duplicate-field warning.
- Confirmed deprecated, codex-cli 0.163.0, `codex doctor`: top-level `compact_token_budget` is recognised and counted as a deprecated startup warning. It was not in the official doc text that was read. Do not set it.
- Confirmed, codex-cli 0.163.0, `codex doctor`: inside `[features.multi_agent_v2]` only `enabled` and `max_concurrent_threads_per_session` are accepted. `default_subagent_model`, `default_subagent_reasoning_effort`, and `max_depth` there fail to load.
- Confirmed, agy 1.4.4: with `HOME` set to a temp dir, `agy -p` loads global `~/.gemini/GEMINI.md`, global `~/.gemini/AGENTS.md`, and the workspace `AGENTS.md`. Load order was not observed.
- Confirmed, agy 1.4.4: an agent file at `~/.gemini/config/agents/NAME.md` with frontmatter `name`, `description`, and `model` is listed by `agy agents`, runs with `agy --agent NAME`, and the main model can call it via `invoke_subagent`. `model` accepts only the aliases `flash`, `pro`, and `inherit` (case-insensitive), or an absent field. Files with `model` `gemini-3.8-flash-low`, `gemini-3.8-flash`, `sonnet`, or `zzz-nonexistent-9` were silently not listed.

Unverifiable from those same sources: whether the `flash` alias maps to `gemini-3.8-flash` (the agy log showed no subagent model, and the recorded `invoke_subagent` call carried Model "inherit"). `model_post_turn_compact_threshold_percent` is accepted by `codex doctor` and was not found in the first 100000 characters of the official config reference, so its runtime effect is unverifiable. Peer claims that were not reproduced locally (sandbox versus GPU, hard-coded compaction thresholds, and `settings.json` `contextWindow` values) stay unverifiable and are not capabilities.

`autoCompactWindow` and the T2 threshold stay as each machine configures them. Defaults stay unchanged.

Opt in with `node scripts/install-token-discipline.js install` (`--check` reports drift; `uninstall` removes the block).
