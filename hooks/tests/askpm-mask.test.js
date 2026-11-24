#!/usr/bin/env node
'use strict';
// A credential-looking string in a prompt or a reply never reaches askpm.jsonl.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { handle, readRows } = require(path.resolve(__dirname, '..', 'askpm-log.js'));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'askpm-mask-'));
const homeDir = path.join(root, 'home');
const stateDir = path.join(root, 'state');
const cwd = path.join(root, 'repo');
fs.mkdirSync(path.join(homeDir, '.autopilot'), { recursive: true });
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(path.join(cwd, '.claude'), { recursive: true });
fs.mkdirSync(path.join(cwd, '.git'), { recursive: true });
fs.writeFileSync(path.join(cwd, '.claude', 'console.json'), JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' }));
fs.writeFileSync(path.join(cwd, '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.writeFileSync(path.join(homeDir, '.autopilot', 'config.json'), JSON.stringify({ hooks: { 'askpm-log': true } }));
const env = { HOME: homeDir, AUTOPILOT_STATE_DIR: stateDir, AUTOPILOT_HOOK_ASKPM_LOG: '1' };
const prevHome = process.env.HOME;
const prevLog = process.env.AUTOPILOT_HOOK_ASKPM_LOG;
process.env.HOME = homeDir;
process.env.AUTOPILOT_HOOK_ASKPM_LOG = '1';
try {
  const fake = ['Zq', '8Kx', 'Lm3Np', '7Rt2Vw', 'Yb5Hc', '9Df4Gj', '1Sa6Pe'].join('');
  handle({ hook_event_name: 'UserPromptSubmit', cwd, session_id: 'sess-m', prompt: 'use this ' + fake + ' please' }, env);
  handle({ hook_event_name: 'Stop', cwd, session_id: 'sess-m', turn: 1, last_assistant_message: 'got ' + fake }, env);
  const raw = fs.readFileSync(path.join(stateDir, 'askpm.jsonl'), 'utf8');
  assert.strictEqual(raw.includes(fake), false, 'raw credential string reached askpm.jsonl');
  assert.ok(readRows(env).some(r => r.kind === 'ask' && r.text.includes('〔已遮罩〕')));
  console.log('askpm-mask: ok');
} finally {
  process.env.HOME = prevHome;
  if (prevLog === undefined) delete process.env.AUTOPILOT_HOOK_ASKPM_LOG;
  else process.env.AUTOPILOT_HOOK_ASKPM_LOG = prevLog;
  fs.rmSync(root, { recursive: true, force: true });
}
