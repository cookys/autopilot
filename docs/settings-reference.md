# Autopilot settings reference

> Part of [Autopilot](../README.md). The project-level `.claude/*-config.md` files and how they are injected are explained in [configuration.md](configuration.md); this page covers everything else you can set: the machine-local `~/.autopilot/config.json`, `AUTOPILOT_*` environment variables, and the Claude Code settings autopilot depends on. Hook behavior in detail: [hooks/README.md](../hooks/README.md).

This page lists the settings meant for you to change. The machine-readable inventory behind it, including the internal variables (test seams, paths, ids autopilot passes to its own child processes), is [`scripts/lib/config-keys.json`](../scripts/lib/config-keys.json). [`scripts/check-config-docs.js`](../scripts/check-config-docs.js) keeps the two in step with the code: a setting the code reads must be registered, a registered setting must still be read, and every user setting must appear on this page.

## Where settings live and which one wins

**The config file.** Operator settings live in `~/.autopilot/config.json`. Set `AUTOPILOT_CONFIG_FILE` to use another file. The file is machine-local and never version-controlled, and its only version field is `config_schema_version` (see "Update notice"). It is not validated by the readers: a missing or malformed file silently means "all defaults" (the one exception is `topology.exclude_seats`, whose reader exits with an error on unparseable JSON or a wrong shape). A typo in a key name is also silent, so check a new setting actually took effect, or run `bash scripts/dev-setup.sh --check`, which lists unknown keys with the closest known name.

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
- **`AUTOPILOT_CONTEXT_BUDGET_MODE`** only understands `off`; any other value is ignored (the config key also accepts `warn`).
- **Zero values.** In the config, `context_budget.t1` or `t2` set to `0` disables that tier; in the environment a value of `0` is ignored.

**Default-on and opt-in hooks.** A default-on hook runs unless you turn it off; an opt-in hook is wired but inert until you enable it with `hooks.<stem>` or `AUTOPILOT_HOOK_<STEM>`. The stems and tiers are in [hooks/README.md](../hooks/README.md). Each default-on hook has its own exit knob, listed in the "Hook switches" section below.

## Context budget, compaction and handoff

The context-budget hook measures the real context size and reminds you to checkpoint (T1) and then to write a handoff (T2). Claude Code can also compact the context by itself; the two need to be set up together.

### Setting `t2`, `gap` and `autoCompactWindow` together

Claude Code compacts when the context reaches **`autoCompactWindow` minus a fixed 33,000-token buffer**. Autopilot's SessionStart check compares that compaction point with your T2:

- The rule: **`context_budget.t2` + `context_budget.gap` must be at most `autoCompactWindow` - 33,000**. `gap` is the room between the T2 reminder and the compaction, in which a handoff gets written.
- With the defaults (T2 150,000, gap 50,000) the window must be at least **233,000**. A window of 250,000 fits (compaction at 217,000, T2 reminder well before it). A window of 200,000 does not (compaction at 167,000, so you would be compacted before the handoff reminder has room to matter); SessionStart then prints the warning and the window that fits, `t2 + gap + 33000`.
- Once auto-compact is configured and on, T2 is a reminder to write a handoff (`autopilot:handoff`) so the compaction restores cleanly, not a request to stop and `/clear`. Without an `autoCompactWindow`, a 1M-window model compacts only near 1M, so T2 asks you to stop and `/clear` at 150,000: set the window if you would rather keep working.
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
- Compaction is off when `DISABLE_AUTO_COMPACT` or `DISABLE_COMPACT` is truthy, or `autoCompactEnabled` is false. Then the window check is skipped and T2 is the only reset prompt.
- Subagents have their own context ceiling: the foreman guard applies `t2` (scaled to the subagent's window) to a foreman's own context, independent of auto-compact.
- Autopilot cannot see `--settings <file>` or `--autocompact` given on the `claude` command line; `scripts/dev-setup.sh --check` reports only whether a window is set.

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `context_budget.t1` (config.json) | Context size (tokens) at which the first reminder fires: plan a checkpoint and avoid loading large files inline. | `100000` | `AUTOPILOT_CONTEXT_BUDGET_T1` |
| `context_budget.t2` (config.json) | Context size (tokens) of the second, stronger reminder: write a handoff. With auto-compact configured it is only a reminder; without it the hook tells you to stop and /clear. | `150000` | `AUTOPILOT_CONTEXT_BUDGET_T2` |
| `context_budget.gap` (config.json) | Tokens between the T2 reminder and the point where Claude Code compacts; used by the SessionStart check that T2 can fire before compaction. | `50000` | `AUTOPILOT_CONTEXT_BUDGET_GAP` |
| `context_budget.step` (config.json) | A tier repeats its reminder only after the context grew by this many tokens since it last fired; 0 reminds on every call past the threshold. | `50000` | `AUTOPILOT_CONTEXT_BUDGET_STEP` |
| `context_budget.per_model` (config.json) | Per-model `t1`/`t2`, keyed by a model-id glob (`*`, `?`), e.g. `{"claude-fable-*": {"t1": 150000, "t2": 200000}}`. Matched against the model id the status line reports; the pattern with the most literal characters wins; no match, or no model id yet, uses the top-level tiers. A value here is explicit (never scaled with the window); the `AUTOPILOT_CONTEXT_BUDGET_T1`/`T2` variables still beat it. Only `t1` and `t2` are accepted, as positive integers; anything else is ignored with a warning. | unset | |
| `context_budget.seat` (config.json) | `session` (default) keeps the T2 handoff wording. `resident` is for a fixed fleet address that cannot change thread: T2 tells you to update the state file and confirm that after compaction only the state file path and unfinished items remain. Any other value is ignored and the seat stays `session`. Advisory only. | `session` | `AUTOPILOT_CONTEXT_BUDGET_SEAT`: `session` or `resident`; beats the config. Any other value is ignored. |
| `context_budget.post_compact_warn` (config.json) | After a compaction, when the status line next reports context above this many tokens, one advisory states how many tokens remain, that a fresh conversation would start around 43K (the reporter's unverified figure), and to update the state file or hand off. 0 disables the advisory. A value that is not an integer greater than or equal to 0 is ignored, so with nothing valid set the threshold stays 100000. The check does not change compaction. | `100000` | `AUTOPILOT_CONTEXT_BUDGET_POST_COMPACT_WARN`: integer >= 0; 0 disables; beats the config. Any other value is ignored, so with nothing valid set the threshold stays 100000. |
| `context_budget.mode` (config.json) | "off" silences the context-budget reminders and the SessionStart window check; "warn" keeps them. | warn | `AUTOPILOT_CONTEXT_BUDGET_MODE`: Set to "off" to silence context-budget. Any other value is ignored (the config accepts "off" and "warn"). |
| `context_budget.live_write` (config.json) | false stops the hook writing the live context file the status band reads (the reminders keep firing). | `true` | `AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE`: off, 0 or false stops the live context file write. |
| `AUTOPILOT_SUGGEST_COMPACT` | Set to "false" to turn off the tool-call-count compaction nudge (suggest-compact hook). | on |  |
| `AUTOPILOT_PRECOMPACT_STDOUT` | Set to "0" to stop the PreCompact hook printing its guidance text for the summarizer. | on |  |
| `handoff_inject` (config.json) | true restores the machine session snapshot after /clear (session-handoff + session-start hooks). | `false` | `AUTOPILOT_HANDOFF_INJECT`: Set to "1" to enable the session snapshot injection (same as handoff_inject: true; either source enables it). |
| `AUTOPILOT_HANDOFF_MIN_USER_TURNS` | A session needs at least this many user turns before a snapshot is written. | `3` |  |
| `AUTOPILOT_HANDOFF_MIN_TOOL_CALLS` | A session needs at least this many tool calls before a snapshot is written. | `12` |  |
| `AUTOPILOT_HANDOFF_TRANSCRIPT_CAP` | Maximum transcript bytes the snapshot writer reads (16 MiB). | `16777216` |  |
| `advisory_bridge.mode` (config.json) | Where hook advisories go: "sink" shows them as a band toast (default); "inject" puts them in the model context as before. | sink | `AUTOPILOT_ADVISORY_BRIDGE`: inject or sink for all four advisory hooks at once. |
| `advisory_bridge.<hook>` (config.json) | Per-hook override of advisory_bridge.mode; `<hook>` is cost_tracker, version_drift, context_budget or suggest_compact. | unset | `AUTOPILOT_ADVISORY_BRIDGE_<HOOK>`: inject or sink for one hook; `<HOOK>` is COST_TRACKER, VERSION_DRIFT, CONTEXT_BUDGET or SUGGEST_COMPACT. Beats the global variable. |
| `AUTOPILOT_ADVISORY_RELAY` | Set to "off" to stop the UserPromptSubmit hook that drains queued advisories into the next prompt. | on |  |
| `AUTOPILOT_DECIDE_REPLY_CLOSE` | Set to "off" to stop a live-panel reply whose first line is [待決回覆] from closing the decision cards it names. | on |  |
| `AUTOPILOT_LIVE_DIR` | Overrides the directory for the live status files; an explicit value is an isolation request and is never replaced by a fallback. | auto (tmpfs) |  |
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
| `cost_tracker.context_clear_pct` (config.json) | Window fill (percent) at or above which the cost warning recommends a handoff and /clear. | `50` | `AUTOPILOT_COST_TRACKER_CLEAR_PCT` |
| `cost_fuse.mode` (config.json) | What the daily brain-spend fuse does at the cap: "warn" (default), "block" or "off". | warn | `AUTOPILOT_COST_FUSE_MODE` |
| `cost_fuse.daily_usd_brain` (config.json) | Daily USD cap on top-tier (brain) model spend, summed per UTC day from the cost ledger. | `150` | `AUTOPILOT_COST_FUSE_DAILY_USD` |
| `cost_fuse.tiers` (config.json) | Which model tiers count toward the cap. | `["brain"]` |  |

## Hook switches and guard knobs

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `hooks.<stem>` (config.json) | Per-hook switch. true enables an opt-in hook; false disables a default-on hook that honors it (residue-auto-reap). | opt-in hooks off, default-on hooks on | `AUTOPILOT_HOOK_<STEM>`: Per-hook switch from the environment; `<STEM>` is the hook file stem upper-cased with dashes as underscores (AUTOPILOT_HOOK_BRANCH_PROTECTION=1). |
| `AUTOPILOT_HOOK_RESIDUE_AUTO_REAP` | Set to 0, false, off or no to disable the automatic residue sweep hook. | on |  |
| `foreman_guard.mode` (config.json) | Foreman guard (Bash cap, no-polling, no-Monitor for l4-l6 subagents): "block", "warn" or "off". | block | `AUTOPILOT_FOREMAN_GUARD_MODE` |
| `foreman_guard.bash_cap` (config.json) | Bash calls a foreman may make before it is told to hand off. A brief's `Bash-Cap: <n>` line (first 10 lines, n from 1 to 200) overrides this per subagent. | `40` | `AUTOPILOT_FOREMAN_GUARD_BASH_CAP` |
| `foreman_guard.reserve_calls` (config.json) | Calls held back after the cap for the closing handoff (git status, add, commit, ...). | `8` | `AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS` |
| `foreman_guard.advisory_every` (config.json) | Repeat interval of the non-denying advisory for other Engine-header subagents. | `40` | `AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY` |
| `foreman_guard.role_caps` (config.json) | Per-role Bash caps: an object with foreman, worker and reviewer integers (worker and reviewer default to 120). | unset | `AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS` |
| `depth0_delegate_gate.mode` (config.json) | Reminder when the top-level session fires many read-class calls in a row: "off", "warn" or "block". | warn | `AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE` |
| `depth0_delegate_gate.threshold` (config.json) | Consecutive read-class calls before the delegate reminder. | `8` |  |
| `depth0_delegate_gate.guarded_models` (config.json) | Model families the gate applies to. | `["fable","opus"]` |  |
| `depth0_delegate_gate.wait_advice_every` (config.json) | Repeat interval of the foreground-wait advice. | `5` | `AUTOPILOT_DEPTH0_WAIT_ADVICE_EVERY` |
| `depth0_delegate_gate.pkill_self_match` (config.json) | What to do with a pkill/pgrep -f pattern that would match its own command line: "deny", "warn" or "off". | deny | `AUTOPILOT_BASH_GUARD_PKILL_MODE` |
| `AUTOPILOT_DISPATCH_MODEL_GUARD_MODE` | Set to "off" to silence the reminder that a subagent dispatch must name a model and an Engine header. | remind |  |
| `run_approval.mode` (config.json) | Human approval gate on dispatches: "off" or "ask-once". An unattended (claude -p) run must keep it off. | off | `AUTOPILOT_RUN_APPROVAL_MODE` |
| `orchestrator_edit_gate.mode` (config.json) | What the (opt-in) orchestrator-edit-gate does when the top-level session edits files itself: "warn", "block" or "off". | warn | `AUTOPILOT_ORCH_EDIT_GATE_MODE` |
| `dirty_tree_reminder` (config.json) | false switches the dirty-working-tree reminder off; an object sets min_files, min_lines and interval_minutes. | on | `AUTOPILOT_DIRTY_TREE_REMINDER`: Set to false, 0, off or no to disable the dirty-tree reminder. |
| `owner_question_guard` (config.json) | false switches off the Stop guard that blocks a reply waiting for the owner without a decision card id. | on | `AUTOPILOT_OWNER_QUESTION_GUARD`: Set to off, false, 0 or no to disable the owner-question guard. |
| `subagent_budget.mode` (config.json) | Subagent budget gate on Agent dispatch (per-lane relay and turn ceilings): "remind" denies at a ceiling, "warn" only notes it, "off" disables. | remind | `AUTOPILOT_SUBAGENT_BUDGET_MODE` |
| `subagent_budget.lane_dispatch_max` (config.json) | Dispatches one lane may already have before the next is denied (reviewers excluded). | `4` | `AUTOPILOT_SUBAGENT_BUDGET_LANE_DISPATCH_MAX` |
| `subagent_budget.lane_turns_max` (config.json) | Subagent turns one lane may already have used before the next dispatch is denied. | `300` | `AUTOPILOT_SUBAGENT_BUDGET_LANE_TURNS_MAX` |
| `subagent_budget.root_turns_per_hour_max` (config.json) | Subagent turns of the whole session in the last 60 minutes before the next dispatch is denied. | `400` | `AUTOPILOT_SUBAGENT_BUDGET_ROOT_TURNS_PER_HOUR_MAX` |
| `dirty_tree_reminder.min_files` (config.json) | Changed files that trigger the reminder. | `3` | `AUTOPILOT_DIRTY_TREE_MIN_FILES` |
| `dirty_tree_reminder.min_lines` (config.json) | Changed lines that trigger the reminder. | `150` | `AUTOPILOT_DIRTY_TREE_MIN_LINES` |
| `dirty_tree_reminder.interval_minutes` (config.json) | Minimum minutes between two reminders per repo and session; 0 reminds every turn. | `30` | `AUTOPILOT_DIRTY_TREE_INTERVAL_MINUTES` |
| `AUTOPILOT_PROTECTED_BRANCHES` | Branch-name pattern the opt-in branch-protection hook guards. | `^(main\|master)$` |  |
| `AUTOPILOT_INTENT_CAPTURE` | Set to "false" to stop the per-directory intent capture used for cross-session resume hints. | on |  |
| `AUTOPILOT_SESSION_TASKS` | Set to "off" to stop folding task-tool events into the live band. | on |  |
| `AUTOPILOT_AWAITING_OWNER` | Set to "off" to stop the awaiting-owner attention records the band shows. | on |  |
| `AUTOPILOT_ASK_DECISION` | Set to "off" to stop recording AskUserQuestion prompts as decisions. | on |  |
| `AUTOPILOT_AGENT_ACTIVITY` | Set to "off" to stop the subagent activity stamps. | on |  |
| `AUTOPILOT_MERGE_TASK_STATUS` | Set to "off" to stop merging task-status input into the band. | on |  |
| `AUTOPILOT_CAPTURE_PAYLOAD` | Set to "1" to write hook payloads to disk for debugging (scripts/toggle-payload-capture.js). | off |  |

## Update notice

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `update_check` (config.json) | false stops the "Autopilot updated" notice at session start. | `true` | `AUTOPILOT_UPDATE_CHECK`: Set to "0" to stop the update notice (either this or update_check: false switches it off). |
| `AUTOPILOT_CONFIG_PAIR_CHECK` | Set to "0" to stop the ordinary-session reminder when context_budget.t2 plus gap is above autoCompactWindow minus 33000. The same reminder is also off when `update_check` is false or `AUTOPILOT_UPDATE_CHECK` is "0". | on | |
| `config_schema_version` (config.json) | The config.json format version you last reviewed. Missing counts as 0; the current version is 1. Autopilot never writes it. | `0` (missing) | none |

### Config check on upgrade

On the SessionStart that announces a new Autopilot version, and whenever you run `bash scripts/dev-setup.sh --check` (or `node scripts/lib/config-audit.js`), autopilot reads your `config.json` and reports, as advice only (nothing is blocked or edited):

- keys it does not know, with the closest known key (a typo is otherwise silent);
- values of the wrong type or outside the allowed values (for example `context_budget.mode`: only `"off"` turns the reminders off, any other value is ignored);
- contradictions: `context_budget.t1` at or above `t2`; `t2 + gap` above `autoCompactWindow - 33,000`; no `autoCompactWindow` set while compaction is on;
- defaults that changed since your `config_schema_version`. After reading them, set `"config_schema_version": 1` in the file to stop seeing the listing.

At SessionStart the report is at most 5 lines and is switched off together with the update notice (`update_check: false` or `AUTOPILOT_UPDATE_CHECK=0`).

On every other SessionStart, only a `t2 + gap` above `autoCompactWindow - 33000` mismatch is shown (at most 2 lines). Nothing is printed when that pair fits. `AUTOPILOT_CONFIG_PAIR_CHECK=0` switches that reminder off, and so do `update_check: false` and `AUTOPILOT_UPDATE_CHECK=0`. The version-update SessionStart still uses only the block above, so the finding is not printed twice.

## Residue cleanup

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `residue.auto_reap` (config.json) | Automatic reaping of finished dispatch worktrees and branches. | `true` | `AUTOPILOT_RESIDUE_AUTO_REAP`: 0 or 1; environment override of residue.auto_reap. |
| `residue.tmp_prune` (config.json) | Daily host-wide prune of autopilot temp roots, riding on the automatic reap. | `true` | `AUTOPILOT_RESIDUE_TMP_PRUNE`: 0 or 1; environment override of residue.tmp_prune. |
| `residue.lease_hours` (config.json) | Hours a dispatch worktree is kept before it may be reaped. | `72` | `AUTOPILOT_RESIDUE_LEASE_HOURS`: Positive number; environment override of residue.lease_hours. |
| `residue.archive_branch_days` (config.json) | Days before an archive branch is cleaned up. | `14` | `AUTOPILOT_RESIDUE_ARCHIVE_BRANCH_DAYS`: Positive number; environment override of residue.archive_branch_days. |
| `residue.archive_remind_days` (config.json) | Age in days after which an old archive ref is only listed as needing a human, never deleted. | `90` | `AUTOPILOT_RESIDUE_ARCHIVE_REMIND_DAYS`: Positive number; environment override of residue.archive_remind_days. |
| `residue.branch_prefixes` (config.json) | Extra branch prefixes the reaper treats as dispatch branches (letters, digits, . _ - and an optional trailing /). | `[]` |  |
| `AUTOPILOT_TMP_LOG_RETENTION_DAYS` | Days dispatch scripts keep their temp logs; 0 disables the prune. | `3` |  |

## Dispatch, topology and endpoints

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `topology.exclude_seats` (config.json) | Seats (engine/effort@runner, or a bare engine) never offered by the dispatch ladders and review panel; unioned with --exclude-seats. | `[]` | `AUTOPILOT_TOPOLOGY_FILE`: Where the derived dispatch topology is written and read. |
| `prices_fetch` (config.json) | false stops the SessionStart refresh of the seat price cache (`scripts/qualification-prices.js fetch`, detached, at most once per 24 h). | `true` | `AUTOPILOT_PRICES_FETCH`: Set to "0" to stop the refresh (either this or prices_fetch: false switches it off). `AUTOPILOT_PRICES_CACHE_DIR`: where the seat price cache lives (default `~/.autopilot/qualification-prices`, never inside a git work tree). |
| `AUTOPILOT_REVIEW_MAX_CONCURRENCY` | Most review seats that run at once in a review fan-out (qc panel, final panel); the rest queue in order and each seat's timeout starts when it actually starts. Unset, 0 or not a whole number means all seats at once. | unlimited |  |
| `AUTOPILOT_MIN_REVIEWED_SEATS` | Minimum seats that must have reviewed before a review loop or phase receipt passes (same grammar as --min-reviewed-seats). | all seats |  |
| `AUTOPILOT_QUALIFICATION_OVERRIDE` | A matching, unexpired override that lets a dispatch use a seat whose qualification would otherwise refuse it. | unset |  |
| `AUTOPILOT_STRIKE_ENFORCEMENT` | Set to "enforce" to arm strike-based requalification; otherwise strikes are only recorded. | shadow |  |
| `AUTOPILOT_ALLOW_REAL_STORE_WITH_BIN_OVERRIDE` | Set to "1" to let a dispatch whose --*-bin override is not the PATH binary write the real capability store. Otherwise the strike writer and passive capture skip that write unless ENGINE_CAPABILITY_DIR, ENGINE_CAPABILITY_FILE, or --store isolates it. | unset |  |
| `AUTOPILOT_CONSULT_TIMEOUT` | Timeout of a consult dispatch. | `5m` |  |
| `AUTOPILOT_DISCUSS_TIMEOUT` | Timeout of a discuss dispatch. | `5m` |  |
| `AUTOPILOT_AUTHOR_KILL_GRACE_SECS` | Seconds the agy author runner is given after the outer timeout before it is killed. A non-negative integer; an invalid value falls back to 30. | `30` |  |
| `AUTOPILOT_AUTHOR_MAX_TOKENS` | Response cap of an authoring dispatch. | `30000` |  |
| `AUTOPILOT_CONTEXT_WINDOW_GATE` | off, warn or block: what a dispatch does when its prompt would not fit the engine context window. | block |  |
| `qualification_feed.url` (config.json) | Default feed URL for adopt-qualification-defaults.js --from; it never fetches by itself. | unset |  |
| `qualification_feed.trust` (config.json) | How admission may use a qualification feed after the gate: `auto` (default; a gate-passed qualification is used, no adopt), `confirm`, or `off` (same as no feed). An unrecognised value is treated as `off` and reported on stderr (fail closed, never silently `auto`). In `confirm`, new rows open one owner-decision card for the whole batch, not one card per row. Answer it with `node scripts/qualification-feed-trust.js answer --card <id> --decision confirm` or `--decision reject` (optional `--feed-cache-dir` and `--cwd`). `confirm` appends one line per row to `~/.autopilot/qualification-feeds/confirmations.jsonl`. `reject` admits nothing and does not ask again for that batch. That command is not an adopt: it never writes a scorecard row, a strike, or evidence. | `auto` |  |
| `qualification_outbox.enqueue` (config.json) | When true, a completed engine-scorecard record is also queued in the registry outbox (`~/.autopilot/qualification-outbox`). The local scorecard write is unchanged; nothing is sent until `qualification-send-queue.js flush` runs with a transport. | `false` |  |
| `qualification_outbox.transport` (config.json) | How `qualification-send-queue.js flush` sends: `off` (nothing is sent) or `git` (bot branch and pull request in the registry clone; the owner merges, and the merge is the ack). | `off` |  |
| `qualification_outbox.registry_repo` (config.json) | Path of the dedicated bot clone of the registry repo (llm-playground) that the git transport uses. Required when transport is `git`. | unset |  |
| `qualification_outbox.workspace` (config.json) | Registry workspace (`benchmarks/qualification/<workspace>`) that the outbox sends into. | `cookys` |  |
| `AUTOPILOT_ENDPOINTS_ENV` | Path of the endpoints env file (mode 600) that load-endpoints-env.sh reads. | `~/.autopilot/endpoints.env` |  |
| `AUTOPILOT_ENDPOINT_<NAME>_URL` | Per-endpoint settings loaded from the endpoints env file: AUTOPILOT_ENDPOINT_`<NAME>`_URL and AUTOPILOT_ENDPOINT_`<NAME>`_TOKEN. An HTTP seat appears in the topology only when its URL is set. | unset |  |
| `AUTOPILOT_MINIMAX_BASE_URL` | Base URL for the provider-native MiniMax endpoint. | unset |  |

## Live band, review page and watchers

| Setting | What it does | Default | Environment variable |
|---|---|---|---|
| `ui.locale` (config.json) | Language of the live band and pane: "en", "zh-TW" or "auto" (follow Claude Code). | auto | `AUTOPILOT_LOCALE`: en or zh-TW; used when ui.locale is auto or absent. |
| `review.port` (config.json) | Port of the local review page server (bound to 127.0.0.1 only). A busy port is reported, never replaced. | `8787` | `AUTOPILOT_REVIEW_SERVER_AUTOSTART`: Set to "0" to stop the runs watcher from starting the review page server. |
| `AUTOPILOT_RUNS_WATCH_AUTOSTART` | Set to "0" (or false, off, no) to stop sessions from starting the live runs watcher. | on |  |
| `AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S` | Seconds of idleness before the runs watcher exits (positive integer). | unset |  |
| `AUTOPILOT_RUNS_WATCH_INTERVAL_S` | Seconds between runs watcher polls (positive integer). | unset |  |
| `AUTOPILOT_QC_OUTCOME` | Overrides `outcome` in `.claude/qc-gate-config.md` for the pre-push outcome stage: `off`, `warn`, or `block`. `off` skips that stage only (the trailer stage still runs) and prints a one-line notice when the file says warn or block. The same file's `outcome_rerun` (`sample`, `all`, or `none`; default `sample`), `outcome_sample` (default `20`), and `outcome_budget_s` (default `600`) have no environment override. An unknown outcome value falls back to `off`. | off |  |

## Project-level files (`.claude/`)

These are plain-markdown files you place in a project's `.claude/` directory. How injection works, the templates and worked examples are in [configuration.md](configuration.md); this table is the index.

| File | Customizes |
|---|---|
| `.claude/backlog-config.md` | Backlog entry schema options and pointer rule. ([template](../project-config-template/backlog-config.md)) |
| `.claude/debug-config.md` | Project-specific debug tools and log paths. ([template](../project-config-template/debug-config.md)) |
| `.claude/dev-flow-config.md` | Size rules, quality gates, build commands, special rules. ([template](../project-config-template/dev-flow-config.md)) |
| `.claude/dispatch-config.md` | Which dispatcher, reviewer and methodology autopilot delegates to when other plugins are installed. ([template](../project-config-template/dispatch-config.md)) |
| `.claude/dispatch-guard-config.md` | Per-project gate on expensive-model dispatch (dispatch-model-guard). ([template](../project-config-template/dispatch-guard-config.md)) |
| `.claude/doa-config.md` | Delegated Operations Authority presets for subagent dispatch. ([template](../project-config-template/doa-config.md)) |
| `.claude/doc-drift-config.md` | Doc-to-code domains the doc-sync skill audits. ([template](../project-config-template/doc-drift-config.md)) |
| `.claude/execution-boundary-config.md` | sanctioned_roots, protected refs and allow_sql for the opt-in exec-boundary hook. ([template](../project-config-template/execution-boundary-config.md)) |
| `.claude/finish-flow-config.md` | Closing-sequence overrides (merge target, archive procedure, per-size quality gate). ([template](../project-config-template/finish-flow-config.md)) |
| `.claude/knowledge-routing-config.md` | Where durable knowledge lands (handoff, learn, distill). ([template](../project-config-template/knowledge-routing-config.md)) |
| `.claude/loop.md` | Default prompt for a bare /loop. ([template](../project-config-template/loop.md)) |
| `.claude/model-routing-config.md` | Subagent model and mode per role. ([template](../project-config-template/model-routing-config.md)) |
| `.claude/next-config.md` | Work source paths for the next skill. ([template](../project-config-template/next-config.md)) |
| `.claude/owner-kernel-governance.json` | Project governance: mission-convergence enforcement and budgets, guidance defaults, red lines, rosters (the file name is historical; the file is live). ([template](../project-config-template/governance-config.md)) |
| `.claude/profiling-config.md` | Profiling tools and metrics collection. ([template](../project-config-template/profiling-config.md)) |
| `.claude/project-lifecycle-config.md` | Project paths and bootstrap/archive scripts. ([template](../project-config-template/project-lifecycle-config.md)) |
| `.claude/qc-gate-config.md` | Strength of the QC forcing function at push and finish-flow. ([template](../project-config-template/qc-gate-config.md)) |
| `.claude/quality-gate-config.md` | Test, scan and review commands. ([template](../project-config-template/quality-gate-config.md)) |
| `.claude/review-loop-config.md` | Engine roster and loop policy of the heterogeneous review pipeline. ([template](../project-config-template/review-loop-config.md)) |
| `.claude/skill-routing.md` | Maps keywords to your project domain skills. ([template](../project-config-template/skill-routing.md)) |
| `.claude/task-class-config.md` | Autonomous front-door routing and next-pick weighting. ([template](../project-config-template/task-class-config.md)) |
| `.claude/team-config.md` | Team role templates for your tech stack. ([template](../project-config-template/team-config.md)) |
| `.claude/test-integrity-config.md` | Mode and rules of the test-integrity gate. ([template](../project-config-template/test-integrity-config.md)) |
| `.claude/test-strategy-config.md` | Test commands, pyramid ratios, coverage thresholds. ([template](../project-config-template/test-strategy-config.md)) |
| `.claude/worktree-teardown-config.md` | Per-project cleanup seam for hetero worktrees. ([template](../project-config-template/worktree-teardown-config.md)) |

## Things that look like settings but are not wired

- `autopilot.costTracker` and `autopilot.protectedBranches` in Claude Code's `settings.json` (shown in `settings.example.json` and some hook comments) are not read by any code, and nothing turns them into environment variables. The working switches are `AUTOPILOT_COST_TRACKER=false` and `AUTOPILOT_PROTECTED_BRANCHES`.
- `config.json` can carry `{"<ENV_NAME>": "off"}` for the knobs of the live band's data sources; only the band's source manifest reads that, so it changes what the band reports, not whether the hook runs. Use the environment variable or the hook's own key to switch the hook off.
- The context-budget hook header still says `AUTOPILOT_HOOK_CONTEXT_BUDGET=1` enables it; the hook is default-on since v2.35.15 and its exit knob is `context_budget.mode: "off"` / `AUTOPILOT_CONTEXT_BUDGET_MODE=off`.

## Keeping this page honest

Run `node scripts/check-config-docs.js` (exit 0 in sync, 1 on drift, `--json` for machine output). It also runs in `scripts/preflight-release.sh`. When you add a setting, add it to `scripts/lib/config-keys.json` (`audience: "user"` with a `summary`, or `audience: "internal"` with a `class`) and, for a user setting, to the matching table above.
