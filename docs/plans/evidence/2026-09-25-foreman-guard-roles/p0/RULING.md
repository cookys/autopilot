# P0 spike — can a PreToolUse hook read a subagent's own first prompt line?

Plan: `docs/plans/2026-09-25-foreman-guard-role-caps-reserve.md` §4 P0

## Verdict

`ROUTE-A-PRIME: HOLDS`

## Setup actually run

- Scratch project `$S/proj` with one `.claude/settings.json` hook: `PreToolUse` / matcher `Bash` → `node $S/dump.js`.
- `dump.js` appends raw stdin JSON to `payloads.jsonl`, and (when `agent_id` present) computes
  `path.join(path.dirname(transcript_path), session_id, 'subagents', 'agent-' + agent_id + '.jsonl')`
  and appends `{agent_id, derived, exists, first_line_prefix, transcript_path}` to `derived.jsonl`.
- Config isolation kept: driven with `CLAUDE_CONFIG_DIR=$S/cfg`, populated with only a copy of
  `~/.claude/.credentials.json` (never the real `~/.claude`); `$S/cfg` was deleted after the run.
- Scope: single run, Claude Code `2.1.282`, `entrypoint: sdk-cli`, `claude -p --permission-mode
  bypassPermissions`. Not repeated across harness versions or permission modes.
- Driver: `claude -p --model claude-sonnet-5 --permission-mode bypassPermissions "<prompt>"` from inside
  `$S/proj`, instructing the main agent to: run `echo main`; launch (A) one foreground
  `general-purpose` subagent (`Role: worker`) running `echo a1` then `echo a2`, which itself launches
  (C) one nested `general-purpose` subagent (`Role: worker`) running `echo c1`; and launch (B) one
  background `general-purpose` subagent (`Role: reviewer`) running `echo b1`. Ran to completion in ~15s,
  no hang, no PID kill needed.

Result: 5 PreToolUse Bash hook firings total — 1 for the main agent (`echo main`), 2 for the foreground
worker (`echo a1`, `echo a2`), 1 for the background reviewer (`echo b1`), 1 for the nested worker
(`echo c1`). Nesting was permitted (the SDK did not block an Agent-tool call from inside a subagent).

## Answers

1. **Yes.** Every subagent hook payload's `agent_id` (e.g. `a13b206c7c5c253cc`) equals the `agentId` field
   on the first (and every) line of that agent's own transcript file
   `<derived>/subagents/agent-<agent_id>.jsonl`, confirmed by grepping `"agentId":"..."` out of all three
   subagent transcript files and diffing against `payloads.jsonl`'s `agent_id` values — exact match in
   all 3 cases (foreground worker, background reviewer, nested worker).

2. **The root session file, unconditionally — even for the nested subagent.** All 5 payloads — main and
   all 3 subagent kinds — carry the identical `transcript_path` pointing at the top-level session file
   `.../<session_id>.jsonl`; a subagent's own transcript never appears as `transcript_path` in its own
   hook payload, and the nested worker C's `transcript_path` is the root session file, not its launching
   parent A's subagent file. `subagents/` is a **flat** directory keyed only by `agent-<agent_id>.jsonl` —
   nesting depth is not encoded in the path, so C's transcript sits beside A's, not under it. The derived
   child path (`dirname(transcript_path)/<session_id>/subagents/agent-<id>.jsonl`) **did exist already at
   the child's very first Bash call**, for all three subagent kinds — foreground, background, and nested
   (`derived.jsonl`: `exists: true` on all 4 subagent hook firings, including the first firing for the
   foreground worker's `echo a1`, the background reviewer's `echo b1`, and the nested worker's `echo c1`).
   So the file is written before the first tool call fires the hook, not lazily after.

3. **Yes, exactly.** `first_line_prefix` for every subagent shows the prompt verbatim starting
   `"Engine: sonnet\nRole: worker\n..."` (foreground and nested) or `"Engine: sonnet\nRole: reviewer\n..."`
   (background) — first line `Engine: sonnet`, second line `Role: …`, matching the required convention
   with no wrapping/mangling by the harness.

4. **`agent_type` is `"general-purpose"` for all three subagents** (foreground, background, nested alike —
   the type field does not distinguish role; only the prompt-embedded `Role:` line does). **No parent-id
   or other identity field appears anywhere** in the hook payload — the full key set on every subagent
   payload is `agent_id, agent_type, cwd, effort, hook_event_name, permission_mode, prompt_id, session_id,
   tool_input, tool_name, tool_use_id, transcript_path`; there is no `parent_agent_id` / `parentAgentId` /
   equivalent. From the hook payload alone, the only way to attribute a nested subagent to its launching
   parent is ordering/timing (the nested worker's hook firing came after its parent's) — this spike did
   not additionally check the nested subagent's own transcript file for a parent-shaped field (its
   `$S/cfg` copy was already removed per the cleanup step by the time this was reconsidered), so that
   narrower claim is scoped to the payload only, not to the transcript file's full contents.

5. **Yes.** The main agent's own `echo main` hook payload has no `agent_id` key at all (confirmed by
   listing sorted keys of all 5 payloads — the first has `agent_id` absent; all 4 subagent payloads have
   it present).

## Evidence files

- `payloads.jsonl` — all 5 raw PreToolUse Bash hook payloads (redact-scanned, clean).
- `derived.jsonl` — 4 derived-path probes (one per subagent-kind hook firing), each showing `exists: true`
  and the correct `first_line_prefix`.
- `dump.js`, `settings.json` — the hook implementation and wiring used.

Cleanup: `$S/cfg` (credentials copy) removed after the run.
