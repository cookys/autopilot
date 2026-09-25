# Hook advisories written to stderr with exit 0 never reach the model

Found 2026-09-25 while shipping v2.36.97 (foreman-guard). The official docs (code.claude.com/docs/en/hooks) say:
"Stderr from a hook that exits 0 goes to the debug log only, never the transcript, and Claude never sees it."
Probes proved that `hookSpecificOutput.additionalContext` does reach the model, including inside a subagent, and that it does so without any `permissionDecision`
(`docs/plans/evidence/2026-09-25-foreman-guard-roles/p1-probe*/`). foreman-guard was fixed in v2.36.97. A read-only inventory on 2026-09-25 found the
hooks below still sending model-facing text through stderr with exit 0. Depth-0 spot-checked cost-fuse:358, context-budget:191, and depth0-delegate-gate:250 and confirmed each.

## Class A — model-facing, exit 0, no other channel (the model never sees it)
| Hook | Event | Default | What never arrives |
|---|---|---|---|
| `hooks/cost-fuse.js:358` | PreToolUse | **on** (warn is the default mode) | "brain-tier spend ≥ $X — dispatch to hands" |
| `hooks/context-budget.js:191,234` | PostToolUse | **on** | the T1 nudge (T2 correctly uses exit 2) |
| `hooks/depth0-delegate-gate.js:250` | PreToolUse | **on** | the "N consecutive reads — delegate" nudge (the block path uses deny, correctly) |
| `hooks/reload-watch.js:95` | PostToolUse | **on** | "run /reload-plugins before next routing query" |
| `hooks/dispatch-model-guard.js:161,184` | PreToolUse Task/Agent | on (reachable only with mode=warn) | the warn-mode substitutes for ask/deny |
| `hooks/cost-tracker.js:134` | Stop | **on** | "write a handoff and /clear" (Stop channel, see below) |
| `hooks/orchestrator-edit-gate.js:115` | PreToolUse | opt-in | the warn-mode reason |
| `hooks/branch-protection.js:92` | PreToolUse Bash | opt-in | the protected-branch merge/rebase/reset warning |
| `hooks/large-file-warner.js:57` | PreToolUse Read | opt-in | the "use offset/limit" advisory |
| `hooks/design-quality.js:45` | PostToolUse | opt-in | the design advisory |
| `hooks/test-runner.js:84` | PostToolUse | opt-in | the test-failure report |
| `hooks/check-console.js:53`, `hooks/batch-format.js:57,71` | Stop | opt-in | console.log / prettier / tsc reports |

## Class D — needs a channel ruling first
- `hooks/mcp-health.js:87` (PostToolUseFailure): which channel is model-visible for this event?
- `hooks/dirty-protected-paths.js:220` (Stop, `systemMessage` plus a stderr mirror): does `systemMessage` reach the model, or only the human UI?
- **The Stop channel in general**: exit 2 on Stop BLOCKS stopping and continues the session, which is wrong for a pure advisory. The right channel for a Stop advisory is undocumented here, and it needs a probe like P1's.

## No allow-bypass elsewhere
Only `'deny'`/`'ask'` decisions are emitted. No other hook attaches a message via `permissionDecision:"allow"`.

## Tests that pin today's stderr-only behavior (must be re-expected)
- `hooks/tests/cost-fuse.test.sh` cases 4, 4b, 5d
- `hooks/orchestrator-edit-gate.test.js:460-465`
- `hooks/context-budget.test.js:157-161, 552-558`
- `hooks/tests/dispatch-model-guard.test.sh` cases 6d, 6e, 12, 21
- `hooks/tests/reload-watch-detects-mtime-change.test.sh:31`
- `hooks/tests/dirty-protected-paths.test.sh:42`

## Fix shape
- PreToolUse and PostToolUse: emit `{"hookSpecificOutput":{"hookEventName":<event>,"additionalContext":<text>}}` on stdout with NO `permissionDecision`, and keep the stderr copy for the debug log.
- Stop and PostToolUseFailure: probe first.

This is a **mechanism** change per CLAUDE.md (an already-stated warning starts actually reaching the model; the text does not change), so no eval is needed. Keep the message text byte-identical.
