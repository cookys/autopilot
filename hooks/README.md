# Autopilot Hooks

14 Claude Code hooks for runtime enforcement of development discipline.

## Architecture

```
hooks/
  _shared/
    secret-patterns.js     # Shared secret detection (used by audit-log + commit-secret-scan)
  hooks.json               # Hook registration (Tier A default-on)
  session-start.sh         # SessionStart priming (pre-existing)
  large-file-warner.js     # Tier A
  suggest-compact.js       # Tier A
  cost-tracker.js          # Tier A
  audit-log.js             # Tier A
  session-summary.js       # Tier A
  log-error.js             # Tier A
  commit-secret-scan.js    # Tier A
  branch-protection.js     # Tier A
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
