// # RED at 4777a2e0b: node --test exit 1; 3 failed, 0 passed; ENOENT copyfile scripts/replay-test-integrity.js (script absent on base).
// RED at 373bd49b5: node scripts/replay-test-integrity.test.js exit 1; 4 failed, 3 passed; SIGTERM did not exit within 6s; cleanup failure still exit 0; --help has no --ref; both worktree basenames are wt.
'use strict';
// node --test scripts/replay-test-integrity.test.js
// Builds a throwaway git repo and replays the L0 checker over three first-parent merges.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn, spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const REPLAY_SRC = path.join(__dirname, 'replay-test-integrity.js');

function git(dir, args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}

function writeFile(dir, rel, body) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function snapshot(dir) {
  return {
    head: git(dir, ['rev-parse', 'HEAD']),
    worktrees: git(dir, ['worktree', 'list']),
  };
}

function residue(prefix) {
  return fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix));
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-ti-fixture-'));
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['config', 'core.hooksPath', '/dev/null']);
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(REPO, 'scripts/check-test-integrity.sh'), path.join(dir, 'scripts/check-test-integrity.sh'));
  fs.copyFileSync(path.join(REPO, 'scripts/lib/test-integrity-l1.py'), path.join(dir, 'scripts/lib/test-integrity-l1.py'));
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  fs.copyFileSync(path.join(REPO, '.claude/test-integrity-config.md'), path.join(dir, '.claude/test-integrity-config.md'));
  writeFile(dir, 'hooks/tests/sample.test.sh', '#!/bin/sh\nassert_eq "1" "1"\necho ok\n');
  writeFile(dir, 'hooks/tests/lib.sh', 'assert_eq() { :; }\n');
  writeFile(dir, 'scripts/product.js', 'module.exports = 1;\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-qm', 'base']);

  function mergeBranch(name, subject, touch) {
    git(dir, ['checkout', '-q', '-b', name]);
    touch();
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-qm', subject]);
    git(dir, ['checkout', '-q', 'main']);
    git(dir, ['merge', '--no-ff', '-m', subject, name]);
  }

  mergeBranch('branch-a', 'merge A delete assertion', () => {
    writeFile(dir, 'hooks/tests/sample.test.sh', '#!/bin/sh\necho ok\n');
  });
  mergeBranch('branch-b', 'merge B product only', () => {
    writeFile(dir, 'scripts/product.js', 'module.exports = 2;\n');
  });
  mergeBranch('branch-c', 'merge C touch lib.sh', () => {
    writeFile(dir, 'hooks/tests/lib.sh', 'assert_eq() { :; }\n# touched\n');
  });

  fs.copyFileSync(REPLAY_SRC, path.join(dir, 'scripts/replay-test-integrity.js'));
  const merges = git(dir, ['log', '--first-parent', '--merges', '--pretty=format:%H%x09%s'])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    });
  return { dir, merges };
}

function runReplay(dir, args, env) {
  return spawnSync(process.execPath, [path.join(dir, 'scripts/replay-test-integrity.js'), ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: env || process.env,
  });
}

function startReplay(dir, args, env) {
  return spawn(process.execPath, [path.join(dir, 'scripts/replay-test-integrity.js'), ...args], {
    cwd: dir,
    env: env || process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const value = fn();
    if (value) return value;
    await sleep(40);
  }
  return null;
}

function waitExit(child, ms) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(null);
    }, ms);
    child.on('exit', (code, signal) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function killTree(child) {
  if (!child || !child.pid) return;
  try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
}

function worktreeBasenames(dir) {
  const names = [];
  for (const name of residue('replay-test-integrity-')) {
    const parent = path.join(os.tmpdir(), name);
    let kids = [];
    try { kids = fs.readdirSync(parent); } catch { continue; }
    for (const kid of kids) names.push(kid);
  }
  return names;
}

function realGit() {
  return execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
}

function makeGitStub() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'replay-ti-gitstub-'));
  const git = realGit();
  fs.writeFileSync(path.join(dir, 'git'), `#!/bin/sh
if [ "$1" = worktree ] && [ "$2" = remove ]; then
  echo "worktree remove blocked" >&2
  exit 1
fi
if [ "$1" = worktree ] && [ "$2" = prune ]; then
  echo "worktree prune blocked" >&2
  exit 1
fi
exec ${git} "$@"
`, { mode: 0o755 });
  return dir;
}

function scrubResidue(before) {
  for (const name of residue('replay-test-integrity-')) {
    if (before.has(name)) continue;
    const full = path.join(os.tmpdir(), name);
    try { execFileSync('chmod', ['-R', 'u+w', full], { stdio: 'ignore' }); } catch { /* gone */ }
    fs.rmSync(full, { recursive: true, force: true });
  }
}

function checkerFor(dir, sha) {
  const res = spawnSync('bash', [
    path.join(dir, 'scripts/check-test-integrity.sh'),
    'validate',
    '--range',
    `${sha}^1..${sha}`,
    '--repo',
    dir,
  ], { cwd: dir, encoding: 'utf8' });
  assert.notStrictEqual(res.status, 2, res.stderr);
  return JSON.parse(res.stdout);
}

function expectedFromChecker(dir, merges) {
  const records = [];
  for (const merge of merges) {
    const range = `${merge.sha}^1..${merge.sha}`;
    const parsed = checkerFor(dir, merge.sha);
    for (const violation of parsed.violations || []) {
      records.push({
        range,
        merge_sha: merge.sha,
        merge_subject: merge.subject,
        kind: violation.kind,
        file: violation.file,
        line: violation.line,
      });
    }
    for (const entry of parsed.surface_touches || []) {
      const obj = typeof entry === 'string' ? { kind: 'surface_touch', file: entry, line: null } : entry;
      records.push({
        range,
        merge_sha: merge.sha,
        merge_subject: merge.subject,
        kind: obj.kind || 'surface_touch',
        file: obj.file,
        line: Object.prototype.hasOwnProperty.call(obj, 'line') ? obj.line : null,
      });
    }
  }
  return records;
}

test('replays three merges, records A and C, leaves the repo untouched', () => {
  const repo = makeRepo();
  const before = snapshot(repo.dir);
  const beforeResidue = new Set(residue('replay-test-integrity-'));
  try {
    const expected = expectedFromChecker(repo.dir, repo.merges);
    const bySubject = Object.fromEntries(repo.merges.map((m) => [m.subject, m.sha]));
    assert.ok(expected.some((r) => r.kind === 'deleted_line' && r.file === 'hooks/tests/sample.test.sh' && r.merge_sha === bySubject['merge A delete assertion']));
    assert.ok(expected.some((r) => r.kind === 'surface_touch' && r.file === 'hooks/tests/lib.sh' && r.merge_sha === bySubject['merge C touch lib.sh']));
    assert.ok(!expected.some((r) => r.merge_sha === bySubject['merge B product only']));

    const res = runReplay(repo.dir, []);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.count_requested, 60);
    assert.strictEqual(out.ranges_scanned, 3);
    assert.deepStrictEqual(out.errors, []);
    const seen = out.records.map((r) => ({
      range: r.range,
      merge_sha: r.merge_sha,
      merge_subject: r.merge_subject,
      kind: r.kind,
      file: r.file,
      line: r.line,
    }));
    assert.deepStrictEqual(seen, expected);
    const rangesWith = new Set(expected.map((r) => r.range)).size;
    assert.strictEqual(out.ranges_with_violations, rangesWith);
    const counts = {};
    for (const row of expected) counts[row.kind] = (counts[row.kind] || 0) + 1;
    assert.deepStrictEqual(out.counts_by_kind, counts);
    for (const row of out.records) {
      assert.ok(row.detail === undefined || typeof row.detail === 'string');
      assert.ok((row.detail || '').length <= 200);
      const match = expected.find((e) => e.merge_sha === row.merge_sha && e.kind === row.kind && e.file === row.file && e.line === row.line);
      assert.ok(match);
      assert.strictEqual(row.merge_subject, repo.merges.find((m) => m.sha === row.merge_sha).subject);
    }
    assert.deepStrictEqual(snapshot(repo.dir), before);
    const afterResidue = residue('replay-test-integrity-').filter((name) => !beforeResidue.has(name));
    assert.deepStrictEqual(afterResidue, []);
    assert.strictEqual(git(repo.dir, ['worktree', 'list']).split('\n').length, 1);

    const outPath = path.join(repo.dir, 'replay-out.json');
    const fileRun = runReplay(repo.dir, ['--out', outPath]);
    assert.strictEqual(fileRun.status, 0, fileRun.stderr);
    assert.strictEqual(fs.readFileSync(outPath, 'utf8'), res.stdout);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('unknown flag exits 2', () => {
  const repo = makeRepo();
  try {
    const res = runReplay(repo.dir, ['--not-a-flag']);
    assert.strictEqual(res.status, 2);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('non-JSON checker output is an error and the worktree is removed', () => {
  const repo = makeRepo();
  const before = snapshot(repo.dir);
  const beforeResidue = new Set(residue('replay-test-integrity-'));
  try {
    writeFile(repo.dir, 'scripts/check-test-integrity.sh', '#!/bin/sh\necho not-json\nexit 0\n');
    git(repo.dir, ['add', 'scripts/check-test-integrity.sh']);
    git(repo.dir, ['commit', '-qm', 'replace checker']);
    const afterCommit = snapshot(repo.dir);
    const res = runReplay(repo.dir, ['--count', '3']);
    assert.strictEqual(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.strictEqual(out.ranges_scanned, 3);
    assert.strictEqual(out.records.length, 0);
    assert.strictEqual(out.errors.length, 3);
    const ranges = new Set(out.errors.map((e) => e.range));
    for (const merge of repo.merges) assert.ok(ranges.has(`${merge.sha}^1..${merge.sha}`));
    assert.deepStrictEqual(snapshot(repo.dir), afterCommit);
    assert.notStrictEqual(afterCommit.head, before.head);
    const afterResidue = residue('replay-test-integrity-').filter((name) => !beforeResidue.has(name));
    assert.deepStrictEqual(afterResidue, []);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('SIGTERM during a range exits 143 and removes the worktree', { timeout: 20000 }, async () => {
  const repo = makeRepo();
  const beforeResidue = new Set(residue('replay-test-integrity-'));
  writeFile(repo.dir, 'scripts/check-test-integrity.sh', '#!/bin/sh\nsleep 30\nprintf \'%s\\n\' \'{"violations":[],"surface_touches":[]}\'\n');
  git(repo.dir, ['add', 'scripts/check-test-integrity.sh']);
  git(repo.dir, ['commit', '-qm', 'slow checker']);
  const child = startReplay(repo.dir, ['--count', '3']);
  try {
    const appeared = await waitFor(() => {
      const admin = path.join(repo.dir, '.git', 'worktrees');
      try {
        return fs.readdirSync(admin).length > 0;
      } catch {
        return false;
      }
    }, 8000);
    assert.ok(appeared, 'worktree should exist before SIGTERM');
    const sent = Date.now();
    child.kill('SIGTERM');
    const exit = await waitExit(child, 6000);
    assert.ok(exit, 'replay should exit within a few seconds of SIGTERM');
    assert.ok(Date.now() - sent < 6000);
    assert.strictEqual(exit.code, 143);
    const afterResidue = residue('replay-test-integrity-').filter((name) => !beforeResidue.has(name));
    assert.deepStrictEqual(afterResidue, []);
    const admin = path.join(repo.dir, '.git', 'worktrees');
    const left = fs.existsSync(admin) ? fs.readdirSync(admin) : [];
    assert.deepStrictEqual(left, []);
  } finally {
    killTree(child);
    scrubResidue(beforeResidue);
    try { git(repo.dir, ['worktree', 'prune']); } catch { /* fixture */ }
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('cleanup failure warns on stderr and exits non-zero', () => {
  // Removal is forced to fail: a PATH git stub rejects `worktree remove` and
  // `worktree prune`, and the checker makes the temp parent immutable (0555)
  // so rmSync cannot delete it. No injected fs doubles — this is the real cleanup path.
  const repo = makeRepo();
  const beforeResidue = new Set(residue('replay-test-integrity-'));
  const stub = makeGitStub();
  writeFile(repo.dir, 'scripts/check-test-integrity.sh', '#!/bin/sh\nchmod 555 "$(dirname "$(pwd)")"\nprintf \'%s\\n\' \'{"violations":[],"surface_touches":[]}\'\nexit 0\n');
  git(repo.dir, ['add', 'scripts/check-test-integrity.sh']);
  git(repo.dir, ['commit', '-qm', 'lock parent checker']);
  const env = { ...process.env, PATH: `${stub}${path.delimiter}${process.env.PATH}` };
  try {
    const res = runReplay(repo.dir, ['--count', '1'], env);
    assert.notStrictEqual(res.status, 0);
    assert.match(res.stderr, /warning:/);
    assert.match(res.stderr, /replay-test-integrity-/);
  } finally {
    scrubResidue(beforeResidue);
    fs.rmSync(stub, { recursive: true, force: true });
    try { git(repo.dir, ['worktree', 'prune']); } catch { /* fixture */ }
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('--ref accepts a commit and rejects an unknown ref', () => {
  const repo = makeRepo();
  try {
    const sha = git(repo.dir, ['rev-parse', 'HEAD']);
    const help = runReplay(repo.dir, ['--help']);
    assert.strictEqual(help.status, 0, help.stderr);
    assert.match(help.stdout, /--ref/);
    const ok = runReplay(repo.dir, ['--ref', sha, '--count', '3']);
    assert.strictEqual(ok.status, 0, ok.stderr);
    const out = JSON.parse(ok.stdout);
    assert.strictEqual(out.ranges_scanned, 3);
    const bad = runReplay(repo.dir, ['--ref', 'refs/does-not-exist-bl0060']);
    assert.strictEqual(bad.status, 2);
  } finally {
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});

test('concurrent replays use different worktree basenames', { timeout: 20000 }, async () => {
  const repo = makeRepo();
  const beforeResidue = new Set(residue('replay-test-integrity-'));
  writeFile(repo.dir, 'scripts/check-test-integrity.sh', '#!/bin/sh\nsleep 30\nprintf \'%s\\n\' \'{"violations":[],"surface_touches":[]}\'\n');
  git(repo.dir, ['add', 'scripts/check-test-integrity.sh']);
  git(repo.dir, ['commit', '-qm', 'slow checker for names']);
  const a = startReplay(repo.dir, ['--count', '1']);
  const b = startReplay(repo.dir, ['--count', '1']);
  try {
    const names = await waitFor(() => {
      const found = [];
      for (const name of residue('replay-test-integrity-')) {
        if (beforeResidue.has(name)) continue;
        try {
          for (const kid of fs.readdirSync(path.join(os.tmpdir(), name))) found.push(kid);
        } catch { /* racing */ }
      }
      return found.length >= 2 ? found : null;
    }, 8000);
    assert.ok(names, 'both worktrees should be visible');
    assert.notStrictEqual(names[0], names[1]);
  } finally {
    killTree(a);
    killTree(b);
    await sleep(200);
    scrubResidue(beforeResidue);
    try { git(repo.dir, ['worktree', 'prune']); } catch { /* fixture */ }
    fs.rmSync(repo.dir, { recursive: true, force: true });
  }
});
