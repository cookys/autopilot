'use strict';

// scheduled-wakeup-guard: a self-scheduled wakeup is not a fresh authorisation.
// Run: node hooks/scheduled-wakeup-guard.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOOK = path.join(__dirname, 'scheduled-wakeup-guard.js');
const WAKEUP_LINE = '這是你自己排的喚醒，不是授權；執行前先對照最新的 attested 指令和 STOP 狀態。';
const GO_LINE = '排程的 prompt 帶有 go／核准／卡號：喚醒時要重新確認那個 go 仍有效（沒有被 STOP 或更新的指令取代），不要照 prompt 直接執行。';
const GO_TEXT = 'PM go switch 4 seats pool MARKER_7f3a9c';

function hangarEntry(content) {
  return {
    type: 'user',
    userType: 'external',
    entrypoint: 'cli',
    turnOrigin: 'scheduled',
    wakeupSource: 'schedule_wakeup',
    promptSource: 'system',
    isMeta: true,
    scheduledTaskId: '49fb44f6',
    scheduledFireId: 'dfd95ba2-0900-4080-970b-613fa78b2014',
    queuePriority: 'later',
    permissionMode: 'bypassPermissions',
    message: { role: 'user', content },
  };
}

function run(payload, env = {}) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function parsed(r) {
  assert.equal(r.status, 0, `exit ${r.status} stderr=${r.stderr}`);
  assert.equal(r.stdout.includes('permissionDecision'), false, r.stdout);
  if (r.stdout === '') return null;
  const out = JSON.parse(r.stdout);
  assert.equal(Object.hasOwn(out, 'permissionDecision'), false);
  assert.equal(JSON.stringify(out).includes('permissionDecision'), false);
  return out;
}

function assertSilent(r, prompt) {
  const out = parsed(r);
  assert.equal(out, null);
  assert.equal(r.stderr.includes(prompt), false);
}

function assertLine(r, event, line, prompt) {
  const out = parsed(r);
  assert.ok(out && out.hookSpecificOutput, r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, event);
  assert.equal(out.hookSpecificOutput.additionalContext, line);
  assert.equal(r.stdout.includes(prompt), false, 'stdout echoed the prompt');
  assert.equal(r.stderr.includes(prompt), false, 'stderr echoed the prompt');
}

function withTranscript(t, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swg-'));
  const transcript = path.join(dir, 'session.jsonl');
  fs.writeFileSync(transcript, lines.map((row) => JSON.stringify(row)).join('\n') + '\n');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return transcript;
}

test('transcript hangar wakeup whose content equals the stdin prompt injects the non-authorising line', (t) => {
  const transcript = withTranscript(t, [
    { type: 'assistant', message: { content: [{ type: 'text', text: 'earlier' }] } },
    hangarEntry(GO_TEXT),
  ]);
  const r = run({
    hook_event_name: 'UserPromptSubmit',
    prompt: GO_TEXT,
    transcript_path: transcript,
  });
  assertLine(r, 'UserPromptSubmit', WAKEUP_LINE, GO_TEXT);
});

test('stdin top-level turnOrigin scheduled injects the line without a transcript', () => {
  const r = run({
    hook_event_name: 'UserPromptSubmit',
    turnOrigin: 'scheduled',
    prompt: GO_TEXT,
  });
  assertLine(r, 'UserPromptSubmit', WAKEUP_LINE, GO_TEXT);
});

test('stdin top-level wakeupSource schedule_wakeup injects the line without a transcript', () => {
  const r = run({
    hook_event_name: 'UserPromptSubmit',
    wakeupSource: 'schedule_wakeup',
    prompt: GO_TEXT,
  });
  assertLine(r, 'UserPromptSubmit', WAKEUP_LINE, GO_TEXT);
});

test('text parts of the wakeup entry joined equal the stdin prompt', (t) => {
  const transcript = withTranscript(t, [
    hangarEntry([{ type: 'text', text: 'PM go ' }, { type: 'text', text: 'switch MARKER_parts' }]),
  ]);
  const prompt = 'PM go switch MARKER_parts';
  const r = run({ hook_event_name: 'UserPromptSubmit', prompt, transcript_path: transcript });
  assertLine(r, 'UserPromptSubmit', WAKEUP_LINE, prompt);
});

test('last user entry turnOrigin peer emits nothing', (t) => {
  const prompt = '<channel source="fleet">peer MARKER_peer</channel>';
  const transcript = withTranscript(t, [
    hangarEntry(prompt),
    {
      type: 'user',
      turnOrigin: 'peer',
      message: { content: prompt },
    },
  ]);
  const r = run({ hook_event_name: 'UserPromptSubmit', prompt, transcript_path: transcript });
  assertSilent(r, prompt);
});

test('last user entry turnOrigin task_notification emits nothing', (t) => {
  const prompt = 'task notice MARKER_task';
  const transcript = withTranscript(t, [
    { type: 'user', turnOrigin: 'task_notification', message: { content: prompt } },
  ]);
  const r = run({ hook_event_name: 'UserPromptSubmit', prompt, transcript_path: transcript });
  assertSilent(r, prompt);
});

test('last user entry turnOrigin human emits nothing', (t) => {
  const prompt = 'human MARKER_human';
  const transcript = withTranscript(t, [
    { type: 'user', turnOrigin: 'human', message: { content: prompt } },
  ]);
  const r = run({ hook_event_name: 'UserPromptSubmit', prompt, transcript_path: transcript });
  assertSilent(r, prompt);
});

test('wakeup entry whose content differs from the stdin prompt emits nothing', (t) => {
  const prompt = 'stdin MARKER_mismatch';
  const transcript = withTranscript(t, [hangarEntry('transcript MARKER_other')]);
  const r = run({ hook_event_name: 'UserPromptSubmit', prompt, transcript_path: transcript });
  assertSilent(r, prompt);
  assert.equal(r.stdout.includes('transcript MARKER_other'), false);
  assert.equal(r.stderr.includes('transcript MARKER_other'), false);
});

test('missing transcript exits 0 with no output', () => {
  const prompt = 'no file MARKER_missing';
  const r = run({
    hook_event_name: 'UserPromptSubmit',
    prompt,
    transcript_path: path.join(os.tmpdir(), 'swg-missing-does-not-exist.jsonl'),
  });
  assertSilent(r, prompt);
  const absent = run({ hook_event_name: 'UserPromptSubmit', prompt });
  assertSilent(absent, prompt);
});

test('a wakeup older than the last 64 KiB is ignored', (t) => {
  const prompt = 'old wakeup MARKER_tail';
  const pad = { type: 'assistant', message: { content: 'x'.repeat(200) } };
  const lines = [hangarEntry(prompt)];
  while (Buffer.byteLength(lines.map((row) => JSON.stringify(row)).join('\n'), 'utf8') < 70 * 1024) lines.push(pad);
  const transcript = withTranscript(t, lines);
  const r = run({ hook_event_name: 'UserPromptSubmit', prompt, transcript_path: transcript });
  assertSilent(r, prompt);
});

test('PreToolUse prompt with PM go injects the advisory and does not deny', () => {
  const prompt = 'PM go 01M7… switch pool';
  const r = run({
    hook_event_name: 'PreToolUse',
    tool_name: 'ScheduleWakeup',
    tool_input: { prompt },
  });
  assertLine(r, 'PreToolUse', GO_LINE, prompt);
});

test('PreToolUse prompt with a card id injects the advisory', () => {
  const prompt = 'd-4b987a63 answered';
  const r = run({
    hook_event_name: 'PreToolUse',
    tool_name: 'ScheduleWakeup',
    tool_input: { prompt },
  });
  assertLine(r, 'PreToolUse', GO_LINE, prompt);
});

test('PreToolUse prompt check CI status emits nothing', () => {
  const prompt = 'check CI status';
  const r = run({
    hook_event_name: 'PreToolUse',
    tool_name: 'ScheduleWakeup',
    tool_input: { prompt },
  });
  assertSilent(r, prompt);
});

test('PreToolUse prompt ongoing does not match go inside a word', () => {
  const prompt = 'ongoing';
  const r = run({
    hook_event_name: 'PreToolUse',
    tool_name: 'ScheduleWakeup',
    tool_input: { prompt },
  });
  assertSilent(r, prompt);
});

test('AUTOPILOT_SCHEDULED_WAKEUP_GUARD=off emits nothing and does not read a transcript', () => {
  const r = run({
    hook_event_name: 'UserPromptSubmit',
    turnOrigin: 'scheduled',
    prompt: GO_TEXT,
    transcript_path: path.join(os.tmpdir(), 'swg-off-must-not-open'),
  }, { AUTOPILOT_SCHEDULED_WAKEUP_GUARD: 'off' });
  assertSilent(r, GO_TEXT);
});
