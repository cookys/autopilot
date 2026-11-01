'use strict';
// runs-dir-refused-readers.test.js -- a runs directory that ensureRunsDir REFUSES is never read (BL-0336 U1, review round 1, point 1).
// Fixture: a runs directory other users can write to (mode 0777: refused) holding a planted manifest; the same manifest in a mode 0700
// directory is the positive control (it IS read there), so a reader that quietly returns nothing cannot pass. Every reader that
// takes the default runs directory is driven: dispatch-status --list, dispatch-tree, `status runs` (collectRuns), and the engine's
// continuation scan. Negative control: a copy of each reader that ignores `ok:false` must show the planted manifest.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyPlugin, mutate } = require('./tests/lib/plugin-copy');

const REPO = path.resolve(__dirname, '..');
const PLANTED = 'PLANTED-RUN-9f3a';
const SESSION = 'sess-planted-1';

function world(mode) {
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rdr-')));
  fs.chmodSync(sb, 0o700);
  const runs = path.join(sb, 'runs');
  fs.mkdirSync(runs);
  fs.chmodSync(runs, mode);
  fs.writeFileSync(path.join(runs, `${PLANTED}.manifest.json`), JSON.stringify({
    run_id: PLANTED, root_run_id: PLANTED, role: 'hand', runner: 'x', model: 'm', session_id: SESSION, started_at: '2026-10-31T00:00:00Z', pid: 1,
  }));
  const home = path.join(sb, 'home');
  fs.mkdirSync(path.join(home, '.claude', 'projects'), { recursive: true });
  const env = {
    PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), AUTOPILOT_DISPATCH_RUNS_DIR: runs,
    AUTOPILOT_SESSION_MODE_DIR: path.join(sb, 'markers'), TMPDIR: sb, AUTOPILOT_LIVE_DIR: (() => { const d = fs.mkdtempSync(path.join('/dev/shm', 'rdr-live-')); fs.chmodSync(d, 0o700); return d; })(),
  };
  return { sb, env };
}
const drop = (w) => { fs.rmSync(w.sb, { recursive: true, force: true }); fs.rmSync(w.env.AUTOPILOT_LIVE_DIR, { recursive: true, force: true }); };

const readers = {
  status(root, w) { return spawnSync(process.execPath, [path.join(root, 'scripts/dispatch-status.js'), '--list'], { encoding: 'utf8', env: w.env }); },
  tree(root, w) { return spawnSync(process.execPath, [path.join(root, 'scripts/dispatch-tree.js'), '--session', SESSION, '--json'], { encoding: 'utf8', env: w.env }); },
  runs(root, w) { return spawnSync(process.execPath, [path.join(root, 'bin/autopilot.js'), 'status', 'runs', '--json'], { encoding: 'utf8', env: w.env, cwd: w.sb }); },
  engine(root, w) {
    const code = `const ca = require(process.argv[1] + '/src/engine/continuation-admission');
      const r = ca.loadMatchingRunsFromDefaultRunsDir({}, process.env); process.stdout.write(JSON.stringify(r));`;
    return spawnSync(process.execPath, ['-e', code, root], { encoding: 'utf8', env: w.env });
  },
};
const seen = (r) => `${r.stdout}${r.stderr}`.includes(PLANTED);

function check(root) {
  for (const [name, run] of Object.entries(readers)) {
    const open = world(0o777);
    const closed = world(0o700);
    try {
      const refused = run(root, open);
      assert.ok(!seen(refused), `${name}: read the planted manifest out of a refused directory:\n${refused.stdout.slice(0, 300)}`);
      assert.match(`${refused.stdout}${refused.stderr}`, /unusable|writable by other users/, `${name}: the reason must be said`);
      assert.ok(seen(run(root, closed)), `${name}: positive control — the same manifest in a private directory must be visible`);
    } finally { drop(open); drop(closed); }
  }
}

test('no reader reads a runs directory that ensureRunsDir refuses, each says why, and each reads the same manifest in a private one', () => check(REPO));

test('negative control: readers that ignore ok:false show the planted manifest', () => {
  // `status runs` takes its rows from dispatch-status --list, which refuses on its own; the cli's own check is the second lock, so the
  // control removes both.
  for (const edits of [
    [['src/engine/continuation-admission.js', 'if (!ensured.ok) return { runs: [], unusable: ensured.reason };', '']],
    [['scripts/dispatch-tree.js', 'runsDir = null; }', '}']],
    [['src/status/cli.js', 'if (!ensured.ok) {\n    // A refused directory', 'if (false) {\n    // A refused directory'],
      ['scripts/dispatch-status.js', 'if (ens.error) return unusableRunsDir(ens.error);\n    const out = reapRuns', 'const out = reapRuns'],
      ['scripts/dispatch-status.js', 'if (ens.error) return unusableRunsDir(ens.error);\n    const dir = ens.dir;\n    let entries = [];', 'const dir = ens.dir;\n    let entries = [];']],
  ]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdr-copy-'));
    copyPlugin(REPO, root);
    for (const [rel, from, to] of edits) mutate(root, rel, from, to);
    assert.throws(() => check(root), assert.AssertionError, `${edits[0][0]}: the mutation must be caught`);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
