#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

FIXTURES_DIR="$(cd "$(dirname "$0")/fixtures" && pwd)"

OUT="$(node - "$REPO_ROOT" "$FIXTURES_DIR" <<'NODE'
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const fixtures = process.argv[3];
const { EVENT_MAP, normalizeClaudeHookEvent, normalizeCodexHookEvent } = require(path.join(root, 'src/hooks/normalize'));

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtures, name), 'utf8'));
}

const claudeTool = normalizeClaudeHookEvent(readFixture('claude-post-tool-use.json'), {
  nowIso: '2026-07-02T00:00:00.000Z',
});
assert.equal(claudeTool.schema_version, 1);
assert.equal(claudeTool.platform, 'claude-code');
assert.equal(claudeTool.event, 'post_tool_use');
assert.equal(claudeTool.host_event, 'PostToolUse');
assert.equal(claudeTool.session_id, 'claude-session-1');
assert.equal(claudeTool.cwd, '/repo');
assert.equal(claudeTool.tool, 'Bash');
assert.deepEqual(claudeTool.tool_input, { command: 'echo ok' });
assert.equal(claudeTool.session.transcript_path, '/tmp/claude-transcript.jsonl');

const claudeStart = normalizeClaudeHookEvent(readFixture('claude-session-start.json'), {
  nowIso: '2026-07-02T00:00:00.000Z',
});
assert.equal(claudeStart.event, 'session_start');
assert.equal(claudeStart.source, 'startup');
assert.equal(claudeStart.tool, null);

const codexTool = normalizeCodexHookEvent(readFixture('codex-post-tool-use.json'), {
  nowIso: '2026-07-02T00:00:00.000Z',
});
assert.equal(codexTool.platform, 'codex');
assert.equal(codexTool.event, 'post_tool_use');
assert.equal(codexTool.model, 'gpt-test');
assert.equal(codexTool.permission_mode, 'default');
assert.equal(codexTool.turn_id, 'turn-1');
assert.equal(codexTool.tool, 'Bash');

const codexStart = normalizeCodexHookEvent(readFixture('codex-session-start.json'), {
  nowIso: '2026-07-02T00:00:00.000Z',
});
assert.equal(codexStart.event, 'session_start');
assert.equal(codexStart.source, 'startup');
assert.equal(codexStart.tool, null);

assert.equal(normalizeCodexHookEvent({ hook_event_name: 'PermissionRequest' }).event, 'permission_request');
assert.equal(normalizeCodexHookEvent({ hook_event_name: 'UserPromptSubmit' }).event, 'user_prompt_submit');
assert.equal(normalizeCodexHookEvent({ hook_event_name: 'SubagentStart' }).event, 'subagent_start');
assert.equal(normalizeCodexHookEvent({ event: 'PreToolUse' }).event, 'pre_tool_use');
assert.equal(normalizeCodexHookEvent({ event: 'pre_tool_use' }).event, 'pre_tool_use');
assert.equal(normalizeCodexHookEvent({ hook_event_name: 'UnexpectedSecretEvent' }).event, 'unknown');

const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas/hook-event.schema.json'), 'utf8'));
const schemaEvents = schema.properties.event.enum.filter((event) => event !== 'unknown').sort();
assert.deepEqual([...new Set(Object.values(EVENT_MAP))].sort(), schemaEvents);

const probeText = fs.readFileSync(path.join(root, 'platforms/codex/hook-probe/plugin/hooks/probe.js'), 'utf8');
const mapMatch = probeText.match(/const EVENT_MAP = \{([\s\S]*?)\};/);
assert(mapMatch, 'probe EVENT_MAP block exists');
const probeMap = {};
for (const match of mapMatch[1].matchAll(/^\s*([A-Za-z0-9_]+): '([^']+)'/gm)) {
  probeMap[match[1]] = match[2];
}
assert.deepEqual(probeMap, EVENT_MAP);

console.log('normalizers_ok');
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "hook normalizer assertions pass"
assert_contains "$OUT" "normalizers_ok" "hook normalizer script reports success"

finalize_test
