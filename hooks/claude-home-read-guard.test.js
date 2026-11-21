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

test('recursive command variants deny broad home scans and preserve exclusions', () => {
  for (const command of [
    'grep -rn SessionStart ~', 'grep -ri SessionStart ~', 'grep -Rl x /home',
    'rg SessionStart ~', 'ugrep -n x ~', 'ag x ~', 'ls -lR ~', 'ls -Ra ~'
  ]) denied(call('Bash', { command }));
  for (const command of [
    "grep -rn x ~ --exclude-dir=.claude", "rg -g '!.claude' x ~",
    "find /home -not -path '*/.claude*'", 'find /home/.claude -prune'
  ]) allowed(call('Bash', { command }));
});

test('search patterns and scripts are not treated as path operands', () => {
  for (const command of [
    'grep "~/.claude" docs/x.md', 'rg "~/.claude" docs',
    'grep -n "\\$HOME/.claude" README.md', "grep -e '~/.claude' -r docs",
    "sed -n '/.claude/p' notes.txt", "awk '/~\\/.claude/' f.txt", "jq '.claude' x.json"
  ]) allowed(call('Bash', { command }));
  for (const command of [
    'grep x ~/.claude/settings.json', 'grep -e x ~/.claude/settings.json',
    'grep -f ~/.claude/patterns docs', 'grep -f patterns ~/.claude/settings.json'
  ]) denied(call('Bash', { command }));
});

test('table-driven operand classification covers option values and pattern arguments', () => {
  for (const command of [
    'rg --regexp=x ~/.claude/settings.json', 'grep --regexp=x ~/.claude/settings.json',
    `grep --file=${home}/.claude/p x.txt`, 'jq -f ~/.claude/x.jq y.json',
    'jq -f ~/.claude/x.jq ~/.claude/settings.json',
    'grep x ~/.claude/settings.json', 'grep -e x ~/.claude/settings.json',
    'grep -f ~/.claude/settings.json x', 'sed -f ~/.claude/x f',
    'jq . ~/.claude/settings.json', 'grep -rn x ~', 'rg x ~'
  ]) denied(call('Bash', { command }));
  for (const command of ['rg "$HOME" docs', "rg '~' docs", 'grep -rn "$HOME" hooks/']) {
    allowed(call('Bash', { command }));
  }
});

test('shell short clusters and sudo wrappers retain guard decisions', () => {
  for (const command of [
    'bash -lc "cat ~/.claude/settings.json"',
    'sh -lc "cat ~/.claude/settings.json"',
    'zsh -lc "cat ~/.claude/settings.json"',
    'sudo cat ~/.claude/settings.json', 'sudo -u nobody cat ~/.claude/settings.json'
  ]) denied(call('Bash', { command }));
  for (const command of ['bash -lc "cat README.md"', 'sudo cat README.md']) allowed(call('Bash', { command }));
});

test('command wrappers and shell command strings retain guard decisions', () => {
  for (const command of [
    'env cat ~/.claude/settings.json', 'FOO=1 cat ~/.claude/settings.json',
    'timeout 5 cat ~/.claude/settings.json', 'bash -c "cat ~/.claude/settings.json"',
    "sh -c 'grep -rn x ~'", 'env -i FOO=1 cat ~/.claude/settings.json',
    'nice -n 5 cat ~/.claude/settings.json', 'nohup cat ~/.claude/settings.json',
    'command cat ~/.claude/settings.json', 'printf x | xargs cat ~/.claude/settings.json',
    'zsh -c "cat ~/.claude/settings.json"'
  ]) denied(call('Bash', { command }));
  for (const command of [
    'env cat README.md', 'FOO=1 cat README.md', 'timeout 5 cat README.md',
    'bash -c "cat README.md"', "sh -c 'grep -rn x docs'"
  ]) allowed(call('Bash', { command }));
});
