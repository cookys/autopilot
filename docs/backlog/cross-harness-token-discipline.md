# Cross-harness token discipline

BL-0271. Reported by llm-playground claude-4 (c4140).

- Report 01M5EWE5D6HT343H26BCXSHBPM, reply 2026-10-21 01M5EWEHPTPD4F0P6KAP5VDCAH.
- Report 01M5EX8WGH1FT9MJDXYNQ2WGWN, reply 2026-10-21 01M5EX9883PHTTG3N2HPE08CG6.
- Report 01M5EY27E8E1PJVDB7B05FEENX, reply 2026-10-21 01M5EY2GX2JCMJB1VX3TMF81EX.

Five rules the reporter asked to share across harnesses:

1. Hand off at 150–200K.
2. Read a file enough in one read.
3. Do not sleep-poll.
4. Subagents use a cheap model, low effort, at most 3.
5. Accumulate peer messages, then reply once.

Resident seats cannot change thread (a fixed fleet address, for example Codex Astra). Use a state file plus a lean compaction instead. context-budget splits by seat type: a normal seat hands off at T2; a resident seat updates the state file and checks the post-compact size.

Figures the reporter gave for Codex Astra, not remeasured here: main thread 1.64B tokens, about 10,000 calls, average 180K, 190 compactions. After compaction the median is 128K, against 43K for a new thread.

Codex settings to spike, all unverified: model_auto_compact_token_limit, default_subagent_model, default_subagent_reasoning_effort, max_concurrent_threads_per_session, compact_prompt, model_post_turn_compact_threshold_percent, compact_token_budget.

Whether agy reads AGENTS.md or GEMINI.md at runtime is unmeasured.

agy (c4140 argon, gemini-4-argon, a single conversation) made 5532 calls, with an average context of 157K, about 25K after compaction, and compaction at about 290K for 89 compactions in total; the fields were inferred from the conversations database protobuf and there is no official schema. The agy subagent configuration follows the official documentation at antigravity.google/docs/subagents: global ~/.gemini/config/agents/NAME.md and workspace .agents/agents/NAME.md, YAML frontmatter fields name and description (both required), model (inherit, flash or pro), tools, subagent, mainAgent, commandExecutionPolicy, mcpServers, skills; there is no per-subagent effort and no concurrency cap (nesting depth cap is 10); a misspelled tool name makes the subagent hang; whether flash maps to gemini-3.8-flash is untested. Source: fleet message 01M5EY27E8E1PJVDB7B05FEENX, reply 2026-10-21 01M5EY2GX2JCMJB1VX3TMF81EX.

Trigger-Type owner. Effort M. Confirm with the owner before adopting the rules.
