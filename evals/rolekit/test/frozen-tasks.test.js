'use strict';
// The frozen task set reproduces from the git objects at its base sha and matches its manifest.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const { ROOT, ROLES, taskDir } = require('./helpers.js');

const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks/manifest.json'), 'utf8'));
const top = cp.execFileSync('git', ['-C', ROOT, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

test('three tasks per role, every task has a prompt, a source with a git object, and frozen file digests that match disk', () => {
  for (const r of ROLES) assert.strictEqual(man.tasks.filter((t) => t.role === r).length, 3, r);
  for (const t of man.tasks) {
    assert.ok(t.sources.length > 0);
    for (const s of t.sources) assert.match(s.git_object, /^[0-9a-f]{40}$/, `${t.dir} ${s.path}`);
    assert.ok(fs.existsSync(path.join(taskDir(t.role, t.id), 'prompt.md')));
    for (const [rel, h] of Object.entries(t.files)) assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'tasks', t.dir, rel))).digest('hex'), h, `${t.dir}/${rel}`);
    const prompt = fs.readFileSync(path.join(taskDir(t.role, t.id), 'prompt.md'), 'utf8');
    assert.match(prompt, /Final answer: one JSON object with top-level key/);
  }
});

test('every prompt is arm-neutral: it names no kit, role card or placebo', () => {
  for (const t of man.tasks) assert.doesNotMatch(fs.readFileSync(path.join(taskDir(t.role, t.id), 'prompt.md'), 'utf8'), /role kit|role card|placebo|rolekit/i);
});

test('build-tasks --check and build-kits --check rebuild identically from the git objects at base_sha', () => {
  const ok = (script) => cp.spawnSync('node', [path.join(ROOT, script), '--repo', top, '--base', man.base_sha, '--check'], { encoding: 'utf8' });
  const a = ok('build-tasks.js'); assert.strictEqual(a.status, 0, a.stderr);
  const b = ok('build-kits.js'); assert.strictEqual(b.status, 0, b.stderr);
});

test('negative control: --check refuses a frozen file that changed (on a copy: the real tree is never touched)', () => {
  const { tmp, rm } = require('./helpers.js');
  const d = tmp();
  try {
    fs.cpSync(ROOT, d, { recursive: true });
    const run = () => cp.spawnSync('node', [path.join(d, 'build-tasks.js'), '--repo', top, '--base', man.base_sha, '--check'], { encoding: 'utf8' });
    assert.strictEqual(run().status, 0, 'the copy is green first');
    fs.appendFileSync(path.join(d, 'tasks/reviewer/kb-05/prompt.md'), 'tampered\n');
    const r = run();
    assert.strictEqual(r.status, 2); assert.match(r.stderr, /kb-05/);
  } finally { rm(d); }
});
