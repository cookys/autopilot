'use strict';
// scripts/status-events-src-dq.test.js - E2 readers `dispatch` and `qc`, plus `redact.js` (autopilot.events/1).
// Plan: project/plans/2026-11-02-oc-a1-events-contract.md (E2 steps 3 and 5, section 3 redact.js).
// Isolation: every dir is an os.tmpdir() mkdtemp dir; the fixture env is an explicit allowlist; nothing touches the real stores.
// Secret, e-mail and home-path shaped strings are assembled at run time so the source holds no such literal (leak-guard).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { buildFixture, goldenEvents } = require('./lib/events-fixture');
const dispatch = require('../src/status/events/sources/dispatch');
const qc = require('../src/status/events/sources/qc');
const redact = require('../src/status/events/redact');
const personal = require('./lib/personal-data-redact');

const cleanup = [];
test.after(() => { for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true }); });
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'status-events-dq-'));
  cleanup.push(dir);
  return buildFixture({ dir });
}
const byTsId = (a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const ctxOf = (fx, over = {}) => ({
  project: { project_key: fx.projectKey, repo_identity: fx.identity, root: fx.repoDir, repo_name: fx.repoName },
  env: fx.env, home: fx.env.HOME, now: Date.parse('2026-11-02T08:00:00Z'), ...over,
});
const COLD = { sinceTs: null, slackMs: 300000, hints: {} };
const codes = (result) => result.warnings.map((w) => w.code).sort();
const PIN_MAIL = ['a', 'fixture.invalid'].join('@');
const FX = fresh();
const GOLDEN = goldenEvents(FX);
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// ---- source-dispatch -----------------------------------------------------------------------------------------------

test('source-dispatch: started and ended events equal the golden ones, the foreign manifest is filtered', () => {
  const r = dispatch.read(ctxOf(FX), COLD);
  assert.deepEqual(r.events.slice().sort(byTsId), GOLDEN.filter((e) => e.kind.startsWith('dispatch.')));
  assert.equal(r.stats.state, 'ok');
  assert.equal(r.stats.rows_read, 3);
  assert.equal(r.stats.rows_filtered, 1);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.events.some((e) => e.run_id === 'fx-run-foreign'), false);
  // internal-only fields never leak into data
  for (const e of r.events) for (const k of ['repo_identity', 'prompt_file', 'log_path', 'worktree', 'lock_path', 'cwd']) assert.equal(k in e.data, false, k);
});

test('source-dispatch: the running manifest yields only dispatch.started', () => {
  const r = dispatch.read(ctxOf(FX), COLD);
  const live = r.events.filter((e) => e.run_id === 'fx-run-live').map((e) => e.kind);
  assert.deepEqual(live, ['dispatch.started']);
});

test('source-dispatch: panel-* manifests are skipped without a warning', () => {
  const fx = fresh();
  fs.writeFileSync(path.join(fx.paths.runsDir, 'panel-x.manifest.json'), '{not json at all');
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.events.length, 3);
});

test('source-dispatch: a manifest whose mtime is older than sinceTs - slack is skipped on a stat alone', () => {
  const fx = fresh();
  const old = new Date('2026-11-01T08:00:00Z');
  for (const name of fs.readdirSync(fx.paths.runsDir)) fs.utimesSync(path.join(fx.paths.runsDir, name), old, old);
  const since = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(dispatch.read(ctxOf(fx), { sinceTs: since, slackMs: 300000, hints: {} }).events.length, 0);
  // within the slack the file is still read
  const within = dispatch.read(ctxOf(fx), { sinceTs: old.getTime() + 60000, slackMs: 300000, hints: {} });
  assert.equal(within.events.length, 3);
  // a corrupt old manifest is not even opened (so no warning) - proof the stat comes first
  const bad = path.join(fx.paths.runsDir, 'old-bad.manifest.json');
  fs.writeFileSync(bad, '{');
  fs.utimesSync(bad, old, old);
  assert.deepEqual(dispatch.read(ctxOf(fx), { sinceTs: since, slackMs: 300000, hints: {} }).warnings, []);
});

test('source-dispatch: a manifest of another repo, or without repo_identity, is only counted in rows_filtered', () => {
  const fx = fresh();
  const m = JSON.parse(fs.readFileSync(path.join(fx.paths.runsDir, 'fx-run-done.manifest.json'), 'utf8'));
  delete m.repo_identity;
  m.run_id = 'fx-run-noid';
  fs.writeFileSync(path.join(fx.paths.runsDir, 'fx-run-noid.manifest.json'), JSON.stringify(m));
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.equal(r.stats.rows_filtered, 2);
  assert.equal(r.events.some((e) => e.run_id === 'fx-run-noid'), false);
  assert.deepEqual(r.warnings, []);
});

test('source-dispatch: runs dir comes from env (AUTOPILOT_DISPATCH_RUNS_DIR), never a hard-coded place', () => {
  const fx = fresh();
  const elsewhere = path.join(fx.dir, 'elsewhere');
  const r = dispatch.read(ctxOf(fx, { env: { ...fx.env, AUTOPILOT_DISPATCH_RUNS_DIR: elsewhere } }), COLD);
  assert.equal(r.stats.state, 'absent');
  assert.equal(fs.existsSync(elsewhere), false, 'read-only: the missing dir is not created');
});

// ---- degrade-dispatch-* --------------------------------------------------------------------------------------------

test('degrade-dispatch-absent: a missing runs dir is state absent with no warning', () => {
  const fx = fresh();
  fs.rmSync(fx.paths.runsDir, { recursive: true });
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.equal(r.stats.state, 'absent');
  assert.deepEqual(r.events, []);
  assert.deepEqual(r.warnings, []);
});

test('degrade-dispatch-empty: an empty runs dir is ok with no event and no warning', () => {
  const fx = fresh();
  for (const name of fs.readdirSync(fx.paths.runsDir)) fs.rmSync(path.join(fx.paths.runsDir, name));
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.equal(r.stats.state, 'ok');
  assert.deepEqual([r.events, r.warnings], [[], []]);
});

test('degrade-dispatch-unparseable: a corrupt manifest warns line_unparseable with the basename only; the rest survive', () => {
  const fx = fresh();
  fs.writeFileSync(path.join(fx.paths.runsDir, 'zz-corrupt.manifest.json'), '{"run_id": "x", ');
  fs.writeFileSync(path.join(fx.paths.runsDir, 'zz-binary.manifest.json'), Buffer.from([0, 1, 2, 0xff, 0]));
  fs.writeFileSync(path.join(fx.paths.runsDir, 'zz-empty.manifest.json'), '');
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.equal(r.events.length, 3);
  const w = r.warnings.find((x) => x.code === 'line_unparseable');
  assert.equal(w.count, 3);
  assert.match(w.detail, /zz-(corrupt|binary|empty)\.manifest\.json/);
  assert.equal(w.detail.includes('/'), false, 'basenames only, never a path');
  assert.equal(r.stats.state, 'degraded');
  assert.equal(r.stats.rows_skipped, 3);
});

test('degrade-dispatch-wrong-schema: JSON that is not a manifest object warns schema_mismatch', () => {
  const fx = fresh();
  fs.writeFileSync(path.join(fx.paths.runsDir, 'zz-array.manifest.json'), '[1,2]');
  fs.writeFileSync(path.join(fx.paths.runsDir, 'zz-norun.manifest.json'), JSON.stringify({ role: 'x', repo_identity: fx.identity }));
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.equal(r.events.length, 3);
  assert.deepEqual(codes(r), ['schema_mismatch']);
  assert.equal(r.warnings[0].count, 2);
});

test('degrade-dispatch-ts-invalid: an unparseable started_at drops that event (ts_invalid), never invents a time', () => {
  const fx = fresh();
  const p = path.join(fx.paths.runsDir, 'fx-run-live.manifest.json');
  const m = JSON.parse(fs.readFileSync(p, 'utf8'));
  m.started_at = '2026-02-30T00:00:00Z';
  fs.writeFileSync(p, JSON.stringify(m));
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.equal(r.events.some((e) => e.run_id === 'fx-run-live'), false);
  assert.deepEqual(codes(r), ['ts_invalid']);
  // a bad ended_at keeps the started event
  const d = path.join(fx.paths.runsDir, 'fx-run-done.manifest.json');
  const md = JSON.parse(fs.readFileSync(d, 'utf8'));
  md.ended_at = 'yesterday';
  fs.writeFileSync(d, JSON.stringify(md));
  const r2 = dispatch.read(ctxOf(fx), COLD);
  assert.deepEqual(r2.events.filter((e) => e.run_id === 'fx-run-done').map((e) => e.kind), ['dispatch.started']);
});

test('degrade-dispatch-mode000: an unreadable manifest warns file_unreadable', { skip: isRoot && 'uid 0 ignores file modes' }, () => {
  const fx = fresh();
  const p = path.join(fx.paths.runsDir, 'fx-run-live.manifest.json');
  fs.chmodSync(p, 0);
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.deepEqual(codes(r), ['file_unreadable']);
  assert.equal(r.events.some((e) => e.run_id === 'fx-run-live'), false);
  fs.chmodSync(p, 0o644);
});

test('degrade-dispatch-runsdir-unreadable: a runs dir that cannot be listed warns file_unreadable', { skip: isRoot && 'uid 0 ignores file modes' }, () => {
  const fx = fresh();
  fs.chmodSync(fx.paths.runsDir, 0);
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.deepEqual(codes(r), ['file_unreadable']);
  assert.equal(r.stats.state, 'degraded');
  fs.chmodSync(fx.paths.runsDir, 0o755);
});

test('degrade-dispatch-10mb: a 10 MB manifest is skipped with line_too_long, not loaded', () => {
  const fx = fresh();
  fs.writeFileSync(path.join(fx.paths.runsDir, 'zz-huge.manifest.json'), `{"run_id":"huge","pad":"${'x'.repeat(10 * 1024 * 1024)}"}`);
  const r = dispatch.read(ctxOf(fx), COLD);
  assert.equal(r.events.length, 3);
  assert.deepEqual(codes(r), ['line_too_long']);
});

test('degrade-dispatch-never-throws: garbage ctx and window return a result', () => {
  for (const [ctx, window] of [[undefined, undefined], [null, null], [{}, {}], [{ project: null, env: null }, { sinceTs: 'zzz', slackMs: 'x' }]]) {
    const r = dispatch.read(ctx, window);
    assert.ok(Array.isArray(r.events) && Array.isArray(r.warnings) && r.stats);
  }
});

// ---- source-qc ------------------------------------------------------------------------------------------------------

test('source-qc: one qc.verdict per commit with a trailer, golden ids, the +01:00 %cI date normalised to UTC', () => {
  const r = qc.read(ctxOf(FX), COLD);
  const golden = GOLDEN.filter((e) => e.kind === 'qc.verdict');
  assert.deepEqual(r.events.slice().sort(byTsId), golden);
  const pass = r.events.find((e) => e.data.verdict === 'PASS');
  assert.equal(pass.ts, '2026-11-01T08:30:00.000Z'); // committed 09:30+01:00
  assert.equal(pass.data.basis, 'self_reported');
  assert.equal(r.stats.rows_read, 3);
  assert.equal(r.stats.rows_filtered, 1); // the commit without a trailer
  assert.deepEqual(r.warnings, []);
  assert.equal(r.stats.state, 'ok');
});

test('source-qc: --since is sinceTs minus the slack', () => {
  const since = Date.parse('2026-11-01T10:00:00Z');
  const tight = qc.read(ctxOf(FX), { sinceTs: since, slackMs: 0, hints: {} });
  assert.deepEqual(tight.events.map((e) => e.data.verdict), ['WAIVED']);
  const slack = qc.read(ctxOf(FX), { sinceTs: since, slackMs: 2 * 3600 * 1000, hints: {} });
  assert.deepEqual(slack.events.map((e) => e.data.verdict).sort(), ['PASS', 'WAIVED']);
});

test('source-qc: GIT_* repository selectors in env are dropped (cleanGitEnv)', () => {
  const r = qc.read(ctxOf(FX, { env: { ...FX.env, GIT_DIR: '/nonexistent-dir-for-test', GIT_WORK_TREE: '/nonexistent-dir-for-test' } }), COLD);
  assert.equal(r.events.length, 2);
});

test('source-qc: the repository is found from the identity alone when the project carries no root', () => {
  const ctx = ctxOf(FX);
  delete ctx.project.root;
  assert.equal(qc.read(ctx, COLD).events.length, 2);
});

test('source-qc: the subject is redacted and capped at 120 characters', () => {
  const fx = fresh();
  const secret = fx.tokenShaped;
  const env = { ...fx.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: PIN_MAIL, GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: PIN_MAIL };
  fs.writeFileSync(path.join(fx.repoDir, 'f.txt'), 'x');
  execFileSync('git', ['add', 'f.txt'], { cwd: fx.repoDir, env });
  execFileSync('git', ['commit', '-q', '-m', `rotate ${secret} ${'y'.repeat(200)}`, '-m', 'QC-Verdict: PASS'], { cwd: fx.repoDir, env });
  const r = qc.read(ctxOf(fx), COLD);
  const e = r.events.find((x) => x.data.subject.startsWith('rotate'));
  assert.ok(e.data.subject.length <= 120);
  assert.equal(e.data.subject.includes(secret), false);
  assert.match(e.data.subject, /^rotate \[redacted\]/);
  assert.ok(r.stats.redactions >= 1);
});

test('source-qc: redaction runs before the cap - a token, a JWT and an e-mail straddling the 120/64 boundary leave no fragment', () => {
  const fx = fresh();
  const env = { ...fx.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: PIN_MAIL, GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: PIN_MAIL };
  const tok = fx.tokenShaped; // ghp_ + 36
  const jwtLike = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlLWJ5dGVz'].join('.');
  const mailLike = ['bob.smith', 'corp.invalid'].join('@');
  const commit = (message, file) => {
    fs.writeFileSync(path.join(fx.repoDir, file), file);
    execFileSync('git', ['add', file], { cwd: fx.repoDir, env });
    execFileSync('git', ['commit', '-q', '-m', message[0], '-m', message[1]], { cwd: fx.repoDir, env });
  };
  // the secret starts 10 characters before the cap, so a cut-first order keeps only a 10-char prefix
  const pad = (n) => 'x'.repeat(n);
  commit([pad(109) + ' ' + tok, 'QC-Verdict: PASS'], 'a.txt');
  commit([pad(109) + ' ' + jwtLike, 'QC-Verdict: PASS'], 'b.txt');
  commit([pad(109) + ' ' + mailLike, 'QC-Verdict: PASS'], 'c.txt');
  commit(['verdict carrier', 'QC-Verdict: ' + pad(55) + tok], 'd.txt');
  const r = qc.read(ctxOf(fx), COLD);
  const added = r.events.filter((e) => e.data.subject.startsWith('xxxx') || e.data.subject === 'verdict carrier');
  assert.equal(added.length, 4);
  const frags = [tok.slice(0, 8), jwtLike.slice(0, 8), 'bob.smi', 'corp.inv', tok.slice(4, 12)];
  for (const e of added) {
    for (const f of frags) { assert.equal(e.data.subject.includes(f), false, 'subject leaks ' + f); assert.equal(e.data.verdict.includes(f), false, 'verdict leaks ' + f); }
    assert.ok(e.data.subject.length <= 120 && e.data.verdict.length <= 64);
  }
  assert.ok(added.filter((e) => /\[redacted\]|<email>|<redacted-secret>/.test(e.data.subject + e.data.verdict)).length >= 3);
  assert.ok(r.stats.redactions >= 4);
});

test('degrade-qc-unborn-head: a fresh repo with no commit is ok with no event and no warning', () => {
  const fx = fresh();
  const empty = path.join(fx.dir, 'empty-repo');
  fs.mkdirSync(empty);
  execFileSync('git', ['init', '-q', '--template=', '-b', 'main'], { cwd: empty, env: fx.env });
  const r = qc.read(ctxOf(fx, { project: { project_key: fx.projectKey, repo_identity: fx.identity, root: empty } }), COLD);
  assert.deepEqual([r.events, r.warnings, r.stats.state], [[], [], 'ok']);
});

// ---- degrade-qc-* ---------------------------------------------------------------------------------------------------

test('degrade-qc-empty-trailer: a QC-Verdict trailer with no value is not an event', () => {
  const fx = fresh();
  const env = { ...fx.env, GIT_AUTHOR_NAME: 'a', GIT_AUTHOR_EMAIL: PIN_MAIL, GIT_COMMITTER_NAME: 'a', GIT_COMMITTER_EMAIL: PIN_MAIL };
  fs.writeFileSync(path.join(fx.repoDir, 'f.txt'), 'x');
  execFileSync('git', ['add', 'f.txt'], { cwd: fx.repoDir, env });
  execFileSync('git', ['commit', '-q', '-m', 'empty verdict', '-m', 'QC-Verdict:'], { cwd: fx.repoDir, env });
  const r = qc.read(ctxOf(fx), COLD);
  assert.equal(r.events.some((e) => e.data.subject === 'empty verdict'), false);
  assert.equal(r.events.length, 2);
  assert.deepEqual(r.warnings, []);
});

test('degrade-qc-git-missing: git not on PATH warns git_unavailable and marks the source degraded', () => {
  const emptyBin = path.join(FX.dir, 'empty-bin');
  fs.mkdirSync(emptyBin, { recursive: true });
  const r = qc.read(ctxOf(FX, { env: { ...FX.env, PATH: emptyBin } }), COLD);
  assert.deepEqual(r.events, []);
  assert.deepEqual(codes(r), ['git_unavailable']);
  assert.equal(r.stats.state, 'degraded');
});

test('degrade-qc-repo-gone: a repository that disappeared after resolution warns git_unavailable', () => {
  const fx = fresh();
  const ctx = ctxOf(fx);
  fs.rmSync(fx.repoDir, { recursive: true, force: true });
  const r = qc.read(ctx, COLD);
  assert.deepEqual(codes(r), ['git_unavailable']);
  assert.equal(r.stats.state, 'degraded');
  assert.equal(r.warnings[0].detail.includes(fx.dir), false, 'no path in the warning');
});

test('degrade-qc-no-repo-info: a project with neither root nor identity degrades instead of throwing', () => {
  const r = qc.read({ project: { project_key: 'k' }, env: FX.env }, COLD);
  assert.deepEqual(codes(r), ['git_unavailable']);
  for (const [ctx, window] of [[undefined, undefined], [null, null], [{}, {}]]) assert.ok(Array.isArray(qc.read(ctx, window).events));
});

// ---- redact ----------------------------------------------------------------------------------------------------------

const homePath = ['', 'home', 'alice', 'work', 'repo'].join('/');
const mail = ['alice', 'corp.invalid'].join('@');
const hosts = JSON.parse(fs.readFileSync(path.join(__dirname, 'lib', 'leak-guard-hosts.json'), 'utf8'));
const strongHost = hosts.strong[0];
// token shapes the personal-data layer alone does NOT cover (so the token layer is load-bearing)
const jwt = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c2lnbmF0dXJlLWJ5dGVz'].join('.');
const gitlab = ['glpat', 'abcdEFGH1234ijklMNOP'].join('-');
const keyBlock = ['-----BEGIN', 'RSA PRIVATE KEY-----\nMIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu\n-----END', 'RSA PRIVATE KEY-----'].join(' ');

test('redact: paths, e-mail, host names and private IPs are masked', () => {
  const ip = ['192', '168', '1', '20'].join('.');
  const out = redact.redactText(`see ${homePath}/x by ${mail} on ${strongHost} via ${ip}`);
  for (const leak of [homePath, 'alice', mail, strongHost, ip]) assert.equal(out.text.includes(leak), false, leak);
  assert.match(out.text, /\$HOME/);
  assert.match(out.text, /<email>/);
  assert.match(out.text, /<host>/);
  assert.match(out.text, /<private-ip>/);
  assert.ok(out.redactions >= 4);
});

test('redact: token-shaped strings become [redacted] (prefixed tokens, JWT, key block, named secrets, bearer)', () => {
  const samples = [FX.tokenShaped, jwt, gitlab, keyBlock, ['sk', 'ant', 'a'.repeat(30)].join('-'), ['AKIA', 'ABCDEFGHIJKLMNOP'].join('')];
  for (const s of samples) {
    const out = redact.redactText(`before ${s} after`);
    assert.equal(out.text.includes(s.slice(4, 24)), false, `leaked: ${s.slice(0, 12)}`);
    assert.match(out.text, /^before \[redacted\] after$/);
    assert.equal(out.redactions, 1);
  }
  const named = redact.redactText('api_key = hunter2hunter2 and token: abcdef123456');
  assert.equal(/hunter2|abcdef123456/.test(named.text), false);
  assert.match(named.text, /api_key = \[redacted\]/);
  const bearer = redact.redactText('Authorization: Bearer abcdefghijklmnop1234');
  assert.equal(bearer.text.includes('abcdefghijklmnop1234'), false);
});

test('redact: plain prose and a commit sha are left alone, truncateText marks the cut', () => {
  const prose = 'pick the smaller option, see 576de6de3fd53f2b783385fbee0744fe92051d53';
  assert.deepEqual(redact.redactText(prose), { text: prose, redactions: 0 });
  assert.deepEqual(redact.redactText(null), { text: '', redactions: 0 });
  assert.equal(redact.truncateText('abcdef', 4), 'abc…');
  assert.equal(redact.truncateText('abc', 4), 'abc');
});

test('redact: negative control - the personal-data layer alone leaks the token shapes (so the token layer is load-bearing)', () => {
  for (const s of [jwt, gitlab, keyBlock]) {
    const leaked = personal.redactText(`before ${s} after`).text;
    assert.equal(leaked.includes(s.slice(4, 24)), true, 'personal-data layer alone must not cover this shape');
    assert.equal(redact.redactText(`before ${s} after`).text.includes(s.slice(4, 24)), false);
  }
  // the golden rationale of the fixture requires the contract placeholder, not the personal-data one
  assert.equal(redact.redactText(`rotated ${FX.tokenShaped} after review`).text, 'rotated [redacted] after review');
  assert.equal(personal.redactText(`rotated ${FX.tokenShaped} after review`).text.includes('[redacted]'), false);
});
