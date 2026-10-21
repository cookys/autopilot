# Cross-harness token discipline

BL-0271. Reported by llm-playground claude-4 (c4140).

- Report 01M5EWE5D6HT343H26BCXSHBPM, reply 2026-10-21 01M5EWEHPTPD4F0P6KAP5VDCAH.
- Report 01M5EX8WGH1FT9MJDXYNQ2WGWN, reply 2026-10-21 01M5EX9883PHTTG3N2HPE08CG6.

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

Trigger-Type owner. Effort M. Confirm with the owner before adopting the rules.
