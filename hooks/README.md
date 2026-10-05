# Autopilot Hooks

36 Claude Code hooks for runtime enforcement of development discipline: **23 default-on** (Tier A) + **13 opt-in** (Tier B) — zero disabled as of v2.25.2. Since v2.26.2 **all hooks are wired in `hooks.json`** (36 as of mods P1W W1c/W1d/W1e/HOOKQ) (the only place `${CLAUDE_PLUGIN_ROOT}` expands and where the path auto-tracks plugin updates); the 13 opt-in ones **self-gate default-OFF** via `_shared/opt-in.js` and do nothing until enabled in `~/.autopilot/config.json`. (Two Tier-A hooks are also inert by default: `session-handoff` needs handoff enabled; `version-drift-check` is silent outside a behind-upstream dev clone.) The canonical tally is derived from `hooks.json` (all wired hooks) + `opt-in-manifest.json` (which are opt-in) by [`../scripts/check-hook-inventory.js`](../scripts/check-hook-inventory.js) — run it to regenerate these tables, `--check` gates drift.

## Tool-event stdin: the `/dev/stdin` path is broken, but **fd 0 works** (fd-0 fix)

2026-05-14 diagnostic (re-confirmed at 2.1.159) found hook scripts that open the
**`/dev/stdin` path** hit ENXIO on this Linux + Bun-spawned-Node environment
(upstream #6305). The root cause is narrow: it's the *path open* that fails — the
payload **is** delivered on **file descriptor 0**. Reading fd 0 directly
(`fs.readFileSync(0, 'utf8')`) gets it. Verified end-to-end on Claude Code 2.1.186
(probe hook saw the JSON; a real PreToolUse hook returning exit 2 blocked the tool).

**v2.8.0 pivot** (PostToolUse): hooks recover tool data from the **session
transcript JSONL** via [`transcript-reader-lib.js`](transcript-reader-lib.js)
(`getToolEvent()` — fd-0/stdin-first, transcript-fallback; path discovery via
`CLAUDE_CODE_SESSION_ID`). See spike + design: `docs/projects/_archive/2026/06/2026-06-02-hook-transcript-pivot/`.

**Re-enabled via transcript-reader (v2.8.0):**

| Hook | Event | Recovered from transcript |
|------|-------|---------------------------|
| intent-capture | PostToolUse .* | `last_tool` (+ `last_tool_source`) |
| audit-log | PostToolUse .* | `tool_input.command` → bash-commands.log |
| log-error | PostToolUse .* | `tool_response` + `is_error` → error-log.md |
| failure-escalation | PostToolUse .* | Bash `is_error` → escalation counter |

**Re-enabled via fd-0 read (opt-in):** the v2.7.4 PreToolUse blockers + `session-summary`
were NOT permanently unrecoverable — they only needed to read fd 0 instead of the
`/dev/stdin` path (fd 0 carries the payload on Stop too — verified 2.1.186). Now
wired opt-in directly in `hooks.json`, default-off and self-gated at runtime via
`_shared/opt-in.js` against `hooks/opt-in-manifest.json` (the old
`settings.example.json` copy-paste route was unusable — `${CLAUDE_PLUGIN_ROOT}`
does not expand in user/project `settings.json`; corrected v2.26.1–2.26.2):

| Hook | Event | Fix |
|------|-------|-----|
| large-file-warner | PreToolUse Read | `fs.readFileSync(0)` + `/dev/stdin` fallback |
| branch-protection | PreToolUse Bash | `fs.readFileSync(0)` + `/dev/stdin` fallback |
| commit-secret-scan | PreToolUse Bash | `fs.readFileSync(0)` + `/dev/stdin` fallback |
| session-summary | Stop | `fs.readFileSync(0)` (content discarded; needs only git + env) |
| cost-tracker | Stop | reads `transcript_path` from the Stop payload + sums per-turn `usage` (v2.25.2 — the Stop payload itself has no `usage` field) |

> `suggest-compact` (PostToolUse `Write\|Edit`) was re-enabled in **v2.8.1** — it only counts tool calls (no `tool_name` needed, so no transcript recovery), the matcher does the filtering. The one fix was isolating the broken `/dev/stdin` read so the counter increments under ENXIO. See the Tier A table below.

**Always active** (stdin-tolerant / different event): state-checkpoint (PreCompact),
session-start.js (SessionStart), reload-watch (PostToolUse, mtime-based).

Diagnostic: [`_transcript-timing-probe.js`](_transcript-timing-probe.js) (opt-in;
wire into a PostToolUse hook to confirm intra-cycle write timing in a fresh session).
Tracking: `docs/BACKLOG.md`.

## Is my PostToolUse dispatch dead? (how to tell + recover)

Claude Code binds its PostToolUse **dispatch table** once at process boot. After a
`/clear` (or `/reload-plugins`) **within the same process**, that table is *not*
re-initialised — so every PostToolUse hook silently stops firing for the rest of
that session, with no error. (Verified; tracked in `docs/BACKLOG.md`.) An automatic
SessionStart detector for this is **deferred** — a SessionStart hook cannot reliably
distinguish "dead dispatch" from "fresh start with a stale intent file" (see the
BACKLOG spike entry). Until then, here is a **deterministic** manual check.

**Check (run from the session you're unsure about):**

1. Run any **`Bash`** tool call (the `bash-commands.log` signal only fires on the
   `Bash` matcher — a Write/Edit-only test would false-read "dead").
2. Check whether **`~/.claude/bash-commands.log` gained a new line** — this is the
   **primary** signal (`audit-log` has no self-disable, so a missing line means the
   PostToolUse subsystem itself didn't run).
   - Secondary: whether `~/.autopilot/intent/<sha1(realpath(cwd))>.json`'s
     `last_updated` advanced. Treat this as confirmatory only — `intent-capture` can
     self-disable via its circuit breaker, which would freeze `last_updated` even on
     a live dispatch (a false "dead").
3. If **neither advanced** after a Bash call, the PostToolUse hook subsystem is dead
   for this session.

This probe proves the **hook subsystem** is alive (or not) — not that any one hook
behaves correctly. It is valid only on **v2.8.0+** installs (`bash-commands.log`
did not exist before the transcript pivot, so its absence pre-v2.8.0 is not a "dead"
signal).

**Recover:** fully **exit and relaunch `claude`**. `/clear` and `/reload-plugins`
do **not** re-init the dispatch table — only a fresh process does.

## Architecture

```
hooks/
  _shared/
    secret-patterns.js     # Shared secret detection (used by audit-log + commit-secret-scan)
  hooks.json               # Hook registration (Tier A default-on)
  session-start.js         # SessionStart priming (pre-existing)
  state-checkpoint.js      # Tier A — PreCompact, Node JSONL parser (v2.7.2+)
  session-handoff.js       # Tier A (default-on wiring, inert unless handoff enabled) — SessionEnd, writes a machine handoff to ~/.autopilot on /clear (no repo writes)
  large-file-warner.js     # Tier B (opt-in)
  suggest-compact.js       # Tier A
  cost-tracker.js          # Tier A (default-on since v2.35.15) — transcript-sum (v2.25.2)
  dirty-protected-paths.js # Tier A (default-on, v2.36.11) — turn-end uncommitted-work reminder under protected_paths (Stop; Codex Stop+SessionEnd)
  session-tasks.js         # Tier A (default-on, mods P1W W1d) — TaskCreated/TaskCompleted/PostToolUse(Task*) -> <live>/tasks/<sid>.json
  awaiting-owner.js        # Tier A (default-on, mods P1W W1e) — permission/question/idle wait -> <live>/attention/<sid>.json
  ask-decision.js          # Tier A (default-on, mods P1W HOOKQ) — PreToolUse AskUserQuestion opens the scope's decision/1 file; answer / SessionEnd close it
  merge-task-status-lib.js # hosted in audit-log.js (lib, not a hook): a successful merge into the integration branch re-writes the task-status input
  live-session-lib.js      # shared helpers for the two live-state writers (lib, not a hook)
  cost-tracker-lib.js      # pure usage/cost aggregation (lib, not a hook)
  audit-log.js             # Tier A
  session-summary.js       # Tier B (opt-in)
  log-error.js             # Tier A
  commit-secret-scan.js    # Tier B (opt-in)
  branch-protection.js     # Tier B (opt-in)
  reload-watch.js          # Tier A — drift detection (v2.7.1+)
  intent-capture.js        # Tier A — per-cwd resume hint (v2.7.2+)
  config-protection.js     # Tier B (opt-in)
  check-console.js         # Tier B (opt-in)
  accumulator.js           # Tier B (opt-in)
  batch-format.js          # Tier B (opt-in)
  test-runner.js           # Tier B (opt-in)
  design-quality.js        # Tier B (opt-in)
  mcp-health.js            # Tier B (opt-in)
  dispatch-model-guard.js  # Tier A (default-on since v2.35.15) — remind (deny→agent decides) on guarded expensive engine / omitted model
  version-drift-check.js   # Tier A (default-on, silent outside dev clone) — behind-upstream advisory (SessionStart)
  runs-watch-autostart.js  # Tier A (default-on, silent outside a git repo) — live pointer + one project watcher (SessionStart)
  context-budget.js        # Tier A (default-on since v2.35.15) — real context-size signal, T1/T2 session-split advisories (v2.32.27)
  context-budget-lib.js    # pure backward usage scan + tier decision (lib, not a hook)
  orchestrator-edit-gate.js     # Tier B (opt-in) — depth-0 inline-edit gate for /l4-/l6 (v2.32.27)
  orchestrator-edit-gate-lib.js # pure gate decision (lib, not a hook)
```

## Exit Code Convention

| Code | Meaning | Used by |
|------|---------|---------|
| `0` | Allow / info only | All hooks |
| `1` | Warning (context injection) | branch-protection (mutations) |
| `2` | Hard block | large-file-warner, branch-protection, commit-secret-scan, config-protection, mcp-health |

## Hook Output Channels

Stderr on an exit-0 path never reaches the model; it goes only to the debug log. To put text in the model's context, a hook must use one of three channels:

1. **`hookSpecificOutput.additionalContext`** on PreToolUse / PostToolUse / PostToolUseFailure — same turn; the tool still runs (no `permissionDecision` on the advisory path).
2. **Exit 2** — forces an extra model turn. Reserved for T2-style escalations, not plain advisories.
3. **Group-S queue + `advisory-relay` on UserPromptSubmit** — deferred to the *next* prompt. Stop-time advisories have no clean same-turn channel: `additionalContext` on Stop re-fires in a loop, and Stop's own `systemMessage` is a human-UI-only channel (never model-visible).

Event support (probe evidence: [`docs/plans/evidence/2026-09-26-hook-channel-probe/`](../docs/plans/evidence/2026-09-26-hook-channel-probe/)):

| Event | Output | Model-visible? |
|-------|--------|----------------|
| PreToolUse / PostToolUse / PostToolUseFailure | `additionalContext` | Yes, same turn |
| Stop | `systemMessage` | No |
| Stop | `additionalContext` | Yes, but re-fires repeatedly — unusable |
| Stop | exit 2 | Yes, but forces another turn |
| UserPromptSubmit | plain stdout | Yes, on the session's next prompt |
| UserPromptSubmit | `additionalContext` | Yes, on the session's next prompt |

The queue/relay path uses `additionalContext` on UserPromptSubmit: it is the same channel group T already uses, and it stays out of human-facing `-p` stdout.

**Wording rule:** a model-facing advisory must name what it counted (a cumulative sum is not a level) and carry the contradicting-axis number when it is cheaply available (e.g. cost-tracker's cache-read sum prints the real context % from the live file) — a bare proxy gets relayed to the operator as fact.

## Tier A — Default-On (23 hooks)

Registered in `hooks.json`. Active for all autopilot users. All are non-destructive and safe for any project. (Three are wired here but **inert by default** — `session-handoff` no-ops unless handoff is enabled, `version-drift-check` is silent outside a behind-upstream dev clone, `run-approval-gate` does nothing until `run_approval.mode` is set — yet they MUST be wired in `hooks.json` because `${CLAUDE_PLUGIN_ROOT}` does not expand in a user's `settings.json`.)

| Hook | Event | Matcher | Behavior |
|------|-------|---------|----------|
| state-checkpoint | PreCompact | * | Node JSONL parser extracts last 20 user/assistant turns from `transcript_path`, writes verbatim to `~/.autopilot/compaction-state.md` (no LLM compliance dependency); JSONL log at `~/.autopilot/.state-checkpoint.log` (rotate 1MB); visible failure diag inline + stderr (v2.7.2) |
| session-start | SessionStart | startup\|clear\|compact | `session-start.js` priming: prints cross-session resume hint (reads intent-capture file) + `⚠ intent-capture hook disabled` warning when the self-disable flag is active |
| intent-capture | PostToolUse | .* | Per-cwd intent file at `~/.autopilot/intent/<sha1(realpath(cwd))>.json` for cross-session resume hint (read by `session-start.js`). Tier A but env opt-out via `AUTOPILOT_INTENT_CAPTURE=false`. Circuit breaker: 10 consecutive fails → `~/.autopilot/intent-capture.disabled` flag (auto-clears at 24h or plugin version bump; manual clear: `rm` the flag) (v2.7.2) |
| reload-watch | PostToolUse | .* | Detects on-disk catalog drift (`installed_plugins.json`, `dispatch-config.md`, `settings.local.json`); injects `/reload-plugins` reminder. Idempotent state at `~/.claude/plugins/.reload-watch-state.json` (v2.7.1). The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |
| audit-log | PostToolUse | .* | Appends to `~/.claude/bash-commands.log`. Uses `_shared/secret-patterns.js`. **Also the PostToolUse host (mods P1W PERF+STAMP)** for `awaiting-owner`'s end-of-wait work and the subagent last-tool stamp, run in this same process (no extra node spawn per tool call); their knobs (`AUTOPILOT_AWAITING_OWNER`, `AUTOPILOT_AGENT_ACTIVITY`) are read inside those modules, audit-log itself still has none. **Also hosts (mods P1W HOOKQ)** `ask-decision.js` `onPostToolUse` (closes the decision file after depth-0's `AskUserQuestion`; knob `AUTOPILOT_ASK_DECISION=off`) and `merge-task-status-lib.js`: for a session whose marker has a `root_run_id`, a successful Bash `git merge` / `git pull` / `gh pr merge` / `git push … develop` (quotes and heredoc bodies ignored; `merge --abort` ignored) that leaves the repo on its integration branch (origin/HEAD name, else local develop/main) runs `scripts/write-task-status-input.js --repo <top> --root-run-id <root>` DETACHED, at most once per (root, HEAD sha) (stamp `<live>/merge-task-status/<root>.json`). Depth-0 and subagents alike. Knob `AUTOPILOT_MERGE_TASK_STATUS=off`; fail-open. |
| log-error | PostToolUse | .* | Detects error keywords, appends to `~/.claude/error-log.md` |
| failure-escalation | PostToolUse | Bash | Tracks consecutive Bash failures per session; escalates to user (was undocumented in README pre-v2.7.2) |
| suggest-compact | PostToolUse | Write\|Edit | Counter at `/tmp/claude-tool-count-{sid}`. Nudges at 50, then every 25 (**unbounded**: 50, 75, 100, 125, …). Opt-out: `AUTOPILOT_SUGGEST_COMPACT=false`. Re-enabled v2.8.1 |
| session-handoff | SessionEnd | — | **Inert unless enabled** (`AUTOPILOT_HANDOFF_INJECT=1` or `~/.autopilot/config.json` `handoff_inject:true` — same switch as the reader). When enabled, on `/clear` or logout: auto-decides if meaningful work happened (dirty tree / commits since session start / active project touched / substantive transcript — ≥`AUTOPILOT_HANDOFF_MIN_USER_TURNS` (3) user turns or ≥`AUTOPILOT_HANDOFF_MIN_TOOL_CALLS` (12) tool calls) and, if so, writes a machine handoff snapshot to `~/.autopilot/handoff/<repo-hash>.md` (NEVER into the repo — `docs/HANDOFF.md` is untouched) via temp→atomic-rename. Fail-open; parses the transcript itself (no LLM). The **reader/inject** half (default-off gate) lives in `session-start.js`: injects the snapshot once (atomic consume-once, <10k cap) and suppresses the thin intent hint. Wired in `hooks.json` (not Tier B) so `${CLAUDE_PLUGIN_ROOT}` resolves |
| version-drift-check | SessionStart | startup\|clear\|compact | **Dev-clone only** — warns if your autopilot clone is behind its git upstream (no network — uses last fetch). Silent no-op for release / marketplace / non-git installs. Wired in `hooks.json` (not Tier B) so `${CLAUDE_PLUGIN_ROOT}` resolves |
| runs-watch-autostart | SessionStart, UserPromptSubmit | startup\|resume\|clear\|compact; all prompts | **Mods P1W W1c.** Gives a session in an **opted-in** git repo a live band: writes `~/.autopilot/live-pointer.json` and ensures the ONE project watcher through the same launch path as `session-mode.js set` (`startWatcherDetached` / `watchLaunchArgv`, lock form ii: foreground `flock -n` probe first, lock held ⇒ starts nothing, never a second watcher). **Scope**: never every git repo on the host — it starts only when the repo has autopilot project config (`.claude/*-config.md`, what `onboard` writes, e.g. `dispatch-config.md`; checked in the work tree and the main checkout) OR an unexpired orchestrator session-mode marker exists for its project_key OR this session's own unexpired marker exists OR `AUTOPILOT_RUNS_WATCH_AUTOSTART=1` forces it. **Plain-session marker (mods P1W MARKER)**: on SessionStart in an opted-in repo it ENSURES `<session-mode dir>/<session_id>.json` (`level: null` = a plain session, no orchestrator mode; `root_run_id` = a minted job root, same rule as `set --level`, mods P1W PLAINROOT) — created only when no unexpired marker exists, never overwritten (compact / resume keep a live l3-l6 marker byte-for-byte), an expired one is replaced (with a NEW root), an unreadable one is left alone; every mode gate reads `level: null` exactly like no marker, and watcher liveness ignores it. **Not opted in costs no process**: on UserPromptSubmit the signals (knob, `.claude/*-config.md` in the work tree or main checkout, this session's marker) are read by walking up to `.git` with no git spawn; git runs only after a signal is found (an opt-in carried only by another session's marker is honoured on SessionStart but no longer on later prompts — a behaviour change). SessionStart with the watcher already alive still ensures the marker, also without a spawn (the per-cwd cache carries project_key, repo_identity and repo_root). **Opt out: `AUTOPILOT_RUNS_WATCH_AUTOSTART=0`** (the same switch `session-mode.js set` honours; it also stops the plain-marker ensure). **Lifetime**: the watcher idle-exits by itself and counts a session as live while a marker is unexpired or `<live>/tasks/<sid>.json` / `<live>/attention/<sid>.json` of this project was updated within the idle window (stale files do not keep it alive); because a watcher may have idle-exited and SessionStart does not re-fire, the UserPromptSubmit ensure re-runs on each prompt (probe only; spawns only when the lock is free, at most one attempt per prompt). **Since mods P1W PERF the UserPromptSubmit ensure runs inside `advisory-relay.js`'s process** (via `awaiting-owner.js` `onUserPromptSubmit()`; no `runs-watch-autostart` process per prompt; `hooks.json` keeps only the SessionStart entry): a per-cwd cache `<live>/autostart/<sha1(cwd)>.json` plus the envelope's `writer.pid` and `/proc/<pid>/cmdline` answer "watcher alive" with no git, no flock and no spawn; anything doubtful takes the full path above. **SessionEnd does not stop the watcher** (other sessions may share it) — idle-exit handles it. Silent no-op outside a git repo; fail-open with at most one stderr line; never blocks. Optional tuning `AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S` / `AUTOPILOT_RUNS_WATCH_INTERVAL_S`. Detail: `references/mods.md` "Watcher launch". **WATCHVER (mods P1W)**: the watcher records `plugin_root` (realpath) + `plugin_version` in the envelope `writer` block; this hook (fast path and full path) compares them with its own and, on a mismatch (an update installed into a new version directory), verifies the pid is a live `status runs --watch --project <key>` whose argv root is the recorded root, SIGTERMs it, waits <= 2 s, then starts the current watcher. A record-less (older) writer is judged by its argv root; an unverifiable pid is never signalled. |
| foreman-guard | PreToolUse | Bash\|Monitor | **v2.35.15.** Ironlaw #6 in the loop for l4/l5/l6 SUBAGENTS (session-mode marker + payload `agent_id`) and, as of v2.36.97, a no-marker advisory for other `Engine:`-dispatched subagents; depth-0 and plain non-agent sessions are untouched: Bash cap 40 per agent (41st denied with the handoff directive — 一刀一命), foreground polling denied (`true`/`:` spin, `sleep N`, `while … sleep/grep`, `pgrep`/`ps -p`/`kill -0`, reading `/tasks/*.output`), `Monitor` denied. `run_in_background` waits are allowed. Modes `foreman_guard.mode` block\|warn\|off, `foreman_guard.bash_cap`; env `AUTOPILOT_FOREMAN_GUARD_MODE` / `_BASH_CAP`. State `~/.autopilot/foreman-guard/`. Fail-open. **v2.36.1**: also denies the next Bash when the subagent status line's `tasks[]` row for THIS agent (`tasks[].id === agent_id`) shows `tokenCount` at or past its own T2 (same `context_budget.{t1,t2}` knobs as `context-budget`, scaled to the row's `contextWindowSize`); 0/≥2 matching rows or a stale (>120s) tasks file ⇒ pass + a stderr diagnostic, never a gate. **v2.36.2**: a row whose `contextWindowSize` is not > 0 carries no window signal (pass, no diagnostic); the 0/≥2-row diagnostic prints once per agent per distinct text, not on every Bash call. Role from a line matching exactly `Role: foreman`/`Role: worker`/`Role: reviewer` among the first five lines of the dispatcher-written first message, re-derived every call, never cached. Caps default foreman 40 / worker 120 / reviewer 120 (`foreman_guard.role_caps` optional integer keys; env `AUTOPILOT_FOREMAN_GUARD_ROLE_CAPS` comma list e.g. `worker=120,reviewer=120`; env overlays config overlays defaults, per key). Last effective-reserve calls (min of `foreman_guard.reserve_calls` default 8 / `AUTOPILOT_FOREMAN_GUARD_RESERVE_CALLS` and floor(cap/2)) admit only close-out: `cd`; git status/diff/add/commit/log/show/rev-parse/restore --staged; `kill <pid>`; rm/rmdir under `/tmp` or `$TMPDIR`; `mkdir -p`; `ls`; `test`; writing a file (`cat >`, `tee`, `printf >`). Advisories (mode=warn, context-ceiling ambiguous-rows diagnostic, reserve-entry directive) reach the model via PreToolUse `additionalContext` on ALLOW. No l4/l5/l6 marker: an `Engine:`-prefixed first message is never denied by call count; one `additionalContext` advisory every `foreman_guard.advisory_every` calls (default 40, `AUTOPILOT_FOREMAN_GUARD_ADVISORY_EVERY`) to consider committing and handing off. Other subagents (no `Engine:` prefix) stay inert. |
| cost-fuse | PreToolUse | Bash\|Edit\|Write\|MultiEdit\|NotebookEdit | **v2.35.16.** Brain-tier (fable/opus) daily spend fuse; sums `costs.jsonl` by tier per UTC day; over threshold (`daily_usd_brain`, default $150) → warn (default) or block (never default); read-only Bash always allowed, and in warn mode only a single `scripts/dispatch-*` rail invocation (block mode exempts nothing beyond read-only); the warning shows `this session $a / host today $b`; modes `cost_fuse.mode`, `.daily_usd_brain`, `.tiers`; env `AUTOPILOT_COST_FUSE_MODE` / `_DAILY_USD`; state `~/.autopilot/cost-fuse/`; fail-open; never `ask`. The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |
| context-budget | PostToolUse | .* | **Default-on since v2.35.15** (opt-out `context_budget.mode: off` / `AUTOPILOT_CONTEXT_BUDGET_MODE=off`). Reads REAL context size (last assistant `usage` in transcript, backward scan 64KB→5MB). T1 (100k) stderr nudge; T2 (150k) escalated advisory via exit 2 (model-visible handoff directive). Thresholds/mode: `context_budget` in `~/.autopilot/config.json` or `AUTOPILOT_CONTEXT_BUDGET_T1/T2/MODE`. **v2.36.1**: when the statusline live file (`scripts/lib/live-state-dir.js`, `<live-dir>/context/<sid>.json`) is present, schema-valid, and fresh (≤120s), the REAL `context_window_size` is used instead of the inference ratchet (message says "(statusline)"); state dir moves under the resolved live-dir base (`<base>/context-budget/`, `AUTOPILOT_CONTEXT_BUDGET_DIR` still wins) — with no usable live file the behaviour, including the SSD state path, is byte-for-byte v2.36.0. **v2.36.2**: a live `context_window_size` that is not > 0 is treated as no live file (inference path), never as a `-0k` window. The T1 advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. **Live-file writer (mods P1W W2f)**: when `<live-dir>/context/<sid>.json` is absent or older than the 120 s reader bound, the hook writes it itself from the transcript's last usage row (same `schema_version: 1` as `statusline-live-tee.js`, plus `writer: "context-budget"` and `window_source: "statusline"\|"observed"\|"unknown"`). A fresh file written by anything else (the status line) is never overwritten, and another session's file is never touched. Window: a status-line window ever seen for this session > observed context above 200K (so 1M) > unknown (`context_window_size` and `used_percentage` are `null`, `total_input_tokens` still written). The hook ignores its own file as a window source (no `(statusline)` attribution). Opt-out for the writer only: `context_budget.live_write: false` in `~/.autopilot/config.json` or `AUTOPILOT_CONTEXT_BUDGET_LIVE_WRITE=off` (`context_budget.mode: off` still disables the whole hook). |
| dispatch-model-guard | PreToolUse | Task\|Agent | **Default-on since v2.35.15** (opt-out `AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off` or `- mode: off`). **Reminds, never dialogs** (v2.36.9, `mode: remind`; was ask): when subagent dispatch names a guarded expensive engine (default `fable`) it denies with a reason handing the decision to the agent — re-dispatch cheaper, or mark line 1 `Engine: <model> (intentional: <why>)` to proceed silently; **denies** (v2.36.2) when it omits `model:` (would inherit session model) — the reason tells depth-0 to re-dispatch with `model:`. `mode: ask` restores the dialog. Config: `guarded_models` / `on_missing_model` (`deny`\|`ask`\|`allow`) / `mode` (`remind`\|`ask`\|`warn`\|`off`) via `.claude/dispatch-guard-config.md`. The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |
| run-approval-gate | PreToolUse + PostToolUse | Task\|Agent | **v2.36.17, inert until configured.** One permission `ask` on the FIRST depth-0 dispatch of a `/l3`-`/l6` run, then silent for the rest of it. The PostToolUse half promotes the ask's `pending` record to the approval receipt, so consent is never model-asserted — though it proves "this hook asked and the call then ran", not that a dialog was answered (a host that auto-allows the call would still execute it; see the hook header). Skipped for subagents (`agent_id` present) and without an active session-mode marker. Enable: `run_approval.mode=ask-once` / `AUTOPILOT_RUN_APPROVAL_MODE`; state dir override `AUTOPILOT_RUN_APPROVAL_DIR`. Headless auto-denies `ask`, so leave it off for unattended runs |
| cost-tracker | Stop | — | **Default-on since v2.35.15** (opt-out `AUTOPILOT_COST_TRACKER=false`); prints a stderr warning when the session's cumulative cache-read passes `cost_tracker.cache_read_warn_tokens` (env `AUTOPILOT_COST_TRACKER_CACHE_READ_WARN`; default 50M) and each doubling after. The message names what it counted (cumulative sum over K calls, dollar share, `cost unknown` for unpriced models) and the real context % from the statusline live file (`context % unknown` when absent/stale); it recommends handoff + `/clear` only when that % is at/above `cost_tracker.context_clear_pct` (env `AUTOPILOT_COST_TRACKER_CLEAR_PCT`; default 50). Sums per-turn `usage` from `transcript_path` → `~/.claude/metrics/costs.jsonl` (cache-aware cost; per-session cursor avoids per-turn double-count). Opt-out `AUTOPILOT_COST_TRACKER=false`. The advisory is also queued for `advisory-relay` to deliver on the next prompt. |
| advisory-relay | UserPromptSubmit | — | **Default-on**; drains this session's group-S advisory queue (`<live-state>/advisory-queue/<sid>.jsonl`, written at Stop by cost-tracker / check-console / batch-format) and emits it as `additionalContext` at most once (verbatim `text` fields joined by newline). Inert when the queue is absent or empty. Caps: 20 entries / 8 KiB, oldest-first; entries older than 24h are dropped unread. Opt-out `AUTOPILOT_ADVISORY_RELAY=off` (no queue file access). **Also the UserPromptSubmit host (mods P1W PERF)** for awaiting-owner's prompt work and the runs-watch-autostart ensure; those have their own knobs (`AUTOPILOT_AWAITING_OWNER`, `AUTOPILOT_RUNS_WATCH_AUTOSTART=0`) and still run when the relay knob is off. Inert — exit 0, no stdout — when `session_id` is missing. Atomic rename-then-unlink drain. Never `permissionDecision`. Fail-open. |
| dirty-protected-paths | Stop (Claude); Stop + SessionEnd (Codex package) | — | **Default-on (v2.36.11)**; advisory only — `systemMessage` reminder, never a Stop `decision`. Fires when `git status` entries under `.claude/qc-gate-config.md` `protected_paths` (no config ⇒ whole tree) reach `min_files` (3) or `min_lines` (150), at most once per `interval_minutes` (30) per repo × session (state in the RAM-backed live dir). Knobs: `~/.autopilot/config.json` `dirty_tree_reminder{min_files,min_lines,interval_minutes}` or `AUTOPILOT_DIRTY_TREE_MIN_FILES/MIN_LINES/INTERVAL_MINUTES`; opt-out `AUTOPILOT_DIRTY_TREE_REMINDER=false`. Codex Stop/SessionEnd display of `systemMessage`/stderr is **unverified** (registration shipped; live-fire evidence pending, see CHANGELOG v2.36.11). It deliberately keeps `systemMessage` (a human-facing channel) and is not relayed via the group-S queue / `advisory-relay` — by design (KR4), not an oversight. |
| session-tasks | TaskCreated + TaskCompleted + PostToolUse | `TaskCreate\|TaskUpdate\|TaskList` (exact tool names; never `Task`/`Agent`) | **Default-on (mods P1W W1d).** Folds the task-tool events into `<live>/tasks/<sid>.json` (shape in the section below). Opt-out `AUTOPILOT_SESSION_TASKS=off`. |
| awaiting-owner | PermissionRequest + Notification + PostToolUse + Stop + UserPromptSubmit + SessionEnd + SubagentStart + SubagentStop | `.*` on PostToolUse (hosted by audit-log.js, no own process; returns before any lock unless a wait is pending); UserPromptSubmit leg hosted by advisory-relay.js, no own process | **Default-on (mods P1W W1e).** Maintains `<live>/attention/<sid>.json` while Claude Code waits on the human. **Also the session turn state (mods P1W TURN)**: `<live>/turn/<sid>.json` `{schema:"autopilot.session-turn/1", session_id, state, since, project_key|null, root_run_id|null}` — UserPromptSubmit writes `active`, Stop sets `ended` (since = now), SessionEnd removes it; tmp + rename, no lock, no extra process (the entries above host it); `project_key` comes from the per-cwd autostart cache and `root_run_id` from this session's own marker (null when unknown); payloads carrying `agent_id` never touch it; the UserPromptSubmit write also records `transcript_path` so the watcher can publish `<live>/turn-effective/<sid>.json` (watcher-owned) for an Escape interrupt, which fires no Stop. Same opt-out `AUTOPILOT_AWAITING_OWNER=off`. **SubagentStart (mods P1W FOREMAN2)**: writes the agent's stamp (`last_tool_at` now, `last_tool_name` null, no `ended_at`; the only path that clears an earlier `ended_at`; same knob, same script, no new hook). **SubagentStop (mods P1W FOREMAN)**: the payload's `agent_id` marks `<live>/agents/<sid>/<agent_id>.json` `ended_at` (own process entry in hooks.json, same script, no new hook; knob `AUTOPILOT_AGENT_ACTIVITY=off`); nothing else is touched. **TaskStop (mods P1W TASKSTOP)**: a successful `TaskStop` PostToolUse ends the stopped agent's existing stamp (same knob; no stamp for a shell task id, so nothing is created). **TaskStop2 (mods P1W TASKSTOP2)**: the same call also removes every `attention` `pending[]` entry whose `agent_id` equals `task_id` (a killed tool never reaches PostToolUse, so an approved dialog would otherwise linger as 要你決定); safe ids only, exact equality, under the attention lock, knob `AUTOPILOT_AWAITING_OWNER`. |
| ask-decision | PreToolUse (+ PostToolUse and SessionEnd legs hosted elsewhere) | `AskUserQuestion` (exact matcher) | **Default-on (mods P1W HOOKQ, plan R5.8).** Depth-0 asking the owner opens the scope's `decision/1` file (`<git-common-dir>/autopilot/decisions/<scope_key>.json`, written through `scripts/open-decision.js` `openDecision()`): `question` = first question (`（共 N 題）` appended when several), `options` = its labels (>= 2 else null), root = this session's marker root, `source: "ask_user_question"`. Subagent payloads (`agent_id`) never open one. The hook replaces only a file it opened; a hand-opened file (no `source`) is never touched. **Close**: the PostToolUse leg runs inside `audit-log.js`'s process (no new spawn), the SessionEnd leg inside `awaiting-owner.js`; both remove the file only when `opened_by_session` and `source` match (pointer `<live>/ask-decision/<sid>.json`), so another session's or a hand-opened file stays. An unanswered question stays. Opt-out `AUTOPILOT_ASK_DECISION=off`. Fail-open; never blocks the tool. |
| depth0-delegate-gate | PreToolUse | WebFetch\|WebSearch\|Read\|Grep\|Glob\|Bash\|Agent\|Task\|Skill | **v2.36.1.** Nudges DEPTH-0 (skipped when payload `agent_id` is present — foreman-guard's territory, not this gate's) away from long read bursts: counts consecutive read-class calls (`WebFetch`/`WebSearch`/`Read`/`Grep`/`Glob`, plus a `Bash` whose executable text — heredoc bodies/comments stripped — starts with `grep `/`rg `/`find `/`cat `/`sed -n`/`head `/`tail `) per session in `<live-dir>/depth0-gate/<sid>.json`; `Agent`/`Task`/`Skill` resets the counter to 0 (the burst was delegated); any other tool is a no-op. At `reads ≥ threshold` (default 8) and every `threshold` after: stderr nudge to delegate to an Explore/survey subagent (model: sonnet). In `block` mode only, when the statusline live main file is fresh and its `model.id` family (`scripts/lib/live-state-dir.js` `modelFamily`) is in `guarded_models` (default `fable`,`opus`) and `reads ≥ 2×threshold`: denies with the same JSON shape as `foreman-guard.js`. Without a live file the model is `unknown` — never blocks, only warns. Modes `depth0_delegate_gate.{mode,threshold,guarded_models}` via `~/.autopilot/config.json` or `AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE` (garbage/unset mode ⇒ `warn`); state dir override `AUTOPILOT_DEPTH0_GATE_DIR`. Fail-open. **v2.36.2**: the per-session `reads` counter is updated under the same exclusive-create lock `foreman-guard` uses, so a parallel read burst is counted in full. The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |

### Hook order on PostToolUse

Intra-`.*` matcher order is deterministic: `intent-capture → reload-watch → audit-log → log-error → failure-escalation` (per `hooks.json`). intent-capture intentionally placed before log-error so the resume hint reflects state BEFORE any error capture noise.

`suggest-compact` runs in a separate `Write|Edit` matcher block — Claude Code may execute different matcher blocks in parallel / non-deterministic order. Only intra-matcher sequencing is guaranteed.

### Testing PreCompact: `/compact` ≠ real PreCompact

The `/compact` **slash command** is not a faithful test of the `state-checkpoint`
PreCompact hook. Manually triggering `/compact` does **not** pipe a JSON payload to
the hook — it hits the same broken-stdin ENXIO as the tool-event hooks, which
`state-checkpoint.js` handles as a graceful `no_payload_skip` (logged, not
`catastrophic`). So `/compact` only proves the hook is *reachable*, not that its
extraction logic works. **Auto-compact** (the ~token-threshold trigger) **does**
pipe the payload, so the extraction path only exercises there. (Empirical source:
2026-05-14 method-B testing — see `docs/BACKLOG.md` "/compact slash-command silent
miss".) To exercise extraction deterministically, prefer the unit test
(`state-checkpoint` JSONL parser) over a manual `/compact`.

`hooks/tests/run.sh` defaults to a disposable git snapshot of the clone (`TMPDIR/autopilot-test-snapshot.*`) so a full suite cannot persist writes into the operator repo: the child runs inside the copy with origin neutered. That protects working-tree and object mutation by isolation; it does not prevent a child that writes the real repo by absolute path — G6's outer config-drift guard detects and restores local config drift (failing the suite) and only warns on refs/worktrees/status, while G7's polluted-baseline check refuses a test-identity `user.email` without editing it. Identity-gate hooks (`pre-commit` / `pre-merge-commit` / `pre-push`) still judge author/committer ident against the canonical email rule. Opt out of snapshotting with `AUTOPILOT_TEST_SNAPSHOT=0` (one stderr line), when `rsync` is missing (in-place with the same line plus reason), when `flock` is missing (same line plus reason), when the parent command line is `suite-oracle-lock.test.sh` (same line plus reason), or by running a single `*.test.sh` file which is never snapshotted.

### Self-Disable Recovery (intent-capture)

If `intent-capture.js` hits 10 consecutive failures, it writes `~/.autopilot/intent-capture.disabled` and subsequent runs silently skip. The flag is **automatically cleared** by:
- (a) plugin version bump — flag stores `plugin_version`; next run detects mismatch and clears
- (b) flag age > 24 hours — stale flag treated as resolvable, auto-cleared
- (c) manual `rm ~/.autopilot/intent-capture.disabled`

SessionStart prints a `⚠ intent-capture hook disabled` warning when the flag is active. Inspect `~/.autopilot/.state-checkpoint.log` for diagnostic JSONL records (also written by intent-capture's sibling state-checkpoint).

### v2.7.2 Rollback

If `state-checkpoint.js` or `intent-capture.js` misbehaves, downgrade plugin + clean sibling state:

```bash
# 1. Reinstall previous version via marketplace
/plugin update autopilot   # to v2.7.1 tag

# 2. Clean v2.7.2 sibling files (they're tolerated by v2.7.1 but stale)
rm -rf ~/.autopilot/intent/
rm -f ~/.autopilot/intent-capture.disabled
rm -f ~/.autopilot/.state-checkpoint.log

# 3. v2.7.1's bash state-checkpoint.sh resumes
```

Maintainer-side rollback (within this repo): `git revert <merge-sha>` on `develop` produces a new commit reversing the change. The v2.7.1 bash version is retrievable from git history (`git log -- hooks/state-checkpoint.sh`), no in-tree copy.

## Tier B — Opt-In (13 hooks)

Wired in `hooks.json` but **default-OFF** — each self-gates via `_shared/opt-in.js` and no-ops until you opt in. **Enable** by adding the stem to `~/.autopilot/config.json`:

```json
{ "hooks": { "branch-protection": true, "commit-secret-scan": true } }
```

Per-hook env override also works: `AUTOPILOT_HOOK_BRANCH_PROTECTION=1` (stem upper-cased, `-`→`_`). The opt-in set is the SSOT list in [`opt-in-manifest.json`](opt-in-manifest.json). (Do **not** copy hook commands into your `settings.json` — `${CLAUDE_PLUGIN_ROOT}` does not expand there, which is why this route replaced the old `settings.example.json` copy-paste.)

**Enabling is separate from configuring.** `~/.autopilot/config.json` only decides whether a hook *runs*. A hook's *behaviour* (e.g. `branch-protection`'s `autopilot.protectedBranches`, `cost-tracker`'s `autopilot.costTracker`) is still set in Claude `settings.json` under `autopilot.*` (Claude Code injects those as `AUTOPILOT_*` env vars) — the `autopilot.*` block remains in `settings.example.json`. Each configurable hook has a safe default, so enabling without configuring is fine.

| Hook | Event | Matcher | Behavior |
|------|-------|---------|----------|
| branch-protection | PreToolUse | Bash | Hard-blocks commit/force-push on `^(main\|master)$`; override `AUTOPILOT_PROTECTED_BRANCHES`. The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |
| exec-boundary | PreToolUse | Bash | Non-LLM deny gate at the execution boundary (four-layer K2): protected-ref force-push (defense-in-depth with branch-protection), recursive `rm` outside sanctioned roots, raw `DROP TABLE`/`TRUNCATE`, `sudo rm`. Allow-by-default; per-project config `.claude/execution-boundary-config.md` |
| commit-secret-scan | PreToolUse | Bash | Hard-blocks `git commit` when added staged hunk content contains secrets (`_shared/secret-patterns.js`); deletion-only cleanup passes, diff metadata is excluded, and diagnostics expose pattern names rather than secret values |
| large-file-warner | PreToolUse | Read | >500KB warn, >2MB block. Bypasses if offset/limit set. The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |
| config-protection | PreToolUse | Write\|Edit | Blocks linter/formatter config edits |
| session-summary | Stop | — | Appends cwd / git status / recent commits to `~/.claude/sessions/{date}-{sid}.md` |
| check-console | Stop | — | Warns about `console.log` in modified JS/TS. The advisory is also queued for `advisory-relay` to deliver on the next prompt. |
| accumulator | PostToolUse | Write\|Edit | Collects edited file paths for batch-format |
| batch-format | Stop | — | Prettier + tsc on accumulated files. Timeout: 300s. The advisory is also queued for `advisory-relay` to deliver on the next prompt. |
| test-runner | PostToolUse | Write\|Edit | Runs sibling vitest/jest test. Timeout: 60s. The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |
| design-quality | PostToolUse | Write\|Edit | Warns on generic UI patterns. Timeout: 10s. The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |
| mcp-health | PreToolUse + PostToolUseFailure | mcp__.* | Exponential backoff (30s base, 10min cap). The PostToolUseFailure advisory reaches the model via `hookSpecificOutput.additionalContext`; the PreToolUse unhealthy path remains an exit-2 deny (stderr only, byte-identical to origin/develop). |
| orchestrator-edit-gate | PreToolUse | Edit\|Write\|NotebookEdit | In /l4-/l6 sessions (marker via `scripts/session-mode.js`) depth-0 product edits are warned (default) or denied (`block`); subagents pass (payload `agent_id`, SPIKE-1). Allowlist: docs/projects, docs/plans, .claude, .autopilot. Mode: `orchestrator_edit_gate.mode` or `AUTOPILOT_ORCH_EDIT_GATE_MODE`. The advisory also reaches the model via `hookSpecificOutput.additionalContext` on the same event. |

> The three PreToolUse blockers + `session-summary` were re-enabled (opt-in) once the `/dev/stdin`→fd-0 fix landed — they read `fs.readFileSync(0)` instead of opening the broken `/dev/stdin` path. The PreToolUse blockers ship opt-in rather than default-on because hard-blocking commits/reads is a per-project policy call.

### dirty-protected-paths (default-on, v2.36.11)

Turn-end reminder that uncommitted work is piling up. Origin: a consuming repo carried ~7800 lines of uncommitted work across sessions for a week (2026-09-07) because commit cadence lived only in finish-flow prose — a session that never invoked finish-flow had no signal at all. Measures `git status --porcelain` entries filtered to the qc-gate `protected_paths` (same CSV `scripts/resolve-qc-gate.sh` reads; no config ⇒ whole tree, and the message says so), lines = `git diff --numstat HEAD` adds+dels for tracked entries + line counts of untracked text files (≤ 2 MB). Fires at `min_files` (3) **or** `min_lines` (150), at most once per `interval_minutes` (30) per repo × session. Output is a top-level `systemMessage` (Claude shows it to the user without blocking) mirrored on stderr; it never emits a Stop `decision`, so it can neither stop the turn nor force a continuation — same warn-only doctrine as expiry warnings. Fail-open on any error. The Codex package registers the same script on `Stop` and `SessionEnd`; how Codex surfaces the output is not yet verified live.

### session-tasks and awaiting-owner (default-on, mods P1W W1d / W1e)

Two writers feeding the `live` mod (under the resolved live base, `scripts/lib/live-state-dir.js`; tests always use a temp base). Both are fail-open (one stderr line, exit 0), serialise per file with the `scripts/lib/jsonl-store.js` PID lock, write atomically (tmp + rename), and write nothing when the knob is off or the payload has no `session_id`. Knobs: `AUTOPILOT_SESSION_TASKS=off`, `AUTOPILOT_AWAITING_OWNER=off` (also `false`/`0`/`no`).

`tasks/<sid>.json`, schema `autopilot.session-tasks/1`: `{schema, session_id, cwd, project_key|null, updated_at, first_created_at, tasks:[{id, subject, status: pending|in_progress|completed|deleted, started_seq}], counts:{total, completed, in_progress}, current:{id, subject}|null}`. `counts` exclude `deleted`; `current` is the in_progress task with the highest `started_seq`. Replays and out-of-order duplicates are no-ops (an unchanged fold is not rewritten). The task tools are gated for sonnet/opus unless `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`; without them no event arrives and no file is written, so a reader sees an absent file.

`attention/<sid>.json`, schema `autopilot.attention/1`, present only while something is pending, ONE ENTRY PER PENDING DIALOG (mods P1W FOREMAN2): `{schema, session_id, project_key|null, kind: permission|question|idle, tool_name|null, summary, since, updated_at, pending: [{agent_id|null, tool_name|null, input_digest|null, kind, summary, since, updated_at}]}`. The top-level `kind/tool_name/summary/since` are the OLDEST permission/question entry (idle only when none exists), so readers of the old shape keep working; `agent_id` null = the main thread; `input_digest` = sha256 of the canonical `tool_input` JSON, 16 hex. A file without `pending` is read as one main-thread entry. Starts: `PermissionRequest` (AskUserQuestion = question; adds or refreshes the entry keyed agent + tool + digest), `Notification idle_prompt` (idle; never at Stop, never over a real prompt). Ends (an entry removed; the file goes when none is left): `PostToolUse` ends that agent's exact entry, else its oldest same-tool entry (Tab-to-amend), never another agent's; `Stop` and `UserPromptSubmit` end main-thread entries and idle only (a subagent's dialog survives the main thread's Stop); `SubagentStop` ends that agent's entries; `SessionEnd` ends all. A human deny emits no event, so the entry lingers until the next prompt (main thread) or the agent's stop (subagent); an approved subagent dialog keeps showing until that agent's PostToolUse. Readers use `since` for age. `permission_prompt` Notifications only refresh `updated_at` of an existing file.

**Process hosting (mods P1W PERF).** `awaiting-owner` has no `PostToolUse` process of its own: `audit-log.js` (default-on, `.*`, no gate) calls `awaiting-owner.js`'s `handle()` in its process, which bails after one `stat` when no attention file exists. Likewise `advisory-relay.js` (the only UserPromptSubmit process) hosts awaiting-owner's UserPromptSubmit work and the `runs-watch-autostart` ensure through `awaiting-owner.js` `onUserPromptSubmit()` (both run even when `AUTOPILOT_ADVISORY_RELAY=off`; the ensure is outside the `AUTOPILOT_AWAITING_OWNER` knob; `AUTOPILOT_RUNS_WATCH_AUTOSTART=0` still disables it; the entry carries `timeout: 10`, the autostart entry's former bound). The live base on these hot paths comes from `live-session-lib.liveBase()` (resolveLiveDir's /proc/mounts branch, no `findmnt` fork; parity with resolveLiveDir asserted in `hooks/hook-hosting.test.js`). Measured per-event cost: `hooks/tests/hook-latency.js`.

`agents/<sid>/<agent_id>.json`, schema `autopilot.agent-activity/1` (subagent liveness stamp, mods P1W STAMP): written by the same PostToolUse host only when the payload carries `agent_id`: `{schema, session_id, agent_id, agent_type|null, last_tool_at, last_tool_name}`; tmp + rename, no lock, last writer wins, fail-open; the session's directory is removed at `SessionEnd`. It is tool-call age only, never a stage. Knob `AUTOPILOT_AGENT_ACTIVITY=off` (independent of `AUTOPILOT_AWAITING_OWNER`). **FOREMAN**: a `SubagentStart` writes the first stamp (so a foreman whose first tool call runs for minutes is visible; the one path that clears `ended_at`); a `SubagentStop` adds `ended_at` (first stop only; a successful `TaskStop` of a background agent does the same to its EXISTING stamp, `tool_input.task_id` = `agent_id`, since no SubagentStop fires for it, and never creates a file; a later stamp keeps it, so an ended agent is never resurrected). The band reads an un-ended stamp quiet < 180 s as 進行中 (`工頭在跑：…`) and >= 180 s as 疑似卡住 (`工頭 N 分沒有動作`).

### dispatch-model-guard (default-on since v2.35.15)

Mechanical enforcement of expensive-model dispatch discipline. On `Agent`/`Task` tool use, default `mode: remind` (v2.36.9; was `ask`) returns a native PreToolUse `permissionDecision: "deny"` when `tool_input.model` contains a guarded token (default `fable`, case-insensitive substring — so `claude-fable-5` matches); the reason reminds the dispatching agent and names its two legal moves — re-dispatch with a cheaper model, or keep the engine and mark line 1 `Engine: <model> (intentional: <why>)`, which the guard allows silently (stderr note). No human dialog is opened; the agent judges. `"deny"` (v2.36.2) when `model` is omitted (subagent would inherit the session model) — the reason tells the agent to re-dispatch with `model:`. Config keys in `.claude/dispatch-guard-config.md` (or `$DISPATCH_GUARD_CONFIG_OVERRIDE`): `guarded_models`, `on_missing_model` (`deny`|`ask`|`allow`), `mode` (`remind`|`ask`|`warn`|`off`; `ask` restores the dialog). Enable via `~/.autopilot/config.json` `{"hooks":{"dispatch-model-guard":true}}` (or `AUTOPILOT_HOOK_DISPATCH_MODEL_GUARD=1`). Fail-open on unreadable payloads. **Headless note:** under `claude -p`, an ask is effectively a refusal whose reason instructs re-dispatch with an explicit cheaper model.

## Secret Patterns

`_shared/secret-patterns.js` provides unified detection for:
- OpenAI (`sk-*`), Anthropic (`sk-ant-*`)
- GitHub PAT/OAuth/App (`ghp_*`, `gho_*`, `ghs_*`)
- AWS (`AKIA*`), Google API (`AIza*`)
- Slack (`xoxb-*`, `xoxp-*`), Stripe (`sk_live_*`)
- Inline: `--token`, `password=`, `sshpass -p`, `Authorization: Bearer`

When enabled, `commit-secret-scan` (opt-in) and the active `audit-log` share this module.

## Override

- **Disable a Tier A hook**: set `autopilot.<hookName> = false` in `settings.json`
- **Custom protected branches** (when `branch-protection` is enabled): set `AUTOPILOT_PROTECTED_BRANCHES` env var or `autopilot.protectedBranches` in settings
- **Disable cost tracking** (when `cost-tracker` is re-enabled): set `autopilot.costTracker = false`

## Source

Ported from [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam) v1.1.0 (MIT) with adjustments from Ship A review:
- **C1 fix**: branch-protection regex → anchored whole-ref match + env override
- **mi1 fix**: secret patterns → shared module (prevents drift)
- **mi1 fix**: cost-tracker → opt-out for privacy
- **mi2 fix**: testing → 8/8 Tier A (was 3/8)
- **log-error**: rewritten from Bash to Node.js for consistency

## Live context feed (v2.36.1, optional — the hooks degrade safely without it)

Hook stdin never carries the model id, the context window size, or per-subagent usage; the Claude Code
**status line** does. Three hooks read those values from two tmpfs "live files" that a status-line
program writes each tick:

| File | Writer | Consumers |
|---|---|---|
| `<base>/context/<sid>.json` — `model.id`, `context_window.{context_window_size,used_percentage,total_input_tokens,current_usage}` | `statusLine` command | `context-budget` (real window instead of inference), `depth0-delegate-gate` (model family for `block`) |
| `<base>/context/<sid>.tasks.json` — one row per running subagent: `id` (= hook `agent_id`), `model`, `contextWindowSize`, `tokenCount`, … | `subagentStatusLine` command | `foreman-guard` (foreman's own context ceiling) |

`<base>` is resolved by [`scripts/lib/live-state-dir.js`](../scripts/lib/live-state-dir.js). An explicit `$AUTOPILOT_LIVE_DIR` is
always honoured or refused, never replaced: a disk-backed override is used with one stderr warning per process (naming the path and
filesystem); an override that is a symlink, not a directory, owned by another user or has unsafe permissions makes the resolver throw
`LiveDirRefusedError` (hooks do nothing; the watcher does not start; `session-mode.js set` still writes its marker and reports
`watcher not started: … refused …`). With no override: `$XDG_RUNTIME_DIR/autopilot` (xdg) → `/run/user/<uid>/autopilot` (xdg-inferred, only when `XDG_RUNTIME_DIR` is
unset/empty and `/run/user/<uid>` already exists) → `/dev/shm/autopilot-<uid>` → `/tmp/autopilot-<uid>`, every candidate probed with
`findmnt` (or `/proc/mounts`) and accepted only when it is `tmpfs`/`ramfs`; if none is RAM-backed the base falls back to
`~/.autopilot` with one warning. Readers accept `schema_version` 1 only, treat a file older than 120 s as absent, and (v2.36.2) treat a
window size that is not > 0 as no window signal.

**Enabling it.** The reference writer is [codeforge](https://github.com/cookys/codeforge) ≥ the 2026-09-05 `main`
(`feat(live)` merge): `codeforge statusline` writes the main file whenever it is your `statusLine`; run
`codeforge install --subagent-statusline` once to add the `subagentStatusLine` entry (opt-in; it renders nothing,
keeps Claude Code's default rows). Any other status-line program can write the same two files — the schema is in
`docs/plans/_archive/2026/09/2026-09-05-statusline-live-context-feed.md` §2.5. Check: `ls "$XDG_RUNTIME_DIR/autopilot/context/"`
shows `<session_id>.json` after one tick.

**Keeping a status line that is not codeforge.** Put `scripts/statusline-live-tee.js` in front of it: it writes the
main live file from the JSON Claude Code pipes in, then runs your program with the same stdin and passes its output
and exit status through. Set `statusLine.command` to
`node <autopilot>/scripts/statusline-live-tee.js -- <your status line> [args…]`
(nothing after `--` ⇒ it writes the file and prints nothing). It does not write the subagent tasks file.

**Without it** (no writer, older codeforge, another host): `context-budget` and `foreman-guard` behave exactly as
v2.36.0 (inference ratchet, Bash cap only), and `depth0-delegate-gate` warns but never blocks. Silence is never a
gate pass. Knobs: `AUTOPILOT_LIVE_DIR` (override base, still probed), `AUTOPILOT_CONTEXT_BUDGET_DIR`,
`AUTOPILOT_DEPTH0_GATE_DIR` (test seams).

## hooks.json wiring notes (moved out of the JSON)

`hooks/hooks.json` carries no `"//"` comment keys: Claude Code 2.1.288 logs an `[ERROR] … unknown keys "//" … ignored` line per key on every start. The notes that used to sit inside the entries live here, in file order, keyed by event and command. Behaviour is unchanged.

| Event | Command | Note |
|-------|---------|------|
| SessionStart | `version-drift-check.js` | version-drift-check: dev-clone-only advisory (silent no-op for release/marketplace users). Wired here — NOT in settings.example.json — because ${CLAUDE_PLUGIN_ROOT} only expands inside the plugin's own hooks.json, never in a user's settings.json. |
| SessionStart | `runs-watch-autostart.js` | runs-watch-autostart (mods P1W W1c): default-on. Writes the live pointer and ensures the ONE project watcher (flock -n probe, same launch path as session-mode.js set) so dev-flow and plain sessions get a live band. No-op outside a git repo; fail-open; never blocks. AUTOPILOT_RUNS_WATCH_AUTOSTART=0 to opt out. |
| SessionEnd | `session-handoff.js` | session-handoff (writer): OPT-IN behaviour gated at runtime — no-ops unless handoff is enabled (env AUTOPILOT_HANDOFF_INJECT=1 OR ~/.autopilot/config.json {"handoff_inject":true}); the SAME switch enables the session-start reader/inject half. Wired here — NOT in settings.example.json — because ${CLAUDE_PLUGIN_ROOT} only expands inside the plugin's own hooks.json, never in a user's settings.json (so the old copy-into-settings.json instruction produced a literal unresolved path). |
| UserPromptSubmit | `advisory-relay.js` | advisory-relay: deferred-relay half of the group-S Stop advisory queue (cost-tracker / check-console / batch-format). Default-on; AUTOPILOT_ADVISORY_RELAY=off to opt out. Inert on an absent/empty queue (safe default-on). |
| PreToolUse | `opt-in-multiplexer.js PreToolUse` | D6: single per-event opt-in multiplexer. Spawns only enabled opt-in handlers (branch-protection, exec-boundary, commit-secret-scan, large-file-warner, config-protection, mcp-health pre, orchestrator-edit-gate). Disabled stems start zero children. |
| PreToolUse | `ask-decision.js` | mods P1W HOOKQ: depth-0 asking the owner (AskUserQuestion, exact matcher so no other tool pays) opens the scope's decision/1 file; the answer closes it from audit-log.js's PostToolUse process and SessionEnd from awaiting-owner.js. AUTOPILOT_ASK_DECISION=off to opt out. |
| PreToolUse | `foreman-guard.js` | v2.35.15 default-on: foreman-guard (ironlaw #6 in the loop — Bash cap / polling deny / Monitor deny for l4-l6 subagents; inert elsewhere; AUTOPILOT_FOREMAN_GUARD_MODE=off to opt out) + dispatch-model-guard (was opt-in; AUTOPILOT_DISPATCH_MODEL_GUARD_MODE=off to opt out). |
| PreToolUse | `cost-fuse.js` | v2.35.16 default-on: cost-fuse — brain-tier (fable/opus) daily spend fuse, warn-mode default; AUTOPILOT_COST_FUSE_MODE=off to opt out. |
| PreToolUse | `run-approval-gate.js PreToolUse` | v2.36.17 wired default-on but INERT until configured: run-approval-gate — one confirmation per /l3-/l6 run, then autonomous to the end of it. Fires only at depth-0 (skipped when payload.agent_id is present) with an active session-mode marker and run_approval.mode=ask-once; the PostToolUse half records the approval receipt (the tool ran ⇒ the human allowed it). Default off; ~/.autopilot/config.json {"run_approval":{"mode":"ask-once"}} or AUTOPILOT_RUN_APPROVAL_MODE to enable. |
| PreToolUse | `depth0-delegate-gate.js` | v2.36.1 default-on: depth0-delegate-gate — nudges depth-0 (never a subagent; skipped when payload.agent_id is present) away from long read bursts toward delegating to an Explore/survey subagent; warns by default, denies only in block mode against a fresh guarded-model live file. AUTOPILOT_DEPTH0_DELEGATE_GATE_MODE=off to opt out. |
| PostToolUse | `opt-in-multiplexer.js PostToolUse` | D6: PostToolUse opt-in multiplexer (accumulator, test-runner, design-quality). |
| PostToolUse | `context-budget.js` | v2.35.15 default-on (was opt-in): context-budget — real context size, T1 100k nudge / T2 150k handoff directive; AUTOPILOT_CONTEXT_BUDGET_MODE=off or config context_budget.mode=off to opt out. |
| PostToolUse | `audit-log.js (hosting awaiting-owner end signal + subagent stamp)` | mods P1W PERF+STAMP: audit-log also hosts awaiting-owner's PostToolUse end signal and the subagent last-tool stamp (no extra node spawn per tool call); knobs AUTOPILOT_AWAITING_OWNER / AUTOPILOT_AGENT_ACTIVITY. |
| PostToolUse | `run-approval-gate.js PostToolUse` | v2.36.17: run-approval-gate PostToolUse half — the approval RECEIPT. A Task/Agent that reached PostToolUse was allowed by the human at the PreToolUse ask, so this records the run as approved and the gate stays silent for the rest of it. Inert unless run_approval.mode=ask-once. |
| PostToolUse (task tools) | `session-tasks.js` | mods P1W W1d default-on: session-tasks — folds the task-tool events into <live>/tasks/<sid>.json; AUTOPILOT_SESSION_TASKS=off to opt out. Exact tool-name matcher (never Task/Agent). Task tools need CLAUDE_CODE_ENABLE_TODO_TOOLS=1 for sonnet/opus. |
| PostToolUseFailure | `opt-in-multiplexer.js PostToolUseFailure` | D6: PostToolUseFailure opt-in multiplexer (mcp-health failure). |
| Stop | `opt-in-multiplexer.js Stop` | D6: Stop opt-in multiplexer (session-summary, check-console, batch-format). |
| Stop | `cost-tracker.js` | v2.35.15 default-on (was opt-in): cost-tracker — per-session cost rows + cumulative cache-read warning; AUTOPILOT_COST_TRACKER=false to opt out. |
| Stop | `dirty-protected-paths.js` | v2.36.11 default-on: dirty-protected-paths — turn-end reminder when uncommitted work under protected_paths passes min_files/min_lines; systemMessage only, never a Stop decision; AUTOPILOT_DIRTY_TREE_REMINDER=false to opt out. |
| TaskCreated / TaskCompleted | `session-tasks.js` | mods P1W W1d default-on: session-tasks — folds the task-tool events into <live>/tasks/<sid>.json; AUTOPILOT_SESSION_TASKS=off to opt out. Exact tool-name matcher (never Task/Agent). Task tools need CLAUDE_CODE_ENABLE_TODO_TOOLS=1 for sonnet/opus. |
| PermissionRequest / Notification | `awaiting-owner.js` | mods P1W W1e default-on: awaiting-owner — maintains <live>/attention/<sid>.json while Claude Code waits on the human (permission / question / idle); AUTOPILOT_AWAITING_OWNER=off to opt out. |
