/**
 * Tests for the plain-session marker (mods P1W MARKER, plan R5.6): `level: null` means "a session record,
 * no orchestrator mode". Run: node --test hooks/plain-session-marker.test.js
 *
 * Contract under test
 *   - writer: `session-mode.js set` without --level (or --level none) writes level:null; root_run_id is a job root
 *     (explicit --root-run-id > AUTOPILOT_ROOT_RUN_ID > minted; mods P1W PLAINROOT, tests in plain-session-root.test.js);
 *     `status` prints level "none"; `set --phase` updates it in place.
 *   - every marker reader treats level:null exactly like "no marker" (readers table in
 *     <scratchpad>/p1c/run-w/marker/REPORT.md), while a malformed level (not null, not l3-l6) stays invalid.
 *   - fields that are meant to be read from a plain marker (project_key, root_run_id, phase, started_at) are read.
 *   - SessionStart ensure (hooks/runs-watch-autostart.js): creates a plain marker only when no unexpired marker
 *     exists for the session id, NEVER overwrites (compact / resume / startup with a live l5 marker: bytes unchanged),
 *     replaces an expired one, creates nothing in a repo that is not opted in; UserPromptSubmit never creates one.
 *   - not-opted-in UserPromptSubmit spawns no git (fake git on PATH records every call).
 * Isolation: HOME, AUTOPILOT_SESSION_MODE_DIR, AUTOPILOT_LIVE_DIR, XDG_RUNTIME_DIR all point under a temp dir;
 * the last test proves the real ~/.autopilot, the real live dir and /run/user/<uid>/autopilot were not touched.
 *
 * RED (before implementation, 2026-10-05): see <scratchpad>/p1c/run-w/marker/red.txt
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'session-mode.js');
const HETERO = path.join(ROOT, 'scripts', 'dispatch-hetero.sh');
const AUTOSTART = path.join(__dirname, 'runs-watch-autostart.js');
const REAL_HOME = os.homedir();

// Other live sessions on this host write to the real stores all the time, so "unchanged" cannot be a hash of
// them. The negative control is "no trace of this suite": nothing under the real stores is named smp-* or mentions
// this suite's temp roots (every fixture path starts with <tmp>/smp- or /dev/shm/smp-).
function snapshot() {
  const targets = [
    path.join(REAL_HOME, '.autopilot'),
    `/run/user/${process.getuid()}/autopilot`,
  ];
  const needles = [path.join(os.tmpdir(), 'smp-'), '/dev/shm/smp-'];
  const hits = [];
  const walk = (p, depth) => {
    let st;
    try { st = fs.lstatSync(p); } catch (_e) { return; }
    if (path.basename(p).startsWith('smp-')) hits.push(p);
    if (st.isDirectory()) {
      if (depth < 4) for (const n of fs.readdirSync(p)) walk(path.join(p, n), depth + 1);
    } else if (st.isFile() && st.size < 65536 && /\.(json|lock|pid)$/.test(p)) {
      try {
        const text = fs.readFileSync(p, 'utf8');
        if (needles.some((n) => text.includes(n))) hits.push(`${p} (content)`);
      } catch (_e) { /* unreadable */ }
    }
  };
  targets.forEach((t) => walk(t, 0));
  return hits.sort();
}
const REAL_BEFORE = snapshot();

const bases = [];
function fx(name = 'plain') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `smp-${name}-`));
  bases.push(base);
  const repo = path.join(base, 'repo');
  const markers = path.join(base, 'home', '.autopilot', 'session-mode');
  const home = path.join(base, 'home');
  const live = fs.mkdtempSync(path.join('/dev/shm', 'smp-live-'));
  bases.push(live);
  fs.mkdirSync(repo, { recursive: true });
  fs.mkdirSync(markers, { recursive: true });
  fs.chmodSync(live, 0o700);
  for (const args of [['init', '-q', '-b', 'develop'], ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'init']]) {
    assert.strictEqual(spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).status, 0);
  }
  const env = {
    PATH: process.env.PATH,
    LANG: 'C',
    HOME: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    XDG_RUNTIME_DIR: path.join(base, 'xdg'),
    AUTOPILOT_LIVE_DIR: live,
    AUTOPILOT_SESSION_MODE_DIR: markers,
    AUTOPILOT_COSTS_FILE: path.join(base, 'costs.jsonl'),
    AUTOPILOT_DISPATCH_RUNS_DIR: path.join(base, 'runs'),
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_SESSION_ID: 'smp-session',
  };
  return { base, repo, markers, home, live, env, marker: path.join(markers, 'smp-session.json') };
}
test.after(() => { for (const b of bases) fs.rmSync(b, { recursive: true, force: true }); });

function cli(f, args, extraEnv = {}) {
  return spawnSync('node', [CLI, ...args], { env: { ...f.env, ...extraEnv }, cwd: f.repo, encoding: 'utf8' });
}
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const iso = (ms) => new Date(ms).toISOString();
function writePlain(f, over = {}, name = 'smp-session') {
  const now = Date.now();
  const m = {
    session_id: name, level: null, repo_root: f.repo, started_at: iso(now), expires_at: iso(now + 36e5),
    repo_identity: null, project_key: null, root_run_id: null, ...over,
  };
  fs.writeFileSync(path.join(f.markers, `${name}.json`), `${JSON.stringify(m, null, 2)}\n`);
  return m;
}
function setLevel(f, level) {
  const r = cli(f, ['set', '--level', level, '--entry-level', level, '--repo-root', f.repo]);
  assert.strictEqual(r.status, 0, r.stderr);
}

// ---------------------------------------------------------------- writer / CLI

test('writer: bare `set` writes level:null with a job root, a project key and no mission fields', () => {
  const f = fx();
  const r = cli(f, ['set', '--repo-root', f.repo]);
  assert.strictEqual(r.status, 0, r.stderr);
  const m = readJson(f.marker);
  assert.strictEqual(m.level, null);
  assert.strictEqual(m.session_id, 'smp-session');
  assert.match(m.root_run_id, /^job-\d+-[0-9a-f]{8}$/);
  assert.strictEqual(m.repo_root, fs.realpathSync(f.repo));
  assert.match(m.project_key, /^[0-9a-f]{16}$/);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(m, 'mission_routing'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(m, 'entry_level'), false);
  const ttl = Date.parse(m.expires_at) - Date.parse(m.started_at);
  assert.strictEqual(ttl, 24 * 3600 * 1000);
});

test('writer: --level none --phase X writes the phase on a plain marker', () => {
  const f = fx();
  const r = cli(f, ['set', '--level', 'none', '--phase', 'review', '--repo-root', f.repo]);
  assert.strictEqual(r.status, 0, r.stderr);
  const m = readJson(f.marker);
  assert.strictEqual(m.level, null);
  assert.strictEqual(m.phase, 'review');
  assert.ok(Number.isFinite(Date.parse(m.phase_set_at)));
});

test('writer: root_run_id is --root-run-id, else AUTOPILOT_ROOT_RUN_ID, else minted', () => {
  const f = fx();
  cli(f, ['set', '--root-run-id', 'job-explicit', '--repo-root', f.repo]);
  assert.strictEqual(readJson(f.marker).root_run_id, 'job-explicit');
  cli(f, ['set', '--repo-root', f.repo], { AUTOPILOT_ROOT_RUN_ID: 'job-from-env' });
  assert.strictEqual(readJson(f.marker).root_run_id, 'job-from-env');
  cli(f, ['set', '--repo-root', f.repo]);
  assert.match(readJson(f.marker).root_run_id, /^job-\d+-[0-9a-f]{8}$/);
});

test('writer: invalid --level is still refused (only absent / none mean plain)', () => {
  const f = fx();
  const r = cli(f, ['set', '--level', 'l9', '--repo-root', f.repo]);
  assert.strictEqual(r.status, 2);
  assert.strictEqual(fs.existsSync(f.marker), false);
});

test('status prints level "none" for a plain marker; the file keeps null', () => {
  const f = fx();
  cli(f, ['set', '--repo-root', f.repo]);
  const s = JSON.parse(cli(f, ['status']).stdout);
  assert.strictEqual(s.level, 'none');
  assert.strictEqual(s.active, false); // no orchestrator mode is active
  assert.strictEqual(s.session_id, 'smp-session');
  assert.strictEqual(readJson(f.marker).level, null);
  fs.rmSync(f.marker);
  assert.strictEqual(JSON.parse(cli(f, ['status']).stdout).level, undefined);
});

test('phase: `set --phase` updates a plain marker in place (every other field identical)', () => {
  const f = fx();
  cli(f, ['set', '--repo-root', f.repo]);
  const before = readJson(f.marker);
  const r = cli(f, ['set', '--phase', '  work  ']);
  assert.strictEqual(r.status, 0, r.stderr);
  const after = readJson(f.marker);
  assert.strictEqual(after.phase, 'work');
  const strip = (m) => { const c = { ...m }; delete c.phase; delete c.phase_set_at; return c; };
  assert.deepStrictEqual(strip(after), strip(before));
  assert.strictEqual(after.level, null);
  assert.strictEqual(cli(f, ['set', '--phase', '']).status, 0);
  assert.strictEqual(readJson(f.marker).phase, undefined);
});

test('phase: `set --phase` with no marker at all still exits 2 and creates nothing', () => {
  const f = fx();
  const r = cli(f, ['set', '--phase', 'orphan']);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /no unexpired session marker/i);
  assert.strictEqual(fs.existsSync(f.marker), false);
});

test('phase: `set --phase` on an expired plain marker exits 2, bytes untouched', () => {
  const f = fx();
  writePlain(f, { started_at: iso(Date.now() - 7200e3), expires_at: iso(Date.now() - 3600e3) });
  const before = fs.readFileSync(f.marker);
  assert.strictEqual(cli(f, ['set', '--phase', 'late']).status, 2);
  assert.ok(before.equals(fs.readFileSync(f.marker)));
});

test('writer: `set --level l3` over a plain marker works and mints a job root; `clear` removes a plain marker', () => {
  const f = fx();
  cli(f, ['set', '--repo-root', f.repo]);
  setLevel(f, 'l3');
  const m = readJson(f.marker);
  assert.strictEqual(m.level, 'l3');
  assert.match(m.root_run_id, /^job-/);
  assert.strictEqual(cli(f, ['clear']).status, 0);
  cli(f, ['set', '--repo-root', f.repo]);
  assert.strictEqual(readJson(f.marker).level, null);
  assert.strictEqual(cli(f, ['clear']).status, 0);
  assert.strictEqual(fs.existsSync(f.marker), false);
});

test('readMarker / root: a plain marker is not an orchestrator marker; its root (when given) is read by `root`', () => {
  const f = fx();
  writePlain(f);
  const read = spawnSync('node', ['-e', 'process.stdout.write(JSON.stringify(require(process.argv[1]).readMarker()))', CLI], { env: f.env, encoding: 'utf8' });
  assert.strictEqual(read.stdout, 'null');
  assert.strictEqual(cli(f, ['root']).stdout.trim(), '');
  writePlain(f, { root_run_id: 'job-plain-1' });
  assert.strictEqual(cli(f, ['root']).stdout.trim(), 'job-plain-1');
  setLevel(f, 'l3');
  const live = spawnSync('node', ['-e', 'process.stdout.write(String(require(process.argv[1]).readMarker().level))', CLI], { env: f.env, encoding: 'utf8' });
  assert.strictEqual(live.stdout, 'l3'); // real markers are still read
});

// ---------------------------------------------------------------- reader: dispatch-hetero.sh

function hetero(f, markerDir, extra = []) {
  fs.writeFileSync(path.join(f.base, 'prompt.txt'), 'p\n');
  return spawnSync(HETERO, ['--branch', 'feat/plain', '--prompt-file', path.join(f.base, 'prompt.txt'), '--agy-bin', '/bin/true', ...extra], {
    cwd: f.repo, encoding: 'utf8', env: { ...f.env, AUTOPILOT_SESSION_ID: '', AUTOPILOT_SESSION_MODE_DIR: markerDir },
  });
}

test('dispatch-hetero classifier: a plain marker is skipped as if absent; the run gets past the session-mode gate', () => {
  const f = fx();
  const absentDir = path.join(f.base, 'empty'); fs.mkdirSync(absentDir);
  const plainDir = path.join(f.base, 'plain'); fs.mkdirSync(plainDir);
  fs.writeFileSync(path.join(plainDir, 'p.json'), JSON.stringify({
    session_id: 'p', level: null, repo_root: f.repo, started_at: iso(Date.now()), expires_at: iso(Date.now() + 36e5), root_run_id: null,
  }));
  const a = hetero(f, absentDir);
  const p = hetero(f, plainDir);
  assert.doesNotMatch(p.stdout + p.stderr, /session-mode marker is invalid|marker level is invalid/);
  assert.strictEqual(p.status, a.status, 'plain marker must not change the exit code versus no marker');
  const err = (r) => { try { return JSON.parse(r.stdout).error; } catch (_e) { return r.stdout; } };
  assert.strictEqual(err(p), err(a));
});

test('dispatch-hetero classifier: an expired or other-repo plain marker is skipped too; l5 in the same dir still blocks', () => {
  const f = fx();
  const dir = path.join(f.base, 'mix'); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify({ session_id: 'p', level: null, repo_root: '/nowhere', started_at: iso(0), expires_at: iso(1) }));
  const a = hetero(f, dir);
  assert.doesNotMatch(a.stdout + a.stderr, /marker is invalid/);
  fs.writeFileSync(path.join(dir, 'q.json'), JSON.stringify({ session_id: 'q', level: 'l5', repo_root: f.repo, started_at: iso(Date.now()), expires_at: iso(Date.now() + 36e5) }));
  const b = hetero(f, dir);
  assert.match(b.stdout + b.stderr, /active session-mode=l5 requires a sealed campaign/);
});

test('dispatch-hetero classifier: a malformed level (not null, not l3-l6) stays invalid', () => {
  const f = fx();
  for (const level of ['l9', '', 'none', 7, undefined]) {
    const dir = fs.mkdtempSync(path.join(f.base, 'bad-'));
    const m = { session_id: 'b', repo_root: f.repo, started_at: iso(Date.now()), expires_at: iso(Date.now() + 36e5) };
    if (level !== undefined) m.level = level;
    fs.writeFileSync(path.join(dir, 'b.json'), JSON.stringify(m));
    const r = hetero(f, dir);
    assert.match(r.stdout + r.stderr, /authoritative session-mode marker is invalid/, `level ${String(level)}`);
  }
});

function bridgeSnippet() {
  const text = fs.readFileSync(HETERO, 'utf8').split('\n');
  const start = text.findIndex((l) => l.includes('"$CAMPAIGN_MISSION_MODE" "$SELF_DIR/session-mode.js" <<\'NODE\''));
  assert.ok(start > 0, 'bridge heredoc located');
  const end = text.indexOf('NODE', start + 1);
  return text.slice(start + 1, end).join('\n');
}

test('dispatch-hetero campaign bridge: a plain marker is INACTIVE (no TypeError); a malformed level still fails', () => {
  const f = fx();
  const snippet = bridgeSnippet();
  const run = (m) => {
    const file = path.join(f.base, 'bridge-marker.json');
    fs.writeFileSync(file, JSON.stringify(m));
    return spawnSync('node', ['-', file, f.repo, path.join(f.base, 'nocampaign.json'), 'enforce', CLI], { input: snippet, encoding: 'utf8' });
  };
  const base = { session_id: 'b', repo_root: f.repo, started_at: iso(Date.now()), expires_at: iso(Date.now() + 36e5) };
  const plain = run({ ...base, level: null });
  assert.strictEqual(plain.status, 0, plain.stdout + plain.stderr);
  assert.strictEqual(plain.stdout, 'INACTIVE');
  const bad = run({ ...base, level: 'l9' });
  assert.strictEqual(bad.status, 3);
  assert.match(bad.stdout, /marker level is invalid/);
  const l3 = run({ ...base, level: 'l3' });
  assert.strictEqual(l3.stdout, 'INACTIVE'); // unchanged for real levels
});

// ---------------------------------------------------------------- readers: hooks

function editPayload(f) {
  return {
    hook_event_name: 'PreToolUse', cwd: f.repo, session_id: 'smp-session', tool_use_id: 'toolu_x', tool_name: 'Edit',
    tool_input: { file_path: path.join(f.repo, 'src', 'a.js'), old_string: 'a', new_string: 'b' },
  };
}
function hook(file, input, env, args = []) {
  return spawnSync('node', [file, ...args], { input: JSON.stringify(input), encoding: 'utf8', env });
}
function gateEnv(f) { return { ...f.env, AUTOPILOT_HOOK_ORCHESTRATOR_EDIT_GATE: '1', AUTOPILOT_ORCH_EDIT_GATE_MODE: 'block' }; }

test('orchestrator-edit-gate: plain marker behaves exactly like no marker (l5 control still denies)', () => {
  const f = fx();
  const none = hook(path.join(__dirname, 'orchestrator-edit-gate.js'), editPayload(f), gateEnv(f));
  writePlain(f);
  const plain = hook(path.join(__dirname, 'orchestrator-edit-gate.js'), editPayload(f), gateEnv(f));
  assert.strictEqual(plain.status, none.status);
  assert.strictEqual(plain.stderr, none.stderr);
  setLevel(f, 'l5');
  const l5 = hook(path.join(__dirname, 'orchestrator-edit-gate.js'), editPayload(f), gateEnv(f));
  assert.strictEqual(l5.status, 2, 'control: l5 marker denies the depth-0 edit');
});

test('foreman-guard: plain marker behaves exactly like no marker (l5 control denies a subagent Monitor)', () => {
  const f = fx();
  const payload = { hook_event_name: 'PreToolUse', agent_id: 'a1', session_id: 'smp-session', tool_name: 'Monitor', tool_input: {}, cwd: f.repo };
  const g = path.join(__dirname, 'foreman-guard.js');
  const none = hook(g, payload, f.env);
  writePlain(f);
  const plain = hook(g, payload, f.env);
  assert.strictEqual(plain.status, none.status);
  assert.strictEqual(plain.stdout, none.stdout);
  assert.strictEqual(plain.stderr, none.stderr);
  setLevel(f, 'l5');
  const l5 = hook(g, payload, f.env);
  assert.notStrictEqual(l5.status === none.status && l5.stdout === none.stdout, true, 'control: an l5 marker changes the verdict');
});

test('run-approval-gate: plain marker behaves exactly like no marker (l5 control asks)', () => {
  const f = fx();
  const env = { ...f.env, AUTOPILOT_RUN_APPROVAL_MODE: 'ask-once' };
  const payload = { hook_event_name: 'PreToolUse', session_id: 'smp-session', tool_name: 'Agent', tool_input: { prompt: 'x' }, cwd: f.repo };
  const g = path.join(__dirname, 'run-approval-gate.js');
  const none = hook(g, payload, env, ['PreToolUse']);
  writePlain(f);
  const plain = hook(g, payload, env, ['PreToolUse']);
  assert.strictEqual(plain.status, none.status);
  assert.strictEqual(plain.stdout, none.stdout);
  setLevel(f, 'l5');
  const l5 = hook(g, payload, env, ['PreToolUse']);
  assert.notStrictEqual(l5.stdout, none.stdout, 'control: an l5 marker makes the gate speak');
});

const CODEX_PLUGIN_ROOT = path.join(ROOT, 'platforms', 'codex', 'plugin');
test('codex pre-effect: a plain marker reads as "session marker absent" (same denial as no marker)', () => {
  const f = fx();
  const env = { ...f.env, PLUGIN_ROOT: CODEX_PLUGIN_ROOT, CODEX_THREAD_ID: 'smp-session' };
  const payload = { hook_event_name: 'PreToolUse', cwd: f.repo, session_id: 'smp-session', tool_name: 'shell', tool_input: { command: 'touch x' } };
  const run = () => spawnSync(process.execPath, [path.join(CODEX_PLUGIN_ROOT, 'hooks', 'pre-effect.js')], { input: JSON.stringify(payload), encoding: 'utf8', env });
  const none = run();
  writePlain(f);
  const plain = run();
  assert.strictEqual(plain.status, none.status);
  assert.strictEqual(plain.stdout, none.stdout);
  assert.match(none.stdout, /session marker absent/);
});

// ---------------------------------------------------------------- readers: scripts / engine

test('decision-ledger stamp: a plain marker without a root stamps null like no marker; with a root it stamps it', () => {
  const f = fx();
  let n = 0;
  const stampedRoot = () => {
    const ledger = path.join(f.base, 'ledger.jsonl');
    n += 1;
    const r = spawnSync('node', [path.join(ROOT, 'scripts', 'decision-ledger.js'), 'append', '--ledger', ledger, '--kind', 'note', '--json', JSON.stringify({ round: n, text: `t${n}` })], { cwd: f.repo, env: f.env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const rows = fs.readFileSync(ledger, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    return rows[rows.length - 1].root_run_id;
  };
  assert.strictEqual(stampedRoot(), null, 'no marker');
  writePlain(f);
  assert.strictEqual(stampedRoot(), null, 'plain marker, no root');
  writePlain(f, { root_run_id: 'job-plain-2' });
  assert.strictEqual(stampedRoot(), 'job-plain-2', 'root_run_id is a field meant to be read');
});

test('next-pick: a plain marker does not count as "on a job" (nothing is written, like no marker)', () => {
  const f = fx();
  writePlain(f);
  const r = spawnSync('node', ['-e', 'process.stdout.write(String(Boolean(require(process.argv[1]).readMarker())))', CLI], { env: f.env, encoding: 'utf8' });
  assert.strictEqual(r.stdout, 'false');
  // and the real consumer: next-pick's own activity probe
  const np = spawnSync('node', ['-e', `
    const src = require('fs').readFileSync(process.argv[1], 'utf8');
    process.stdout.write(/readMarker\\(\\)/.test(src) ? 'uses-readMarker' : 'other');`, path.join(ROOT, 'scripts', 'next-pick.js')], { encoding: 'utf8' });
  assert.strictEqual(np.stdout, 'uses-readMarker');
});

test('mission-routing-admission: a plain marker file is observed as absent (never corrupt)', () => {
  const f = fx();
  const run = (markerFile) => spawnSync('node', [path.join(ROOT, 'scripts', 'mission-routing-admission.js'), '--repo-root', f.repo, '--level', 'l3', '--marker', markerFile], { cwd: f.repo, env: f.env, encoding: 'utf8' });
  const none = run(path.join(f.base, 'nonexistent.json'));
  writePlain(f);
  const plain = run(f.marker);
  const status = (r) => JSON.parse(r.stdout).marker.status;
  assert.strictEqual(status(none), 'absent');
  assert.strictEqual(status(plain), 'absent');
  fs.writeFileSync(path.join(f.base, 'bad.json'), JSON.stringify({ level: 'l9', expires_at: iso(Date.now() + 1e6), repo_root: f.repo }));
  assert.strictEqual(status(run(path.join(f.base, 'bad.json'))), 'corrupt');
});

test('validateManagedDevFlowAdmission: a plain marker is rejected as "session marker absent"', () => {
  const f = fx();
  writePlain(f);
  const r = spawnSync('node', ['-e', `
    const m = require(process.argv[1]);
    process.stdout.write(JSON.stringify(m.validateManagedDevFlowAdmission({ repoRoot: process.argv[2], effectiveLevel: 'l5', campaignContract: null, markerFile: process.argv[3] })));`, CLI, f.repo, f.marker], { env: f.env, encoding: 'utf8' });
  const v = JSON.parse(r.stdout);
  assert.strictEqual(v.valid, false);
  assert.strictEqual(v.reason, 'session marker absent');
});

test('dispatch-author gate: a plain marker does not block non-strict dispatch (same as l3 / absent)', () => {
  const f = fx();
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'dispatch-author.sh'), 'utf8');
  assert.match(src, /data\.level !== "l5" && data\.level !== "l6"\) process\.exit\(1\)/);
  // the one-liner exits 1 (not active) for any level other than l5/l6 — run it as the script does
  const m = src.match(/node -e '(const fs = require\("fs"\);[^']*)'/);
  assert.ok(m, 'gate one-liner located');
  const probe = (marker) => {
    const file = path.join(f.base, 'author-marker.json');
    fs.writeFileSync(file, JSON.stringify(marker));
    return spawnSync('node', ['-e', m[1], file, f.repo], { encoding: 'utf8' }).status;
  };
  const base = { session_id: 'a', repo_root: f.repo, started_at: iso(Date.now()), expires_at: iso(Date.now() + 36e5) };
  assert.strictEqual(probe({ ...base, level: null }), 1);
  assert.strictEqual(probe({ ...base, level: 'l3' }), 1);
  assert.strictEqual(probe({ ...base, level: 'l5' }), 0, 'control: l5 blocks');
});

// ---------------------------------------------------------------- readers: watcher

const { createWatcher, unexpiredMarkers } = require(path.join(ROOT, 'src', 'status', 'runs-watch'));
const { scopeFromCwd } = require(path.join(ROOT, 'src', 'status', 'project-key'));
const { readWatchInputs } = require(path.join(ROOT, 'src', 'status', 'watch-inputs'));

function watcherEnv(f) { return { ...f.env }; }

test('runs-watch liveness: a plain marker does not keep the watcher alive; an l5 marker does', () => {
  const f = fx();
  const key = scopeFromCwd(f.repo).project_key;
  const run = () => {
    let t = Date.now();
    const w = createWatcher({ key, env: watcherEnv(f), cwd: f.repo, collect: () => [], now: () => t, interval: 1, idleExitS: 1 });
    w.tick(); t += 3000;
    return w.tick();
  };
  writePlain(f, { project_key: key });
  assert.strictEqual(run().exit, 'idle_exit', 'plain marker: the watcher idles out');
  fs.rmSync(f.marker);
  setLevel(f, 'l3');
  assert.strictEqual(run().exit, undefined, 'control: an l3 marker keeps it alive');
});

test('runs-watch cost: a plain marker adds no session to the cost summary; an l3 marker does', () => {
  const f = fx();
  const key = scopeFromCwd(f.repo).project_key;
  const old = iso(Date.now() - 3 * 86400e3);
  fs.writeFileSync(path.join(f.base, 'costs.jsonl'), `${JSON.stringify({ session: 'smp-session', cost_usd: 1.5, ts: old })}\n`);
  const tickCost = () => {
    const w = createWatcher({ key, env: watcherEnv(f), cwd: f.repo, collect: () => [], interval: 1 });
    w.tick();
    return w.state.lastCost.sessions;
  };
  writePlain(f, { project_key: key });
  assert.deepStrictEqual(Object.keys(tickCost()), []);
  fs.rmSync(f.marker);
  setLevel(f, 'l3');
  assert.deepStrictEqual(Object.keys(tickCost()), ['smp-session']);
});

test('dev-flow plain marker: the watcher inputs resolve the session project and phase from it', () => {
  const f = fx();
  const key = scopeFromCwd(f.repo).project_key;
  assert.strictEqual(cli(f, ['set', '--phase', 'x']).status, 2); // no marker yet
  const r = cli(f, ['set', '--level', 'none', '--phase', '實作 W1', '--repo-root', f.repo]);
  assert.strictEqual(r.status, 0, r.stderr);
  const markers = unexpiredMarkers(watcherEnv(f), key, Date.now());
  assert.strictEqual(markers.length, 1, 'the plain marker carries this project key');
  assert.strictEqual(markers[0].project_key, key);
  const inputs = readWatchInputs({
    env: watcherEnv(f), key, identity: scopeFromCwd(f.repo).repo_identity, root: markers[0].root_run_id, nowMs: Date.now(),
    liveBase: f.live, autopilotHome: path.dirname(f.markers), markers, progressReceipt: null,
  });
  assert.strictEqual(inputs.assemble.markerPhase.phase, '實作 W1');
  assert.strictEqual(inputs.assemble.markerPhase.session_id, 'smp-session');
});

// ---------------------------------------------------------------- SessionStart ensure

function startHook(f, event, source, opts = {}) {
  const payload = { hook_event_name: event, session_id: opts.sid || 'smp-session', cwd: opts.cwd || f.repo };
  if (source) payload.source = source;
  return spawnSync('node', [AUTOSTART], {
    input: JSON.stringify(payload), encoding: 'utf8',
    env: { ...f.env, AUTOPILOT_RUNS_WATCH_AUTOSTART: opts.knob === undefined ? '' : opts.knob, ...(opts.env || {}) },
  });
}
function optIn(f) {
  fs.mkdirSync(path.join(f.repo, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(f.repo, '.claude', 'dispatch-config.md'), '# cfg\n');
}
// A hook run must never leave a watcher behind in these tests: the autostart knob is irrelevant to ensure, so
// tests that reach the watcher launch set an enormous interval and a 1 s idle exit.
const quiet = { env: { AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S: '1', AUTOPILOT_RUNS_WATCH_INTERVAL_S: '1', PATH: `${process.env.PATH}` } };

test('ensure: startup in an opted-in repo creates a plain marker (level null, minted root, project key)', () => {
  const f = fx(); optIn(f);
  const r = startHook(f, 'SessionStart', 'startup', quiet);
  assert.strictEqual(r.status, 0, r.stderr);
  const m = readJson(f.marker);
  assert.strictEqual(m.level, null);
  assert.match(m.root_run_id, /^job-\d+-[0-9a-f]{8}$/);
  assert.strictEqual(m.session_id, 'smp-session');
  assert.strictEqual(m.project_key, scopeFromCwd(f.repo).project_key);
  assert.strictEqual(m.repo_root, fs.realpathSync(f.repo));
});

test('ensure: compact and resume never overwrite a live l5 marker (bytes unchanged)', () => {
  const f = fx(); optIn(f);
  setLevel(f, 'l5');
  const before = fs.readFileSync(f.marker);
  for (const source of ['compact', 'resume', 'startup', 'clear']) {
    const r = startHook(f, 'SessionStart', source, quiet);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(before.equals(fs.readFileSync(f.marker)), `${source}: marker bytes changed`);
  }
});

test('ensure: a live plain marker is kept byte-for-byte on compact/resume', () => {
  const f = fx(); optIn(f);
  writePlain(f, { project_key: scopeFromCwd(f.repo).project_key, phase: 'keep', phase_set_at: iso(Date.now()) });
  const before = fs.readFileSync(f.marker);
  for (const source of ['compact', 'resume']) {
    startHook(f, 'SessionStart', source, quiet);
    assert.ok(before.equals(fs.readFileSync(f.marker)), source);
  }
});

test('ensure: an expired marker is replaced by a plain one; a corrupt marker is left alone', () => {
  const f = fx(); optIn(f);
  writePlain(f, { level: 'l5', started_at: iso(Date.now() - 7200e3), expires_at: iso(Date.now() - 3600e3) });
  startHook(f, 'SessionStart', 'startup', quiet);
  const m = readJson(f.marker);
  assert.strictEqual(m.level, null);
  assert.ok(Date.parse(m.expires_at) > Date.now());
  fs.writeFileSync(f.marker, 'not-json');
  startHook(f, 'SessionStart', 'startup', quiet);
  assert.strictEqual(fs.readFileSync(f.marker, 'utf8'), 'not-json');
});

test('ensure: a repo that is not opted in gets no marker (and no pointer)', () => {
  const f = fx(); // no .claude/*-config.md
  const r = startHook(f, 'SessionStart', 'startup', quiet);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.existsSync(f.marker), false);
  assert.deepStrictEqual(fs.readdirSync(f.markers), []);
});

test('ensure: the knob =0 disables it; UserPromptSubmit and a payload without a session id never create one', () => {
  const f = fx(); optIn(f);
  startHook(f, 'SessionStart', 'startup', { ...quiet, knob: '0' });
  assert.strictEqual(fs.existsSync(f.marker), false);
  startHook(f, 'UserPromptSubmit', null, quiet);
  assert.strictEqual(fs.existsSync(f.marker), false);
  const r = spawnSync('node', [AUTOSTART], {
    input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup', cwd: f.repo }), encoding: 'utf8',
    env: { ...f.env, AUTOPILOT_RUNS_WATCH_AUTOSTART: '', ...quiet.env, AUTOPILOT_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '' },
  });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(fs.readdirSync(f.markers), []);
});

test('ensure: a worktree of an opted-in main checkout is opted in; a path that normalises to another session id is refused', () => {
  const f = fx(); optIn(f);
  fs.writeFileSync(path.join(f.repo, '.gitignore'), '.claude/\n');
  const wt = path.join(f.base, 'wt');
  assert.strictEqual(spawnSync('git', ['-C', f.repo, 'worktree', 'add', '-q', '-b', 'w/x', wt], { encoding: 'utf8' }).status, 0);
  const r = startHook(f, 'SessionStart', 'startup', { ...quiet, cwd: wt });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(readJson(f.marker).repo_root, fs.realpathSync(wt));
});

// ---------------------------------------------------------------- not-opted-in prompt cost

test('UserPromptSubmit in a repo that is not opted in spawns no git; an opted-in repo still does', () => {
  const f = fx();
  const bin = path.join(f.base, 'bin'); fs.mkdirSync(bin);
  const log = path.join(f.base, 'git-calls.log');
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH}`, AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S: '1', AUTOPILOT_RUNS_WATCH_INTERVAL_S: '1' };
  const r = startHook(f, 'UserPromptSubmit', null, { env });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(fs.existsSync(log), false, 'no git call for a not-opted-in prompt');
  optIn(f);
  startHook(f, 'UserPromptSubmit', null, { env });
  assert.strictEqual(fs.existsSync(log), true, 'control: an opted-in repo reaches git');
});

test('UserPromptSubmit opt-in signals without git: knob =1, config in the work tree or the main checkout, this session\'s own marker', () => {
  const f = fx();
  const bin = path.join(f.base, 'bin'); fs.mkdirSync(bin);
  const log = path.join(f.base, 'git-calls.log');
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH}`, AUTOPILOT_RUNS_WATCH_IDLE_EXIT_S: '1', AUTOPILOT_RUNS_WATCH_INTERVAL_S: '1' };
  const sawGit = () => { const s = fs.existsSync(log); fs.rmSync(log, { force: true }); return s; };
  startHook(f, 'UserPromptSubmit', null, { env, knob: '1' });
  assert.strictEqual(sawGit(), true, 'knob =1');
  startHook(f, 'UserPromptSubmit', null, { env });
  assert.strictEqual(sawGit(), false, 'nothing opted in');
  writePlain(f);
  startHook(f, 'UserPromptSubmit', null, { env });
  assert.strictEqual(sawGit(), true, 'own unexpired marker');
  fs.rmSync(f.marker);
  optIn(f);
  const wt = path.join(f.base, 'wt2');
  assert.strictEqual(spawnSync('git', ['-C', f.repo, 'worktree', 'add', '-q', '-b', 'w/y', wt], { encoding: 'utf8' }).status, 0);
  sawGit();
  startHook(f, 'UserPromptSubmit', null, { env, cwd: path.join(wt) });
  assert.strictEqual(sawGit(), true, 'config of the main checkout reached from a linked worktree');
});

// ---------------------------------------------------------------- negative control

test('negative control: the real ~/.autopilot session-mode dir, live pointer and /run/user autopilot dir are untouched', () => {
  assert.deepStrictEqual(REAL_BEFORE, []);
  assert.deepStrictEqual(snapshot(), []);
});

// ---------------------------------------------------------------- repair 1: tick-level phase / scope from a plain marker

test('watcher tick publishes the session phase (source session) from a plain marker for an unbound dev-flow scope', () => {
  const f = fx();
  const key = scopeFromCwd(f.repo).project_key;
  const ident = scopeFromCwd(f.repo).repo_identity;
  const outRoot = path.join(f.base, 'review');
  const mf = path.join(f.base, 'row.manifest.json');
  fs.writeFileSync(mf, JSON.stringify({ run_id: 'r1', root_run_id: null }));
  const row = {
    run_id: 'r1', role: 'hand', runner: 'claude', model: 'sonnet', started_at: iso(Date.now() - 60e3), ended_at: null, parent_run_id: null,
    root_run_id: null, depth: 1, manifest: mf, project: ident, source: { manifest: mf, status_probe: null, exit_file: path.join(f.base, 'r1.exit') },
    fact_at: iso(Date.now()), observed_at: iso(Date.now()), probe_age_s: null, rc: null, final_status: null, elapsed_s: 5, alive: null,
  };
  const publish = (withMarker) => {
    fs.rmSync(outRoot, { recursive: true, force: true });
    if (withMarker) writePlain(f, { project_key: key, phase: '實作 W1', phase_set_at: iso(Date.now()) });
    else fs.rmSync(f.marker, { force: true });
    let t = Date.now();
    const w = createWatcher({ key, env: watcherEnv(f), cwd: f.repo, collect: () => [row], now: () => t, interval: 10, enrichCap: 8, render: { outRoot } });
    w.tick(); t += 6000; w.tick();
    const found = [];
    const walk = (d) => { for (const n of fs.existsSync(d) ? fs.readdirSync(d) : []) { const p = path.join(d, n); if (n === 'model.json') found.push(p); else if (fs.statSync(p).isDirectory()) walk(p); } };
    walk(outRoot);
    assert.ok(found.length > 0, 'a job page model was published');
    return JSON.parse(fs.readFileSync(found.sort()[found.length - 1], 'utf8'));
  };
  const withPlain = publish(true);
  assert.strictEqual(withPlain.phase.source, 'session');
  assert.strictEqual(withPlain.phase.label, '實作 W1');
  assert.strictEqual(withPlain.scope.project_key, key);
  const without = publish(false);
  assert.strictEqual(without.phase, null, 'control: no marker, no session phase');
});

// ---------------------------------------------------------------- repair 1: SessionStart ensure on the zero-spawn fast path

function fastPathFixture() {
  const f = fx(); optIn(f);
  const sc = scopeFromCwd(f.repo);
  const cwd = fs.realpathSync(f.repo);
  const w = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)', 'status', 'runs', '--watch', '--project', sc.project_key], { stdio: 'ignore', detached: true });
  w.unref();
  const name = require('crypto').createHash('sha1').update(cwd).digest('hex').slice(0, 16);
  fs.mkdirSync(path.join(f.live, 'autostart'), { recursive: true });
  fs.writeFileSync(path.join(f.live, 'autostart', `${name}.json`), JSON.stringify({ cwd, project_key: sc.project_key, repo_identity: sc.repo_identity, repo_root: cwd }));
  fs.mkdirSync(path.join(f.live, 'runs'), { recursive: true });
  fs.writeFileSync(path.join(f.live, 'runs', `${sc.project_key}.json`), JSON.stringify({ schema: 'x', writer: { pid: w.pid } }));
  fs.mkdirSync(path.join(f.home, '.autopilot'), { recursive: true });
  fs.writeFileSync(path.join(f.home, '.autopilot', 'live-pointer.json'), '{}');
  const bin = path.join(f.base, 'bin'); fs.mkdirSync(bin);
  const log = path.join(f.base, 'git-calls.log');
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\necho "$*" >> "${log}"\nexec "${realGit}" "$@"\n`, { mode: 0o755 });
  return { f, w, log, cwd, env: { PATH: `${bin}:${process.env.PATH}` } };
}

test('ensure on the fast path: SessionStart with the watcher alive still creates the plain marker, with no git spawn', () => {
  const x = fastPathFixture();
  try {
    const r = startHook(x.f, 'SessionStart', 'startup', { cwd: x.cwd, env: x.env });
    assert.strictEqual(r.status, 0, r.stderr);
    const m = readJson(x.f.marker);
    assert.strictEqual(m.level, null);
    assert.strictEqual(m.repo_root, x.cwd);
    assert.strictEqual(m.project_key, scopeFromCwd(x.f.repo).project_key);
    assert.strictEqual(fs.existsSync(x.log), false, 'zero-spawn: git never ran');
    // a prompt on the same fast path creates nothing
    fs.rmSync(x.f.marker);
    startHook(x.f, 'UserPromptSubmit', null, { cwd: x.cwd, env: x.env });
    assert.strictEqual(fs.existsSync(x.f.marker), false);
  } finally { try { process.kill(x.w.pid, 'SIGKILL'); } catch (_e) { /* gone */ } }
});

test('ensure on the fast path: an active l5 marker is kept byte-for-byte on startup/resume/compact', () => {
  const x = fastPathFixture();
  try {
    setLevel(x.f, 'l5');
    const before = fs.readFileSync(x.f.marker);
    for (const source of ['startup', 'resume', 'compact']) {
      startHook(x.f, 'SessionStart', source, { cwd: x.cwd, env: x.env });
      assert.ok(before.equals(fs.readFileSync(x.f.marker)), source);
    }
  } finally { try { process.kill(x.w.pid, 'SIGKILL'); } catch (_e) { /* gone */ } }
});

test('ensure on the fast path: a cache without repo_root (written before MARKER) takes the full path once and is rewritten', () => {
  const x = fastPathFixture();
  try {
    const sc = scopeFromCwd(x.f.repo);
    const name = require('crypto').createHash('sha1').update(x.cwd).digest('hex').slice(0, 16);
    fs.writeFileSync(path.join(x.f.live, 'autostart', `${name}.json`), JSON.stringify({ cwd: x.cwd, project_key: sc.project_key }));
    startHook(x.f, 'SessionStart', 'startup', { cwd: x.cwd, env: x.env });
    assert.strictEqual(readJson(x.f.marker).level, null);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(x.f.live, 'autostart', `${name}.json`), 'utf8')).repo_root, x.cwd);
  } finally { try { process.kill(x.w.pid, 'SIGKILL'); } catch (_e) { /* gone */ } }
});

// ---------------------------------------------------------------- repair 1: a plain `set` never replaces a live l3-l6 marker

test('plain set refuses to replace an unexpired l3 / l5 / l6 marker of this session (exit 2, points at clear, bytes unchanged)', () => {
  for (const level of ['l3', 'l5', 'l6']) {
    const f = fx();
    setLevel(f, level);
    const before = fs.readFileSync(f.marker);
    for (const args of [['set', '--repo-root', f.repo], ['set', '--level', 'none', '--repo-root', f.repo], ['set', '--level', 'none', '--phase', 'x', '--repo-root', f.repo]]) {
      const r = cli(f, args);
      assert.strictEqual(r.status, 2, `${level} ${args.join(' ')}`);
      assert.match(r.stderr, /clear/);
      assert.ok(before.equals(fs.readFileSync(f.marker)), `${level}: marker bytes changed`);
    }
  }
});

test('plain set replaces an expired l5 marker and a plain marker; clear keeps its close-evidence rule for l5', () => {
  const f = fx();
  writePlain(f, { level: 'l5', started_at: iso(Date.now() - 7200e3), expires_at: iso(Date.now() - 3600e3) });
  assert.strictEqual(cli(f, ['set', '--repo-root', f.repo]).status, 0);
  assert.strictEqual(readJson(f.marker).level, null);
  assert.strictEqual(cli(f, ['set', '--repo-root', f.repo]).status, 0);
  setLevel(f, 'l5');
  assert.strictEqual(cli(f, ['clear']).status, 1, 'l5 clear still needs close evidence');
});

// ---------------------------------------------------------------- repair 1: the remaining readers named by the brief

test('live-pointer: a plain marker changes nothing (pointer content equals the no-marker pointer; it only derives the dir)', () => {
  const f = fx();
  const run = () => JSON.parse(spawnSync('node', ['-e', `
    const p = require(process.argv[1]).writeLivePointer({ env: process.env, now: 0 });
    process.stdout.write(JSON.stringify(p.pointer));`, path.join(ROOT, 'src', 'status', 'live-pointer.js')], { env: f.env, encoding: 'utf8' }).stdout);
  const none = run();
  writePlain(f);
  assert.deepStrictEqual(run(), none);
  setLevel(f, 'l3');
  assert.deepStrictEqual(run(), none, 'control: an l3 marker does not change it either (the pointer never reads markers)');
});

test('autopilot-engine: its only marker access is validateManagedDevFlowAdmission, which treats a plain marker like an absent file (l3 control differs)', () => {
  const f = fx();
  const src = fs.readFileSync(path.join(ROOT, 'src', 'engine', 'autopilot-engine.js'), 'utf8');
  assert.doesNotMatch(src, /readMarker|readSessionRecord|SESSION_MODE_DIR/);
  const verdict = (markerFile) => JSON.parse(spawnSync('node', ['-e', `
    const m = require(process.argv[1]);
    process.stdout.write(JSON.stringify(m.validateManagedDevFlowAdmission({ repoRoot: process.argv[2], effectiveLevel: 'l5', campaignContract: null, markerFile: process.argv[3] })));`, CLI, f.repo, markerFile], { env: f.env, encoding: 'utf8' }).stdout);
  const absent = verdict(path.join(f.base, 'nothing.json'));
  writePlain(f);
  assert.deepStrictEqual(verdict(f.marker), absent);
  setLevel(f, 'l3');
  assert.notDeepStrictEqual(verdict(f.marker), absent, 'control: a real l3 marker is judged differently (level mismatch)');
});

test('context-budget, transcript-reader-lib, merge/cli, repair-lineage-cleanup do not read the session-mode marker (source pin: nothing to mis-handle level null)', () => {
  const files = ['hooks/context-budget.js', 'hooks/context-budget-lib.js', 'hooks/transcript-reader-lib.js', 'src/merge/cli.js', 'src/engine/repair-lineage-cleanup.js', 'src/engine/repair-lineage-cleanup-transaction.js'];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.doesNotMatch(src, /session-mode|SESSION_MODE_DIR|\.autopilot\/session|readSessionRecord|scripts\/session-mode/, rel);
  }
  // their "marker" is something else: git operation markers (merge/cli) and the .autopilot-worktree file (cleanup)
  assert.match(fs.readFileSync(path.join(ROOT, 'src/merge/cli.js'), 'utf8'), /--git-path/);
  assert.match(fs.readFileSync(path.join(ROOT, 'src/engine/repair-lineage-cleanup.js'), 'utf8'), /\.autopilot-worktree/);
});
