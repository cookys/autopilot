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
// TWO ADAPTORS (opencode 2.x removed `run --dir/--pure/--variant`; every v1 argv exits rc=1):
//   v1 = the shape above (opencode 1.x). v2 = `run --standalone -m provider/model#variant
//   --agent locked --format json` in an EMPTY cwd under a clean HOME/XDG tree, with
//   OPENCODE_DISABLE_PROJECT_CONFIG=1 and a v2-native OPENCODE_CONFIG_CONTENT (`permissions`,
//   `agents`). The adaptor is chosen from `<bin> --version`'s major number (detectAdaptor);
//   an unknown major refuses (fail closed), nothing is guessed. Evidence: spike REPORT in
//   references/multi-agent-portability.md "OpenCode 2.x adaptor". `--pure` has NO v2 equivalent,
//   so plugins/MCP are kept out ONLY by the clean config home (P2). v2 keeps credentials in
//   opencode.db, not auth.json: they travel by `auth export --standalone` (real env) ->
//   `auth import --standalone` (clean env), the export file deleted at once.
//   buildPlan() is the ONE source of argv/env/cwd for every call site (dispatch-review.sh,
//   dispatch-hetero.sh, probe-engine-capability.sh, qualification-review-provider.js).
//
// CLI:
//   node opencode-containment.js version --bin <bin>       print v1|v2 (exit 1 + reason on an unknown major)
//   node opencode-containment.js plan --bin B --model M [--effort E] --profile review|probe|implement
//        [--root R] [--cwd D] [--version-string S] --out DIR
//        write DIR/{argv.nul,env.nul,cwd,adaptor}; env.nul = `env(1)` operands (`-u K`, `K=V`)
//   node opencode-containment.js assert-plan DIR             exit 0 iff DIR's argv/env/cwd are the locked shape
//   node opencode-containment.js config               print the canonical OPENCODE_CONFIG_CONTENT JSON
//   node opencode-containment.js agent                print the agent name
//   node opencode-containment.js assert <argv...>     exit 0 iff argv + env OPENCODE_CONFIG_CONTENT are the locked shape
//   node opencode-containment.js prepare-home <root>  make <root>/home (auth.json only) ; print KEY=VALUE env lines
//   node opencode-containment.js audit <file> [v1|v2] exit 1 + breaches on stderr if the NDJSON holds a tool event
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
// v2 only: a tool_use whose state is `error` with the "No tool named ... is currently
// available" message is a HALLUCINATED call to a tool the locked agent does not have (spike
// t13) — nothing ran, so it is let through. completed / running / any other error is a breach.
const NO_SUCH_TOOL = /^No tool named "[^"]*" is currently available/;
function isUnavailableToolCall(part) {
  const st = part && part.state;
  if (!st || st.status !== 'error' || typeof st.error !== 'string') return false;
  if (!NO_SUCH_TOOL.test(st.error)) return false;
  const res = st.metadata && st.metadata.providerResult;
  if (res && res.executed === true) return false;
  return true;
}
function auditEvents(raw, adaptor = 'v1') {
  const out = [];
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let ev;
    try { ev = JSON.parse(t); } catch { continue; }
    if (!ev || typeof ev !== 'object') continue;
    const part = ev.part && typeof ev.part === 'object' ? ev.part : {};
    if (ev.type === 'tool_use' || part.type === 'tool') {
      if (adaptor === 'v2' && isUnavailableToolCall(part)) continue;
      const st = part.state && part.state.status;
      out.push(`tool event ${part.tool || '?'}${st ? `:${st}` : ''}`);
    }
  }
  return out;
}

// ── v2 adaptor ──────────────────────────────────────────────────────────────
const ALLOW_ADAPTORS = Object.freeze({ 1: 'v1', 2: 'v2' });
const DENY_ALL = Object.freeze({ action: '*', resource: '*', effect: 'deny' });
const CONFIG_V2 = Object.freeze({
  permissions: [DENY_ALL],
  agents: { [AGENT_NAME]: { mode: 'primary', permissions: [DENY_ALL] } },
});
const CONFIG_V2_JSON = JSON.stringify(CONFIG_V2);

// Throws on an unknown major: no guessing which argv an unrecognised opencode wants.
// `versionString` skips the spawn when the caller already ran `--version` (one run per call).
function detectAdaptor(bin, { env, versionString } = {}) {
  let raw = versionString;
  if (raw === undefined || raw === null || raw === '') {
    const r = require('child_process').spawnSync(bin, ['--version'], {
      encoding: 'utf8', timeout: 30000, env: env || process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.error || r.status !== 0) throw new Error(`opencode --version failed for ${bin}: ${r.error ? r.error.message : `rc=${r.status}`}`);
    raw = r.stdout;
  }
  const first = String(raw).split('\n').map((l) => l.trim()).find(Boolean) || '';
  const m = /^(?:opencode\s+)?v?(\d+)\.(\d+)\.(\d+)/i.exec(first);
  const adaptor = m ? ALLOW_ADAPTORS[Number(m[1])] : undefined;
  if (!adaptor) {
    throw new Error(`unsupported opencode version "${first || '(empty)'}": only major 1 (v1 adaptor) and 2 (v2 adaptor) are known — refusing to guess an argv`);
  }
  return { adaptor, version: first };
}

const variantFor = (effort) => (!effort ? '' : effort === 'max' ? 'xhigh' : effort);

function lockedArgsV2({ model, variant }) {
  return ['run', '--standalone', '-m', variant ? `${model}#${variant}` : model, '--agent', AGENT_NAME, '--format', 'json'];
}

function makeCleanHome(root) {
  const home = path.join(root, 'home');
  fs.mkdirSync(path.join(home, '.local', 'share'), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(home, '.config'), { recursive: true });
  fs.mkdirSync(path.join(home, '.local', 'state'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cache'), { recursive: true });
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
  };
}

// v2 credentials live in opencode.db: export from the REAL environment, import under the
// clean one, delete the export file whatever happens (it holds secrets in plaintext).
function prepareHomeV2(root, { bin, realEnv }) {
  const clean = makeCleanHome(root);
  const exp = path.join(root, 'auth-export.json');
  const { spawnSync } = require('child_process');
  try {
    const fd = fs.openSync(exp, 'w', 0o600);
    let r;
    try {
      r = spawnSync(bin, ['auth', 'export', '--standalone'], { env: realEnv || process.env, stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', timeout: 120000 });
    } finally { fs.closeSync(fd); }
    if (r.error || r.status !== 0) throw new Error(`opencode auth export failed: ${r.error ? r.error.message : `rc=${r.status} ${String(r.stderr || '').slice(0, 200)}`}`);
    const cleanEnv = { ...(realEnv || process.env), ...clean };
    delete cleanEnv.OPENCODE_CONFIG; delete cleanEnv.OPENCODE_CONFIG_DIR; delete cleanEnv.OPENCODE_CONFIG_CONTENT;
    cleanEnv.OPENCODE_DISABLE_PROJECT_CONFIG = '1';
    const i = spawnSync(bin, ['auth', 'import', '--standalone', exp], { env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 120000, cwd: path.join(root, 'work') });
    if (i.error || i.status !== 0) throw new Error(`opencode auth import failed: ${i.error ? i.error.message : `rc=${i.status} ${String(i.stderr || '').slice(0, 200)}`}`);
  } finally { fs.rmSync(exp, { force: true }); }
  return clean;
}

function realHomeDir() { try { return os.userInfo().homedir; } catch { return os.homedir(); } }

// Returns null when the v2 invocation is the locked one, else a breach string (fail closed).
function assertLockedV2({ args, env, cwd, realHome }) {
  const once = (flag) => args.filter((a) => a === flag).length;
  if (args[0] !== 'run') return 'argv is not an `opencode run` invocation';
  for (const flag of ['--standalone', '--agent', '--format', '-m']) {
    if (once(flag) !== 1) return once(flag) === 0 ? `${flag} is missing` : `${flag} given more than once`;
  }
  for (const gone of ['--dir', '--pure', '--variant', '--server', '--auto', '--continue', '-c', '--session', '-s', '--fork']) {
    if (args.includes(gone)) return `${gone} must not be passed to the v2 locked run`;
  }
  const at = (flag) => args[args.indexOf(flag) + 1];
  if (at('--agent') !== AGENT_NAME) return `--agent is not ${AGENT_NAME}`;
  if (at('--format') !== 'json') return '--format is not json';
  if (!at('-m')) return '-m has no model';
  if (!env || env.OPENCODE_DISABLE_PROJECT_CONFIG !== '1') return 'OPENCODE_DISABLE_PROJECT_CONFIG=1 is missing';
  if (env.OPENCODE_CONFIG || env.OPENCODE_CONFIG_DIR) return 'OPENCODE_CONFIG / OPENCODE_CONFIG_DIR must be unset';
  const raw = env.OPENCODE_CONFIG_CONTENT;
  if (!raw) return 'OPENCODE_CONFIG_CONTENT is not set';
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return 'OPENCODE_CONFIG_CONTENT is not valid JSON'; }
  if (!deepEqual(parsed, CONFIG_V2)) return 'OPENCODE_CONFIG_CONTENT is not the canonical v2 deny-all config';
  const rh = path.resolve(realHome || realHomeDir());
  for (const k of ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
    if (!env[k]) return `${k} is not set (would fall back to the real home)`;
  }
  const home = path.resolve(env.HOME);
  if (home === rh) return 'HOME is the real home directory';
  const realDefaults = ['.config', '.local/share', '.local/state', '.cache'].map((d) => path.join(rh, d));
  const within = (child, parent) => child === parent || child.startsWith(parent + path.sep);
  for (const k of ['XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CACHE_HOME']) {
    const v = path.resolve(env[k]);
    if (!within(v, home)) return `${k} is not inside the clean HOME`;
    if (realDefaults.includes(v)) return `${k} is the real ${path.basename(v)} directory`;
  }
  if (!cwd) return 'cwd is missing';
  if (!env.PWD || path.resolve(env.PWD) !== path.resolve(cwd)) return 'PWD is not the empty cwd (opencode 2.x works in $PWD)';
  let entries;
  try { entries = fs.readdirSync(cwd); } catch { return 'cwd is not a readable directory'; }
  if (entries.length !== 0) return 'cwd is not empty';
  if (insideGitWorktree(cwd)) return 'cwd is under a git worktree';
  return null;
}

function applyEnv(base, { set = {}, unset = [] } = {}) {
  const env = { ...base };
  for (const k of unset) delete env[k];
  Object.assign(env, set);
  return env;
}

// The one place that decides argv / env / cwd for an opencode call.
//   profile review    contained deny-all seat (empty cwd, clean home)         -> root required
//   profile probe     reachability probe; v1 = `--agent plan` as before; v2 = the contained seat
//   profile implement write-capable implementer in `cwd` (no containment; not a review seat)
// Returns { adaptor, version, profile, args, env:{set,unset}, cwd }.
function buildPlan({ bin, model, effort, profile, root, cwd, baseEnv, versionString, dataRoot }) {
  if (!['review', 'probe', 'implement'].includes(profile)) throw new Error(`unknown opencode profile "${profile}"`);
  if (!model) throw new Error('opencode model is required');
  const base = baseEnv || process.env;
  const { adaptor, version } = detectAdaptor(bin, { env: base, versionString });
  const variant = variantFor(effort);
  const plan = { adaptor, version, profile, args: [], env: { set: {}, unset: [] }, cwd };
  if (adaptor === 'v1') {
    if (profile === 'implement') {
      if (!cwd) throw new Error('implement profile needs a cwd');
      plan.args = ['run', '--dir', cwd, '--pure', '-m', model, '--variant', variant, '--format', 'json'];
    } else if (profile === 'probe') {
      if (!cwd) throw new Error('probe profile needs a cwd');
      plan.args = ['run', '--dir', cwd, '--pure', '-m', model, '--agent', 'plan'];
      if (variant) plan.args.push('--variant', variant);
    } else {
      if (!root) throw new Error('review profile needs a root');
      const work = path.join(root, 'work');
      fs.mkdirSync(work, { recursive: true });
      const home = prepareHome(root, dataRoot || (base.XDG_DATA_HOME || path.join(base.HOME || os.homedir(), '.local', 'share')));
      plan.args = lockedArgs({ model, variant, dir: work });
      plan.env = { set: { ...home, OPENCODE_CONFIG_CONTENT: CONFIG_JSON }, unset: ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR'] };
      plan.cwd = work;
    }
    return plan;
  }
  // v2
  if (profile === 'implement') {
    if (!cwd) throw new Error('implement profile needs a cwd');
    plan.args = ['run', '--standalone', '-m', variant ? `${model}#${variant}` : model, '--format', 'json'];
    plan.env = { set: { PWD: cwd }, unset: [] };   // v2 resolves its project dir from $PWD, not getcwd() (spike 2026-10-18)
    return plan;
  }
  if (!root) throw new Error(`${profile} profile needs a root`);
  const work = path.join(root, 'work');
  fs.mkdirSync(work, { recursive: true });
  const home = prepareHomeV2(root, { bin, realEnv: base });
  plan.args = lockedArgsV2({ model, variant });
  plan.env = {
    // PWD: opencode 2.x takes its working dir from $PWD, so a spawn(cwd:) without it would run
    // (and write files) in the CALLER's directory — proven by a live write landing in the parent cwd.
    set: { ...home, PWD: work, OPENCODE_DISABLE_PROJECT_CONFIG: '1', OPENCODE_CONFIG_CONTENT: CONFIG_V2_JSON },
    unset: ['OPENCODE_CONFIG', 'OPENCODE_CONFIG_DIR'],
  };
  plan.cwd = work;
  return plan;
}

// Verifies a contained (review/probe) plan against the effective environment.
function assertPlan(plan, { baseEnv, realHome } = {}) {
  const env = applyEnv(baseEnv || process.env, plan.env);
  if (plan.adaptor === 'v2') return assertLockedV2({ args: plan.args, env, cwd: plan.cwd, realHome });
  if (plan.adaptor === 'v1') {
    const breach = assertLocked({ args: plan.args, env });
    if (breach) return breach;
    if (plan.cwd !== plan.args[plan.args.indexOf('--dir') + 1]) return 'cwd is not the --dir';
    return null;
  }
  return `unknown adaptor "${plan.adaptor}"`;
}

// env(1) operands for a plan's env delta, and the inverse (used by the shell hand-off).
function envOperands(env) {
  const ops = [];
  for (const k of env.unset || []) ops.push('-u', k);
  for (const [k, v] of Object.entries(env.set || {})) ops.push(`${k}=${v}`);
  return ops;
}
function parseEnvOperands(ops) {
  const env = { set: {}, unset: [] };
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i] === '-u') { env.unset.push(ops[i + 1]); i += 1; continue; }
    const eq = ops[i].indexOf('=');
    if (eq <= 0) throw new Error(`bad env operand: ${ops[i]}`);
    env.set[ops[i].slice(0, eq)] = ops[i].slice(eq + 1);
  }
  return env;
}
const nulSplit = (s) => (s === '' ? [] : s.replace(/\0$/, '').split('\0'));

module.exports = {
  AGENT_NAME, CONFIG, CONFIG_JSON, CONFIG_V2, CONFIG_V2_JSON, lockedArgs, lockedArgsV2, lockedEnv, prepareHome,
  prepareHomeV2, insideGitWorktree, assertLocked, assertLockedV2, extractText, auditEvents, detectAdaptor,
  buildPlan, assertPlan, applyEnv, envOperands, parseEnvOperands, variantFor,
};

if (require.main === module) {
  const argv = process.argv.slice(3);
  const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const cmd = process.argv[2];
  const fail = (msg, code = 1) => { process.stderr.write(`opencode containment: ${msg}\n`); process.exit(code); };
  if (cmd === 'config') process.stdout.write(`${CONFIG_JSON}\n`);
  else if (cmd === 'agent') process.stdout.write(`${AGENT_NAME}\n`);
  else if (cmd === 'version') {
    try { process.stdout.write(`${detectAdaptor(opt('--bin'), { versionString: opt('--version-string') }).version}\n`); } catch (e) { fail(e.message); }
  } else if (cmd === 'plan') {
    const out = opt('--out');
    if (!out || !opt('--bin')) fail('plan needs --bin and --out', 2);
    try {
      const plan = buildPlan({
        bin: opt('--bin'), model: opt('--model'), effort: opt('--effort'), profile: opt('--profile'),
        root: opt('--root'), cwd: opt('--cwd'), versionString: opt('--version-string'),
      });
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'argv.nul'), plan.args.map((a) => `${a}\0`).join(''));
      fs.writeFileSync(path.join(out, 'env.nul'), envOperands(plan.env).map((a) => `${a}\0`).join(''));
      fs.writeFileSync(path.join(out, 'cwd'), plan.cwd || '');
      fs.writeFileSync(path.join(out, 'adaptor'), plan.adaptor);
    } catch (e) { fail(e.message); }
  } else if (cmd === 'assert-plan' && process.argv[3]) {
    const d = process.argv[3];
    let breach;
    try {
      const rd = (f) => fs.readFileSync(path.join(d, f), 'utf8');
      breach = assertPlan({
        adaptor: rd('adaptor'), args: nulSplit(rd('argv.nul')), env: parseEnvOperands(nulSplit(rd('env.nul'))), cwd: rd('cwd'),
      });
    } catch (e) { breach = `plan files unreadable: ${e.message}`; }
    if (breach) fail(breach);
  } else if (cmd === 'assert') {
    const breach = assertLocked({ args: process.argv.slice(3), env: process.env });
    if (breach) { process.stderr.write(`opencode containment: ${breach}\n`); process.exit(1); }
  } else if (cmd === 'prepare-home' && process.argv[3]) {
    const e = prepareHome(process.argv[3], process.env.XDG_DATA_HOME || path.join(process.env.HOME || os.homedir(), '.local', 'share'));
    process.stdout.write(`${Object.entries(e).map(([k, v]) => `${k}=${v}`).join('\n')}\n`);
  } else if (cmd === 'audit' && process.argv[3]) {
    const b = auditEvents(fs.readFileSync(process.argv[3], 'utf8'), process.argv[4] === 'v2' ? 'v2' : 'v1');
    if (b.length) { process.stderr.write(`opencode containment breach: ${b.join('; ')}\n`); process.exit(1); }
  } else { process.stderr.write('usage: opencode-containment.js version|plan|assert-plan <dir>|config|agent|assert <argv...>|prepare-home <root>|audit <file> [v1|v2]\n'); process.exit(2); }
}
