# Autopilot Hooks

19 Claude Code hooks for runtime enforcement of development discipline (12 Tier A default-on + 7 Tier B opt-in) plus `session-start.sh` SessionStart priming.

## Architecture

```
hooks/
  _shared/
    secret-patterns.js     # Shared secret detection (used by audit-log + commit-secret-scan)
  hooks.json               # Hook registration (Tier A default-on)
  session-start.sh         # SessionStart priming (pre-existing)
  state-checkpoint.js      # Tier A — PreCompact, Node JSONL parser (v2.7.2+)
  state-checkpoint.sh.bak  # rollback artifact, v2.7.1 bash version
  large-file-warner.js     # Tier A
  suggest-compact.js       # Tier A
  cost-tracker.js          # Tier A
  audit-log.js             # Tier A
  session-summary.js       # Tier A
  log-error.js             # Tier A
  commit-secret-scan.js    # Tier A
  branch-protection.js     # Tier A
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

## Tier A — Default-On (12 hooks)

Registered in `hooks.json`. Active for all autopilot users.

| Hook | Event | Matcher | Behavior |
|------|-------|---------|----------|
| large-file-warner | PreToolUse | Read | >500KB warn, >2MB block. Bypasses if offset/limit set |
| suggest-compact | PostToolUse | Write\|Edit | Counter at `/tmp/claude-tool-count-{sid}`. Warns at 50/75/100 |
| cost-tracker | Stop | — | JSONL to `~/.claude/metrics/costs.jsonl`. Opt-out: `AUTOPILOT_COST_TRACKER=false` |
| audit-log | PostToolUse | Bash | Appends to `~/.claude/bash-commands.log`. Uses `_shared/secret-patterns.js` |
| session-summary | Stop | — | Writes to `~/.claude/sessions/{date}-{sid}.md` |
| log-error | PostToolUse | .* | Detects error keywords, appends to `~/.claude/error-log.md` |
| commit-secret-scan | PreToolUse | Bash | Scans `git diff --cached`. Uses `_shared/secret-patterns.js` |
| branch-protection | PreToolUse | Bash | Default: `^(main\|master)$`. Override: `AUTOPILOT_PROTECTED_BRANCHES` env |
| failure-escalation | PostToolUse | Bash | Tracks consecutive Bash failures per session; escalates to user (was undocumented in README pre-v2.7.2) |
| reload-watch | PostToolUse | .* | Detects on-disk catalog drift (`installed_plugins.json`, `dispatch-config.md`, `settings.local.json`); injects `/reload-plugins` reminder. Idempotent state at `~/.claude/plugins/.reload-watch-state.json` (v2.7.1) |
| state-checkpoint | PreCompact | * | Node JSONL parser extracts last 20 user/assistant turns from `transcript_path`, writes verbatim to `~/.autopilot/compaction-state.md` (no LLM compliance dependency); JSONL log at `~/.autopilot/.state-checkpoint.log` (rotate 1MB); visible failure diag inline + stderr (v2.7.2) |
| intent-capture | PostToolUse | .* | Per-cwd intent file at `~/.autopilot/intent/<sha1(realpath(cwd))>.json` for cross-session resume hint (read by `session-start.sh`). Tier A but env opt-out via `AUTOPILOT_INTENT_CAPTURE=false`. Circuit breaker: 10 consecutive fails → `~/.autopilot/intent-capture.disabled` flag (auto-clears at 24h or plugin version bump; manual clear: `rm` the flag) (v2.7.2) |

### Hook order on PostToolUse

Intra-`.*` matcher order is deterministic: `intent-capture → log-error → reload-watch`. intent-capture intentionally placed before log-error so the resume hint reflects state BEFORE any error capture noise.

`suggest-compact` runs in a separate `Write|Edit` matcher block, `failure-escalation` + `audit-log` in `Bash` matcher block — Claude Code may execute different matcher blocks in parallel / non-deterministic order. Only intra-matcher sequencing is guaranteed.

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

## Tier B — Opt-In (6 hooks)

Not in `hooks.json`. Enable by copying from `settings.example.json`.

| Hook | Event | Matcher | Behavior |
|------|-------|---------|----------|
| config-protection | PreToolUse | Write\|Edit | Blocks linter/formatter config edits |
| check-console | Stop | — | Warns about `console.log` in modified JS/TS |
| accumulator | PostToolUse | Write\|Edit | Collects edited file paths for batch-format |
| batch-format | Stop | — | Prettier + tsc on accumulated files. Timeout: 300s |
| test-runner | PostToolUse | Write\|Edit | Runs sibling vitest/jest test. Timeout: 60s |
| design-quality | PostToolUse | Write\|Edit | Warns on generic UI patterns. Timeout: 10s |
| mcp-health | PreToolUse + PostToolUseFailure | mcp__.* | Exponential backoff (30s base, 10min cap) |

## Secret Patterns

`_shared/secret-patterns.js` provides unified detection for:
- OpenAI (`sk-*`), Anthropic (`sk-ant-*`)
- GitHub PAT/OAuth/App (`ghp_*`, `gho_*`, `ghs_*`)
- AWS (`AKIA*`), Google API (`AIza*`)
- Slack (`xoxb-*`, `xoxp-*`), Stripe (`sk_live_*`)
- Inline: `--token`, `password=`, `sshpass -p`, `Authorization: Bearer`

## Source

Ported from [NYCU-Chung/my-claude-devteam](https://github.com/NYCU-Chung/my-claude-devteam) v1.1.0 (MIT) with adjustments from Ship A review:
- **C1 fix**: branch-protection regex → anchored whole-ref match + env override
- **mi1 fix**: secret patterns → shared module (prevents drift)
- **mi1 fix**: cost-tracker → opt-out for privacy
- **mi2 fix**: testing → 8/8 Tier A (was 3/8)
- **log-error**: rewritten from Bash to Node.js for consistency
