# Cross-harness token discipline

BL-0271. Reported by llm-playground claude-4 (<host>).

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

agy (<host> argon, gemini-4-argon, a single conversation) made 5532 calls, with an average context of 157K, about 25K after compaction, and compaction at about 290K for 89 compactions in total; the fields were inferred from the conversations database protobuf and there is no official schema. The agy subagent configuration follows the official documentation at antigravity.google/docs/subagents: global ~/.gemini/config/agents/NAME.md and workspace .agents/agents/NAME.md, YAML frontmatter fields name and description (both required), model (inherit, flash or pro), tools, subagent, mainAgent, commandExecutionPolicy, mcpServers, skills; there is no per-subagent effort and no concurrency cap (nesting depth cap is 10); a misspelled tool name makes the subagent hang; whether flash maps to gemini-3.8-flash is untested. Source: fleet message 01M5EY27E8E1PJVDB7B05FEENX, reply 2026-10-21 01M5EY2GX2JCMJB1VX3TMF81EX.

Trigger-Type owner. Effort M. Confirm with the owner before adopting the rules.

## 2026-10-21 local measurement

Local spike on this host (foreman). Versions: codex-cli 0.163.0 (`codex --version`), agy 1.4.4 (`agy --version`). Runtime effect of Codex config keys was not observed (no model-driven measurement). Official Codex config reference: https://learn.chatgpt.com/docs/config-file/config-reference (`developers.openai.com/codex/config-reference` redirects there). Oracle for Codex keys is `codex doctor` (Configuration section names ignored keys; bogus top-level `totally_bogus_key_zz` is "is ignored"; unknown keys in `[agents]` and `[features.multi_agent_v2]` fail to load with "invalid data").

| item | command | version | conclusion | summary |
| --- | --- | --- | --- | --- |
| Codex global AGENTS.md in CODEX_HOME | `CODEX_HOME=<temp with auth.json and AGENTS.md codeword>`, cwd AGENTS.md has a second codeword, `codex exec --skip-git-repo-check -s read-only` plus a one-line question | codex-cli 0.163.0 | confirmed | Model returned both codewords; global AGENTS.md text appeared first, then the repo AGENTS.md. CODEX_HOME is the config directory. |
| `model_auto_compact_token_limit` top-level | `codex doctor` | codex-cli 0.163.0 | confirmed | Accepted with no warning. Official doc lists it top-level. Effect not observed. |
| `compact_prompt` top-level | `codex doctor` | codex-cli 0.163.0 | confirmed | Accepted. Official doc lists it top-level. Effect not observed. |
| `model_post_turn_compact_threshold_percent` top-level | `codex doctor` | codex-cli 0.163.0 | unverifiable | Parser accepts it with no warning. Not found in the first 100000 characters of the official config reference. Effect not observed. |
| `compact_token_budget` top-level | `codex doctor` | codex-cli 0.163.0 | confirmed | Recognised but deprecated: redacted startup warning counted under "startup warning deprecated 1". Not in the official doc text read. Do not recommend it. Effect not observed. |
| `default_subagent_model`, `default_subagent_reasoning_effort`, `max_concurrent_threads_per_session` at top level | `codex doctor` | codex-cli 0.163.0 | refuted | Each reported "is ignored". |
| Same three keys inside `[agents]` | `codex doctor` | codex-cli 0.163.0 | confirmed | Accepted without warning. Official doc lists `agents.default_subagent_model`, `agents.default_subagent_reasoning_effort`, `agents.max_concurrent_threads_per_session`. Effect not observed. |
| `agents.max_threads` vs `max_concurrent_threads_per_session` | `codex doctor` | codex-cli 0.163.0 | confirmed | `agents.max_threads` is the legacy alias. Setting both yields "Ignoring malformed agent role definition: duplicate field max_concurrent_threads_per_session". |
| Keys inside `[features.multi_agent_v2]` | `codex doctor` | codex-cli 0.163.0 | confirmed | Only `enabled` and `max_concurrent_threads_per_session` accepted. `default_subagent_model`, `default_subagent_reasoning_effort`, and `max_depth` there fail to load. |
| agy global instruction files | `HOME=<temp dir with copied OAuth token>`, `agy -p` plus a one-line question | agy 1.4.4 | confirmed | Loads global `~/.gemini/GEMINI.md`, global `~/.gemini/AGENTS.md`, and the workspace AGENTS.md. All three codewords returned. Load order was not observed. |
| agy subagent file and aliases | `~/.gemini/config/agents/NAME.md`; `agy agents`; `agy --agent NAME`; `invoke_subagent` | agy 1.4.4 | confirmed | Frontmatter `name`, `description`, `model` is listed and runnable, and the main model can call it via `invoke_subagent`. `model` accepts only `flash`, `pro`, `inherit` (case-insensitive) or an absent field. `gemini-3.8-flash-low`, `gemini-3.8-flash`, `sonnet`, and `zzz-nonexistent-9` were silently not listed. |
| Whether `flash` resolves to `gemini-3.8-flash` | agy log and transcript of `invoke_subagent` | agy 1.4.4 | unverifiable | Log shows no subagent model. The recorded call carried Model "inherit". `agy models` lists `gemini-4-argon-{low,medium,high}`, `gemini-3.8-flash-{low,medium,high}`, `claude-opus-5-5-*`, `claude-sonnet-5-5-*`, `gpt-oss-120b-medium`. `--agent NAME` left the main label at Gemini 4 Argon (Medium). `--model gemini-3.8-flash-low` changed it to Gemini 3.8 Flash (Low). |
| `commandExecutionPolicy` sandbox vs GPU | peer measurement, <host> argon; not run locally | peer (agy) | unverifiable | Peer measured, not reproduced locally. Not recorded as a capability. |
| Compaction thresholds hard-coded for `gemini-4-argon` | not tested | peer claim | unverifiable | Unverified peer claim. |
| `settings.json` `contextWindow` only 256K/512K/900K | not tested | peer claim | unverifiable | Unverified peer claim. |

### Recommended global files for tokinstall

- Codex global instructions go in `~/.codex/AGENTS.md` (confirmed loaded before the repo AGENTS.md).
- agy global instructions go in `~/.gemini/GEMINI.md` and/or `~/.gemini/AGENTS.md` (both confirmed loaded).
- Codex subagent and compaction settings go in `config.toml`: `model_auto_compact_token_limit` and `compact_prompt` at top level; `default_subagent_model`, `default_subagent_reasoning_effort`, and `max_concurrent_threads_per_session` under `[agents]`. Do not set `compact_token_budget`.

## 2026-10-21 shipped

Merges: tokspike 36cd0a5f0 wrote the measured Codex and agy facts into the capability notes and this sidecar. tokmech dd45ce115 added the rules file and the two hook mechanisms. tokinstall 0feb09594 added the opt-in installer.

The five rules are the install block in `docs/token-discipline.md`. tokmech (`git show dd45ce115`) lands them as follows.

1. Hand off by each machine's own context-budget setting. The rule text is in that file. `context_budget.seat` (`session` by default, or `resident`) chooses the T2 wording. `session` keeps the handoff sentence, and that sentence stays byte-identical. `resident` tells a fixed-address seat to update its state file and to keep only that path and the unfinished items. Anything else is ignored and the seat stays `session`.
2. Read a file enough in one read. The rule is advisory text in that file. No hook blocks a second read.
3. Do not sleep-then-check poll. The rule is advisory text in that file. No hook blocks a poll.
4. Subagents doing light work use a cheap model at low effort, and at most 3 at once. The rule text shipped. The concurrency advisory did not. `docs/plans/2026-10-21-subagent-concurrency-advisory.md` is frozen after two generations of hetero plan review and waits on owner decision d-02c60498.
5. Accumulate peer messages, then reply once. The rule is advisory text in that file. No hook batches replies.

SessionStart prints one extra line that points at `docs/token-discipline.md`. The line is advisory only.

Two settings, both advisory. `context_budget.post_compact_warn` defaults to 100000. PostCompact records one size after compaction, and the context-budget hook warns once when the live context still exceeds that many tokens. 0 turns the warning off. A value that is not an integer of 0 or more is ignored, so the threshold stays 100000. `context_budget.seat` is the seat switch above.

Install is opt-in. `node scripts/install-token-discipline.js` accepts `install`, `uninstall`, `--check` and `--dry-run`. It writes the rules block into the Codex file at `CODEX_HOME/AGENTS.md` (or `~/.codex/AGENTS.md` when `CODEX_HOME` is unset) and the agy file at `~/.gemini/GEMINI.md`. `scripts/dev-setup.sh --check` only reports. It never installs.

Not done: item 4, the sub-agent concurrency advisory, still waits on d-02c60498.
