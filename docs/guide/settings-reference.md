# Autopilot settings reference

> Part of [Autopilot](../../README.md). The project-level `.claude/*-config.md` files and how they are injected are explained in [configuration.md](configuration.md); this page covers everything else you can set: the machine-local `~/.autopilot/config.json`, `AUTOPILOT_*` environment variables, and the Claude Code settings autopilot depends on. Hook behavior in detail: [hooks/README.md](../../hooks/README.md).

This page lists the settings meant for you to change. The machine-readable inventory behind it, including the internal variables (test seams, paths, ids autopilot passes to its own child processes), is [`scripts/lib/config-keys.json`](../../scripts/lib/config-keys.json). [`scripts/check-config-docs.js`](../../scripts/check-config-docs.js) keeps the two in step with the code: a setting the code reads must be registered, a registered setting must still be read, and every user setting must appear on this page.

## Where settings live and which one wins

**The config file.** Operator settings live in `~/.autopilot/config.json`. Set `AUTOPILOT_CONFIG_FILE` to use another file (exception: `implementer_claude_native.confirmed_at` ignores it and reads only `<HOME>/.autopilot/config.json`, see `implementer_claude_native`). The file is machine-local and never version-controlled, and its only version field is `config_schema_version` (see "Update notice"). It is not validated by the readers: a missing or malformed file silently means "all defaults" (the one exception is `topology.exclude_seats`, whose reader exits with an error on unparseable JSON or a wrong shape). A typo in a key name is also silent, so check a new setting actually took effect, or run `bash scripts/dev-setup.sh --check`, which lists unknown keys with the closest known name.

```json
{
  "context_budget": { "t2": 150000, "gap": 50000 },
  "hooks": { "branch-protection": true },
  "residue": { "lease_hours": 72 },
  "ui": { "locale": "zh-TW" }
}
```

**Precedence.** For almost every setting it is: built-in default, then `config.json`, then the environment variable. The environment wins, so you can override one shell or one dispatch without editing the file. The exceptions, taken from the code:

- **Either source switches it off or on.** `handoff_inject` (env `1` or config `true` enables it), `update_check` (env `0` or config `false` disables it) and `hooks.<stem>` (env or config enables an opt-in hook; for the default-on `residue-auto-reap`, either one disables it).
- **`advisory_bridge`**: per-hook environment variable, then the global environment variable, then the per-hook config value, then `advisory_bridge.mode`, then `sink`.
- **`ui.locale`** is the reverse: the config value beats `AUTOPILOT_LOCALE`, then Claude Code's own language setting, then `LC_ALL`/`LANG`, then English.
- **`AUTOPILOT_CONTEXT_BUDGET_MODE`** understands `off` and `once`; any other value is ignored (the config key also accepts `warn`).
- **Zero values.** In the config, `context_budget.t1` or `t2` set to `0` disables that tier; in the environment a value of `0` is ignored.

**Default-on and opt-in hooks.** A default-on hook runs unless you turn it off; an opt-in hook is wired but inert until you enable it with `hooks.<stem>` or `AUTOPILOT_HOOK_<STEM>`. The stems and tiers are in [hooks/README.md](../../hooks/README.md). Each default-on hook has its own exit knob, listed in the "Hook switches" section below.

## Context budget, compaction and handoff

The context-budget hook measures the real context size and reminds you to checkpoint (T1) and then to write a handoff (T2). Claude Code can also compact the context by itself; the two need to be set up together.

### Setting `t2`, `gap` and `autoCompactWindow` together

Claude Code compacts when the context reaches **`autoCompactWindow` minus a fixed 33,000-token buffer**. Autopilot's SessionStart check compares that compaction point with your T2:

- The rule: **`context_budget.t2` + `context_budget.gap` must be at most `autoCompactWindow` - 33,000**. `gap` is the room between the T2 reminder and the compaction, in which a handoff gets written.
- With the defaults (T2 150,000, gap 50,000) the window must be at least **233,000**. A window of 250,000 fits (compaction at 217,000, T2 reminder well before it). A window of 200,000 does not (compaction at 167,000, so you would be compacted before the handoff reminder has room to matter); SessionStart then prints the warning and the window that fits, `t2 + gap + 33000`.
- T2 always tells the lane to keep working and to write a handoff file as a backup. Auto-compact restores context. It is never a request to stop. Without an `autoCompactWindow`, a 1M-window model compacts only near 1M: set the window if you want compaction earlier.
- If you raise T2, raise the window with it. For example `t2` 450,000 with the default gap needs a window of at least 533,000.
- Set it with `/autocompact` or `"autoCompactWindow": 250000` in Claude Code's `settings.json`, or `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. The environment variable is clamped to 100,000-1,000,000 and beats every settings file. A change takes effect on the next session start.
- Per-model windows: put `modelSettings` in `~/.claude/settings.json`, keyed by the full model id (the statusline `model.id`, without `[1m]`); the value is an integer 100000-1000000 or `"auto"`, and within one file the per-model value beats the top-level `autoCompactWindow`. Example values only; derive yours from the measured compaction point below.

  ```json
  "modelSettings": {
    "claude-fable-5-1":  { "autoCompactWindow": 250000 },
    "claude-opus-5-5":   { "autoCompactWindow": 250000 },
    "claude-sonnet-5-5": { "autoCompactWindow": 300000 }
  }
  ```

  `/autocompact <value>` writes to `modelSettings` from Claude Code v2.1.288 (earlier versions wrote the top level). A later-read settings file that has a top-level value discards the per-model values of earlier files (contract in the header of `scripts/lib/autocompact-window.js`, which the T2 check uses to resolve the window from the model id). **Do not set `CLAUDE_CODE_AUTO_COMPACT_WINDOW`** when you use this: it beats commands, flags, settings and subagent frontmatter, so it overrides every per-model value.
- Measured compaction point (first record, 2026-10-17, local session a6cb3442, top-level window 533,000): the `compact_boundary` `preTokens` were 500,826, 501,310, 500,183 and 499,974, i.e. compaction fires at about the window minus 33K (matches `AUTOCOMPACT_BUFFER_TOKENS` in `scripts/lib/compaction-handoff.js`). To compact near N tokens, set the window to about N + 33,000.
- Custom subagents may set `autoCompactWindow` in their frontmatter (Claude Code v2.1.296+): a plain integer, only lower than the inherited value (`200k` is read as 200 and ignored). Whether the built-in general-purpose agent with an Agent `model:` parameter uses the `modelSettings` value is not documented; untested. Official docs: https://code.claude.com/docs/en/model-config#set-the-auto-compact-window , https://code.claude.com/docs/en/sub-agents#subagent-auto-compact-window , https://code.claude.com/docs/en/settings-reference#modelsettings , https://code.claude.com/docs/en/env-vars
- Keep `t1` below `t2`: nothing checks it, and a T1 at or above T2 is never shown because T2 takes precedence.
- Compaction is off when `DISABLE_AUTO_COMPACT` or `DISABLE_COMPACT` is truthy, or `autoCompactEnabled` is false. Then the window check is skipped. SessionStart adds one line that auto-compact is off and this session will not compact itself. T2 still says keep working and to write a handoff file as a backup.
- Subagents have their own context ceiling: the foreman guard applies `t2` (scaled to the subagent's window) to a foreman's own context, independent of auto-compact.
- Autopilot cannot see `--settings <file>` or `--autocompact` given on the `claude` command line; `scripts/dev-setup.sh --check` reports only whether a window is set.

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `context_budget.t1` (config.json) | Context size (tokens) at which the first reminder fires: plan a checkpoint and avoid loading large files inline. | `100000` | `AUTOPILOT_CONTEXT_BUDGET_T1` |
| `context_budget.t2` (config.json) | Context size (tokens) of the second, stronger reminder: a land checklist (write back anything the session holds, then run `/handoff`). Stopping before a handoff file is written is blocked at most twice per fire by the `context-land-gate` Stop hook. | `150000` | `AUTOPILOT_CONTEXT_BUDGET_T2` |
| `context_budget.gap` (config.json) | Tokens between the T2 reminder and the point where Claude Code compacts; used by the SessionStart check that T2 can fire before compaction. | `50000` | `AUTOPILOT_CONTEXT_BUDGET_GAP` |
| `context_budget.step` (config.json) | A tier repeats its reminder only after the context grew by this many tokens since it last fired; 0 reminds on every call past the threshold. | `50000` | `AUTOPILOT_CONTEXT_BUDGET_STEP` |
| `context_budget.per_model` (config.json) | Per-model `t1`/`t2`, keyed by a model-id glob (`*`, `?`), e.g. `{"claude-fable-*": {"t1": 150000, "t2": 200000}}`. Matched against the model id the status line reports; the pattern with the most literal characters wins; no match, or no model id yet, uses the top-level tiers. A value here is explicit (never scaled with the window); the `AUTOPILOT_CONTEXT_BUDGET_T1`/`T2` variables still beat it. Only `t1` and `t2` are accepted, as positive integers; anything else is ignored with a warning. | unset | |
| `context_budget.t3` (config.json) | Context size (tokens) of the third tier, same land checklist and Stop gate again. Default is 70% of the context window when the window is known, and only above t2. | 70% of the window | `AUTOPILOT_CONTEXT_BUDGET_T3` |
| `context_budget.seat` (config.json) | `session` (default) keeps the T2 handoff wording. `resident` is for a fixed fleet address that cannot change thread: T2 tells you to update the state file and confirm that after compaction only the state file path and unfinished items remain. Any other value is ignored and the seat stays `session`. Advisory only. | `session` | `AUTOPILOT_CONTEXT_BUDGET_SEAT`: `session` or `resident`; beats the config. Any other value is ignored. |
| `context_budget.post_compact_warn` (config.json) | After a compaction, when the status line next reports context above this many tokens, one advisory states how many tokens remain, that a fresh conversation would start around 43K (the reporter's unverified figure), and to update the state file or hand off. 0 disables the advisory. A value that is not an integer greater than or equal to 0 is ignored, so with nothing valid set the threshold stays 100000. The check does not change compaction. | `100000` | `AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN`: integer >= 0; 0 disables; beats the config. Any other value is ignored, so with nothing valid set the threshold stays 100000. |
| `context_budget.mode` (config.json) | "off" silences the context-budget reminders and the SessionStart window check; "warn" keeps them; "once" keeps them but each tier (T1, T2) speaks at most once per session, however far context grows. | warn | `AUTOPILOT_CONTEXT_BUDGET_MODE`: Set to "off" to silence context-budget, or "once" for one reminder per tier per session. Any other value is ignored (the config accepts "off", "warn" and "once"). |
| `context_budget.live_write` (config.json) | false stops the hook writing the live context file the status band reads (the reminders keep firing). | `true` | `AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE`: off, 0 or false stops the live context file write. |
| `context_budget.t2_pct_by_seat` (config.json) | Per-seat T2 threshold as a percentage of the known context window (e.g. `{"pm": 11}`). Overrides `t2` for matching seats (`pm`, `lead`, `other`); unset seats keep the default. | `{"pm": 11}` | |
| `context_budget.t2_hard_block` (config.json) | When `true`, `context-land-gate` keeps blocking Stop after T2 fires, with no block cap, until a newer handoff file exists; only for seats listed in `t2_pct_by_seat` (PM by default). Default `false` caps Stop blocks at 2. | `false` | |
| `AUTOPILOT_STUCK_HAND_MINUTES` (env) | Minutes a still-running dispatched hand must show no log or worktree change, no new commit and no CPU growth before the dispatching session is told once (stuck-hand-lib leg of the audit-log hook). `0` or `off` disables the hook. | `30` | Env only. Detection: `scripts/stuck-hand-check.js`. |
| `AUTOPILOT_SUGGEST_COMPACT` | Set to "false" to turn off the tool-call-count compaction nudge (suggest-compact hook). | on |  |
| `AUTOPILOT_BASH_TEST_TIMEOUT` | Set to "0" to disable the PreToolUse Bash test/check timeout-prefix guard (`bash-test-timeout-guard` hook). | on |  |
| `AUTOPILOT_DEP_CACHE` | Set to "0" to disable runtime dependency cache pruning in `scripts/affected-suites.js`. | on |  |
| `AUTOPILOT_PRECOMPACT_STDOUT` | Set to "0" to stop the PreCompact hook printing its guidance text for the summarizer. | on |  |
| `handoff_inject` (config.json) | true restores the machine session snapshot after /clear (session-handoff + session-start hooks). | `false` | `AUTOPILOT_HANDOFF_INJECT`: Set to "1" to enable the session snapshot injection (same as handoff_inject: true; either source enables it). |
| `AUTOPILOT_HANDOFF_MIN_USER_TURNS` | A session needs at least this many user turns before a snapshot is written. | `3` |  |
| `AUTOPILOT_HANDOFF_MIN_TOOL_CALLS` | A session needs at least this many tool calls before a snapshot is written. | `12` |  |
| `AUTOPILOT_HANDOFF_TRANSCRIPT_CAP` | Maximum transcript bytes the snapshot writer reads (16 MiB). | `16777216` |  |
| `advisory_bridge.mode` (config.json) | Where hook advisories go: "sink" shows them as a band toast (default); "inject" puts them in the model context as before. | sink | `AUTOPILOT_ADVISORY_BRIDGE`: inject or sink for all four advisory hooks at once. |
| `advisory_bridge.<hook>` (config.json) | Per-hook override of advisory_bridge.mode; `<hook>` is cost_tracker, version_drift, context_budget or suggest_compact. | unset | `AUTOPILOT_ADVISORY_BRIDGE_<HOOK>`: inject or sink for one hook; `<HOOK>` is COST_TRACKER, VERSION_DRIFT, CONTEXT_BUDGET or SUGGEST_COMPACT. Beats the global variable. |
| `AUTOPILOT_ADVISORY_RELAY` | Set to "off" to stop the UserPromptSubmit hook that drains queued advisories into the next prompt. | on |  |
| `AUTOPILOT_PAST_RECALL` | Set to "off" to stop the UserPromptSubmit hook that, when the prompt mentions the past (之前, 不是說過, 說過, 我有講, 講過, 上次, 又 except 又名, already told, last time), injects up to 5 keyword hits from AUTOPILOT_RECALL_RECORDS_DIR (default ~/projects/pm/.hippo/records) and this session's transcript. | on |  |
| `AUTOPILOT_SCHEDULED_WAKEUP_GUARD` | Set to "off" to stop the hook that marks a self-scheduled wakeup as not an authorisation, and that warns when a ScheduleWakeup prompt contains a go, an approval word (核准, 批准, 授權), or a card id. | on |  |
| `AUTOPILOT_DECIDE_REPLY_CLOSE` | Set to "off" to stop a live-panel reply whose first line is [待決回覆] from closing the decision cards it names. | on |  |
| `AUTOPILOT_QUOTA_WAIT_GUARD_MODE` | Controls the `fleet-quota-wait-guard` PreToolUse hook: `block` (default) denies, `warn` injects an advisory, `off` disables. | `block` |  |
| `AUTOPILOT_AGY_FILE_FALLBACK` | Writes an over-ceiling agy prompt to a mode-0600 dot file in the cwd and sends a short pointer; set to `0`, `false`, `no`, or `off` to disable. | on | |
| `AUTOPILOT_AGY_FILE_MAX_BYTES` | Caps the agy prompt fallback file in bytes; invalid or non-positive values use the default. | `2097152` (2 MiB) | |
| `AUTOPILOT_HETERO_RUNS_DIR` | Overrides the directory for hetero run registry entries. | sibling `hetero-runs` of the dispatch runs directory | |
| `AUTOPILOT_OWNER_MEMBER` | Owner member recorded for hetero runs; falls back to `FLEET_MEMBER`, then `OWNER_MEMBER`, then an empty string. | unset | |
| `AUTOPILOT_LIVE_DIR` | Overrides the directory for the live status files; an explicit value is an isolation request and is never replaced by a fallback. | auto (tmpfs) |  |
| `AUTOPILOT_CTX_RESET_SOFT` | Soft context-token threshold for `scripts/session-ctx-report.js candidates` (reset reason `soft`). Positive number; CLI `--soft` beats env. See [`references/session-reset.md`](../../references/session-reset.md). | `150000` |  |
| `AUTOPILOT_CTX_RESET_HARD` | Hard context-token threshold for session-ctx-report candidates (reset reason `hard`). Positive number; CLI `--hard` beats env. | `250000` |  |
| `AUTOPILOT_CTX_RESET_SOFT_IDLE_MIN` | Idle minutes required with the soft threshold for a soft reset candidate. Positive number; CLI `--soft-idle-min` beats env. | `15` |  |
| `AUTOPILOT_CTX_RESET_HARD_IDLE_MIN` | Idle minutes required with the hard threshold for a hard reset candidate. Positive number; CLI `--hard-idle-min` beats env. | `5` |  |
| `AUTOPILOT_CTX_RESET_COOLDOWN_MIN` | Minutes after a session reset during which candidates keeps the session (`cooldown`). Positive number; CLI `--cooldown-min` beats env. | `120` |  |
| `autoCompactEnabled` (Claude Code) | Claude Code setting (settings.json, else ~/.claude.json): false turns auto-compact off. | unset |  |
| `autoCompactWindow` (Claude Code) | Claude Code setting (user/project/local/policy settings.json; also modelSettings.`<model>`.autoCompactWindow): token window after which Claude Code compacts, at window minus a 33k buffer. Set via /autocompact or in settings.json. | unset |  |
| `CLAUDE_CODE_AUTO_COMPACT_WINDOW` (Claude Code) | Claude Code environment variable: auto-compact window in tokens (clamped to 100000-1000000). Beats every settings file. | unset |  |
| `DISABLE_AUTO_COMPACT` (Claude Code) | Claude Code environment variable: 1, true, yes or on turns auto-compact off. | unset |  |
| `DISABLE_COMPACT` (Claude Code) | Claude Code environment variable: 1, true, yes or on turns all compaction off. | unset |  |


## Cost tracking and the daily spend fuse

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `AUTOPILOT_COST_TRACKER` | Set to "false" to switch the cost tracker off. | on |  |
| `cost_tracker.cache_read_warn_tokens` (config.json) | Cumulative cache-read tokens in one session at which the tracker prints its first warning (then at each doubling). | `50000000` | `AUTOPILOT_COST_TRACKER_CACHE_READ_WARN` |
| `cost_tracker.context_clear_pct` (config.json) | Window fill (percent) at or above which the cost warning says to keep working and to write a handoff file as a backup. | `50` | `AUTOPILOT_COST_TRACKER_CLEAR_PCT` |
| `cost_fuse.mode` (config.json) | What the daily brain-spend fuse does at the cap: "warn" (default), "block" or "off". | warn | `AUTOPILOT_COST_FUSE_MODE` |
| `cost_fuse.daily_usd_brain` (config.json) | Daily USD cap on top-tier (brain) model spend, summed per UTC day from the cost ledger. | `150` | `AUTOPILOT_COST_FUSE_DAILY_USD` |
| `cost_fuse.tiers` (config.json) | Which model tiers count toward the cap. | `["brain"]` |  |

## Hook switches and guard knobs

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `hooks.<stem>` (config.json) | Per-hook switch. true enables an opt-in hook; false disables a default-on hook that honors it (residue-auto-reap). | opt-in hooks off, default-on hooks on | `AUTOPILOT_HOOK_<STEM>`: Per-hook switch from the environment; `<STEM>` is the hook file stem upper-cased with dashes as underscores (AUTOPILOT_HOOK_BRANCH_PROTECTION=1). |
| `AUTOPILOT_HOOK_RESIDUE_AUTO_REAP` | Set to 0, false, off or no to disable the automatic residue sweep hook. | on |  |
| `foreman_guard.mode` (config.json) | Foreman guard (Bash cap, no-polling, no-Monitor for l4-l6 subagents): "block", "warn" or "off". | block | `AUTOPILOT_FOREMAN_GUARD_MODE` |
| `AUTOPILOT_FOREMAN_GUARD_POLL_SCOPE` | Environment override for `foreman_guard.poll_scope` (`all` or `foreman`). | unset |  |
| `AUTOPILOT_FOREMAN_GUARD_POLL_ENFORCE_FROM` | Environment override for the ISO date-time when polling hits switch from warning to denial. | unset |  |
| `foreman_guard.bash_cap` (config.json) | Bash calls a foreman may make before it is told to hand off. A brief's `Bash-Cap: <n>` line (first 10 lines, n from 1 to 200) overrides this per subagent. | `40` | `AUTOPILOT_FOREMAN_GUARD_BASH_CAP` |
| `foreman_guard.reserve_calls` (config.json) | Calls held back after the cap for the closing handoff (git status, add, commit, ...). | `8` | `AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS` |
| `foreman_guard.advisory_every` (config.json) | Repeat interval of the non-denying advisory for other Engine-header subagents. | `40` | `AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY` |
| `foreman_guard.role_caps` (config.json) | Per-role Bash caps: an object with foreman, worker and reviewer integers (worker and reviewer default to 120). | unset | `AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS` |
| `foreman_guard.poll_scope` (config.json) | `all` applies polling rules to every subagent; `foreman` applies them only in l4-l6 marker sessions. | `all` | `AUTOPILOT_FOREMAN_GUARD_POLL_SCOPE` |
| `foreman_guard.poll_enforce_from` (config.json) | ISO date-time when polling-rule hits change from warn to deny; an invalid value denies immediately. | `2026-11-24T00:00:00+08:00` | `AUTOPILOT_FOREMAN_GUARD_POLL_ENFORCE_FROM` |
| `ask_guard` (config.json) | PM question-gate seat decision: `ask_guard.allow_members` is a glob list on the fleet member segment (default `["pm--claude", "glm-trial*"]`); `ask_guard.enforce_from` is an ISO date-time (before it, warn and log to `ask-guard/hits.jsonl`, then a one-hour warn window, then deny). | `allow_members`: `["pm--claude", "glm-trial*"]`; `enforce_from`: `2026-11-24T00:00:00+08:00` | `AUTOPILOT_ASK_GUARD_ENFORCE_FROM`: Environment override for `ask_guard.enforce_from`. |
| `depth0_delegate_gate.mode` (config.json) | Reminder when the top-level session fires many read-class calls in a row: "off", "warn" or "block". | warn | `AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE` |
| `depth0_delegate_gate.threshold` (config.json) | Consecutive read-class calls before the delegate reminder. | `8` |  |
| `depth0_delegate_gate.guarded_models` (config.json) | Model families the gate applies to. | `["fable","opus"]` |  |
| `depth0_delegate_gate.wait_advice_every` (config.json) | Repeat interval of the foreground-wait advice. | `5` | `AUTOPILOT_DEPTH0_WAIT_ADVICE_EVERY` |
| `depth0_delegate_gate.pkill_self_match` (config.json) | What to do with a pkill/pgrep -f pattern that would match its own command line: "deny", "warn" or "off". | deny | `AUTOPILOT_BASH_GUARD_PKILL_MODE` |
| `depth0_delegate_gate.bare_ls` (config.json) | What to do with a bare `ls` in command position of a Bash call (this machine's alias can hang it): "deny", "warn" or "off". | deny | `AUTOPILOT_BASH_GUARD_LS_MODE` |
| `depth0_delegate_gate.busy_loop` (config.json) | Handle busy loops in Bash calls: "deny", "warn" or "off". | deny | `AUTOPILOT_BASH_GUARD_BUSY_LOOP_MODE` |
| `depth0_delegate_gate.rm_var_target` (config.json) | What to do with a recursive `rm` whose target expands at run time (`$VAR`, `${VAR}`, `$(…)` or a backtick): "off", "warn" or "deny". The deny advice is to expand the target to a literal path and remove that path (`cargo clean` for cargo targets), never to `mv` it into a trash dir; a hangar sweeper clears scratchpad trash dirs, but that is a last line of defence, not a normal way to delete. | deny | `AUTOPILOT_BASH_GUARD_RMVAR_MODE` |
| `depth0_delegate_gate.subagent_rm` (config.json) | What to do when a subagent (non-empty `agent_id`) runs a recursive `rm` whose literal target resolves outside the session scratchpad (`<tmp-root>/claude-<uid>/*/<session_id>/`): "off", "warn" or "deny". | deny | `AUTOPILOT_BASH_GUARD_SUBAGENT_RM_MODE` |
| `depth0_delegate_gate.shared_rm` (config.json) | What to do when any session (main or subagent) runs a recursive `rm` whose literal non-glob target exists outside the session scratchpad and is a group/world-writable directory (`mode & 0o022`) or owned by another uid: "off", "warn" or "deny". | warn | `AUTOPILOT_BASH_GUARD_SHARED_RM_MODE` |
| `depth0_delegate_gate.rm_wrapped` (config.json) | What to do when a Bash call puts `rm` inside `sh -c` / `bash -c` / `zsh -c` (including standalone `rm` prose inside a heredoc inside `-c`), an executed heredoc, a `for`/`while` loop, `xargs rm`, `find -exec rm` or `find -delete`: "deny", "warn" or "off". | deny | `AUTOPILOT_BASH_GUARD_RM_WRAPPED_MODE` |
| `depth0_delegate_gate.zsh_syntax` (config.json) | What to do when a Bash command contains zsh-only parameter flags, glob qualifiers or `=(...)` temp-file process substitution (single-quoted text is ignored): "deny", "warn" or "off". | deny | `AUTOPILOT_BASH_GUARD_ZSH_MODE` |
| `depth0_delegate_gate.secret_print` (config.json) | Bash secret dumps: `block` denies commands; `warn` advises. Both redact PHP secret defines, env/systemd assignments and service tokens from Bash stdout/stderr via `secret-output-redact`; `off` disables both layers. Use [safe-inspect](safe-inspect.md) for masked inspection. | block | `AUTOPILOT_BASH_GUARD_SECRET_MODE` (env wins; invalid → block). |
| `AUTOPILOT_DISPATCH_MODEL_GUARD_MODE` | Set to "off" to silence the reminder that a subagent dispatch must name a model and an Engine header. | remind |  |
| `AUTOPILOT_MECHANICAL_REROUTE` | Mechanical subagent reroute on PM and lead seats (seat set by `AUTOPILOT_SEAT_ROLE=pm\|lead`, or a PM console cwd): `off`, `shadow` (log header values to the runtime dir; report with `scripts/mechanical-reroute-report.js`) or `enforce` (deny with a cheap-engine re-dispatch command). | shadow |  |
| `run_approval.mode` (config.json) | Human approval gate on dispatches: "off" or "ask-once". An unattended (claude -p) run must keep it off. | off | `AUTOPILOT_RUN_APPROVAL_MODE` |
| `implementer_claude_native.confirmed_at` (config.json) | ISO timestamp of the owner's one-time confirmation that dispatch-hetero may use the first-party claude-native implementer runner. Written only by `node scripts/run-approval.js confirm-claude-native`; without it the runner is refused. Read only from `<HOME>/.autopilot/config.json` (`os.homedir()`); `AUTOPILOT_CONFIG_FILE` and XDG overrides are ignored on purpose, so a hand-written file cannot be pointed at by env. Changing HOME therefore changes the owner's settings and the confirmation. Must be a full ISO 8601 timestamp with a timezone, a real date, not in the future. | unset |  |
| `orchestrator_edit_gate.mode` (config.json) | What the (opt-in) orchestrator-edit-gate does when the top-level session edits files itself: "warn", "block" or "off". | warn | `AUTOPILOT_ORCH_EDIT_GATE_MODE` |
| `dirty_tree_reminder` (config.json) | false switches the dirty-working-tree reminder off; an object sets min_files, min_lines and interval_minutes. | on | `AUTOPILOT_DIRTY_TREE_REMINDER`: Set to false, 0, off or no to disable the dirty-tree reminder. |
| `unmerged_ship` (config.json) | false switches the Stop advisory that flags SHIP-AS-IS reviewed heads left out of origin/develop off; an object sets enabled and max_age_minutes. | on | `AUTOPILOT_UNMERGED_SHIP`: Set to false, 0, off or no to disable the unmerged SHIP-AS-IS Stop advisory. |
| `unmerged_ship.enabled` (config.json) | false switches the unmerged-SHIP-AS-IS Stop advisory off. | `true` | `AUTOPILOT_UNMERGED_SHIP` |
| `unmerged_ship.max_age_minutes` (config.json) | Minutes after a SHIP-AS-IS verdict before a head that is not in the target branch is an alert (check-unmerged-ship.js, its Stop hook). | `60` |  |
| `owner_question_guard` (config.json) | false switches off the Stop guard that blocks a reply waiting for the owner without a decision card id, including the bare card id check. | on | `AUTOPILOT_OWNER_QUESTION_GUARD`: Set to off, false, 0 or no to disable the owner-question guard. `AUTOPILOT_BARE_CARD_ID_LINT`: Set to off, false, 0 or no to disable only the bare card id check (a `d-` + 8 hex id needs a subject, for example `d-47602dd8（週一手機重連 Wi-Fi）`). |
| `reply_language` (config.json) | Set to `"zh-Hant"` to make `owner-question-guard` block a reply that is not Traditional Chinese (CJK ideograph ratio under 60% after stripping code, URLs, paths and ids when letters + CJK >= 20, or containing simplified-only characters). Unset or any other value does nothing. `AUTOPILOT_OWNER_QUESTION_GUARD=off` still disables the whole hook. | unset (off) | `AUTOPILOT_REPLY_LANGUAGE`: `zh-Hant` enables; any other value disables and beats `config.json`. |
| `AUTOPILOT_STOP_ONCE` (env) | `owner-question-guard`'s reply-language check blocks at most once per turn: a retry Stop (`stop_hook_active`) passes it, so a reply is not re-prompted repeatedly. | on | `0` restores the old repeat-block behaviour. |
| `AUTOPILOT_SEND_WORK_ORDER_GUARD` | Set to off, false, 0 or no to disable the PreToolUse guard that denies a fleet `send` used as a work order. | on | New work uses `dispatch`; news about an existing task uses `reply`; a pure fact uses `send` with `fyi=true`. Note: on `mcp__fleet__dispatch`, enabling opt-in stem `pm-dispatch-plan-guard` (`hooks.pm-dispatch-plan-guard` / `AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD=1`) in a PM console session requires a `Size` marker (and a `Plan: <path>@<sha>` or `Plan: plan-first` marker for `Size: M|L|XL`). |
| `hooks.askpm-remind` / `hooks.pm-output-cap` / `hooks.pm-dispatch-plan-guard` | Opt-in PM-console hook switches (`hooks.<stem>`). `askpm-remind` blocks once on Stop for an undisposed `ask_id` turn and owns the askpm reply row; `pm-output-cap` caps bulky `Bash`/`mcp__*` outputs at 40 lines on PostToolUse (or 30 lines when `pm_output_cap.ledger_search_pattern` matches a `Bash` command or `mcp__*` tool name); `pm-dispatch-plan-guard` checks `Size`/`Plan` markers on `mcp__fleet__dispatch`. | off (`false`) | `AUTOPILOT_HOOK_ASKPM_REMIND`, `AUTOPILOT_HOOK_PM_OUTPUT_CAP`, `AUTOPILOT_HOOK_PM_DISPATCH_PLAN_GUARD` |
| `pm_output_cap.ledger_search_pattern` (config.json) | Regex matched against `Bash` commands or `mcp__*` tool names by opt-in `pm-output-cap` in a PM console session; matching calls get a 30-line output cap instead of 40. Empty or unset (the default) leaves the rule off. | `""` (empty, off) | none |
| `per_turn_gate.verifier` (config.json) | Command the (opt-in) per-turn-gate Stop hook runs at turn end as `<command> --turn <n> --repo <cwd> --json`; exit 1 blocks the stop with its violations, any error allows. Needs `hooks.per-turn-gate` too. `scripts/gate-verify.js` is the generic data-driven verifier built for this interface (rule list schema `schemas/gate-rules.schema.json`); the hook runs it itself, with no config, for a worker-bound gate file (`per_turn_gate.session_arming`, below). | none | none |
| `per_turn_gate.mode` (config.json) | What per-turn-gate may block on: "violations" (verifier exit 1 only) or "violations+features" (also exit 0 with a non-empty `feature_gaps`; this mode, the trigger and its retry text, is the one evaluated: P2-3r2 and P2-3-h55 PASS (Haiku only, task t14); `violations` alone was not evaluated on its own; see `docs/plans/evidence/2026-10-25-per-turn-gate-p2-4/VERDICT.md`). | violations | none |
| `per_turn_gate.max_blocks` (config.json) | Blocks per-turn-gate may give in one turn. | `2` | none |
| `per_turn_gate.session_arming` (config.json) | Whether per-turn-gate honours a worker-bound gate file (`<live-state>/per-turn-gate/<session>.gate.json`, written only by `scripts/per-turn-gate-arm.js`, e.g. through `dispatch-hetero.sh --gate-rules`). With it missing or `true`, a valid file arms the gate for that one session or subagent even when `hooks.per-turn-gate` is off; an invalid, missing or expired file changes nothing. An explicit `false` ignores gate files without looking for one. A `gate-verify.js` exit 2 (the check could not run) blocks the worker like a violation and shares `max_blocks`. | `true` | none |
| `per_turn_gate.state_retention_days` (config.json) | Days after which per-turn-gate deletes its untouched counter, turn and lock files from the live-state directory (log files are kept). | `7` | none |
| `per_turn_gate.timeout_ms` (config.json) | Hard timeout of the verifier in milliseconds; a timeout allows the stop. | `30000` | none |
| `subagent_budget.mode` (config.json) | Subagent budget gate on Agent dispatch (per-lane relay and turn ceilings): "warn" (default) notes a ceiling and denies only past `runaway_multiple`, never opening an owner card; "remind" (opt-in) denies at a ceiling and opens an owner card; "off" disables. | warn | `AUTOPILOT_SUBAGENT_BUDGET_MODE` |
| `subagent_budget.lane_dispatch_max` (config.json) | Dispatches one lane may already have before the next is denied (reviewers excluded). | `4` | `AUTOPILOT_SUBAGENT_BUDGET_LANE_DISPATCH_MAX` |
| `subagent_budget.lane_turns_max` (config.json) | Subagent turns one lane may already have used before the next dispatch is denied. | `300` | `AUTOPILOT_SUBAGENT_BUDGET_LANE_TURNS_MAX` |
| `subagent_budget.root_turns_per_hour_max` (config.json) | Subagent turns of the whole session in the last 60 minutes before the next dispatch is denied. | `400` | `AUTOPILOT_SUBAGENT_BUDGET_ROOT_TURNS_PER_HOUR_MAX` |
| `subagent_budget.runaway_multiple` (config.json) | In warn mode, a ceiling whose actual count reaches this multiple of its limit denies the dispatch and writes a `runaway_block` ledger row (no owner card; `Budget-Ack:` passes it). 0 disables the guard. | `3` | `AUTOPILOT_SUBAGENT_BUDGET_RUNAWAY_MULTIPLE` |
| `subagent_budget.concurrent_advise_max` (config.json) | Running subagents at or above this number add one advisory line on Agent dispatch. 0 disables the line. The hook never denies on this count. | `3` | `AUTOPILOT_SUBAGENT_BUDGET_CONCURRENT_ADVISE_MAX` |
| `subagent_budget.per_ticket_usd` (config.json) | Default per-ticket Claude subagent USD budget when the brief has no `Claude-Budget:` line. | `5` | `AUTOPILOT_SUBAGENT_BUDGET_PER_TICKET_USD`, `AUTOPILOT_TICKET_BUDGET` |
| `dirty_tree_reminder.min_files` (config.json) | Changed files that trigger the reminder. | `3` | `AUTOPILOT_DIRTY_TREE_MIN_FILES` |
| `dirty_tree_reminder.min_lines` (config.json) | Changed lines that trigger the reminder. | `150` | `AUTOPILOT_DIRTY_TREE_MIN_LINES` |
| `dirty_tree_reminder.interval_minutes` (config.json) | Minimum minutes between two reminders per repo and session; 0 reminds every turn. | `30` | `AUTOPILOT_DIRTY_TREE_INTERVAL_MINUTES` |
| `AUTOPILOT_PROTECTED_BRANCHES` | Branch-name pattern the opt-in branch-protection hook guards. | `^(main\|master)$` |  |
| `AUTOPILOT_INTENT_CAPTURE` | Set to "false" to stop the per-directory intent capture used for cross-session resume hints. | on |  |
| `AUTOPILOT_SESSION_TASKS` | Set to "off" to stop folding task-tool events into the live band. | on |  |
| `AUTOPILOT_SESSION_END_CLEANUP` | Set to "0" (also off/false/no) to stop the SessionEnd hook (session-mode-end) from deleting the session's plain/expired marker or clamping its l3–l6 marker; residue then dies only through the sweep and reader-side cleanup. | on |  |
| `AUTOPILOT_AWAITING_OWNER` | Set to "off" to stop the awaiting-owner attention records the band shows. | on |  |
| `AUTOPILOT_ASK_DECISION` | Set to "off" to stop recording AskUserQuestion prompts as decisions. | on |  |
| `AUTOPILOT_AGENT_ACTIVITY` | Set to "off" to stop the subagent activity stamps. | on |  |
| `AUTOPILOT_MERGE_TASK_STATUS` | Set to "off" to stop merging task-status input into the band. | on |  |
| `AUTOPILOT_PRUNE_MERGED_BRANCH` | Set to "off" to stop deleting merged remote head branches after pushing to the integration branch. | on |  |
| `AUTOPILOT_CAPTURE_PAYLOAD` | Set to "1" to write hook payloads to disk for debugging (scripts/toggle-payload-capture.js). | off |  |
| `AUTOPILOT_LEAK_GUARD_HOSTS` | Path of the per-user JSON host deny list (`{"strong":[...],"contextual":[...]}`) read by `scripts/leak-guard.js` and `scripts/redact-personal.js`; missing falls back to the local hostname only with one stderr notice, unreadable or malformed fails closed (exit 2). | `~/.autopilot/leak-guard-hosts.json` |  |

## Update notice

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `onboard_hint` (config.json) | false stops the one-line suggestion to run `autopilot:onboard` at session start (shown on `startup` only, when the repo has `.claude/` but no `.claude/dispatch-config.md`). | `true` | `AUTOPILOT_ONBOARD_HINT`: Set to "0" to stop the startup onboard suggestion (either this or onboard_hint: false switches it off). |
| `update_check` (config.json) | false stops the "Autopilot updated" notice at session start. | `true` | `AUTOPILOT_UPDATE_CHECK`: Set to "0" to stop the update notice (either this or update_check: false switches it off). |
| `AUTOPILOT_CONFIG_PAIR_CHECK` | Set to "0" to stop the ordinary-session reminder when context_budget.t2 plus gap is above autoCompactWindow minus 33000. The same reminder is also off when `update_check` is false or `AUTOPILOT_UPDATE_CHECK` is "0". | on | |
| `config_schema_version` (config.json) | The config.json format version you last reviewed. Missing counts as 0; the current version is 2. Autopilot never writes it. | `0` (missing) | none |

### Config check on upgrade

On the SessionStart that announces a new Autopilot version, and whenever you run `bash scripts/dev-setup.sh --check` (or `node scripts/lib/config-audit.js`), autopilot reads your `config.json` and reports, as advice only (nothing is blocked or edited):

- keys it does not know, with the closest known key (a typo is otherwise silent);
- values of the wrong type or outside the allowed values (for example `context_budget.mode`: only `"off"` turns the reminders off, any other value is ignored);
- contradictions: `context_budget.t1` at or above `t2`; `t2 + gap` above `autoCompactWindow - 33,000`; no `autoCompactWindow` set while compaction is on;
- defaults that changed since your `config_schema_version`. After reading them, set `"config_schema_version": 2` in the file to stop seeing the listing.

At SessionStart the report is at most 5 lines and is switched off together with the update notice (`update_check: false` or `AUTOPILOT_UPDATE_CHECK=0`).

On every other SessionStart, only a `t2 + gap` above `autoCompactWindow - 33000` mismatch is shown (at most 2 lines). Nothing is printed when that pair fits. `AUTOPILOT_CONFIG_PAIR_CHECK=0` switches that reminder off, and so do `update_check: false` and `AUTOPILOT_UPDATE_CHECK=0`. The version-update SessionStart still uses only the block above, so the finding is not printed twice.

## Review ledger archive

Opt-in copy of hetero-review report files. Finalize is wired in. It writes to the archive only when a dir is configured (env or config key); unset means nothing is written. The config file is still read to learn whether the key is set. The suggested path `~/.autopilot/review-ledger-archive` is not a default.

| Setting | What it does | Default | Environment override |
|---|---|---|---|
| `review_ledger_archive.dir` (config.json) | Directory that receives the archive (layout: repo bucket, month of the first collect, ledger id). Empty string means off. | unset (off) | `AUTOPILOT_REVIEW_LEDGER_ARCHIVE_DIR`: same meaning; empty string means off; beats the config. |
| `review_ledger_archive.include_diff` (config.json) | Also store `diff.txt`. Off, the archive keeps the report files only. | `false` | `AUTOPILOT_REVIEW_LEDGER_ARCHIVE_INCLUDE_DIFF`: true, 1, or yes copies `diff.txt`; false, 0, or no does not. Beats the config. |
| `review_ledger_archive.warn_mb` (config.json) | `status` warns when the archive is larger than this many mebibytes. The warning never blocks. | `500` | `AUTOPILOT_REVIEW_LEDGER_ARCHIVE_WARN_MB`: number >= 0; beats the config. A non-number is ignored, so the threshold stays 500. |
| `review_ledger_archive.rotate_after_months` (config.json) | `rotate` compresses a complete month directory when it is strictly older than this many calendar months. The current month stays a directory. | `2` | `AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_AFTER_MONTHS`: a positive integer; beats the config. Anything else is ignored, so the age stays 2. |
| `review_ledger_archive.rotate_remove_source` (config.json) | After a tar listing matches, delete the month directory. Off, both the directory and the tar stay. | `false` | `AUTOPILOT_REVIEW_LEDGER_ARCHIVE_ROTATE_REMOVE_SOURCE`: true, 1, or yes deletes; false, 0, or no keeps the directory. Beats the config. |

## Residue cleanup

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `residue.auto_reap` (config.json) | Automatic reaping of finished dispatch worktrees. Does not delete branches (see residue.delete_branches). | `true` | `AUTOPILOT_RESIDUE_AUTO_REAP`: 0 or 1; environment override of residue.auto_reap. |
| `residue.delete_branches` (config.json) | When true, reap and close-session delete branches after printing each branch and its tip. Default false: branches stay and are listed for the owner. | `false` | `AUTOPILOT_RESIDUE_DELETE_BRANCHES`: 0 or 1; environment override of residue.delete_branches. Any other value is ignored. |
| `residue.tmp_prune` (config.json) | Daily host-wide prune of autopilot temp roots, riding on the automatic reap. | `true` | `AUTOPILOT_RESIDUE_TMP_PRUNE`: 0 or 1; environment override of residue.tmp_prune. |
| `run_ledger.max_rotations` (config.json) | How many rotated run-ledger segments (`<ledger>.1` to `<ledger>.N`) are kept before the oldest is dropped; also how many the readers and the seat sweep follow. Readers follow `.N` down to `.1` and then the live ledger. At `0` the campaign CLI and `scripts/run-ledger.sh` read only the live ledger, but the seat-store, work-order and engine readers fall back to `4`; the writer still moves the live ledger to `.1` when it rotates, even at `0`. Odd values are handled by each reader as before: the work-order and engine readers accept only integers 1 to 64 and otherwise use `4`; the seat-store reader and the campaign CLI cut `1.5` down to `1`, use `4` for negatives and keep values above 64; the shell script uses the number as given. | `4` | None on purpose: `RUN_LEDGER_MAX_ROTATIONS` is no longer read, so a sweep or test environment cannot change the real rotation. Set it in the config file. |
| `residue.lease_hours` (config.json) | Hours a dispatch worktree is kept before it may be reaped. | `72` | `AUTOPILOT_RESIDUE_LEASE_HOURS`: Positive number; environment override of residue.lease_hours. |
| `residue.archive_branch_days` (config.json) | Days before an archive branch is cleaned up. | `14` | `AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS`: Positive number; environment override of residue.archive_branch_days. |
| `residue.archive_remind_days` (config.json) | Age in days after which an old archive ref is only listed as needing a human, never deleted. | `90` | `AUTOPILOT_RESIDUE_ARCHIVE_REMIND_DAYS`: Positive number; environment override of residue.archive_remind_days. |
| `residue.branch_prefixes` (config.json) | Extra branch prefixes the reaper treats as dispatch branches (letters, digits, . _ - and an optional trailing /). | `[]` |  |
| `AUTOPILOT_TMP_LOG_RETENTION_DAYS` | Days dispatch scripts keep their temp logs; 0 disables the prune. | `3` |  |
| `AUTOPILOT_DISK_GUARD_MIN_FREE_PCT` | Minimum free disk percent below which `dispatch-hetero.sh`, `dispatch-foreman.sh` and `dispatch-batch.sh` refuse to create a worktree (precondition failure). Below it they first sweep idle build output a repo declares in `.autopilot/build-artifacts.json` (`scripts/reap-build-artifacts.js`) and re-check. | `20` |  |

## Dispatch, topology and endpoints

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `topology.exclude_seats` (config.json) | Seats (engine/effort@runner, or a bare engine) never offered by the dispatch ladders and review panel; unioned with --exclude-seats. | `[]` | `AUTOPILOT_TOPOLOGY_FILE`: Where the derived dispatch topology is written and read. |
| `qc_panel.codex_quota_substitutes` (config.json) | Ordered substitute seats (`engine/effort@runner`, or `engine@runner` with effort `high`) tried once at runtime when a `qc_panel` seat on the `codex` runner fails because codex quota or rate-limit is exhausted (HTTP 429 or usage-limit error). Skips any substitute whose family matches the implementer or violates the panel's cross-family requirement; never changes `qc_panel` composition. | `["grok-4.7/high@grok", "gemini-4-carbon-high/high@agy"]` |  |
| `prices_fetch` (config.json) | false stops the SessionStart refresh of the seat price cache (`scripts/qualification-prices.js fetch`, detached, at most once per 24 h). | `true` | `AUTOPILOT_PRICES_FETCH`: Set to "0" to stop the refresh (either this or prices_fetch: false switches it off). `AUTOPILOT_PRICES_CACHE_DIR`: where the seat price cache lives (default `~/.autopilot/qualification-prices`, never inside a git work tree). |
| `AUTOPILOT_REVIEW_MAX_CONCURRENCY` | Most review seats that run at once in a review fan-out (qc panel, final panel); the rest queue in order and each seat's timeout starts when it actually starts. Unset, 0 or not a whole number means all seats at once. | unlimited |  |
| `AUTOPILOT_REVIEW_IDLE_TIMEOUT` | Idle cap for a review seat: when its output files have not grown for this long (seconds, or Ns / Nm) the seat is killed and reported no_verdict with reason `seat_idle_timeout`, so the seat can be swapped. Same as `dispatch-review.sh --idle-timeout`, which wins. Keep it above the longest quiet think of the runner: buffered runners (claude -p) print nothing until the end. | unset (off) |  |
| `AUTOPILOT_RUNNER_HOME_FALLBACK` | Set to "off" to stop the lookup of a runner binary under HOME (codex and agy in ~/.local/bin, grok in ~/.grok/bin, kimi in ~/.kimi-code/bin) when PATH does not hold it. PATH is always searched first. Unset, it is off under node --test; an explicit on wins. Tests set it off so a runner removed from PATH is never found at the real home. | on |  |
| `AUTOPILOT_MIN_REVIEWED_SEATS` | Minimum seats that must have reviewed before a review loop or phase receipt passes (same grammar as --min-reviewed-seats). | all seats |  |
| `AUTOPILOT_QUALIFICATION_OVERRIDE` | A matching, unexpired override that lets a dispatch use a seat whose qualification would otherwise refuse it. | unset |  |
| `AUTOPILOT_STRIKE_ENFORCEMENT` | Strike-based requalification is enforced by default; set to "shadow" to opt out (strikes are then only recorded and `would_requalify` is projected). | enforce |  |
| `AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE` | Set to "1" to let a dispatch whose --*-bin override is not the PATH binary write the real capability store. Otherwise the strike writer and passive capture skip that write unless ENGINE_CAPABILITY_DIR, ENGINE_CAPABILITY_FILE, or --store isolates it. | unset |  |
| `AUTOPILOT_ENDPOINT_PREPROBE` | Set to `off` to skip the 2 s GET /models probe that dispatch-hetero and dispatch-consult make before using a local `--endpoint`. | `on` |  |
| `AUTOPILOT_TIP_VERIFY_REQUIRE` | Set to `1` to make `dispatch-hetero.sh` refuse before the worker starts when no acceptance command is found (no `--verify-cmd`, no fenced block under the brief `## Acceptance`, no fenced or whole-line command under `.claude/quality-gate-config.md` `## Test Command`). Unset, a non-empty `scripts/lib/tip-verify-grace.json` proceeds, records `tip_verify` `no_source`, prints one stderr line naming the repo, and does not re-run acceptance. An empty, missing or unreadable list refuses the same way as `1`. | unset |  |
| `target_precommit` (config.json) | Run the target repo's executable pre-commit against captured commits in a disposable worktree. | on |  |
| `target_precommit_timeout_s` (config.json) | Maximum time in seconds for the target repo's pre-commit hook. | `300` |  |
| `rc_alarm_lead` (config.json) | Fleet addresses notified by `rc-alarm.js` when no `--lead` is supplied. | `[]` |  |
| `AUTOPILOT_RC_ALARM_LABEL` | Default label for `dispatch-hetero.sh`'s rc-alarm check and record. | unset |  |
| `AUTOPILOT_RC_ALARM_OWNER` | Default owner recipient for `dispatch-hetero.sh` rc-alarm notices. | unset |  |
| `AUTOPILOT_TARGET_PRECOMMIT` | Set to `off` to skip the target repo pre-commit check. | on |  |
| `AUTOPILOT_TARGET_PRECOMMIT_TIMEOUT_S` | Override `target_precommit_timeout_s`. | `300` |  |
| `AUTOPILOT_CONSULT_TIMEOUT` | Timeout of a consult dispatch. | `5m` |  |
| `AUTOPILOT_DISCUSS_TIMEOUT` | Timeout of a discuss dispatch. | `5m` |  |
| `AUTOPILOT_AUTHOR_KILL_GRACE_SECS` | Seconds the agy author runner is given after the outer timeout before it is killed. A positive integer; zero, negatives and non-numbers fall back to 30. | `30` |  |
| `AUTOPILOT_HETERO_HARD_TIMEOUT` | Wall cap for a hetero dispatch when `--hard-timeout` is not passed; the worker is killed at the cap. | `4h` |  |
| `AUTOPILOT_HETERO_SAMPLE_S` | Seconds between agent-log byte and process-tree CPU samples; positive number. | `15` |  |
| `AUTOPILOT_AUTHOR_HARD_TIMEOUT` | Wall cap for an author dispatch when `--hard-timeout` is not passed; the run is killed at the cap. | `4h` |  |
| `AUTOPILOT_AUTHOR_SAMPLE_S` | Seconds between agent-log byte and process-tree CPU samples; positive number. | `15` |  |
| `AUTOPILOT_AUTHOR_MAX_TOKENS` | Response cap of an authoring dispatch. | `30000` |  |
| `AUTOPILOT_CONTEXT_WINDOW_GATE` | off, warn or block: what a dispatch does when its prompt would not fit the engine context window. | block |  |
| `AUTOPILOT_NONCQ_DIR` | Queue root for `scripts/noncq.js` (non-Claude work queue). Created `0700`; persistent on purpose. See [`references/noncq.md`](../../references/noncq.md). | `~/.autopilot/noncq` |  |
| `AUTOPILOT_NONCQ_REPORT_TO` | Fleet address (`namespace/courier/member`) that receives `[noncq-empty]` reports from `noncq.js drain`. The report's second line names lane backlog items tagged noncq-ok (fixed text; see [`references/noncq.md`](../../references/noncq.md)). Falls back to `AUTOPILOT_PM_ADDRESS`; with neither, drain prints one stderr line only. | unset |  |
| `qualification_feed.url` (config.json) | Default feed URL for adopt-qualification-defaults.js --from; it never fetches by itself. | unset |  |
| `qualification_feed.trust` (config.json) | How admission may use a qualification feed after the gate: `auto` (default; a gate-passed qualification is used, no adopt), `confirm`, or `off` (same as no feed). An unrecognised value is treated as `off` and reported on stderr (fail closed, never silently `auto`). In `confirm`, new rows open one owner-decision card for the whole batch, not one card per row. Answer it with `node scripts/qualification-feed-trust.js answer --card <id> --decision confirm` or `--decision reject` (optional `--feed-cache-dir` and `--cwd`). `confirm` appends one line per row to `~/.autopilot/qualification-feeds/confirmations.jsonl`. `reject` admits nothing and does not ask again for that batch. That command is not an adopt: it never writes a scorecard row, a strike, or evidence. | `auto` |  |
| `qualification_outbox.enqueue` (config.json) | When true, a completed engine-scorecard record is also queued in the registry outbox (`~/.autopilot/qualification-outbox`). The local scorecard write is unchanged; nothing is sent until `qualification-send-queue.js flush` runs with a transport. | `false` |  |
| `qualification_outbox.transport` (config.json) | How `qualification-send-queue.js flush` sends: `off` (nothing is sent) or `git` (bot branch and pull request in the registry clone; the owner merges, and the merge is the ack). | `off` |  |
| `qualification_outbox.registry_repo` (config.json) | Path of the dedicated bot clone of the registry repo (llm-playground) that the git transport uses. Required when transport is `git`. | unset |  |
| `qualification_outbox.workspace` (config.json) | Registry workspace (`benchmarks/qualification/<workspace>`) that the outbox sends into. | `cookys` |  |
| `AUTOPILOT_ENDPOINTS_ENV` | Path of the endpoints env file (mode 600) that load-endpoints-env.sh and resolve-endpoint.sh read. | `~/.autopilot/endpoints.env` |  |
| `AUTOPILOT_ENDPOINT_<NAME>_URL` | Per-endpoint settings loaded from the endpoints env file: AUTOPILOT_ENDPOINT_`<NAME>`_URL and AUTOPILOT_ENDPOINT_`<NAME>`_TOKEN. An HTTP seat appears in the topology only when its URL is set. | unset |  |
| `fleet_gateway_endpoints` (config.json) | Named endpoints allowlisted as fleet gateways to receive the `X-Fleet-Task` header (case-insensitive); unnamed endpoints or endpoints outside the list send no header and emit no warning. | `[]` | `AUTOPILOT_FLEET_GATEWAY_ENDPOINTS`: comma-separated. When set, even to empty, it replaces this list. |
| `local_gateway_hosts` (config.json) | Per-host gateway hostnames, or RFC1918 IPv4 addresses, unioned with the tracked list and `AUTOPILOT_LOCAL_GATEWAY_HOSTS`. A missing or unparsable file adds nothing. Public IPv4, IPv6 literals and unlisted addresses stay refused. | `[]` |  |
| `local_slots_cmd` (config.json) | Legacy command override; implicit local dispatch no longer reads this setting and requires a gateway lease. | `""` | `AUTOPILOT_LOCAL_SLOTS_CMD` replaces this legacy setting when set, even when empty. |
| `local_slots_url` (config.json) | Legacy slot-query URL; implicit local dispatch no longer reads this setting and requests a lease from the resolved local endpoint's gateway origin. | `""` | `AUTOPILOT_LOCAL_SLOTS_URL` replaces this URL when set; an explicitly empty value disables the query and keeps the dispatch on the cloud default. |
| `AUTOPILOT_LOCAL_LEASE_TTL_S` | Requested local gateway lease duration in seconds; heartbeat runs every third of the TTL. Default `180`. | `180` | Primarily for gateway tuning and tests. |
| `local_context_bytes` (config.json) | Byte cap for the implicit local implementer: the prompt file plus existing relative files named in the first Scope lines. A larger prompt stays on the cloud default. | `400000` |  |
| `local_context_tokens` (config.json) | Estimated token window for an implicit local implementer; named existing files and prompt bytes are estimated at 3.5 bytes per token. | `262144` |  |
| `local_output_reserve_tokens` (config.json) | Output tokens reserved from the implicit local implementer's context window before checking the estimated input. | `32000` |  |
| `AUTOPILOT_ENGINES_TABLE` | Path of the capacity engines table (`capacity.engines/1`) that `scripts/lib/engine-preflight.js` reads before a dispatch. A row whose availability is 已用完, 停用 or 暫停, or whose suggest is 暫停 or starts with 不派, is skipped. A file older than 30 minutes, missing or unparseable is ignored and reported as `capacity_table_stale` or `capacity_table_missing`; it never blocks the dispatch by itself. | `$HOME/projects/capacity/out/engines.v1.json` |  |
| `AUTOPILOT_BURN_MORE` | Path of the capacity burn-more list (`capacity.burn_more/1`). A candidate listed there is reported with `burn_more: true` and is not reordered or skipped because of this file. | `$HOME/projects/capacity/out/burn_more.v1.json` |  |
| `AUTOPILOT_SHED_ROUTE` | Set to `0` to disable seat-scoped mechanical-work shed routing from the fresh `capacity.burn_more/1` shed field. | `on` |  |
| `AUTOPILOT_ENGINE_PREFLIGHT_WINDOW_MIN` | Minutes of recent dispatch manifests (`*.manifest.json` in the dispatch-runs directory) that engine preflight treats as a skip for the same runner and model when the manifest says overloaded, rate_limited / 429, model_unsupported / not supported on this account, or quota exhausted. | `15` |  |
| `AUTOPILOT_ENGINE_PREFLIGHT_PROBE` | Optional executable called as `<probe> <runner> <model>` (20 s, stdin ignored, `SIGKILL` on timeout) before choosing a candidate. Exit 0 is ok, 75 overloaded, 76 rate_limited, 77 unsupported. A timeout is `probe:timeout` plus warning `probe_unknown:timeout`, and the next candidate is tried. Any other exit is a warning and is not a skip. Unset means no probe. | unset |  |
| `AUTOPILOT_LANE` | Lane slug the dispatch rails (`dispatch-hetero.sh`, `dispatch-review.sh`, `dispatch-author.sh`) record as `lane` in the run manifest, so quota use can be attributed to a lane. Must match `^[a-z0-9][a-z0-9._-]{0,63}$`, otherwise `null`. When unset, `dispatch-hetero.sh` and `dispatch-author.sh` read the `Lane:` field from the first 8 lines of the brief (`Engine: x \| Role: y \| Lane: slug \| Size: S`, or one field per line); `dispatch-review.sh` has no brief and records `null`. | unset |  |
| `AUTOPILOT_LOCAL_GATEWAY_HOSTS` | Comma-separated names or RFC1918 IPv4 addresses accepted as local gateway hosts for tests; config key `local_gateway_hosts` is the user setting. | unset |  |
| `AUTOPILOT_RULE_CAPTURE_LOG` | JSONL file where the `lesson-lint.js stop-hook` rule-capture appends one row per Stop whose last operator message matched a rule marker (outcome `block`, `no_rule` or `pass`; never the message text), so the false-block rate can be computed. | `$XDG_STATE_HOME/autopilot/rule-capture.jsonl` (else `~/.local/state/autopilot/rule-capture.jsonl`) | `AUTOPILOT_RULE_CAPTURE_LOG` |
| `AUTOPILOT_MINIMAX_BASE_URL` | Base URL for the provider-native MiniMax endpoint. | unset |  |
| `AUTOPILOT_PM_SWITCHBOARD` | Set to `off` to disable `scripts/pm-switchboard.js run` (exits 0 with no inbox reads, marks, wakes or receipts). | `on` |  |
| `AUTOPILOT_FLEET_REPO` | Path to the fleet checkout whose `plugins/claude/src/inbox-cli.ts` backs `scripts/lib/pm-inbox-adapter.js` in `fleet` mode; unset exits 2. | unset |  |
| `AUTOPILOT_PM_INBOX_MEMBER` | Fleet member handle passed as `--member` to `inbox-cli.ts` by `scripts/lib/pm-inbox-adapter.js`. | `pm--claude` |  |
| `AUTOPILOT_PM_ACCEPT_CMD` | JSON argv array invoked with the task id appended when `scripts/pm-switchboard.js` auto-accepts a verified `task_result` in `fleet` mode; when unset, auto-accept is unavailable and the item routes to `pending_decision`. | unset |  |
| `AUTOPILOT_PM_TASK_SHOW_CMD` | JSON argv array invoked with the task id appended by `scripts/lib/pm-inbox-adapter.js` (`getTask`) in `fleet` mode to read `{assignee, attempt, dispatched_at, acceptance}` for `task_result` verification; when unset, task metadata is unavailable and `task_result` items route to `pending_decision`. | unset |  |
| `AUTOPILOT_PM_SWITCHBOARD_FALLBACK` | Set to `on` or `off` to control the residue-only Sonnet fallback in `scripts/pm-switchboard.js` (invoked through `scripts/dispatch-author.sh --runner claude-native` with a throwaway credentials-only config dir); when `off` and any hour has `> 3` residue items, the next run reopens the fallback for that run and records `fallback_reopened: true`. | `on` |  |
| `AUTOPILOT_PM_LEAK_STATUS_FILE` | Path to a JSON file containing the four leak-check counts read by `scripts/pm-switchboard.js fallback-status`; when unset or unreadable, `leak_checks` reports `unknown` and `retirable` is `false`. | unset |  |
| `AUTOPILOT_PM_AUTO_ACCEPT` | Rollback knob (`on` or `off`) for `scripts/pm-switchboard.js`: `off` stops `task_result` auto-accept and routes those items into batched `pending_decision` packets without restoring per-message wakes. | `on` |  |

## Claude accounts (G37)

Only matter once you have created an account registry (`~/.config/autopilot/accounts/registry.json`); without one the account layer is not used. Setup steps: [accounts.md](accounts.md). Config keys live under `accounts` in `~/.autopilot/config.json`.

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `accounts.mode` (config.json) | `auto` uses the account layer whenever a registry exists; `off` takes the legacy path even with a registry (each use is audited as `mode_off`). | `auto` | `AUTOPILOT_ACCOUNT_MODE`: Overrides the config value for one shell (`auto` or `off`). |
| `accounts.refuse_all_tight` (config.json) | true makes pick and run refuse (exit 3) when every alias is at or above 90% used; false uses the least tight alias. | `false` |  |
| `accounts.cooldown_default_minutes` (config.json) | Minutes an alias is skipped after a quota 429 when no reset time is known. A plain server throttle uses the shorter of this and 5. | `30` |  |
| `accounts.max_attempts` (config.json) | Most aliases one `run` tries before it gives up with exit 4. | `3` |  |
| `accounts.quota_capture` (config.json) | `on` records the rate-limit event of a finished attempt into the local quota mirror (zero cost; only `--output-format stream-json` callers carry one, so a `json` caller records nothing); `off` turns off this passive capture, the 429 refusal row and the statusline adapter that copies the codeforge snapshot into the mirror (`run` calls it once before it picks; `sync-statusline` by hand); a probe still writes its row: one you start yourself (`usage-probe`), one `quota_probe=stale` makes, and the on-demand probe that an unset `quota_probe` makes before pick when an alias's newest observation is old (see `accounts.quota_probe`). A 429 with no live window on file also writes a refusal row. In the audit, the `quota_capture` field of an attempt line is one closed reason code, or two distinct codes joined by `+` (the attempt's own capture reason first, then a statusline-adapter write failure of the same alias, e.g. `bad_event+mirror_lock_busy`); an adapter failure never rides another alias's line. | `on` |  |
| `accounts.quota_probe` (config.json) | Unset follows the adapter manifest. On-demand: before pick, for an alias whose newest observation is older than `accounts.quota_probe_stale_minutes`, one tiny model call (about 0.003 USD), at most one per run, never for a pinned, tight or cooling alias. Periodic (`scheduled`, driven by `usage-probe --due` from an external timer, about every 30 minutes, only for an alias a run used in the last 24 h and with no newer observation): only when the manifest says `starts_window=false` with `starts_window_confidence=high`, an evidence path and a recorded `quota_share_per_probe`; Claude is `unknown`, so on-demand only. `off` never probes and beats the manifest; `stale` is on-demand only; `scheduled` is rejected when the gate has not passed. | `manifest` |  |
| `accounts.quota_probe_demand` (config.json) | Which aliases are in the periodic probe's demand set: `audit` (default, only aliases a run used in the last 24 h) or `registry` (union with every alias in this host's registry that `staleCandidates` can probe). | `audit` | `AUTOPILOT_QUOTA_PROBE_DEMAND`: `audit` or `registry`; beats the config. |
| `accounts.quota_probe_stale_minutes` (config.json) | Minutes after which an alias's newest observation counts as stale for the `stale` probe; 5 to 360. | `60` |  |
| `accounts.quota_probe_timeout_secs` (config.json) | Seconds a probe call may run before it is killed. A failed probe never blocks the real call. | `20` |  |
| `accounts.host_role` (config.json) | Role label written into this host's quota rows. | `agent` |  |
| `quota_mirror_dirs` (config.json) | Extra fleet.quota mirror directories merged with this account's live `quota/` directory. Each entry is itself a quota directory (the same shape as `<live_dir>/quota`, typically `<shared-dir>/quota`). Per provider, account and window, the row with the newest `observed_at` wins; a tie keeps the local live directory. A missing or unreadable directory is skipped, and a row that fails the fleet.quota/1 check is dropped. | `[]` | `AUTOPILOT_QUOTA_MIRROR_DIRS`: colon-separated. When the variable is set, even to empty, it replaces this list. |
| `AUTOPILOT_ACCOUNTS_DIR` | Directory of the registry and token store. Point it at a throwaway directory to try the layer without touching the real one (step O6). | `~/.config/autopilot/accounts` |  |
| `AUTOPILOT_PM_ADDRESS` | Fleet address (`namespace/courier/member`, e.g. `ns/host-a/pm--claude`) that `profile-health.js notify` sends to when `--to` is omitted, and the fallback recipient for `noncq.js` `[noncq-empty]` when `AUTOPILOT_NONCQ_REPORT_TO` is unset. No default: with neither `--to` nor `AUTOPILOT_PM_ADDRESS`, `notify` exits 2 without sending. | unset |  |

Set by the layer, not by you: `AUTOPILOT_ACCOUNT` (the alias a child runs as). Test-only seams are listed as internal in `scripts/lib/config-keys.json`.

## Live band, review page and watchers

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `ui.locale` (config.json) | Language of the live band and pane: "en", "zh-TW" or "auto" (follow Claude Code). | auto | `AUTOPILOT_LOCALE`: en or zh-TW; used when ui.locale is auto or absent. |
| `review.port` (config.json) | Port of the local review page server (bound to 127.0.0.1 only). A busy port is reported, never replaced. | `8787` | `AUTOPILOT_REVIEW_SERVER_AUTOSTART`: Set to "0" to stop the runs watcher from starting the review page server. |
| `AUTOPILOT_MODS_PANE_PROBE` | 設為 JSONL 檔案路徑，逐次記錄 live Pane 的 host 配置、正文配給、回傳列數與末列分頁狀態；未設定或空字串不做探針檔案 I/O。啟用與截圖核對方式見 [W1 探針](../../mods/live/docs/w1-host-row.md#r4-5真機-host-props-opt-in-探針)。 | unset |  |
| `AUTOPILOT_RUNS_WATCH_AUTOSTART` | Set to "0" (or false, off, no) to stop sessions from starting the live runs watcher. | on |  |
| `AUTOPILOT_CARD_NOTIFY` | Set to "off" (or 0, false, no) to stop `open-decision.js` from sending the card open/close notice to the program PM. | on |  |
| `AUTOPILOT_CARD_NOTIFY_TO` | Fleet address (`namespace/courier/member`, e.g. `example/host-a/pm--claude`) that receives the card open/close notice. No default: unset or empty sends nothing (environment variable only; set it per host, never in the repo); "off" or "none" also sends nothing. | unset |  |
| `AUTOPILOT_USAGE_PUSH_TO` | Fleet address receiving the daily dispatch usage snapshot. Unset or empty disables sending; configure per host for `scripts/dispatch-usage-push.sh`. | unset |  |
| `AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S` | Seconds of idleness before the runs watcher exits (positive integer). | unset |  |
| `AUTOPILOT_RUNS_WATCH_INTERVAL_S` | Seconds between runs watcher polls (positive integer). | unset |  |
| `AUTOPILOT_QC_OUTCOME` | Overrides `outcome` in `.claude/qc-gate-config.md` for the pre-push outcome stage: `off`, `warn`, or `block`. `off` skips that stage only (the trailer stage still runs) and prints a one-line notice when the file says warn or block. The same file's `outcome_rerun` (`sample`, `all`, or `none`; default `sample`), `outcome_sample` (default `20`), and `outcome_budget_s` (default `600`) have no environment override. An unknown outcome value falls back to `off`. | off |  |

## Project-level files (`.claude/`)

These are plain-markdown files you place in a project's `.claude/` directory. How injection works, the templates and worked examples are in [configuration.md](configuration.md); this table is the index.

| File | Customizes |
|---|---|
| `.claude/backlog-config.md` | Backlog entry schema options and pointer rule. ([template](../../project-config-template/backlog-config.md)) |
| `.claude/debug-config.md` | Project-specific debug tools and log paths. ([template](../../project-config-template/debug-config.md)) |
| `.claude/dev-flow-config.md` | Size rules, quality gates, build commands, special rules. ([template](../../project-config-template/dev-flow-config.md)) |
| `.claude/dispatch-config.md` | Which dispatcher, reviewer and methodology autopilot delegates to when other plugins are installed. ([template](../../project-config-template/dispatch-config.md)) |
| `.claude/dispatch-guard-config.md` | Per-project gate on expensive-model dispatch (dispatch-model-guard). ([template](../../project-config-template/dispatch-guard-config.md)) |
| `.claude/doa-config.md` | Delegated Operations Authority presets for subagent dispatch. ([template](../../project-config-template/doa-config.md)) |
| `.claude/doc-drift-config.md` | Doc-to-code domains the doc-sync skill audits. ([template](../../project-config-template/doc-drift-config.md)) |
| `.claude/execution-boundary-config.md` | sanctioned_roots, protected refs and allow_sql for the opt-in exec-boundary hook. ([template](../../project-config-template/execution-boundary-config.md)) |
| `.claude/finish-flow-config.md` | Closing-sequence overrides (merge target, archive procedure, per-size quality gate). ([template](../../project-config-template/finish-flow-config.md)) |
| `.claude/knowledge-routing-config.md` | Where durable knowledge lands (handoff, learn, distill). ([template](../../project-config-template/knowledge-routing-config.md)) |
| `.claude/loop.md` | Default prompt for a bare /loop. ([template](../../project-config-template/loop.md)) |
| `.claude/model-routing-config.md` | Subagent model and mode per role. ([template](../../project-config-template/model-routing-config.md)) |
| `.claude/next-config.md` | Work source paths for the next skill. ([template](../../project-config-template/next-config.md)) |
| `.claude/owner-kernel-governance.json` | Project governance: mission-convergence enforcement and budgets, guidance defaults, red lines, rosters (the file name is historical; the file is live). ([template](../../project-config-template/governance-config.md)) |
| `.claude/profiling-config.md` | Profiling tools and metrics collection. ([template](../../project-config-template/profiling-config.md)) |
| `.claude/project-lifecycle-config.md` | Project paths and bootstrap/archive scripts. ([template](../../project-config-template/project-lifecycle-config.md)) |
| `.claude/qc-gate-config.md` | Strength of the QC forcing function at push and finish-flow. ([template](../../project-config-template/qc-gate-config.md)) |
| `.claude/quality-gate-config.md` | Test, scan and review commands. ([template](../../project-config-template/quality-gate-config.md)) |
| `.claude/review-loop-config.md` | Engine roster and loop policy of the heterogeneous review pipeline. Global `on_engine_unavailable` defaults to `cloud-fallback` (automatic retreat along `scripts/lib/pace-roles.json` `priority.implementer`: `agy` -> `grok` -> `glm` -> `agyclaude`, never `codex`; explicit `ask`/`solo-fallback`/`wait-reset` and explicit `cloud_fallback_rung` keep their meaning). The reviewer seat's `reviewer_on_engine_unavailable` (empty follows `on_engine_unavailable`, except an unset `agy` `gemini-4-carbon-*` reviewer resolves to `cloud-fallback`) retreats once along `pace-roles.json` `fallback.reviewer` (`hydrogen` -> `grok` -> `glm` -> `agyclaude`, skipping implementer family — or skipping nothing when inferred family is `unknown`, keeping GLM eligible — and never `codex`, unless an explicit non-codex `reviewer_cloud_fallback_rung` override is active). ([template](../../project-config-template/review-loop-config.md)) |
| `.claude/skill-routing.md` | Maps keywords to your project domain skills. ([template](../../project-config-template/skill-routing.md)) |
| `.claude/task-class-config.md` | Autonomous front-door routing and next-pick weighting. ([template](../../project-config-template/task-class-config.md)) |
| `.claude/team-config.md` | Team role templates for your tech stack. ([template](../../project-config-template/team-config.md)) |
| `.claude/test-integrity-config.md` | Mode and rules of the test-integrity gate. ([template](../../project-config-template/test-integrity-config.md)) |
| `.claude/test-strategy-config.md` | Test commands, pyramid ratios, coverage thresholds. ([template](../../project-config-template/test-strategy-config.md)) |
| `.claude/worktree-teardown-config.md` | Per-project cleanup seam for hetero worktrees. ([template](../../project-config-template/worktree-teardown-config.md)) |

## Things that look like settings but are not wired

- `autopilot.costTracker` and `autopilot.protectedBranches` in Claude Code's `settings.json` (shown in `settings.example.json` and some hook comments) are not read by any code, and nothing turns them into environment variables. The working switches are `AUTOPILOT_COST_TRACKER=false` and `AUTOPILOT_PROTECTED_BRANCHES`.
- `config.json` can carry `{"<ENV_NAME>": "off"}` for the knobs of the live band's data sources; only the band's source manifest reads that, so it changes what the band reports, not whether the hook runs. Use the environment variable or the hook's own key to switch the hook off.
- The context-budget hook header still says `AUTOPILOT_HOOK_CONTEXT_BUDGET=1` enables it; the hook is default-on since v2.35.15 and its exit knob is `context_budget.mode: "off"` / `AUTOPILOT_CONTEXT_BUDGET_MODE=off`.

## Keeping this page honest

Run `node scripts/check-config-docs.js` (exit 0 in sync, 1 on drift, `--json` for machine output). It also runs in `scripts/preflight-release.sh`. When you add a setting, add it to `scripts/lib/config-keys.json` (`audience: "user"` with a `summary`, or `audience: "internal"` with a `class`) and, for a user setting, to the matching table above.

### Inbox drain gate

- **`inbox_drain_gate_lead`** (`boolean`, default `false`) / **`AUTOPILOT_INBOX_DRAIN_GATE_LEAD`** (`0` | `1`, default `0`): By default `hooks/inbox-drain-gate.js` (Stop) only blocks the PM seat (`pm--claude`) when unread or `pending_decision` inbox items are older than 10 minutes. Set `inbox_drain_gate_lead: true` in `~/.autopilot/config.json` or `AUTOPILOT_INBOX_DRAIN_GATE_LEAD=1` to also cover lead seats.
