#!/usr/bin/env node
'use strict';
// opencode containment — the ONE owner of the deny-all invocation an opencode
// REVIEW/EXAM seat runs under (dispatch-review.sh opencode branch and
// qualification-review-provider.js opencode kind). Never used by the implementer
// rail (dispatch-hetero.sh), which must be able to write files.
//
// Facts (live adversarial probe 2026-10-16, opencode 1.19.2, model
// opencode-go/muse-spark-1.3-contributor; permission docs
// https://opencode.ai/docs/permissions/ ; config docs https://opencode.ai/docs/config/):
//   - The only reliable deny-all is BOTH a global `permission: {"*":"deny"}` AND a
//     custom primary agent whose own `permission` is `{"*":"deny"}`, delivered through
//     OPENCODE_CONFIG_CONTENT (inline JSON, highest-precedence config source).
//   - OPENCODE_CONFIG (a file) does NOT override a project opencode.json; a global
//     deny alone is overridden by a project agent md; `--agent plan` denies only
//     `edit` (bash, webfetch, MCP stay open).
//   - With both layers, a hostile project opencode.json / .opencode/agent/locked.md
//     / `tools: bash: true` could not re-open anything (3 repeats, 0 executions across
//     bash write, ~/.ssh read, write/edit, webfetch/websearch, MCP, task, grep/glob).
//   - --dir is an EMPTY scratch directory so there is no project config to read at all.
// Live re-verification: hooks/tests/opencode-deny-all-live.test.sh (AUTOPILOT_LIVE_OPENCODE=1).
//
// CLI:
//   node opencode-containment.js config               print the canonical OPENCODE_CONFIG_CONTENT JSON
//   node opencode-containment.js agent                print the agent name
//   node opencode-containment.js assert <argv...>     exit 0 iff argv + env OPENCODE_CONFIG_CONTENT are the locked shape
//   node opencode-containment.js prepare-home <root>  make <root>/home (auth.json only) ; print KEY=VALUE env lines
//   node opencode-containment.js audit <file>         exit 1 + breaches on stderr if the NDJSON holds a tool event
//
// Environment isolation (round-2 review): opencode also reads ~/.config/opencode (agents,
// MCP, plugins), OPENCODE_CONFIG and OPENCODE_CONFIG_DIR, and walks up from --dir to a git
// root for opencode.json. So the seat runs under a clean temp HOME/XDG tree that holds only
// auth.json (credentials live in $XDG_DATA_HOME/opencode/auth.json, default
// ~/.local/share/opencode/auth.json), with OPENCODE_CONFIG/OPENCODE_CONFIG_DIR removed, and
// --dir must not sit under any git worktree.

const fs = require('fs');
const os = require('os');
const path = require('path');

const AGENT_NAME = 'locked';
const CONFIG = Object.freeze({
  permission: { '*': 'deny' },
  agent: { [AGENT_NAME]: { mode: 'primary', permission: { '*': 'deny' } } },
});
const CONFIG_JSON = JSON.stringify(CONFIG);

// argv for `opencode run` (prompt goes on stdin). `dir` must be an empty directory.
function lockedArgs({ model, variant, dir }) {
  const args = ['run', '--dir', dir, '--pure', '-m', model, '--agent', AGENT_NAME];
  if (variant) args.push('--variant', variant);
  args.push('--format', 'json');
  return args;
}

function lockedEnv(base) {
  const env = { ...base, OPENCODE_CONFIG_CONTENT: CONFIG_JSON };
  delete env.OPENCODE_CONFIG;
  delete env.OPENCODE_CONFIG_DIR;
  return env;
}

// Clean HOME/XDG tree under <root>/home holding only auth.json copied from dataRoot
// (dataRoot = the XDG data dir that holds opencode/auth.json). Returns the env overrides.
function prepareHome(root, dataRoot) {
  const home = path.join(root, 'home');
  const dataDir = path.join(home, '.local', 'share', 'opencode');
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(home, '.config'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'state'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cache'), { recursive: true });
  const src = path.join(dataRoot || path.join(os.homedir(), '.local', 'share'), 'opencode', 'auth.json');
  try { fs.copyFileSync(src, path.join(dataDir, 'auth.json')); fs.chmodSync(path.join(dataDir, 'auth.json'), 0o600); } catch { /* no credential: opencode will report it */ }
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  };
}

// True when dir or any ancestor holds a .git entry (opencode walks up to the git root
// looking for opencode.json / .opencode).
function insideGitWorktree(dir) {
  let cur = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return true;
    const up = path.dirname(cur);
    if (up === cur) return false;
    cur = up;
  }
}

function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Returns null when the invocation is the locked one, else a breach string. Fail
// closed: any deviation (no env, other agent, no --pure, missing/non-empty --dir) refuses.
function assertLocked({ args, env }) {
  const raw = env && env.OPENCODE_CONFIG_CONTENT;
  if (!raw) return 'OPENCODE_CONFIG_CONTENT is not set';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return 'OPENCODE_CONFIG_CONTENT is not valid JSON'; }
  if (!deepEqual(parsed, CONFIG)) return 'OPENCODE_CONFIG_CONTENT is not the canonical deny-all config';
  const at = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  for (const flag of ['--agent', '--dir']) {
    if (args.filter((a) => a === flag).length > 1) return `${flag} given more than once`;
  }
  if (env.OPENCODE_CONFIG || env.OPENCODE_CONFIG_DIR) return 'OPENCODE_CONFIG / OPENCODE_CONFIG_DIR must be unset';
  if (args[0] !== 'run') return 'argv is not an `opencode run` invocation';
  if (at('--agent') !== AGENT_NAME) return `--agent is not ${AGENT_NAME}`;
  if (!args.includes('--pure')) return '--pure is missing';
  const dir = at('--dir');
  if (!dir) return '--dir is missing';
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return '--dir is not a readable directory'; }
  if (entries.length !== 0) return '--dir is not empty';
  if (insideGitWorktree(dir)) return '--dir is under a git worktree';
  return null;
}

// `--format json` emits NDJSON; the answer is the LAST {"type":"text"} event's part.text.
function extractText(raw) {
  let last = '';
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (ev && ev.type === 'text' && ev.part && typeof ev.part.text === 'string') last = ev.part.text;
  }
  return last;
}

// Any tool event in the NDJSON means a tool ran (or was attempted) despite deny-all: a
// clean exit proves nothing, so the answer is voided. Returns a list of breach strings.
function auditEvents(raw) {
  const out = [];
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (!ev || typeof ev !== 'object') continue;
    const part = ev.part && typeof ev.part === 'object' ? ev.part : {};
    if (ev.type === 'tool_use' || part.type === 'tool') {
      const st = part.state && part.state.status;
      out.push(`tool event ${part.tool || '?'}${st ? `:${st}` : ''}`);
    }
  }
  return out;
}

module.exports = {
  AGENT_NAME, CONFIG, CONFIG_JSON, lockedArgs, lockedEnv, prepareHome, insideGitWorktree,
  assertLocked, extractText, auditEvents,
};

if (require.main === module) {
  const cmd = process.argv[2];
  if (cmd === 'config') process.stdout.write(`${CONFIG_JSON}\n`);
  else if (cmd === 'agent') process.stdout.write(`${AGENT_NAME}\n`);
  else if (cmd === 'assert') {
    const breach = assertLocked({ args: process.argv.slice(3), env: process.env });
    if (breach) { process.stderr.write(`opencode containment: ${breach}\n`); process.exit(1); }
  } else if (cmd === 'prepare-home' && process.argv[3]) {
    const e = prepareHome(process.argv[3], process.env.XDG_DATA_HOME || path.join(process.env.HOME || os.homedir(), '.local', 'share'));
    process.stdout.write(`${Object.entries(e).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
  } else if (cmd === 'audit' && process.argv[3]) {
    const b = auditEvents(fs.readFileSync(process.argv[3], 'utf8'));
    if (b.length) { process.stderr.write(`opencode containment breach: ${b.join('; ')}\n`); process.exit(1); }
  } else { process.stderr.write('usage: opencode-containment.js config|agent|assert <argv...>|prepare-home <root>|audit <file>\n'); process.exit(2); }
}
