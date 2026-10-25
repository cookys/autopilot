#!/usr/bin/env node
'use strict';
/**
 * post-tool-chain differential harness (BL-0241 guard-port Phase 1; plan docs/plans/2026-10-23-guard-port.md).
 *
 * Compares three arms on equal isolated sandboxes (own HOME, TMPDIR, XDG/AUTOPILOT_LIVE_DIR, cwd, env):
 *   orig   the five observers exactly as at the pinned develop sha (git show), run as separate processes
 *   cur    the five observers as in this tree (export refactor + unchanged CLI wrapper), separate processes
 *   chain  hooks/post-tool-chain.js (one process)
 * Host-visible oracle for a call (plan Phase 1): the five standalone stdout streams concatenated in
 * registration order, stderr likewise, exit = highest of the five. Exit code, stdout and stderr are compared
 * RAW, and so are state files: nothing the observers wrote is rewritten before comparing. Volatile values (clock,
 * hostname, pid) are frozen identically in every process of every arm by ptc-freeze.js (--require via NODE_OPTIONS),
 * and every arm runs in the SAME sandbox paths (recreated before each run), so the bytes are equal by construction.
 * The golden file keeps sandbox paths as <ROOT>/<LIVE>/<CWDSHA1>/<CWDSHA12> placeholders and is EXPANDED for the
 * observing sandbox before the byte compare; observed bytes are never touched.
 *
 * Modes:
 *   check [--chain DIR] [--no-orig] [--overlap-n N]   permanent test: cur == golden, chain == golden,
 *                                                    (orig == golden when the pinned sha is present),
 *   --no-freeze                                      run without ptc-freeze.js (negative control: must go red)
 *                                                    overlapping-call cases; exit 1 on any difference
 *   gen-golden                                       (re)write the golden file from the ORIG arm
 *   serial-orig-vs-cur                               orig vs cur only, no golden
 * `--chain DIR`: directory holding post-tool-chain.js (+ -lib) to test instead of hooks/ (negative controls).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..', '..');
const HOOKS = path.join(REPO, 'hooks');
const GOLDEN = path.join(REPO, 'hooks', 'tests', 'fixtures', 'post-tool-chain', 'golden.json');
const { MEMBERS } = require(path.join(HOOKS, 'post-tool-chain-lib.js'));
const ORIG_REF = 'e5691fb6c';

// ---------- args ----------
// Fixed umask: default-created files/dirs get the same modes on every host (the golden stores modes).
process.umask(0o022);
const args = process.argv.slice(2);
const mode = args[0] || 'check';
function opt(name, dflt) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; }
const chainDir = path.resolve(opt('--chain', HOOKS));
const useOrig = !args.includes('--no-orig');
const overlapN = Number(opt('--overlap-n', '12'));
const onlyOverlap = args.includes('--only-overlap');
const FREEZE = path.join(__dirname, 'ptc-freeze.js');
const freezeOn = !args.includes('--no-freeze');

// ---------- sandbox ----------
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'ptc-harness-'));
const SHM = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
const LIVE_BASE = fs.mkdtempSync(path.join(SHM, 'ptc-live-'));
process.on('exit', () => {
  try { fs.rmSync(BASE, { recursive: true, force: true }); } catch { /* best effort */ }
  try { fs.rmSync(LIVE_BASE, { recursive: true, force: true }); } catch { /* best effort */ }
});

// hooks dir for the orig arm: symlinks to every file in hooks/, the five replaced by `git show` copies;
// ../src and ../scripts are symlinked so the originals' relative requires resolve.
function buildOrigTree() {
  const rev = spawnSync('git', ['-C', REPO, 'rev-parse', '--verify', `${ORIG_REF}^{commit}`], { encoding: 'utf8' });
  if (rev.status !== 0) return null;
  const root = path.join(BASE, 'orig');
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.symlinkSync(path.join(REPO, 'src'), path.join(root, 'src'));
  fs.symlinkSync(path.join(REPO, 'scripts'), path.join(root, 'scripts'));
  for (const f of fs.readdirSync(HOOKS)) {
    fs.symlinkSync(path.join(HOOKS, f), path.join(root, 'hooks', f)); // files and dirs (_shared/, lib/)
  }
  for (const stem of MEMBERS) {
    const show = spawnSync('git', ['-C', REPO, 'show', `${ORIG_REF}:hooks/${stem}.js`], { encoding: 'buffer', maxBuffer: 1 << 26 });
    if (show.status !== 0) return null;
    const dest = path.join(root, 'hooks', `${stem}.js`);
    fs.rmSync(dest, { force: true });
    fs.writeFileSync(dest, show.stdout);
  }
  return path.join(root, 'hooks');
}

// One fixed sandbox path per invocation, recreated empty before every run (arms run one after another), so a path
// that an observer echoes into a file is the same bytes in every arm.
function newSandbox() {
  const root = path.join(BASE, 'sb');
  fs.rmSync(root, { recursive: true, force: true });
  for (const d of ['home', 'tmp', 'cwd', 'run']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const live = path.join(LIVE_BASE, 'live');
  fs.rmSync(live, { recursive: true, force: true });
  fs.mkdirSync(live, { recursive: true, mode: 0o700 });
  const realRoot = fs.realpathSync(root);
  const cwd = path.join(realRoot, 'cwd');
  return { root: realRoot, home: path.join(realRoot, 'home'), tmp: path.join(realRoot, 'tmp'), cwd, live: fs.realpathSync(live) };
}

function sbEnv(sb, extra) {
  const env = {
    PATH: process.env.PATH,
    HOME: sb.home,
    TMPDIR: sb.tmp,
    XDG_RUNTIME_DIR: path.join(sb.root, 'run'),
    AUTOPILOT_LIVE_DIR: sb.live,
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_REVIEW_SERVER_AUTOSTART: '0',
    GIT_CEILING_DIRECTORIES: BASE,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    LC_ALL: 'C.UTF-8',
  };
  if (freezeOn) env.NODE_OPTIONS = `--require=${FREEZE}`;
  return Object.assign(env, extra || {});
}

// ---------- state snapshot (raw) and golden placeholders ----------
// No state file content is rewritten. File NAMES contain the sandbox identity (the sha1 of the cwd names the intent
// record), so the golden keeps those as placeholders; see tmpl()/expandText() below.
function snapshot(sb) {
  const out = {};
  const roots = [[sb.root, ''], [sb.live, 'LIVE:']];
  for (const [r, prefix] of roots) {
    (function walk(dir) {
      let ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      ents.sort((a, b) => (a.name < b.name ? -1 : 1));
      for (const e of ents) {
        if (e.name === '.git') continue; // git's own tree (sample hooks, description, config) is git-version state, not hook state
        const full = path.join(dir, e.name);
        const rel = prefix + path.relative(r, full);
        let st;
        try { st = fs.lstatSync(full); } catch { continue; }
        const mode = (st.mode & 0o777).toString(8);
        if (e.isDirectory()) { out[rel + '/'] = { mode }; walk(full); }
        else if (e.isFile()) {
          let txt;
          try { txt = fs.readFileSync(full, 'utf8'); } catch { txt = '<unreadable>'; }
          out[rel] = { mode, content: txt };
        } else out[rel] = { mode, kind: 'other' };
      }
    })(r);
  }
  return out;
}

// ---------- fixtures ----------
const KB = 1024;
function post(tool, input, extra) {
  return JSON.stringify(Object.assign({
    hook_event_name: 'PostToolUse', session_id: 'sess-ptc', tool_name: tool, tool_input: input,
    tool_response: 'ok',
  }, extra || {}));
}
const bashOk = (cmd) => post('Bash', { command: cmd }, { exit_code: 0, tool_response: 'fine' });
const bashFail = (cmd, extra) => post('Bash', { command: cmd }, Object.assign({ exit_code: 1, tool_response: 'boom' }, extra || {}));

function seedReload(sb, { changed }) {
  // cwd watch file with a fixed mtime; the state remembers an older (or the same) mtime
  const watch = path.join(sb.cwd, '.claude', 'dispatch-config.md');
  fs.mkdirSync(path.dirname(watch), { recursive: true });
  fs.writeFileSync(watch, 'cfg');
  fs.utimesSync(watch, 1700000000, 1700000000);
  const st = fs.statSync(watch).mtimeMs;
  const stateDir = path.join(sb.home, '.claude', 'plugins');
  fs.mkdirSync(stateDir, { recursive: true });
  const state = {
    [path.join(sb.home, '.claude/plugins/installed_plugins.json')]: null,
    [watch]: changed ? st - 5000 : st,
    [path.join(sb.cwd, '.claude/settings.local.json')]: null,
  };
  fs.writeFileSync(path.join(stateDir, '.reload-watch-state.json'), JSON.stringify(state, null, 2));
}
function seedFailureCount(sb, n, sessionId) {
  const dir = path.join(sb.home, '.autopilot');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const h = crypto.createHash('md5').update(sessionId).digest('hex').slice(0, 8);
  fs.writeFileSync(path.join(dir, `.failure_count_${h}`), String(n), { mode: 0o600 });
}

// Creates a pending permission/question attention entry through the real awaiting-owner CLI in the sandbox.
function seedAttention(sb, tool, input) {
  const r = spawnSync(process.execPath, [path.join(HOOKS, 'awaiting-owner.js')], {
    input: JSON.stringify({ hook_event_name: 'PermissionRequest', session_id: 'sess-ptc', cwd: sb.cwd, tool_name: tool, tool_input: input }),
    cwd: sb.cwd, env: sbEnv(sb),
  });
  if (r.status !== 0) throw new Error('seedAttention failed: ' + r.stderr);
}

const HUGE = 'error ENOENT fatal: '.repeat(80 * KB / 20 * 16); // ~1.28 MB

const FIXTURES = [
  { name: 'quiet-bash-success', steps: [bashOk('echo ok')] },
  { name: 'bash-fail-escalation-ladder', steps: [1, 2, 3, 4, 5, 6].map((i) => bashFail(`false ${i}`)) },
  { name: 'bash-fail-then-reset', steps: [bashFail('false'), bashFail('false'), bashOk('true'), bashFail('false')] },
  { name: 'bash-fail-pattern-exit0', steps: [post('Bash', { command: 'x' }, { exit_code: 0, tool_output: 'Traceback (most recent call last)' }), post('Bash', { command: 'x' }, { tool_result: { exitCode: 3 } })] },
  { name: 'reload-first-run-silent', steps: [post('Read', { file_path: '/x' })] },
  { name: 'reload-change-emits', setup: (sb) => seedReload(sb, { changed: true }), steps: [post('Read', { file_path: '/x' }), post('Read', { file_path: '/x' })] },
  { name: 'reload-and-failure-both-emit', setup: (sb) => { seedReload(sb, { changed: true }); seedFailureCount(sb, 1, 'sess-ptc'); }, steps: [bashFail('false')] },
  { name: 'none-emit-read', setup: (sb) => seedReload(sb, { changed: false }), steps: [post('Read', { file_path: '/x' }, { tool_response: 'all good' })] },
  { name: 'empty-stdin', steps: [''] },
  { name: 'invalid-json', steps: ['not json {'] },
  { name: 'json-null', steps: ['null'] },
  { name: 'non-utf8-bytes', steps: [Buffer.from([0x7b, 0xff, 0xfe, 0x7d])] },
  { name: 'huge-payload', steps: [post('Bash', { command: 'cat big' }, { exit_code: 1, tool_response: HUGE })] },
  { name: 'ask-user-question-live-state', steps: [post('AskUserQuestion', { questions: [{ question: 'q?' }] })] },
  { name: 'attention-pending-resolved-by-posttool', setup: (sb) => seedAttention(sb, 'AskUserQuestion', { questions: [{ question: 'q?' }] }), steps: [post('AskUserQuestion', { questions: [{ question: 'q?' }] }, { cwd: '/x' })] },
  { name: 'bash-secret-redaction-multiline', steps: [bashOk('echo "token=ghp_abcdefghijklmnopqrstuvwxyz0123456789"\nsecond line')] },
  { name: 'log-error-keyword-read', steps: [post('Read', { file_path: '/x' }, { tool_response: 'permission denied while reading' }), post('Edit', { file_path: '/y' }, { is_error: true, tool_response: 'x' })] },
  { name: 'intent-disable-flag-active', setup: (sb) => { const d = path.join(sb.home, '.autopilot'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'intent-capture.disabled'), JSON.stringify({ disabled_at: '2026-01-01T00:00:00.000Z', reason: 'x', plugin_version: 'unknown' })); }, steps: [bashOk('echo hi')] },
  { name: 'intent-breaker-trips', setup: (sb) => { const d = path.join(sb.home, '.autopilot'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.intent-capture-failures'), '9'); fs.writeFileSync(path.join(d, 'intent'), 'not a dir'); }, steps: [bashOk('echo hi'), bashOk('echo again')] },
  { name: 'home-dot-claude-is-a-file', setup: (sb) => { fs.writeFileSync(path.join(sb.home, '.claude'), 'file'); }, steps: [post('Bash', { command: 'echo err' }, { exit_code: 0, tool_response: 'error: nope' })] },
  { name: 'transcript-fallback', env: { CLAUDE_CODE_SESSION_ID: 'dddd0000-1111-2222-3333-444455556666' }, setup: (sb) => { const t = path.join(sb.home, '.claude', 'projects', '-enc'); fs.mkdirSync(t, { recursive: true }); fs.writeFileSync(path.join(t, 'dddd0000-1111-2222-3333-444455556666.jsonl'), [JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'echo from-transcript' } }] } }), JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'error: failed', is_error: true }] } })].join('\n') + '\n'); }, steps: ['', ''] },
  { name: 'no-session-id-ppid-hash', steps: [JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'f' }, exit_code: 2 }), JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'f' }, exit_code: 2 })] },
  { name: 'intent-env-opt-out', env: { AUTOPILOT_INTENT_CAPTURE: 'false' }, steps: [bashOk('echo hi')] },
  { name: 'literal-timestamp-hostname-pid-in-user-text', steps: [post('Bash', { command: 'echo "2026-01-01T00:00:00.123Z build-host-1 f.4242.tmp"' }, { exit_code: 0, tool_response: 'error: at 2026-02-02T02:02:02.222Z on build-host-1' })] },
  { name: 'user-error-text-with-heading-shaped-line', steps: [post('Read', { file_path: '/x' }, { tool_response: 'error: first\n### 2026-03-03T03:03:03.333Z\n**Tool:** not-a-heading\nlast' })] },
  { name: 'user-error-text-embeds-terminator-and-heading', steps: [post('Read', { file_path: '/x' }, { tool_response: 'error: before\n```\n**Solution:** (fill in after fix)\n\n---\n### 2026-03-03T03:03:03.333Z\n**Tool:** fake\n**Input:** `{}`\n```\nafter' })] },
  { name: 'git-cwd-branch', setup: (sb) => { const env = sbEnv(sb, { GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x', GIT_COMMITTER_EMAIL: 'x@x' }); spawnSync('git', ['init', '-q', '-b', 'main', sb.cwd], { env }); spawnSync('git', ['-C', sb.cwd, 'commit', '-q', '--allow-empty', '-m', 'i'], { env }); }, steps: [bashOk('echo hi')] },
];

// ---------- running ----------
function observerPath(dir, stem) { return path.join(dir, `${stem}.js`); }

function spawnOnce(script, argv, input, sb, extraEnv) {
  const r = spawnSync(process.execPath, [script, ...argv], {
    input, cwd: sb.cwd, env: sbEnv(sb, extraEnv), maxBuffer: 1 << 27, timeout: 60000,
  });
  return { code: r.status === null ? -1 : r.status, stdout: r.stdout || Buffer.alloc(0), stderr: r.stderr || Buffer.alloc(0) };
}

// one call = the five observers as separate processes, in registration order
function runSeparate(dir, input, sb, extraEnv) {
  return MEMBERS.map((stem) => Object.assign({ hook: stem }, spawnOnce(observerPath(dir, stem), [], input, sb, extraEnv)));
}
function aggregate(per) {
  return {
    code: Math.max(...per.map((p) => p.code)),
    stdout: Buffer.concat(per.map((p) => p.stdout)),
    stderr: Buffer.concat(per.map((p) => p.stderr)),
  };
}
function runChainCall(input, sb, extraEnv, argv) {
  return spawnOnce(path.join(chainDir, 'post-tool-chain.js'), argv || [], input, sb, extraEnv);
}

function runFixture(fx, arm, origDir) {
  const sb = newSandbox();
  if (fx.setup) fx.setup(sb);
  const steps = [];
  for (const input of fx.steps) {
    if (arm === 'chain' || arm === 'chain-rev') {
      const r = runChainCall(input, sb, fx.env, arm === 'chain-rev' ? MEMBERS.slice().reverse() : []);
      steps.push({ agg: r });
    } else {
      const per = runSeparate(arm === 'orig' ? origDir : HOOKS, input, sb, fx.env);
      steps.push({ per, agg: aggregate(per) });
    }
  }
  const state = snapshot(sb);
  return { steps, state, sb };
}

// Golden text keeps the sandbox's own identity strings as placeholders (hooks echo their sandbox path, and the cwd's
// sha1 names the intent record). The OBSERVED bytes are never touched: the expected text is expanded with the observing
// sandbox's real strings and compared byte for byte. tmpl() asserts the round trip is lossless.
function idMap(sb) {
  const sha1 = crypto.createHash('sha1').update(sb.cwd).digest('hex');
  return [[sha1, '<CWDSHA1>'], [sha1.slice(0, 12), '<CWDSHA12>'], [sb.root, '<ROOT>'], [sb.live, '<LIVE>']];
}
function tmplText(t, sb) {
  let out = t;
  for (const [a, b] of idMap(sb)) out = out.split(a).join(b);
  if (expandText(out, sb) !== t) throw new Error('golden placeholders are not lossless for this text');
  return out;
}
function expandText(t, sb) {
  let out = t;
  for (const [a, b] of idMap(sb).slice().reverse()) out = out.split(b).join(a);
  return out;
}
function tmpl(buf, sb) {
  const t = buf.toString('utf8');
  if (!Buffer.from(t, 'utf8').equals(buf)) throw new Error('hook output is not lossless UTF-8; golden cannot store it');
  return tmplText(t, sb);
}
function expand(text, sb) { return Buffer.from(expandText(text, sb), 'utf8'); }
function aggJson(a, sb) { return { code: a.code, stdout: tmpl(a.stdout, sb), stderr: tmpl(a.stderr, sb) }; }
function stateToGolden(state, sb) {
  const out = {};
  for (const [k, v] of Object.entries(state)) out[tmplText(k, sb)] = typeof v.content === 'string' ? { ...v, content: tmplText(v.content, sb) } : v;
  return out;
}
function stateFromGolden(g, sb) {
  const out = {};
  for (const [k, v] of Object.entries(g)) out[expandText(k, sb)] = typeof v.content === 'string' ? { ...v, content: expandText(v.content, sb) } : v;
  return out;
}
function toGolden(res) {
  return {
    steps: res.steps.map((s) => ({ per: s.per ? s.per.map((p) => Object.assign({ hook: p.hook }, aggJson(p, res.sb))) : undefined, agg: aggJson(s.agg, res.sb) })),
    state: stateToGolden(res.state, res.sb),
  };
}

// ---------- comparison ----------
const problems = [];
function bad(msg) { problems.push(msg); }
function cmpAgg(label, got, want, sb) {
  // want: golden aggJson (templated text). Raw byte compare against the expansion.
  if (got.code !== want.code) bad(`${label}: exit ${got.code} != ${want.code}`);
  const wo = expand(want.stdout, sb), we = expand(want.stderr, sb);
  if (!got.stdout.equals(wo)) bad(`${label}: stdout bytes differ (${got.stdout.length} vs ${wo.length})`);
  if (!got.stderr.equals(we)) bad(`${label}: stderr bytes differ (${got.stderr.length} vs ${we.length})`);
}
function cmpState(label, got, want) {
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  for (const k of [...keys].sort()) {
    const a = got[k], b = want[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) bad(`${label}: state differs at ${k}: ${a === undefined ? 'missing' : 'present'} vs ${b === undefined ? 'missing' : 'present'}${a && b ? ` (${JSON.stringify(a).slice(0, 160)} != ${JSON.stringify(b).slice(0, 160)})` : ''}`);
  }
}

// ---------- overlapping calls ----------
function perms(a) { if (a.length <= 1) return [a]; const o = []; a.forEach((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).forEach((p) => o.push([x, ...p]))); return o; }

function outcomeKey(perCall, state, sb) { return JSON.stringify({ calls: perCall.map((a) => aggJson(a, sb)), state: JSON.parse(tmplText(JSON.stringify(state), sb)) }); }

const OVERLAP_CASES = [
  { name: 'two-failing-bash-same-session', sem: { fc: { init: 0, inc: 2, reset: false }, ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 2, reset: false } }, calls: () => [bashFail('false a'), bashFail('false b')] },
  { name: 'fail-and-success-same-session', sem: { fc: { init: 1, inc: 1, reset: true }, ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 2, reset: false } }, setup: (sb) => seedFailureCount(sb, 1, 'sess-ptc'), calls: () => [bashFail('false'), bashOk('true')] },
  { name: 'three-failing-bash-same-session', sem: { fc: { init: 0, inc: 3, reset: false }, ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 3, reset: false } }, calls: () => [bashFail('false a'), bashFail('false b'), bashFail('false c')] },
  { name: 'intent-breaker-pair', sem: { fc: { init: 0, inc: 0, reset: false }, ifail: { init: 8, inc: 2, reset: false }, tc: { init: 0, inc: 2, reset: false }, optional: [/^home\/\.autopilot\/intent-capture\.disabled$/] }, setup: (sb) => { const d = path.join(sb.home, '.autopilot'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.intent-capture-failures'), '8'); fs.writeFileSync(path.join(d, 'intent'), 'not a dir'); }, calls: () => [bashOk('echo 1'), bashOk('echo 2')] },
  { name: 'reload-change-pair', sem: { fc: { init: 0, inc: 0, reset: false }, ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 2, reset: false } }, setup: (sb) => seedReload(sb, { changed: true }), calls: () => [post('Read', { file_path: '/a' }), post('Read', { file_path: '/b' })] },
  { name: 'same-cwd-intent-and-log-pair', sem: { fc: { init: 0, inc: 0, reset: false }, ifail: { init: 0, inc: 0, reset: true }, tc: { init: 0, inc: 2, reset: false } }, calls: () => [post('Read', { file_path: '/a' }, { tool_response: 'error one' }), post('Bash', { command: 'echo two' }, { exit_code: 0, tool_response: 'error two' })] },
];

function serialOutcome(oc, order, calls, origOrCur) {
  const sb = newSandbox();
  if (oc.setup) oc.setup(sb);
  const perCall = new Array(calls.length);
  for (const idx of order) {
    perCall[idx] = aggregate(runSeparate(origOrCur, calls[idx], sb, { PTC_PID: String(4242 + 10 * idx) }));
  }
  return outcomeKey(perCall, snapshot(sb), sb);
}

function runConcurrent(oc, calls, side) {
  const sb = newSandbox();
  if (oc.setup) oc.setup(sb);
  const procs = []; // {call, hook, child, chunks}
  const t0 = process.hrtime.bigint();
  const spawnTimes = [];
  calls.forEach((input, ci) => {
    const scripts = side === 'chain' ? [{ hook: 'chain', file: path.join(chainDir, 'post-tool-chain.js') }] : MEMBERS.map((stem) => ({ hook: stem, file: path.join(HOOKS, `${stem}.js`) }));
    for (const s of scripts) {
      const child = spawn(process.execPath, [s.file], { cwd: sb.cwd, env: sbEnv(sb, { PTC_PID: String(4242 + 10 * ci) }), stdio: ['pipe', 'pipe', 'pipe'] });
      spawnTimes.push(process.hrtime.bigint() - t0);
      const rec = { call: ci, hook: s.hook, out: [], err: [], code: null };
      child.stdout.on('data', (d) => rec.out.push(d));
      child.stderr.on('data', (d) => rec.err.push(d));
      rec.done = new Promise((res) => child.on('close', (c) => { rec.code = c === null ? -1 : c; res(); }));
      rec.child = child;
      procs.push(rec);
    }
  });
  return { sb, procs, calls, spawnTimes, t0 };
}

// Blocks until every child is parked reading fd 0 (kernel wait channel shows a pipe read), i.e. node start-up
// and module loading are done; falls back to a fixed 6 s ceiling. Releasing then is a tight loop of stdin writes.
async function waitParked(run) {
  // x86_64 Linux: /proc/<pid>/syscall begins "0 0x0 " while the main thread sits in read(0, ...). Elsewhere the
  // wait channel names a pipe/socket wait. No /proc at all: a flat 1.5 s settle (overlap is then best-effort).
  const hasProc = fs.existsSync('/proc/self/syscall') || fs.existsSync('/proc/self/wchan');
  if (!hasProc) { await new Promise((r) => setTimeout(r, 1500)); return; }
  const deadline = Date.now() + 6000;
  const rd = (pid, f) => { try { return fs.readFileSync(`/proc/${pid}/${f}`, 'utf8'); } catch { return ''; } };
  const parked = (pid) => /^0 0x0 /.test(rd(pid, 'syscall')) || /pipe|unix_stream|sk_wait/.test(rd(pid, 'wchan'));
  while (Date.now() < deadline && !run.procs.every((p) => parked(p.child.pid))) await new Promise((r) => setTimeout(r, 15));
}

async function releaseAndCollect(run) {
  await waitParked(run);
  const rel0 = process.hrtime.bigint();
  const relTimes = [];
  for (const p of run.procs) { p.child.stdin.end(run.calls[p.call]); relTimes.push(process.hrtime.bigint() - rel0); }
  await Promise.all(run.procs.map((p) => p.done));
  const perCall = run.calls.map((_, ci) => aggregate(run.procs.filter((p) => p.call === ci).map((p) => ({ code: p.code, stdout: Buffer.concat(p.out), stderr: Buffer.concat(p.err) }))));
  return { perCall, state: snapshot(run.sb), spreadUs: Number(relTimes[relTimes.length - 1]) / 1000 };
}

async function sample(oc, side, n, stats) {
  const keys = [];
  for (let i = 0; i < n; i++) {
    const run = runConcurrent(oc, oc.calls(), side);
    const res = await releaseAndCollect(run);
    stats.spreads.push(res.spreadUs);
    keys.push(outcomeKey(res.perCall, res.state, run.sb));
  }
  return keys;
}

// Acceptance for overlapping calls (plan Phase 1, replaced by depth-0 ruling 2026-10-25: INVARIANTS instead of
// "equals some serial order"). Reason: the separate-process baseline itself loses updates on shared counters when
// calls overlap tightly (failure counters, the intent-capture breaker counter, reload-watch state): it is not a
// serial outcome in 70-100% of tight-overlap samples (reported as baseline_non_serial). The chain runs the same
// hook bodies and only removes concurrency between ONE call's own hooks, so each schedule it produces is one the
// baseline can produce; what must hold is an invariant of every such outcome. Observed set O = every serial
// outcome plus the baseline's own 2n samples. A chain outcome FAILS when any of these breaks:
//   per call:  exit code, stdout and stderr are each a value seen in O (few values: empty / escalation text);
//   per path:  the path exists in the chain outcome if it exists in every outcome of O (except a path the case declares
//              optional: the breaker's flag file exists only if no update was lost), and no path appears that
//              never appears in O (lock / tmp residue);
//   mode:      the file/dir mode is one seen in O for that path;
//   content:   a counter file holds an integer inside the range REACHABLE FROM THE CALLS' OPERATIONS (rangeOf: each case declares
//              init / number of +1 calls / whether some call resets to 0), not a range padded around what was sampled; a JSON object file parses,
//              has a key set seen in O, and the intent record's tool_count_session obeys the tool counter's range while every other field
//              equals a value seen in O; any other text file has the same line count range as O and every line
//              a line seen in O.
function collect(keys) {
  const out = new Map(), perPath = new Map();
  let outcomes = 0;
  for (const k of keys) {
    outcomes++;
    const o = JSON.parse(k);
    o.calls.forEach((c, i) => { for (const f of ['code', 'stdout', 'stderr']) { const n = `call${i}.${f}`; if (!out.has(n)) out.set(n, new Set()); out.get(n).add(JSON.stringify(c[f])); } });
    for (const [pth, e] of Object.entries(o.state)) { if (!perPath.has(pth)) perPath.set(pth, []); perPath.get(pth).push(e); }
  }
  return { out, perPath, outcomes };
}
// Reachable range of a counter from the operations of the overlapping calls (ruling: no free-floating slack).
//   init:  value before the group;  inc: number of calls that do read-modify-write "+1";
//   reset: some call writes 0 (a success branch).
// Every written value is (a value read) + 1 with the value read in {init, anything written earlier, 0 for a read of
// a file caught mid-rewrite}, so no value exceeds init + inc; without a reset op every write is >= 1, so the file
// is >= 1 whenever some call increments and stays init when none does. With a reset op the file may end at 0.
function rangeOf({ init, inc, reset }) {
  return { lo: reset ? 0 : (inc > 0 ? 1 : init), hi: init + inc };
}
const COUNTER_FILES = [
  [/^home\/\.autopilot\/\.failure_count_[0-9a-f]{8}$/, 'fc'],        // failure-escalation: failing Bash +1, success -> 0
  [/^home\/\.autopilot\/\.intent-capture-failures$/, 'ifail'],       // intent-capture: failed record write +1, success -> 0
  [/^tmp\/claude-intent-tool-count-[0-9a-f]{12}$/, 'tc'],                  // intent-capture tool counter: +1 per call
];
function counterKind(pth) { const m = COUNTER_FILES.find(([re]) => re.test(pth)); return m ? m[1] : null; }

function contentProblem(pth, content, observed, sem) {
  const vals = observed.map((e) => e.content).filter((c) => typeof c === 'string');
  if (vals.length === 0) return null;
  const isInt = (c) => /^\d+$/.test(c);
  if (vals.every(isInt)) {
    if (!isInt(content)) return `${pth}: counter content "${String(content).slice(0, 40)}" is not an integer`;
    const v = Number(content);
    const kind = counterKind(pth);
    if (kind) {
      const r = rangeOf(sem[kind]);
      if (v < r.lo || v > r.hi) return `${pth}: counter ${v} outside the range [${r.lo}, ${r.hi}] reachable from these calls' operations (${JSON.stringify(sem[kind])})`;
      return null;
    }
    return vals.includes(content) ? null : `${pth}: unmodelled numeric file holds ${v}, never observed`;
  }
  const parse = (c) => { try { const o = JSON.parse(c); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch { return null; } };
  if (vals.every((c) => parse(c) !== null)) {
    const o = parse(content);
    if (o === null) return `${pth}: content is no longer a JSON object`;
    const objs = vals.map(parse);
    const keySig = (x) => JSON.stringify(Object.keys(x).sort());
    if (!objs.some((x) => keySig(x) === keySig(o))) return `${pth}: key set ${keySig(o)} never observed`;
    for (const [key, v] of Object.entries(o)) {
      const seen = objs.filter((x) => key in x).map((x) => x[key]);
      if (key === 'tool_count_session' && /\/intent\//.test(pth)) { // the tool counter's value after this call's +1
        const r = rangeOf(sem.tc);
        if (typeof v !== 'number' || v < Math.max(1, r.lo) || v > r.hi) return `${pth}: tool_count_session=${JSON.stringify(v)} outside [${Math.max(1, r.lo)}, ${r.hi}]`;
      } else if (!seen.some((x) => JSON.stringify(x) === JSON.stringify(v))) return `${pth}: field ${key}=${JSON.stringify(v).slice(0, 80)} never observed`;
    }
    return null;
  }
  const lines = (c) => c.split('\n');
  const counts = vals.map((c) => lines(c).length);
  const seenLines = new Set(vals.flatMap(lines));
  const l = lines(content);
  if (l.length < Math.min(...counts) || l.length > Math.max(...counts)) return `${pth}: ${l.length} lines outside observed [${Math.min(...counts)}, ${Math.max(...counts)}]`;
  const stray = l.find((x) => !seenLines.has(x));
  return stray === undefined ? null : `${pth}: line never observed: ${stray.slice(0, 80)}`;
}
function judge(keys, acc, sem) {
  const failing = [];
  for (const k of keys) {
    const o = JSON.parse(k);
    o.calls.forEach((c, i) => { for (const f of ['code', 'stdout', 'stderr']) { const n = `call${i}.${f}`; if (!acc.out.has(n) || !acc.out.get(n).has(JSON.stringify(c[f]))) failing.push(`${n} = ${JSON.stringify(c[f]).slice(0, 120)}`); } });
    for (const [pth, observed] of acc.perPath) {
      if (observed.length === acc.outcomes && !(pth in o.state) && !(sem.optional || []).some((re) => re.test(pth))) failing.push(`${pth}: missing (present in every observed outcome)`);
    }
    for (const [pth, e] of Object.entries(o.state)) {
      const observed = acc.perPath.get(pth);
      if (!observed) { failing.push(`${pth}: path never seen in serial/baseline`); continue; }
      if (!observed.some((x) => x.mode === e.mode)) failing.push(`${pth}: mode ${e.mode} (observed ${[...new Set(observed.map((x) => x.mode))].join(',')})`);
      if (typeof e.content === 'string') { const pr = contentProblem(pth, e.content, observed, sem); if (pr) failing.push(pr); }
    }
  }
  return { failing };
}

async function runOverlap() {
  const report = [];
  for (const oc of OVERLAP_CASES) {
    const calls = oc.calls();
    const serial = [];
    for (const order of perms(calls.map((_, i) => i))) serial.push(serialOutcome(oc, order, calls, HOOKS));
    const stats = { spreads: [] };
    const baseKeys = await sample(oc, 'separate', overlapN * 2, stats);
    const chainKeys = await sample(oc, 'chain', overlapN, stats);
    const serialSet = new Set(serial);
    const verdict = judge(chainKeys, collect([...serial, ...baseKeys]), oc.sem);
    const sp = stats.spreads.slice().sort((a, b) => a - b);
    report.push({ case: oc.name, serial_outcomes: serialSet.size, baseline_n: baseKeys.length, baseline_non_serial: baseKeys.filter((k) => !serialSet.has(k)).length, chain_n: chainKeys.length, chain_non_serial: chainKeys.filter((k) => !serialSet.has(k)).length, chain_failing_components: verdict.failing.length, release_spread_us_p50: Math.round(sp[Math.floor(sp.length / 2)]), release_spread_us_max: Math.round(sp[sp.length - 1]) });
    if (verdict.failing.length > 0) bad(`overlap ${oc.name}: ${[...new Set(verdict.failing)].slice(0, 4).join(' | ')}`);
  }
  return report;
}

// ---------- main ----------
async function main() {
  const origDir = useOrig ? buildOrigTree() : null;
  if (mode === 'gen-golden') {
    if (!origDir) { console.error('gen-golden needs the pinned sha in this clone'); process.exit(2); }
    const golden = { source_ref: ORIG_REF, source_sha: spawnSync('git', ['-C', REPO, 'rev-parse', ORIG_REF], { encoding: 'utf8' }).stdout.trim(), fixtures: {} };
    for (const fx of FIXTURES) golden.fixtures[fx.name] = toGolden(runFixture(fx, 'orig', origDir));
    fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
    fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 1) + '\n');
    console.log(`golden written: ${GOLDEN} (${FIXTURES.length} fixtures, source ${golden.source_sha})`);
    return;
  }
  if (mode === 'serial-orig-vs-cur') {
    for (const fx of FIXTURES) {
      const a = toGolden(runFixture(fx, 'orig', origDir));
      const b = toGolden(runFixture(fx, 'cur', origDir));
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        bad(`${fx.name}: orig != cur`);
        if (process.env.PTC_DEBUG) {
          a.steps.forEach((s, i) => { if (JSON.stringify(s) !== JSON.stringify(b.steps[i])) console.error('step', i, JSON.stringify(s).slice(0, 700), '\nVS\n', JSON.stringify(b.steps[i]).slice(0, 700)); });
          cmpState(`${fx.name} orig-vs-cur`, b.state, a.state);
        }
      }
    }
  } else if (!onlyOverlap) {
    const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
    for (const fx of FIXTURES) {
      const want = golden.fixtures[fx.name];
      if (!want) { bad(`${fx.name}: missing from golden`); continue; }
      const arms = ['cur', 'chain', 'chain-rev'];
      if (origDir) arms.unshift('orig');
      for (const arm of arms) {
        const res = runFixture(fx, arm, origDir);
        res.steps.forEach((s, i) => {
          let wantAgg = want.steps[i].agg;
          if (arm === 'chain-rev') {
            // members are independent: the reversed chain's streams are the per-hook golden streams, reversed
            const rev = want.steps[i].per.slice().reverse();
            wantAgg = { code: Math.max(...rev.map((x) => x.code)), stdout: rev.map((x) => x.stdout).join(''), stderr: rev.map((x) => x.stderr).join('') };
          }
          cmpAgg(`${fx.name}[${i}] ${arm} aggregate`, s.agg, wantAgg, res.sb);
          if (arm !== 'chain' && arm !== 'chain-rev') s.per.forEach((p, j) => cmpAgg(`${fx.name}[${i}] ${arm} ${p.hook}`, p, want.steps[i].per[j], res.sb));
        });
        cmpState(`${fx.name} ${arm}`, res.state, stateFromGolden(want.state, res.sb));
      }
    }
    console.log(`serial corpus: ${FIXTURES.length} fixtures, arms ${origDir ? 'orig,' : '(orig skipped: pinned sha absent) '}cur,chain,chain-rev`);
  }
  if (mode === 'check' && overlapN > 0) {
    const rep = await runOverlap();
    console.log('overlap report ' + JSON.stringify(rep));
  }
  if (problems.length) {
    console.error(`HARNESS RED: ${problems.length} difference(s)`);
    for (const p of problems.slice(0, 40)) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('HARNESS GREEN');
}

main().catch((e) => { console.error('harness error: ' + (e && e.stack || e)); process.exit(2); });
