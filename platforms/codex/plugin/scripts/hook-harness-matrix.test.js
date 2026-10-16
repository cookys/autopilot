#!/usr/bin/env node
'use strict';
// BL-0026: matrix generator/checker, with negative controls (each bad tree must be rejected).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REAL = path.resolve(__dirname, '..');
const SCRIPT = path.join(__dirname, 'hook-harness-matrix.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hhm-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

function tree(name, evidence) {
  const d = path.join(tmp, name);
  for (const f of ['hooks/hooks.json', 'platforms/codex/hooks/hooks.json']) {
    fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
    fs.copyFileSync(path.join(REAL, f), path.join(d, f));
  }
  fs.mkdirSync(path.join(d, 'docs'), { recursive: true });
  if (evidence) fs.writeFileSync(path.join(d, 'hooks/harness-support-evidence.json'), JSON.stringify({ rows: evidence }));
  return d;
}
const run = (d, ...a) => spawnSync('node', [SCRIPT, '--repo', d, '--today', '2026-10-16', ...a], { encoding: 'utf8' });
const good = { stem: 'post-compact', harness: 'codex', event: 'PostCompact', verified_at: '2026-10-01', evidence: 'probe run' };

// the committed doc matches the committed wiring
assert.equal(spawnSync('node', [SCRIPT, '--check'], { encoding: 'utf8' }).status, 0, 'repo doc is in sync');

// good tree: written then checked ok; no evidence row => 未驗證, with row => date
let d = tree('ok', [good]);
assert.equal(run(d, '--write').status, 0);
assert.equal(run(d, '--check').status, 0);
const doc = fs.readFileSync(path.join(d, 'docs/hook-harness-matrix.md'), 'utf8');
assert.match(doc, /\| `post-compact` \| — \| PostCompact<br>驗證: PostCompact 2026-10-01/);
assert.match(doc, /dirty-protected-paths` \| Stop<br>未驗證 \| SessionEnd, Stop<br>未驗證/, 'no fabricated support');

// negative controls
const neg = (name, ev, wantRe, mutate) => {
  const t = tree(name, ev);
  run(t, '--write');
  if (mutate) mutate(t);
  const r = run(t, '--check');
  assert.equal(r.status, 1, `${name}: must fail (${r.stderr})`);
  assert.match(r.stderr, wantRe, name);
};
neg('drift', [good], /differs from the wiring/, (t) => fs.appendFileSync(path.join(t, 'docs/hook-harness-matrix.md'), 'x\n'));
neg('unwired', [{ ...good, harness: 'opencode' }], /not a registered/);
neg('future', [{ ...good, verified_at: '2026-12-01' }], /future/);
neg('baddate', [{ ...good, verified_at: 'soon' }], /YYYY-MM-DD/);
neg('noevidence', [{ ...good, evidence: '' }], /empty evidence/);
// a wired hook that gains no evidence row is never shown as verified
d = tree('stale', [{ ...good, verified_at: '2026-05-01' }]);
run(d, '--write');
const s = run(d, '--check');
assert.equal(s.status, 0); assert.match(s.stderr, /WARN .*older than 60 days/);
console.log('hook-harness-matrix: all assertions passed');
