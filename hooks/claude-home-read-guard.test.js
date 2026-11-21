'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-home-guard-'));
const home = path.join(temp, 'homes', 'seat');
const operator = path.join(temp, 'homes', 'operator');
const cwd = path.join(temp, 'project');
fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
fs.mkdirSync(path.join(operator, '.claude'), { recursive: true });
fs.mkdirSync(cwd, { recursive: true });
const ownHash = cwd.replace(/[^a-zA-Z0-9]/g, '-');
const env = { HOME: home, AUTOPILOT_CLAUDE_HOME_ROOTS: path.join(temp, 'homes'), CLAUDE_PROJECT_DIR: cwd };
const { handle } = require('./claude-home-read-guard.js');
function call(tool_name, tool_input, extraEnv = {}) {
  const old = {};
  for (const [k, v] of Object.entries({ ...env, ...extraEnv })) { old[k] = process.env[k]; process.env[k] = v; }
  try { return handle({ hook_event_name: 'PreToolUse', tool_name, tool_input, cwd }); }
  finally { for (const k of Object.keys({ ...env, ...extraEnv })) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } }
}
function denied(result) { assert.equal(result?.hookSpecificOutput?.permissionDecision, 'deny'); }
function allowed(result) { assert.equal(result, null); }

test('incident: Read of another home .claude settings is denied', () => denied(call('Read', { file_path: `${operator}/.claude/settings.json` })));
test('own project transcript allowed, other project transcript denied', () => {
  allowed(call('Read', { file_path: `${home}/.claude/projects/${ownHash}/abc.jsonl` }));
  denied(call('Read', { file_path: `${home}/.claude/projects/-elsewhere/abc.jsonl` }));
  allowed(call('Read', { file_path: `${home}/.claude/projects/-elsewhere/abc.jsonl` }, { AUTOPILOT_CLAUDE_HOME_EXCEPTION: 'usage' }));
  denied(call('Read', { file_path: `${home}/.claude/projects/-elsewhere/settings.json` }, { AUTOPILOT_CLAUDE_HOME_EXCEPTION: 'usage' }));
});
test('Bash recursive home scans denied unless excluded; bounded project scan allowed', () => {
  denied(call('Bash', { command: 'grep -r SessionStart ~' }));
  allowed(call('Bash', { command: 'grep -r foo ~ --exclude-dir=.claude' }));
  denied(call('Bash', { command: 'find /home -name settings.json' }));
  allowed(call('Bash', { command: 'rg foo ~/projects' }));
});
test('Bash direct paths, redirections, and cd context denied', () => {
  for (const command of ['cat ~/.claude/settings.json', 'jq . $HOME/.claude/settings.json', "python3 -c 'print(1)' < ~/.claude/settings.json", 'echo secret > ~/.claude/settings.json', 'cd ~/.claude && cat settings.json']) denied(call('Bash', { command }));
});
test('Grep and Glob protected roots denied', () => {
  denied(call('Glob', { path: '~', pattern: '**/settings.json' }));
  denied(call('Grep', { path: `${operator}/.claude`, pattern: 'SessionStart' }));
});
test('non-default config and profile directories are allowed', () => {
  const profile = path.join(temp, 'profiles', 'a');
  allowed(call('Read', { file_path: `${profile}/settings.json` }, { CLAUDE_CONFIG_DIR: profile }));
  allowed(call('Read', { file_path: `${home}/.claude-profiles/x/settings.json` }));
});
test('own memory writes allowed; config writes denied except updater card', () => {
  allowed(call('Write', { file_path: `${home}/.claude/projects/${ownHash}/memory/x.md` }));
  denied(call('Write', { file_path: `${home}/.claude/settings.json` }));
  allowed(call('Write', { file_path: `${home}/.claude/settings.json` }, { AUTOPILOT_CLAUDE_HOME_EXCEPTION: 'updater' }));
});
test('symlink into protected config directory is denied', () => {
  const link = path.join(temp, 'link');
  try { fs.symlinkSync(path.join(operator, '.claude'), link); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  denied(call('Read', { file_path: `${link}/settings.json` }));
});

test.after(() => fs.rmSync(temp, { recursive: true, force: true }));
