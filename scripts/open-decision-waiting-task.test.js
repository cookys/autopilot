'use strict';
require('./lib/test-git-env.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const OD = path.join(__dirname, 'open-decision.js');
const ids = ['01M8BPE8D7G8YZG1RECV83932A', '01M8BPE8D7G8YZG1RECV83932B'];
function scratch() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'od-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'od-repo-'));
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: repo }).status, 0);
  const bin = path.join(home, 'fleet');
  const log = path.join(home, 'calls');
  fs.writeFileSync(bin, '#!/usr/bin/env node\nrequire("fs").appendFileSync(process.env.CALL_LOG, JSON.stringify(process.argv.slice(2))+"\\n"); if (process.argv[4] === process.env.FAIL_ID) { console.error("simulated failure"); process.exit(1); }\n', { mode: 0o755 });
  const env = { ...process.env, HOME: home, FLEET_BIN: bin, CALL_LOG: log, AUTOPILOT_ALLOW_SCRATCH_CARD: '1', AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', AUTOPILOT_CARD_NOTIFY: 'off' };
  for (const k of ['AUTOPILOT_SESSION_ID', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_SESSION_ID', 'CODEX_THREAD_ID', 'XDG_CONFIG_HOME']) delete env[k];
  return {
    env, run(extra = []) { return spawnSync(process.execPath, [OD, 'open', '--category', 'goal', '--cwd', repo, '--kind', 'step', '--executor', 'ns/courier/member', '--question', 'Do the work', '--background', 'Context', ...extra], { env, encoding: 'utf8' }); },
    cards() { const d = path.join(repo, '.git', 'autopilot', 'decisions'); return fs.existsSync(d) ? fs.readdirSync(d).filter(n => n.endsWith('.json')).flatMap(n => JSON.parse(fs.readFileSync(path.join(d, n))).decisions) : []; },
    calls() { return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : []; },
    cleanup() { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); },
  };
}
test('repeatable waiting tasks append background and invoke fleet', () => {
  const s = scratch(); try {
    const r = s.run(ids.flatMap(id => ['--waiting-task', id]));
    assert.equal(r.status, 0, r.stderr);
    const card = s.cards()[0];
    assert.equal(card.background, `Context\nwaiting task: ${ids[0]}\nwaiting task: ${ids[1]}`);
    assert.deepEqual(s.calls(), ids.map(id => ['task', 'progress', id, 'waiting', '--waiting-on', `card:${card.id}`]));
    for (const id of ids) assert.match(r.stderr, new RegExp(`${id}.*ok`));
  } finally { s.cleanup(); }
});
test('a failed fleet call does not prevent later tasks or undo the card', () => {
  const s = scratch(); try {
    s.env.FAIL_ID = ids[0];
    const r = s.run(ids.flatMap(id => ['--waiting-task', id]));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(s.cards().length, 1);
    assert.equal(s.calls().length, 2);
    assert.match(r.stderr, new RegExp(`${ids[0]}.*simulated failure`));
    assert.match(r.stderr, new RegExp(`${ids[1]}.*ok`));
  } finally { s.cleanup(); }
});
test('invalid IDs reject the whole open before fleet or card writes', () => {
  for (const bad of [ids[0].slice(1), ids[0].toLowerCase(), `U${ids[0].slice(1)}`]) {
    const s = scratch(); try {
      const r = s.run(['--waiting-task', ids[0], '--waiting-task', bad]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /waiting-task/i);
      assert.deepEqual(s.cards(), []);
      assert.deepEqual(s.calls(), []);
    } finally { s.cleanup(); }
  }
});
test('without waiting tasks background and fleet calls are unchanged', () => {
  const s = scratch(); try {
    const r = s.run();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(s.cards()[0].background, 'Context');
    assert.deepEqual(s.calls(), []);
  } finally { s.cleanup(); }
});
