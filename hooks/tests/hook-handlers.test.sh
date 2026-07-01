#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const assert = require('node:assert');
const path = require('path');

const root = process.argv[2];
const { buildIntentCaptureRecord } = require(path.join(root, 'src/hooks/handlers/intent-capture'));
const {
  buildBaseContext,
  composeSessionStartContext,
  buildSessionStartOutput,
} = require(path.join(root, 'src/hooks/handlers/session-start'));

const record = buildIntentCaptureRecord({
  event: {
    platform: 'claude-code',
    event: 'post_tool_use',
    session_id: 'payload-session',
    cwd: '/repo',
    tool: 'Bash',
    tool_input: { command: 'echo ok' },
    input_source: 'stdin',
  },
  fallbackSessionId: 'fallback-session',
  hostname: 'host',
  nowIso: '2026-07-02T00:00:00.000Z',
  toolCount: 3,
  gitBranch: 'feat/test',
  summarizeToolInput: (tool, input) => `${tool} ${input.command}`,
});
assert.equal(record.session_id, 'payload-session');
assert.equal(record.hostname, 'host');
assert.equal(record.last_tool, 'Bash');
assert.equal(record.last_tool_source, 'stdin');
assert.equal(record.last_tool_input_summary, 'Bash echo ok');
assert.equal(record.tool_count_session, 3);
assert.equal(record.cwd, '/repo');
assert.equal(record.git_branch, 'feat/test');

const fallbackRecord = buildIntentCaptureRecord({
  event: {
    platform: 'claude-code',
    event: 'post_tool_use',
    cwd: '/repo',
    tool: 'Bash',
    tool_input: { command: 'echo fallback' },
    input_source: 'stdin',
  },
  fallbackSessionId: 'fallback-session',
  hostname: 'host',
  nowIso: '2026-07-02T00:00:00.000Z',
  toolCount: 4,
  gitBranch: 'feat/test',
  summarizeToolInput: (tool, input) => `${tool} ${input.command}`,
});
assert.equal(fallbackRecord.session_id, 'fallback-session');

const scalarInputRecord = buildIntentCaptureRecord({
  event: {
    platform: 'codex',
    event: 'post_tool_use',
    session_id: 'scalar-session',
    cwd: '/repo',
    tool: 'ScalarTool',
    tool_input: 'literal input',
    input_source: 'stdin',
  },
  fallbackSessionId: 'fallback-session',
  hostname: 'host',
  nowIso: '2026-07-02T00:00:00.000Z',
  toolCount: 5,
  gitBranch: 'feat/test',
  summarizeToolInput: (tool, input) => `${tool}:${typeof input}:${input}`,
});
assert.equal(scalarInputRecord.last_tool_input_summary, 'ScalarTool:string:literal input');

const base = buildBaseContext();
assert(base.includes('autopilot:dev-flow'));

const context = composeSessionStartContext({
  compactionRecovery: '\nRECOVERY',
  intentHint: '\nINTENT',
  disableWarning: '\nDISABLED',
  updateNotice: 'UPDATED',
  limit: 10000,
  keep: 9999,
});
assert(context.includes('RECOVERY'));
assert(context.includes('INTENT'));
assert(context.includes('DISABLED'));
assert(context.includes('UPDATED'));

const withHandoff = composeSessionStartContext({
  intentHint: '\nINTENT',
  handoffInjected: 'HANDOFF',
  injectHandoffSection: (current, handoff) => `${current}\nHANDOFF:${handoff}`,
});
assert(withHandoff.includes('HANDOFF:HANDOFF'));
assert(!withHandoff.includes('INTENT'));

const claudeOutput = buildSessionStartOutput({ context: 'ctx', claudePluginRoot: '/plugin' });
assert.equal(claudeOutput.hookSpecificOutput.hookEventName, 'SessionStart');
assert.equal(claudeOutput.hookSpecificOutput.additionalContext, 'ctx');

const rawOutput = buildSessionStartOutput({ context: 'ctx', claudePluginRoot: '' });
assert.equal(rawOutput.additional_context, 'ctx');

console.log('handlers_ok');
NODE
)"
EXIT=$?
assert_eq "$EXIT" "0" "hook handler assertions pass"
assert_contains "$OUT" "handlers_ok" "hook handler script reports success"

finalize_test
