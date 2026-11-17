# P3 Bash output-cap correction — verification receipt

Date: 2026-11-17. Implementer task, XS, confined to the supplied worktree.
Base: `89d5715e24f52c30ae97aff63c093e122e168f3c`.
Branch: `feat/pmts-a-int-fix5`.

1. Task and acceptance: preserve the supplied probe verbatim; return a Bash
   response object with the combined stdout/stderr capped to 40 lines plus its
   pointer (30 for ledger matches), empty replacement stderr, and all other
   response keys preserved; pass through non-object Bash responses; retain MCP
   behavior; pass all three named commands and commit the result.
2. Located lines before editing:
   - `hooks/pm-output-cap.js:215`: `if (!isTargetPostTool(toolName)) return null;`
     — insert the Bash response guard immediately after it.
   - `hooks/pm-output-cap.js:238`: `[field]: truncated,`
     — return the spread Bash response object on that branch.
   - `hooks/pm-output-cap.test.js:109`: `tool_response: full,`
     and line 122: `const outLines = out.split('\n');`
     — use a Bash object fixture and assert its stdout and metadata.
3. Probe copied before code changes. `cmp` of the supplied source against
   `p3-probe.md` exited **0**, both immediately after copying and on the final pass.
4. Verification was incremental; tests changed before each production fix.
   Existing MCP, cap, file-content, permission, path, opt-in, and PreToolUse
   assertions were retained. Bash fixtures now use the real response shape.

| Run | Command | Exit | Result |
|---|---|---:|---|
| Baseline | `node --test hooks/pm-output-cap.test.js` | 0 | 11 passed, 0 failed |
| Object assertions, original production code | `node --test hooks/pm-output-cap.test.js` | 1 | 7 passed, 4 failed |
| Bash object return fix | `node --test hooks/pm-output-cap.test.js` | 0 | 11 passed, 0 failed |
| Non-object pass-through assertion, before guard | `node --test hooks/pm-output-cap.test.js` | 1 | 11 passed, 1 failed |
| Bash response guard | `node --test hooks/pm-output-cap.test.js` | 0 | 12 passed, 0 failed |
| Final tests | `node --test hooks/pm-output-cap.test.js` | 0 | 12 passed, 0 failed |
| Generate mirrors | `bash scripts/sync-all.sh` | 0 | `ok: true`, no generated file changes |
| Final mirror and contract checks | `bash scripts/sync-all.sh --check` | 0 | all 16 checks ran; no failures or skips |
| Whitespace check | `git diff --check` | 0 | no findings |

First red run, assertion output excerpt:

```text
PostToolUse Bash: 41 lines -> 40 + pointer and full 41 lines on disk (0700/0600)
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
'string' !== 'object'

PostToolUse Bash: caps combined stdout and stderr and preserves response metadata
AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
'string' !== 'object'
```

The other two failures in that run were the ledger and sanitized-path assertions
reading `stdout` from the old string result. The second red run failed only
`PostToolUse Bash: non-object tool_response passes through without writing`:
the string response incorrectly produced a replacement object instead of no output.

Final test output:

```text
✔ pm-console gate: requires first .git + schema autopilot.console/1 + mode program (5.441244ms)
✔ PostToolUse Bash: 41 lines -> 40 + pointer and full 41 lines on disk (0700/0600) (46.997676ms)
✔ PostToolUse Bash: caps combined stdout and stderr and preserves response metadata (42.587984ms)
✔ PostToolUse Bash: non-object tool_response passes through without writing (248.50215ms)
✔ PostToolUse Bash: 40 lines (with or without trailing newline) is untouched (80.142193ms)
✔ PostToolUse: ledger_search_pattern lowers cap to 30 when matched (130.183729ms)
✔ non-PM repo and opt-in off leave output untouched and write nothing (78.937264ms)
✔ PostToolUse mcp__*: preserves updatedMCPToolOutput shape; Read/Grep/Glob and non-text pass through (277.544925ms)
✔ symlinked pm-output directory fails open without writing through symlink (43.758488ms)
✔ unsafe or empty tool_use_id stays inside pm-output dir and falls back to state dir without XDG_RUNTIME_DIR (200.817392ms)
✔ PreToolUse fallback: preserves heredoc, exit 3, trailing # comment, truncates > 40 and passes <= 40 (199.433376ms)
✔ PostToolUse: empty ledger_search_pattern leaves 30-line rule off; pattern matches mcp__* tool names (88.458088ms)
ℹ tests 12
ℹ suites 0
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1513.435987
```

Mirror-generation completion (the earlier progress lines identified
sync-agent-bodies, sync-model-routing, and sync-codex-plugin-skills):

```text
── sync-opencode-plugin: bash scripts/sync-opencode-plugin.sh
── hook-harness-matrix: node scripts/hook-harness-matrix.js --write
{"mode":"generate","changed":false,"ran":["sync-agent-bodies","sync-model-routing","sync-codex-plugin-skills","sync-opencode-plugin","hook-harness-matrix"],"skipped":["sync-version (no generate cmd)","check-canonical-invariants (no generate cmd)","check-readme-parity (no generate cmd)","check-hook-inventory (no generate cmd)","check-config-docs (no generate cmd)","check-quota-adapters (no generate cmd)","check-claude-md-inventory (no generate cmd)","check-js-syntax (no generate cmd)","check-backlog-entries (no generate cmd)","check-contract-schema (no generate cmd)","check-profile-catalog (no generate cmd)"],"unknown_only":[],"failures":[],"ok":true}
```

Final check completion (the earlier progress lines identified sync-version,
sync-agent-bodies, and check-canonical-invariants):

```text
── sync-model-routing: bash scripts/sync-model-routing.sh --check
── sync-codex-plugin-skills: bash scripts/sync-codex-plugin-skills.sh --check
── sync-opencode-plugin: bash scripts/sync-opencode-plugin.sh --check
── check-readme-parity: node scripts/check-readme-parity.js
── check-hook-inventory: node scripts/check-hook-inventory.js --check
── hook-harness-matrix: node scripts/hook-harness-matrix.js --check
── check-config-docs: node scripts/check-config-docs.js
── check-quota-adapters: node scripts/check-quota-adapters.js
── check-claude-md-inventory: node scripts/check-claude-md-inventory.js
── check-js-syntax: node scripts/check-js-syntax.js
── check-backlog-entries: node scripts/check-backlog-entries.js --backlog project/backlog/BACKLOG.md
── check-contract-schema: node scripts/check-contract-schema.js
── check-profile-catalog: node scripts/build-profile-payload.js catalog --check --repo .
{"mode":"check","changed":false,"ran":["sync-version","sync-agent-bodies","check-canonical-invariants","sync-model-routing","sync-codex-plugin-skills","sync-opencode-plugin","check-readme-parity","check-hook-inventory","hook-harness-matrix","check-config-docs","check-quota-adapters","check-claude-md-inventory","check-js-syntax","check-backlog-entries","check-contract-schema","check-profile-catalog"],"skipped":[],"unknown_only":[],"failures":[],"ok":true}
```

Changed files, one reason each:

- `hooks/pm-output-cap.js` — guard malformed Bash responses and return the capped Bash response object with metadata preserved.
- `hooks/pm-output-cap.test.js` — pin the object shape, metadata, combined streams, no-write pass-through, and retain existing assertions with Bash object fixtures.
- `docs/plans/evidence/2026-11-17-pm-token-split/p3-probe.md` — verbatim supplied live-probe record.
- `docs/plans/evidence/2026-11-17-pm-token-split/p3-output-cap-verification.md` — record acceptance, red/green results, final command outputs, and scope.

Not done: no live Claude Code probe rerun, network access, MCP or PreToolUse
behavior change, merge, push, release, or version bump. No implementation items
deferred. The caller's independent review by another model family remains
outstanding; this receipt does not claim a review verdict.
