'use strict';
// Tests for check-quota-adapters.js (G40-N27, N28, N72 and the shipped Claude manifest). Titles carry the G40-N prefix.
// The checker reads the evidence files a manifest names (the capability matrix inside this repo, read-only) and nothing
// a credential_ref points at. No real credentials, no ~/.claude, no live directory.
// Run: node --test scripts/check-quota-adapters.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const c = require('./check-quota-adapters');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(__dirname, 'check-quota-adapters.js');
const SHIPPED = JSON.parse(fs.readFileSync(path.join(__dirname, 'quota-adapters', 'claude.json'), 'utf8'));

function realCtx(extra) {
  return Object.assign({
    fileProvider: 'claude',
    evidenceDir: c.EVIDENCE_DIR,
    exists: (rel) => { try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (_) { return false; } },
    readText: (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (_) { return null; } },
  }, extra || {});
}
function manifest(mut) {
  const m = JSON.parse(JSON.stringify(SHIPPED));
  if (mut) mut(m);
  return m;
}
const probe = (m) => m.capture.find((x) => x.mode === 'tinyprobe');
const rules = (m, ctx) => c.checkManifest(m, ctx || realCtx()).map((f) => f.rule);
const has = (m, rule, detailRe) => c.checkManifest(m, realCtx()).some((f) => f.rule === rule && (!detailRe || detailRe.test(f.detail)));

test('G40-N27 the shipped Claude manifest passes the checker, as a library call and through the CLI', () => {
  assert.deepStrictEqual(c.checkManifest(SHIPPED, realCtx()), []);
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8', input: '', cwd: ROOT });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /1 manifest\(s\) ok/);
});

test('G40-N27 a verified:true capture with no evidence, or a manifest with no matrix_row, fails', () => {
  assert.ok(has(manifest((m) => { delete m.capture[0].evidence; }), 'verified_evidence', /passive:evidence_missing/));
  assert.ok(has(manifest((m) => { delete probe(m).evidence; }), 'verified_evidence', /tinyprobe:evidence_missing/));
  assert.ok(has(manifest((m) => { m.capture[0].evidence = 'docs/plans/evidence/nope/not-there.md'; }), 'verified_evidence', /evidence_path_missing/));
  assert.ok(has(manifest((m) => { delete m.matrix_row; }), 'matrix_row', /missing_or_malformed/));
  assert.ok(has(manifest((m) => { m.matrix_row = 'capability-matrix.md#no-such-provider'; }), 'matrix_row', /anchor_not_found/));
  assert.ok(has(manifest((m) => { m.matrix_row = 'absent-file.md#claude'; }), 'matrix_row', /matrix_file_missing/));
});

test('G40-N27 a manifest with starts_window missing fails; true or false needs its own evidence', () => {
  assert.ok(has(manifest((m) => { delete m.starts_window; }), 'starts_window', /missing/));
  assert.ok(has(manifest((m) => { m.starts_window = 'maybe'; }), 'starts_window', /enum/));
  assert.ok(has(manifest((m) => { m.starts_window = true; }), 'starts_window_evidence'));
  assert.deepStrictEqual(rules(manifest((m) => { m.starts_window = false; m.starts_window_evidence = m.capture[0].evidence; })), []);
});

test('G40-N27 a verified tinyprobe whose argv_template is not byte-equal to the evidenced command fails', () => {
  const broken = [
    (t) => { t.splice(t.indexOf('--no-session-persistence'), 1); },
    (t) => { t[t.indexOf('haiku')] = 'sonnet'; },
    (t) => { t.push('--strict-mcp-config'); },
    (t) => { t[t.indexOf('--tools') + 1] = 'Bash'; },
    (t) => { const i = t.indexOf('--verbose'); t.splice(i, 1); t.splice(t.indexOf('--output-format'), 0, '--verbose'); },
    (t) => { t[0] = 'claude-code'; },
  ];
  for (const f of broken) {
    const m = manifest((x) => f(probe(x).argv_template));
    assert.ok(has(m, 'tinyprobe_argv'), JSON.stringify(probe(m).argv_template));
  }
  assert.ok(has(manifest((m) => { probe(m).argv_template = probe(m).argv_template.map((x) => (x === '<PROMPT>' ? 'ok' : x)); }), 'tinyprobe_argv', /placeholder_count/));
  assert.ok(has(manifest((m) => { delete probe(m).argv_template; }), 'tinyprobe_argv', /argv_template_missing/));
  assert.deepStrictEqual(c.checkManifest(manifest(), realCtx()), [], 'the unbroken template, with <PROMPT> read as the evidenced prompt, passes');
});

test('G40-N27 a manifest enabling a capture marked verified:false fails; an unverified capture needs its note; visibility needs a verified capture', () => {
  assert.ok(has(manifest((m) => { m.capture[1].enabled = true; }), 'verified_false_enabled'));
  assert.ok(has(manifest((m) => { delete m.capture[1].note; }), 'capture', /note_required_when_unverified/));
  const none = manifest((m) => { m.capture[0].verified = false; m.capture[0].note = 'x'; probe(m).verified = false; probe(m).note = 'x'; });
  assert.ok(has(none, 'visibility_unverified'));
  none.visibility = 'L0';
  assert.strictEqual(has(none, 'visibility_unverified'), false, 'L0 needs nothing verified');
});

test('G40-N27 captures must be unique and listed cheapest first', () => {
  assert.ok(has(manifest((m) => { m.capture.reverse(); }), 'capture_order'));
  assert.ok(has(manifest((m) => { m.capture.push(JSON.parse(JSON.stringify(m.capture[0]))); }), 'capture_order'));
});

test('G40-N28 a credential_ref carrying a value, or a path outside the allowed roots, fails', () => {
  const fileRefs = [
    ['sk', 'ant-oat01-abcdefghijklmnopqrstuvwxyz'].join('-'), 'FAKE-token-a-0', 'KEY=abc', 'TOKEN=sk-ant-x', ['https://u:p', 'h.invalid/x'].join(String.fromCharCode(64)),
    'file:///etc/passwd', '/etc/passwd', ['', 'home', 'someone', '.claude/.credentials.json'].join('/'), '~/.claude/.credentials.json',
    '<accounts-dir>/../../etc/passwd', '<accounts-dir>/<alias>/../x', '<accounts-dir>/other/token', 'accounts/<alias>/token',
    '<accounts-dir>/<alias>/', '<accounts-dir>/<alias>/to ken', '<other-dir>/<alias>/token', '<accounts-dir>/<alias>/a'.padEnd(80, 'b'),
  ];
  for (const p of fileRefs) {
    const m = manifest((x) => { x.credential_ref = { kind: 'file', path: p }; });
    assert.ok(has(m, 'credential_ref', /^file_path:/), p);
  }
  assert.ok(has(manifest((x) => { x.credential_ref = { kind: 'file', path: '<accounts-dir>/<alias>/token', value: 'abc' }; }), 'credential_ref', /unknown_key/));
  assert.ok(has(manifest((x) => { x.credential_ref = { kind: 'keychain', item: 'x' }; }), 'credential_ref', /kind/));
});

test('G40-N28 an env credential_ref whose name is followed by = and a value, or does not match its pattern, fails the same way', () => {
  const good = { kind: 'env', name: 'ANTHROPIC_AUTH_TOKEN', file: '<accounts-dir>/<alias>/env' };
  assert.deepStrictEqual(rules(manifest((x) => { x.credential_ref = good; })), []);
  for (const name of ['ANTHROPIC_AUTH_TOKEN=abc123', 'lowercase', 'HAS SPACE', '', 'A'.repeat(65), 'X-Y']) {
    assert.ok(has(manifest((x) => { x.credential_ref = Object.assign({}, good, { name }); }), 'credential_ref', /env_name/), name);
  }
  assert.ok(has(manifest((x) => { x.credential_ref = Object.assign({}, good, { file: '/etc/env' }); }), 'credential_ref', /^env_file:/));
  assert.ok(has(manifest((x) => { x.credential_ref = Object.assign({}, good, { file: 'A_KEY=FAKE-1' }); }), 'credential_ref', /^env_file:/));
});

test('G40-N28 the checker never opens what a credential_ref points at: judged on the string alone', () => {
  const touched = [];
  const names = ['openSync', 'readFileSync', 'statSync', 'lstatSync', 'existsSync', 'accessSync', 'readdirSync', 'realpathSync', 'readlinkSync', 'opendirSync'];
  const saved = {};
  for (const n of names) {
    saved[n] = fs[n];
    fs[n] = function spy(p, ...rest) { touched.push(String(p)); return saved[n].call(fs, p, ...rest); };
  }
  try {
    // an unreadable fixture file sits where a naive checker would resolve the template
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g40-n28-'));
    const tok = path.join(dir, 'token');
    fs.writeFileSync(tok, 'FAKE-never-read');
    fs.chmodSync(tok, 0o000);
    try {
      const ok = manifest((x) => { x.credential_ref = { kind: 'file', path: '<accounts-dir>/<alias>/token' }; });
      assert.deepStrictEqual(c.checkManifest(ok, realCtx()), []);
      const bad = manifest((x) => { x.credential_ref = { kind: 'file', path: `${tok}` }; });
      assert.ok(c.checkManifest(bad, realCtx()).some((f) => f.rule === 'credential_ref'));
      const env = manifest((x) => { x.credential_ref = { kind: 'env', name: 'SOME_TOKEN', file: '<accounts-dir>/<alias>/env' }; });
      assert.deepStrictEqual(c.checkManifest(env, realCtx()), []);
    } finally { fs.chmodSync(tok, 0o600); fs.rmSync(dir, { recursive: true, force: true }); }
  } finally { for (const n of names) fs[n] = saved[n]; }
  const credentialish = touched.filter((p) => /token|accounts|alias|\.env|FAKE|g40-n28/.test(p) && !/capability-matrix/.test(p));
  assert.deepStrictEqual(credentialish, [], 'only evidence files were opened');
  assert.ok(touched.some((p) => /capability-matrix\.md/.test(p)), 'the spy is live: it saw the evidence read');
});

test('G40-N72 a manifest at L2 or L3 with no required window fails the checker; one with a required window passes', () => {
  for (const vis of ['L2', 'L3']) {
    assert.ok(has(manifest((m) => { m.visibility = vis; m.windows.forEach((w) => { w.required = false; }); }), 'required_window'), vis);
    assert.strictEqual(has(manifest((m) => { m.visibility = vis; }), 'required_window'), false, vis);
  }
  assert.strictEqual(has(manifest((m) => { m.visibility = 'L1'; m.windows.forEach((w) => { w.required = false; }); }), 'required_window'), false, 'L1 has no window to require');
  assert.ok(has(manifest((m) => { m.windows = []; }), 'windows', /missing/));
});

test('G40-D1 manifest grammar: unknown key, wrong schema, provider vs file name, window entry, token_lifetime', () => {
  assert.ok(has(manifest((m) => { m.extra = 1; }), 'unknown_key'));
  assert.ok(has(manifest((m) => { m.schema = 'fleet.quota-adapter/2'; }), 'schema'));
  assert.ok(has(manifest((m) => { m.provider = 'glm'; }), 'provider', /file_name_mismatch/));
  assert.ok(has(manifest((m) => { m.provider = 'Claude'; }), 'provider', /grammar/));
  assert.ok(has(manifest((m) => { m.windows[0].kind = 'hourly'; }), 'windows', /entry/));
  assert.ok(has(manifest((m) => { m.windows[1].kind = 'rolling_5h'; }), 'windows', /duplicate_kind/));
  assert.ok(has(manifest((m) => { m.token_lifetime = { days: 365 }; }), 'token_lifetime', /days_without_evidence/));
  assert.deepStrictEqual(rules(manifest((m) => { m.token_lifetime = { days: null, evidence: null }; })), []);
  assert.ok(has(manifest((m) => { m.token_lifetime = { days: -1, evidence: 'https://x.invalid/a' }; }), 'token_lifetime', /days/));
  assert.ok(has(manifest((m) => { m.capture[0].evidence = 'http://x.invalid/a'; }), 'verified_evidence'));
  assert.ok(has(manifest((m) => { m.capture[0].evidence = ['https://u', 'h.invalid/a'].join(String.fromCharCode(64)); }), 'verified_evidence'));
});

test('G40-D1 helpers: the tokenizer keeps "" as an empty argument; the matrix section is found by heading slug', () => {
  assert.deepStrictEqual(c.tokenize('claude -p ok --tools "" --x'), ['claude', '-p', 'ok', '--tools', '', '--x']);
  assert.deepStrictEqual(c.tokenize('a "b c" \'d e\''), ['a', 'b c', 'd e']);
  const text = '# t\n## alpha beta\nline1\n## gamma\nline2\n';
  assert.deepStrictEqual(c.matrixSection(text, 'alpha'), ['line1']);
  assert.deepStrictEqual(c.matrixSection(text, 'alpha-beta'), ['line1']);
  assert.deepStrictEqual(c.matrixSection(text, 'gamma'), ['line2', '']);
  assert.strictEqual(c.matrixSection(text, 'alp'), null);
});

function cliWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g40-qa-'));
  try {
    for (const [n, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), typeof body === 'string' ? body : JSON.stringify(body));
    return spawnSync(process.execPath, [CLI, '--dir', dir, '--json'], { encoding: 'utf8', input: '', cwd: ROOT });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('G40-D1 CLI: a broken manifest exits 1 with its findings as JSON, a directory with no manifest exits 2', () => {
  const broken = manifest((m) => { delete m.starts_window; });
  const r = cliWith({ 'claude.json': broken });
  assert.strictEqual(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.ok, false);
  assert.deepStrictEqual(j.findings.map((f) => `${f.file}:${f.rule}`), ['claude.json:starts_window']);
  assert.strictEqual(cliWith({ 'notes.txt': 'x' }).status, 2);
  const bad = cliWith({ 'claude.json': '{not json' });
  assert.strictEqual(bad.status, 1);
  assert.strictEqual(JSON.parse(bad.stdout).findings[0].detail, 'unreadable_or_not_json');
});

test('G40-D1 the token shapes have one source: the checker uses the validator\'s list, and an exact slug beats a prefix match', () => {
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'check-quota-adapters.js'), 'utf8'), /const TOKEN_SHAPES\s*=/);
  assert.strictEqual(Object.isFrozen(require('./lib/account-observation').TOKEN_SHAPES), true, 'the shared list cannot be edited by a consumer');
  const text = '## claude code\nprefix body\n## claude\nexact body\n';
  assert.deepStrictEqual(c.matrixSection(text, 'claude'), ['exact body', '']);
  assert.deepStrictEqual(c.matrixSection('## claude code\nonly prefix\n', 'claude'), ['only prefix', '']);
});
