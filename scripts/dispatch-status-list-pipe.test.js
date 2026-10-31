/**
 * `dispatch-status.js --list` must deliver its whole JSON through a pipe. process.exit() right after a large stdout write
 * truncated it (a few hundred manifests ~ 200 KB), every consumer then parsed null and saw zero runs, and the runs watcher
 * flapped between "no rows" and "all rows". Run: node --test scripts/dispatch-status-list-pipe.test.js
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('--list: 700 manifests (> 300 KB) arrive complete through a pipe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsl-pipe-'));
  try {
    for (let i = 0; i < 700; i += 1) {
      const id = `review-${1792000000 + i}-${i}-ab${String(i).padStart(2, '0')}`;
      fs.writeFileSync(path.join(dir, `${id}.manifest.json`), JSON.stringify({
        schema: 1, run_id: id, role: 'reviewer', runner: 'codex', model: 'm'.repeat(200), started_at: '2026-10-24T18:48:55Z', ended_at: '2026-10-24T18:49:55Z',
        final_status: 'reviewed', parent_run_id: null, root_run_id: id, depth: 0,
      }));
    }
    const r = spawnSync('node', [path.join(__dirname, 'dispatch-status.js'), '--list'], { encoding: 'utf8', env: { ...process.env, AUTOPILOT_DISPATCH_RUNS_DIR: dir }, maxBuffer: 64 * 1024 * 1024 });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.length > 300000, `output truncated or too small (${r.stdout.length} bytes)`);
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual((Array.isArray(parsed) ? parsed : parsed.runs).length, 700);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
