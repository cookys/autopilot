'use strict';
require('./lib/test-git-env'); // fixture repos must not run the account's global git config
// Run: node --test scripts/check-batch-overlap.test.js

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, 'check-batch-overlap.js');
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-overlap-'));

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'overlap-test',
  GIT_AUTHOR_EMAIL: 'overlap-test@example.com',
  GIT_COMMITTER_NAME: 'overlap-test',
  GIT_COMMITTER_EMAIL: 'overlap-test@example.com',
};

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, env: gitEnv, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
}

function write(rel, body) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

git(['init', '-b', 'main']);
write('src/register.ts', 'export {}\n');
write('src/a.ts', 'export {}\n');
write('src/b.ts', 'export {}\n');
write('src/ui/pane.ts', 'export {}\n');
write('src/ui/deep/x.ts', 'export {}\n');
write('platforms/mirror.ts', 'export {}\n');
write('CHANGELOG.md', '# log\n');
git(['add', '.']);
git(['commit', '-m', 'seed']);

after(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, '--repo', ROOT, ...args], { encoding: 'utf8' });
}

function brief(name, scopeLine) {
  const file = path.join(ROOT, `${name}.md`);
  const body = scopeLine == null ? `# ${name}\n\nNo scope here.\n` : `# ${name}\n\nScope: ${scopeLine}\n`;
  fs.writeFileSync(file, body);
  return file;
}

test('codeforge-v74-A-B-register', () => {
  const a = brief('A', 'src/register.ts, src/a.ts');
  const b = brief('B', 'src/b.ts, src/register.ts');
  const r = run([a, b]);
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.schema, 'autopilot.batch-overlap/1');
  assert.equal(json.tickets, 2);
  assert.deepEqual(json.overlaps, [{ a: 'A', b: 'B', files: ['src/register.ts'] }]);
  assert.match(r.stderr, /overlap: ticket A and ticket B both edit src\/register\.ts/);
});

test('glob vs literal src/ui/** overlaps src/ui/pane.ts', () => {
  const a = brief('ui-glob', 'src/ui/**');
  const b = brief('ui-lit', 'src/ui/pane.ts');
  const r = run([a, b]);
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.ok(json.overlaps[0].files.includes('src/ui/pane.ts'));
});

test('glob src/ui/* does not overlap src/ui/deep/x.ts', () => {
  const a = brief('star', 'src/ui/*');
  const b = brief('deep', 'src/ui/deep/x.ts');
  const r = run([a, b]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).overlaps, []);
});

test('untracked new file in both scopes overlaps', () => {
  const manifest = path.join(ROOT, 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'N1', scope: ['src/new/**'] },
      { id: 'N2', scope: ['src/new/x.ts'] },
    ],
  }));
  const r = run(['--manifest', manifest]);
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.overlaps.length, 1);
  assert.ok(json.overlaps[0].files.includes('src/new/x.ts'));
});

test('platforms/** in every ticket is exempt and --allow CHANGELOG.md exempts that file', () => {
  const a = brief('P1', 'platforms/**, CHANGELOG.md');
  const b = brief('P2', 'platforms/**, CHANGELOG.md');
  const bare = run([a, b]);
  assert.equal(bare.status, 1);
  assert.ok(JSON.parse(bare.stdout).overlaps[0].files.includes('CHANGELOG.md'));
  assert.ok(!JSON.parse(bare.stdout).overlaps[0].files.some((f) => f.startsWith('platforms/')));
  const allowed = run(['--allow', 'CHANGELOG.md', a, b]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(JSON.parse(allowed.stdout).overlaps, []);
});

test('three tickets, only B and C overlap, exactly one pair', () => {
  const a = brief('TA', 'src/a.ts');
  const b = brief('TB', 'src/b.ts, src/register.ts');
  const c = brief('TC', 'src/register.ts');
  const r = run([a, b, c]);
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.tickets, 3);
  assert.equal(json.overlaps.length, 1);
  assert.equal(json.overlaps[0].a, 'TB');
  assert.equal(json.overlaps[0].b, 'TC');
  assert.deepEqual(json.overlaps[0].files, ['src/register.ts']);
});

test('a brief without Scope: exits 2 and names the file', () => {
  const a = brief('noscope', null);
  const b = brief('ok', 'src/a.ts');
  const r = run([a, b]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('untracked src/a*.ts and src/*b.ts overlap on a shared witness', () => {
  const manifest = path.join(ROOT, 'manifest-ab.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'GA', scope: ['src/a*.ts'] },
      { id: 'GB', scope: ['src/*b.ts'] },
    ],
  }));
  const r = run(['--manifest', manifest]);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  const files = JSON.parse(r.stdout).overlaps[0].files;
  assert.ok(files.some((f) => /^src\/a[^/]*b\.ts$/.test(f)), files.join(','));
});

test('a*.ts and *b.ts in different directories do not overlap', () => {
  const manifest = path.join(ROOT, 'manifest-dirs.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'DA', scope: ['src/a*.ts'] },
      { id: 'DB', scope: ['lib/*b.ts'] },
    ],
  }));
  const r = run(['--manifest', manifest]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).overlaps, []);
});

test('** overlaps an untracked literal', () => {
  const manifest = path.join(ROOT, 'manifest-dstar.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'DS', scope: ['**'] },
      { id: 'DL', scope: ['src/new/only.ts'] },
    ],
  }));
  const r = run(['--manifest', manifest]);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.ok(JSON.parse(r.stdout).overlaps[0].files.includes('src/new/only.ts'));
});

test('allow of one witness still overlaps on another file in the glob', () => {
  const manifest = path.join(ROOT, 'manifest-allow-hide.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'H1', scope: ['src/new/*.ts'] },
      { id: 'H2', scope: ['src/new/*.ts'] },
    ],
  }));
  const r = run(['--allow', 'src/new/x.ts', '--manifest', manifest]);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  const files = JSON.parse(r.stdout).overlaps[0].files;
  assert.ok(files.some((f) => f !== 'src/new/x.ts' && /^src\/new\/[^/]*\.ts$/.test(f)), files.join(','));
});

test('allow-listed literal that is the only intersection clears', () => {
  const manifest = path.join(ROOT, 'manifest-allow-only.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'O1', scope: ['src/new/x.ts'] },
      { id: 'O2', scope: ['src/new/*.ts'] },
    ],
  }));
  const open = run(['--manifest', manifest]);
  assert.equal(open.status, 1, open.stderr + open.stdout);
  const cleared = run(['--allow', 'src/new/x.ts', '--manifest', manifest]);
  assert.equal(cleared.status, 0, cleared.stderr + cleared.stdout);
  assert.deepEqual(JSON.parse(cleared.stdout).overlaps, []);
});

test('two src/* scopes with --allow src/* report no overlap', () => {
  const manifest = path.join(ROOT, 'manifest-star-allow.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'S1', scope: ['src/*'] },
      { id: 'S2', scope: ['src/*'] },
    ],
  }));
  const r = run(['--allow', 'src/*', '--manifest', manifest]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).overlaps, []);
});

test('two src/* scopes without --allow still overlap', () => {
  const manifest = path.join(ROOT, 'manifest-star-open.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'S1', scope: ['src/*'] },
      { id: 'S2', scope: ['src/*'] },
    ],
  }));
  const r = run(['--manifest', manifest]);
  assert.equal(r.status, 1, r.stderr + r.stdout);
  assert.ok(JSON.parse(r.stdout).overlaps.length >= 1);
});

test('src/** vs src/a/* with --allow src/a/* reports no overlap', () => {
  const manifest = path.join(ROOT, 'manifest-starstar-allow.json');
  fs.writeFileSync(manifest, JSON.stringify({
    tickets: [
      { id: 'D1', scope: ['src/**'] },
      { id: 'D2', scope: ['src/a/*'] },
    ],
  }));
  const r = run(['--allow', 'src/a/*', '--manifest', manifest]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.deepEqual(JSON.parse(r.stdout).overlaps, []);
});

test('parentheses comment is stripped from scope entries', () => {
  const a = brief('C1', 'src/a.ts (only A), platforms/** (mirrors via sync-all only)');
  const b = brief('C2', 'src/b.ts');
  const r = run([a, b]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).overlaps, []);
  const c = brief('C3', 'src/a.ts (the shared one)');
  const hit = run([a, c]);
  assert.equal(hit.status, 1);
  assert.deepEqual(JSON.parse(hit.stdout).overlaps[0].files, ['src/a.ts']);
});
