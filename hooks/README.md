# Autopilot Hooks

21 Claude Code hooks for runtime enforcement of development discipline: **8 default-on** (Tier A, wired in `hooks.json`) + **13 opt-in** (Tier B, copied from `settings.example.json`) — zero disabled as of v2.25.2. The canonical tally is derived from `hooks.json` + `settings.example.json` by [`../scripts/check-hook-inventory.js`](../scripts/check-hook-inventory.js) — run it to regenerate these tables, `--check` gates drift.

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
`CLAUDE_CODE_SESSION_ID`). See spike + design: `docs/projects/2026-06-02-hook-transcript-pivot/`.

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
shipped opt-in in `settings.example.json` (Tier B):

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
  session-handoff.js       # Tier B (opt-in) — SessionEnd, auto-writes docs/HANDOFF.md on /clear
  state-checkpoint.sh.bak  # rollback artifact, v2.7.1 bash version
  large-file-warner.js     # Tier B (opt-in)
  suggest-compact.js       # Tier A
  cost-tracker.js          # Tier B (opt-in) — transcript-sum (v2.25.2)
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
```

## Exit Code Convention

| Code | Meaning | Used by |
|------|---------|---------|
| `0` | Allow / info only | All hooks |
| `1` | Warning (context injection) | branch-protection (mutations) |
| `2` | Hard block | large-file-warner, branch-protection, commit-secret-scan, config-protection, mcp-health |

## Tier A — Default-On (8 hooks)

Registered in `hooks.json`. Active for all autopilot users. All are non-destructive and safe for any project.

| Hook | Event | Matcher | Behavior |
|------|-------|---------|----------|
| state-checkpoint | PreCompact | * | Node JSONL parser extracts last 20 user/assistant turns from `transcript_path`, writes verbatim to `~/.autopilot/compaction-state.md` (no LLM compliance dependency); JSONL log at `~/.autopilot/.state-checkpoint.log` (rotate 1MB); visible failure diag inline + stderr (v2.7.2) |
| session-start | SessionStart | startup\|clear\|compact | `session-start.js` priming: prints cross-session resume hint (reads intent-capture file) + `⚠ intent-capture hook disabled` warning when the self-disable flag is active |
| intent-capture | PostToolUse | .* | Per-cwd intent file at `~/.autopilot/intent/<sha1(realpath(cwd))>.json` for cross-session resume hint (read by `session-start.js`). Tier A but env opt-out via `AUTOPILOT_INTENT_CAPTURE=false`. Circuit breaker: 10 consecutive fails → `~/.autopilot/intent-capture.disabled` flag (auto-clears at 24h or plugin version bump; manual clear: `rm` the flag) (v2.7.2) |
| reload-watch | PostToolUse | .* | Detects on-disk catalog drift (`installed_plugins.json`, `dispatch-config.md`, `settings.local.json`); injects `/reload-plugins` reminder. Idempotent state at `~/.claude/plugins/.reload-watch-state.json` (v2.7.1) |
| audit-log | PostToolUse | Bash | Appends to `~/.claude/bash-commands.log`. Uses `_shared/secret-patterns.js` |
| log-error | PostToolUse | .* | Detects error keywords, appends to `~/.claude/error-log.md` |
| failure-escalation | PostToolUse | Bash | Tracks consecutive Bash failures per session; escalates to user (was undocumented in README pre-v2.7.2) |
| suggest-compact | PostToolUse | Write\|Edit | Counter at `/tmp/claude-tool-count-{sid}`. Nudges at 50, then every 25 (**unbounded**: 50, 75, 100, 125, …). Opt-out: `AUTOPILOT_SUGGEST_COMPACT=false`. Re-enabled v2.8.1 |

### Hook order on PostToolUse

Intra-`.*` matcher order is deterministic: `intent-capture → log-error → reload-watch`. intent-capture intentionally placed before log-error so the resume hint reflects state BEFORE any error capture noise.

`suggest-compact` runs in a separate `Write|Edit` matcher block, `failure-escalation` + `audit-log` in `Bash` matcher block — Claude Code may execute different matcher blocks in parallel / non-deterministic order. Only intra-matcher sequencing is guaranteed.

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

Maintainer-side rollback (within this repo): `git revert <merge-sha>` on `develop` produces a new commit reversing the change. `hooks/state-checkpoint.sh.bak` is preserved as in-tree archaeology, not part of the canonical rollback path.

## Tier B — Opt-In (13 hooks)

Not in `hooks.json`. Enable by copying from `settings.example.json` (`hooks-opt-in-examples`).

| Hook | Event | Matcher | Behavior |
|------|-------|---------|----------|
| cost-tracker | Stop | — | Sums per-turn `usage` from `transcript_path` → `~/.claude/metrics/costs.jsonl` (cache-aware cost; per-session cursor avoids per-turn double-count). Opt-out `AUTOPILOT_COST_TRACKER=false` |
| branch-protection | PreToolUse | Bash | Hard-blocks commit/force-push on `^(main\|master)$`; override `AUTOPILOT_PROTECTED_BRANCHES` |
| commit-secret-scan | PreToolUse | Bash | Hard-blocks `git commit` when `git diff --cached` contains secrets (`_shared/secret-patterns.js`) |
| large-file-warner | PreToolUse | Read | >500KB warn, >2MB block. Bypasses if offset/limit set |
| config-protection | PreToolUse | Write\|Edit | Blocks linter/formatter config edits |
| session-summary | Stop | — | Appends cwd / git status / recent commits to `~/.claude/sessions/{date}-{sid}.md` |
| session-handoff | SessionEnd | — | On `/clear` or logout: auto-decides if meaningful work happened (dirty tree / commits since session start / active project touched / substantive transcript — ≥`AUTOPILOT_HANDOFF_MIN_USER_TURNS` (3) user turns or ≥`AUTOPILOT_HANDOFF_MIN_TOOL_CALLS` (12) tool calls) and, if so, writes/updates `docs/HANDOFF.md` in the repo cwd from the transcript (idempotent overwrite). Does nothing otherwise. Fail-open; parses the transcript itself (no LLM dependency). Opt-in because it writes into your repo |
| check-console | Stop | — | Warns about `console.log` in modified JS/TS |
| accumulator | PostToolUse | Write\|Edit | Collects edited file paths for batch-format |
| batch-format | Stop | — | Prettier + tsc on accumulated files. Timeout: 300s |
| test-runner | PostToolUse | Write\|Edit | Runs sibling vitest/jest test. Timeout: 60s |
| design-quality | PostToolUse | Write\|Edit | Warns on generic UI patterns. Timeout: 10s |
| mcp-health | PreToolUse + PostToolUseFailure | mcp__.* | Exponential backoff (30s base, 10min cap) |

> The three PreToolUse blockers + `session-summary` were re-enabled (opt-in) once the `/dev/stdin`→fd-0 fix landed — they read `fs.readFileSync(0)` instead of opening the broken `/dev/stdin` path. The PreToolUse blockers ship opt-in rather than default-on because hard-blocking commits/reads is a per-project policy call.

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
