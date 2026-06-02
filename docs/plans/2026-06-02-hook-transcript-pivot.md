# Plan — Hook Transcript Pivot (recover tool data without stdin)

> **Status**: spike done (GO) → foundation build → live timing gate → rewire/re-enable
> **Branch**: `feat/hook-transcript-pivot` · **Size**: L (~6-10hr) · **Created**: 2026-06-02
> **Source**: BACKLOG "Claude Code tool-event hooks get NO stdin pipe" path 3.

## 1. Problem
Claude Code PreToolUse/PostToolUse hooks get no stdin pipe — `fs.readFileSync('/dev/stdin')` throws ENXIO. Every hook depending on `tool_name`/`tool_input`/`tool_response` is broken (intent-capture `last_tool: <unknown>`, audit-log never writes, failure-escalation/cost-tracker/… inert). Disabled in v2.7.4. Re-probed 2.1.159 (2026-06-02): still broken. Anthropic unresponsive on #6305 → self-solve.

## 2. Spike result (2026-06-02) — GO
| Unknown | Result |
|---------|--------|
| transcript carries tool data | ✅ `assistant.message.content[].tool_use{name,input,id}` + `user.message.content[].tool_result{content,is_error,tool_use_id}` + top-level `toolUseResult` |
| recoverable to stdin shape | ✅ match `tool_result` by `tool_use_id` |
| path discovery w/o stdin | ✅ `CLAUDE_CODE_SESSION_ID` env (UUID) → locate `~/.claude/projects/*/<id>.jsonl` (glob avoids cwd-encoding assumption) |
| write timing vs PostToolUse | 🟢 strong: transcript flushed incrementally (current session 690 entries, prior-turn tool_use present within ~10s). Residual ms-race → confirmed by probe hook (step 4) before any blocker re-enable. |

## 3. Scope (PostToolUse only — PreToolUse is unrecoverable)
- **In**: PostToolUse hooks. intent-capture `last_tool` recovery; re-enable log-only disabled hooks (audit-log, cost-tracker, log-error, session-summary, failure-escalation, suggest-compact) rewired to transcript.
- **Out**: PreToolUse hooks (large-file-warner, branch-protection, commit-secret-scan) — tool hasn't run, no transcript entry; stay disabled (record in README why). No version pivot for those.

## 4. Phases
- **P1 — transcript-reader lib** (`hooks/transcript-reader-lib.js`): pure `findLatestToolEvent(jsonlText)` → `{tool_name,tool_input,tool_response,is_error,tool_use_id}|null`; `resolveTranscriptPath({sessionId,homedir})` (derive + UUID-glob fallback); `readLatestToolEvent({env,homedir})` wrapper. node:test against real-shape fixtures. **(verified-feasible — build now)**
- **P2 — timing probe hook** (`hooks/_transcript-timing-probe.js`): PostToolUse hook that runs a Bash/Read, then asserts the just-run tool appears as the latest transcript tool event. **User runs ONE fresh `claude` session to confirm timing GREEN before P3.** This is the live gate.
- **P3 — rewire intent-capture**: stdin-first, transcript-fallback when stdin empty/ENXIO → `last_tool` populated. Test.
- **P4 — re-enable log-only disabled hooks** rewired to the lib, one at a time, each smoke-verified writing its artifact (per BACKLOG re-enable order). hooks.json + README updates.
- **P5 — quality gate + finish**: validate, full test suite, preflight-portability, CHANGELOG, version bump, merge.

## 5. Verification / risk
- Lib is pure → unit-tested against fixtures mirroring real transcript JSON (captured this spike).
- Timing: P2 probe is the hard gate — **do not re-enable any blocker hook until the probe confirms the triggering tool is visible**. If probe fails (transcript not flushed pre-hook), the pivot is NO-GO → fall back to "stay disabled", document, close.
- Fail-open: every rewired hook keeps the fail-open contract (transcript missing/unparseable → silent skip, never block).
- Off-by-one: if latest entry not yet flushed, lib returns the previous tool — P2 quantifies how often (expect ~never given incremental writes).

## 6. Out of scope
PreToolUse recovery; upstream #6305; any non-tool-event hook.
