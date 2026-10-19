'use strict';
// RED at 0f810c88488a9028ce6afd440485dc07db33898f: tests 12, pass 0, fail 12 (MODULE_NOT_FOUND scripts/check-test-outcome.js)
// node --test scripts/check-test-outcome.test.js
// Throwaway git repos. Expected suite lists are literals from the real selector
// on this fixture shape: ['scripts/other.test.js', 'scripts/tool.test.js'].
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const CHECK = path.join(__dirname, 'check-test-outcome.js');
const SEL = path.join(__dirname, 'affected-suites.js');
const SELECTED = ['scripts/other.test.js', 'scripts/tool.test.js'];

function gitEnv() {
  const env = { ...process.env };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

function makeRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'outcome-gate-test-'));
  const git = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, env: gitEnv(), stdio: 'pipe' }).toString().trim();
  git('init', '-q');
  const write = (m) => {
    for (const [p, body] of Object.entries(m)) {
      const full = path.join(dir, p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      if (body === null) fs.rmSync(full, { force: true }); else fs.writeFileSync(full, body);
    }
  };
  write(files);
  git('add', '-A'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  return {
    dir, base, git, write,
    change(m) { write(m); git('add', '-A'); git('commit', '-qm', 'change'); return git('rev-parse', 'HEAD'); },
    cleanup() { fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

const PASS_JS = (named) =>
  `'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert');\nconst named = '${named}';\ntest('ok', () => { assert.strictEqual(named.length > 0, true); });\n`;

const LAYOUT = {
  'scripts/tool.js': 'console.log(1);\n',
  'scripts/other.js': 'console.log(2);\n',
  'scripts/tool.test.js': PASS_JS('scripts/tool.js'),
  'scripts/other.test.js': PASS_JS('scripts/other.js'),
  'docs/note.md': 'text\n',
  'hooks/hooks.json': '{}\n',
};

function runCheck(repo, args) {
  return spawnSync(process.execPath, [CHECK, '--root', repo.dir, ...args], {
    encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function parseOut(r) {
  const line = (r.stdout || '').trim();
  return JSON.parse(line);
}

function greenRecord(head, base, suites) {
  return {
    schema: 1, head, base, mode: 'selective',
    suites: suites.map((p) => ({ path: p, rc: 0 })),
  };
}

test('pass: recorded green and the re-run sample stays green; selected is 2', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({
      'scripts/tool.js': 'console.log(3);\n',
      'scripts/other.js': 'console.log(4);\n',
    });
    const rec = path.join(r.dir, 'rec.json');
    const prod = spawnSync(process.execPath, [SEL, '--root', r.dir, '--base', r.base, '--head', head, '--run', '--record', rec], {
      encoding: 'utf8', env: gitEnv(),
    });
    assert.strictEqual(prod.status, 0, prod.stderr);
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec, '--rerun', 'sample', '--sample', '20', '--seed', '1']);
    assert.strictEqual(out.status, 0, out.stderr);
    const v = parseOut(out);
    assert.strictEqual(v.schema, 1);
    assert.strictEqual(v.verdict, 'pass');
    assert.strictEqual(v.code, 'ok');
    assert.strictEqual(v.selected, 2);
    assert.notStrictEqual(v.selected, 0);
    assert.strictEqual(v.recorded, 2);
    assert.strictEqual(v.flaky, false);
    assert.deepStrictEqual(v.detail, []);
    assert.strictEqual(v.claimed_not_rederived, 0);
    assert.strictEqual(v.rerun.mode, 'sample');
    assert.strictEqual(v.rerun.ran, 2);
    assert.strictEqual(v.rerun.planned, 2);
    assert.ok(out.stderr.startsWith('outcome gate:'));
    assert.match(out.stderr, /claimed, not re-derived: 0 of 2 suites/);
    const written = JSON.parse(fs.readFileSync(rec, 'utf8'));
    assert.deepStrictEqual(written.suites.map((s) => s.path), SELECTED);
  } finally { r.cleanup(); }
});

test('record_missing', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'scripts/tool.js': 'console.log(3);\n', 'scripts/other.js': 'console.log(4);\n' });
    const missing = path.join(r.dir, 'no-such-record.json');
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', missing]);
    assert.strictEqual(out.status, 1);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'record_missing');
    assert.strictEqual(v.verdict, 'refuse');
    assert.match(out.stderr, new RegExp(`node scripts/affected-suites.js --base ${r.base} --head ${head} --run --record`));
  } finally { r.cleanup(); }
});

test('record_stale: amended parent, and an unparseable record', () => {
  const r = makeRepo(LAYOUT);
  try {
    const old = r.change({ 'scripts/tool.js': 'console.log(3);\n', 'scripts/other.js': 'console.log(4);\n' });
    r.write({ 'scripts/tool.js': 'console.log(9);\n' });
    r.git('add', '-A');
    r.git('commit', '--amend', '-qm', 'amended');
    const head = r.git('rev-parse', 'HEAD');
    assert.notStrictEqual(head, old);
    const rec = path.join(r.dir, 'rec.json');
    fs.writeFileSync(rec, JSON.stringify(greenRecord(old, r.base, SELECTED)) + '\n');
    const out = runCheck(r, ['--range', `${r.base}..${head}`, '--record-file', rec]);
    assert.strictEqual(out.status, 1);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'record_stale');
    assert.strictEqual(v.verdict, 'refuse');
    assert.match(out.stderr, new RegExp(old.slice(0, 7)));
    assert.match(out.stderr, new RegExp(head.slice(0, 7)));

    fs.writeFileSync(rec, '{not json');
    const bad = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec]);
    assert.strictEqual(bad.status, 1);
    assert.strictEqual(parseOut(bad).code, 'record_stale');
  } finally { r.cleanup(); }
});

test('recorded_red', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'scripts/tool.js': 'console.log(3);\n', 'scripts/other.js': 'console.log(4);\n' });
    const rec = path.join(r.dir, 'rec.json');
    const body = greenRecord(head, r.base, SELECTED);
    body.suites[1].rc = 1;
    fs.writeFileSync(rec, JSON.stringify(body) + '\n');
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec]);
    assert.strictEqual(out.status, 1);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'recorded_red');
    assert.deepStrictEqual(v.detail, ['scripts/tool.test.js']);
    assert.match(out.stderr, /scripts\/tool\.test\.js/);
  } finally { r.cleanup(); }
});

test('selection_shortfall ignores a forged selected field', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'scripts/tool.js': 'console.log(3);\n', 'scripts/other.js': 'console.log(4);\n' });
    const rec = path.join(r.dir, 'rec.json');
    const body = greenRecord(head, r.base, ['scripts/other.test.js']);
    fs.writeFileSync(rec, JSON.stringify(body) + '\n');
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec]);
    assert.strictEqual(out.status, 1);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'selection_shortfall');
    assert.strictEqual(v.verdict, 'refuse');
    assert.deepStrictEqual(v.detail, ['scripts/tool.test.js']);
    assert.match(out.stderr, /1/);

    body.selected = SELECTED.slice();
    fs.writeFileSync(rec, JSON.stringify(body) + '\n');
    const forged = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec]);
    assert.strictEqual(forged.status, 1);
    assert.strictEqual(parseOut(forged).code, 'selection_shortfall');
    assert.deepStrictEqual(parseOut(forged).detail, ['scripts/tool.test.js']);
  } finally { r.cleanup(); }
});

test('rerun_red: record says rc 0 but the suite exits 1', () => {
  const r = makeRepo(LAYOUT);
  try {
    const red = PASS_JS('scripts/tool.js').replace('assert.strictEqual(named.length > 0, true)', 'assert.strictEqual(1, 2)');
    const head = r.change({
      'scripts/tool.js': 'console.log(3);\n',
      'scripts/other.js': 'console.log(4);\n',
      'scripts/tool.test.js': red,
    });
    const rec = path.join(r.dir, 'rec.json');
    fs.writeFileSync(rec, JSON.stringify(greenRecord(head, r.base, SELECTED)) + '\n');
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec, '--rerun', 'all', '--seed', '1']);
    assert.strictEqual(out.status, 1);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'rerun_red');
    assert.strictEqual(v.flaky, false);
    assert.match(out.stderr, /record claims green but scripts\/tool\.test\.js fails when re-run \(rc=1\)/);
  } finally { r.cleanup(); }
});

test('unjudged_full: hooks/hooks.json is not a block and says NOT JUDGED', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'hooks/hooks.json': '{"a":1}\n' });
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', path.join(r.dir, 'absent.json')]);
    assert.strictEqual(out.status, 0);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'unjudged_full');
    assert.strictEqual(v.verdict, 'unjudged');
    assert.match(out.stderr, /NOT JUDGED/);
    assert.match(out.stderr, /unjudgeable change: hooks\/hooks\.json/);
  } finally { r.cleanup(); }
});

test('nothing_selected: docs-only change', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'docs/note.md': 'more text\n' });
    const out = runCheck(r, ['--base', r.base, '--head', head]);
    assert.strictEqual(out.status, 0);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'nothing_selected');
    assert.strictEqual(v.verdict, 'pass');
    assert.strictEqual(v.selected, 0);
  } finally { r.cleanup(); }
});

test('budget_exceeded: --budget-s 0 stops before any re-run', () => {
  const r = makeRepo(LAYOUT);
  try {
    const head = r.change({ 'scripts/tool.js': 'console.log(3);\n', 'scripts/other.js': 'console.log(4);\n' });
    const rec = path.join(r.dir, 'rec.json');
    fs.writeFileSync(rec, JSON.stringify(greenRecord(head, r.base, SELECTED)) + '\n');
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec, '--budget-s', '0', '--seed', '1']);
    assert.strictEqual(out.status, 1);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'budget_exceeded');
    assert.strictEqual(v.verdict, 'refuse');
    assert.match(out.stderr, /re-ran 0 of 2 sampled suites in 0s, budget hit; rest NOT re-derived/);
  } finally { r.cleanup(); }
});

test('rerun none skips the re-run and sets claimed_not_rederived', () => {
  const r = makeRepo(LAYOUT);
  try {
    const red = PASS_JS('scripts/tool.js').replace('assert.strictEqual(named.length > 0, true)', 'assert.strictEqual(1, 2)');
    const head = r.change({
      'scripts/tool.js': 'console.log(3);\n',
      'scripts/other.js': 'console.log(4);\n',
      'scripts/tool.test.js': red,
    });
    const rec = path.join(r.dir, 'rec.json');
    fs.writeFileSync(rec, JSON.stringify(greenRecord(head, r.base, SELECTED)) + '\n');
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec, '--rerun', 'none']);
    assert.strictEqual(out.status, 0, out.stderr);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'ok');
    assert.strictEqual(v.verdict, 'pass');
    assert.strictEqual(v.claimed_not_rederived, 2);
    assert.strictEqual(v.rerun.ran, 0);
    assert.match(out.stderr, /claimed, not re-derived: 2 of 2 suites/);
  } finally { r.cleanup(); }
});

test('checker_error: unknown sha exits 2', () => {
  const r = makeRepo(LAYOUT);
  try {
    const out = runCheck(r, ['--base', r.base, '--head', 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef']);
    assert.strictEqual(out.status, 2);
    const v = parseOut(out);
    assert.strictEqual(v.code, 'checker_error');
    assert.strictEqual(v.verdict, 'error');
    assert.match(out.stderr, /NOT enforced/);
  } finally { r.cleanup(); }
});

test('detached worktree directory is gone after a run', () => {
  const r = makeRepo(LAYOUT);
  try {
    const markerSuite = PASS_JS('scripts/tool.js') + "require('fs').writeFileSync('wt-marker.txt', 'ran');\n";
    const head = r.change({
      'scripts/tool.js': 'console.log(3);\n',
      'scripts/other.js': 'console.log(4);\n',
      'scripts/tool.test.js': markerSuite,
    });
    const rec = path.join(os.tmpdir(), `outcome-rec-${process.pid}.json`);
    fs.writeFileSync(rec, JSON.stringify(greenRecord(head, r.base, SELECTED)) + '\n');
    fs.writeFileSync(path.join(r.dir, 'dirty.txt'), 'dirty\n');
    const before = new Set(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('qc-outcome-wt-')));
    const out = runCheck(r, ['--base', r.base, '--head', head, '--record-file', rec, '--rerun', 'all']);
    assert.strictEqual(out.status, 0, out.stderr + out.stdout);
    const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('qc-outcome-wt-') && !before.has(n));
    assert.deepStrictEqual(after, []);
    assert.strictEqual(fs.existsSync(path.join(r.dir, 'wt-marker.txt')), false);
    fs.rmSync(rec, { force: true });
  } finally { r.cleanup(); }
});
