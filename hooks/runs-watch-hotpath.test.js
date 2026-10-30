'use strict';
// runs-watch-hotpath.test.js -- the PostToolUse hot path of hooks/runs-watch-autostart.js makes no directory (BL-0336 U1,
// plan F3 / F6 row "hot path makes no directory"). The hook runs under a preload that counts fs.mkdirSync / fs.mkdir /
// fs.promises.mkdir / fs.chmodSync; both PostToolUse fast outcomes (the watcher is alive; the 60 s throttle holds) must show
// zero. TMPDIR points at a directory that does not exist, so ANY call to ensureTmpdir on this path would make it (a regression
// that moves the SessionStart-time ensure into the hot path turns this red). Negative control: a copy of the hook with
// that ensure moved up must show a mkdir.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');
const { copyPlugin, mutate } = require('./tests/lib/plugin-copy');

const REPO = path.resolve(__dirname, '..');
const KEY = '0123456789abcdef';
const SID = 'hotpath-session-1';

const PRELOAD = `
const fs = require('fs');
const counts = { mkdir: [], chmod: [] };
for (const [name, bucket] of [['mkdirSync', 'mkdir'], ['mkdir', 'mkdir'], ['chmodSync', 'chmod'], ['chmod', 'chmod']]) {
  const orig = fs[name];
  fs[name] = function wrapped(p, ...rest) { counts[bucket].push(String(p)); return orig.call(this, p, ...rest); };
}
const po = fs.promises.mkdir;
fs.promises.mkdir = function wrapped(p, ...rest) { counts.mkdir.push(String(p)); return po.call(this, p, ...rest); };
process.on('exit', () => { fs.writeFileSync(process.env.COUNT_FILE, JSON.stringify(counts)); });
`;

function scenario(root, kind) {
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'hot-')));
  const home = path.join(sb, 'home');
  const live = fs.mkdtempSync(path.join('/dev/shm', 'hot-live-'));
  fs.chmodSync(live, 0o700);
  fs.mkdirSync(home);
  const repo = path.join(sb, 'repo');
  fs.mkdirSync(repo);
  execFileSync('git', ['-C', repo, 'init', '-q']);
  const preload = path.join(sb, 'count.js');
  fs.writeFileSync(preload, PRELOAD);
  const countFile = path.join(sb, 'counts.json');
  // a process whose command line reads like a project watcher: `... status runs --watch --project <key>`
  const watcher = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)', 'status', 'runs', '--watch', '--project', KEY], { stdio: 'ignore' });
  try {
    const realRoot = fs.realpathSync(root);
    const version = JSON.parse(fs.readFileSync(path.join(realRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
    const pid = kind === 'alive' ? watcher.pid : 2 ** 22 - 3; // a pid that is not a watcher
    fs.mkdirSync(path.join(live, 'autostart'), { recursive: true, mode: 0o700 });
    const stamp = path.join(live, 'autostart', `${SID}.ensure`);
    fs.writeFileSync(stamp, JSON.stringify({ cwd: repo, project_key: KEY, pid, plugin_root: realRoot, plugin_version: version }));
    // alive: the stamp is OLD, so only the "pid is a watcher of this project" answer can end the hook early (the throttle would not)
    if (kind === 'alive') { const old = new Date(Date.now() - 600000); fs.utimesSync(stamp, old, old); }
    const payload = JSON.stringify({ hook_event_name: 'PostToolUse', session_id: SID, tool_name: 'Bash', cwd: repo, tool_input: { command: 'ls' } });
    const r = spawnSync(process.execPath, ['-r', preload, path.join(root, 'hooks/runs-watch-autostart.js')], {
      input: payload, encoding: 'utf8', cwd: sb, timeout: 30000,
      env: {
        PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), AUTOPILOT_LIVE_DIR: live,
        AUTOPILOT_RUNS_WATCH_AUTOSTART: '1', TMPDIR: path.join(sb, 'tmp-that-does-not-exist'), COUNT_FILE: countFile,
      },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'PostToolUse writes nothing');
    return JSON.parse(fs.readFileSync(countFile, 'utf8'));
  } finally {
    try { process.kill(watcher.pid, 'SIGKILL'); } catch (_e) { /* gone */ }
    fs.rmSync(sb, { recursive: true, force: true });
    fs.rmSync(live, { recursive: true, force: true });
  }
}

function check(root) {
  for (const kind of ['alive', 'throttled']) {
    const c = scenario(root, kind);
    assert.deepStrictEqual(c.mkdir, [], `PostToolUse (${kind}) made a directory: ${JSON.stringify(c.mkdir)}`);
    assert.deepStrictEqual(c.chmod, [], `PostToolUse (${kind}) chmod-ed: ${JSON.stringify(c.chmod)}`);
  }
}

test('PostToolUse hot path (watcher alive; throttle holding): no mkdir, no chmod, nothing printed', () => check(REPO));

test('negative control: the temp-directory ensure moved into the hot path makes a directory and is caught', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hot-copy-'));
  copyPlugin(REPO, root);
  mutate(root, 'hooks/runs-watch-autostart.js', 'if (!postToolUse) ensureTmp();', 'ensureTmp();');
  assert.throws(() => check(root), (e) => e instanceof assert.AssertionError && /made a directory/.test(e.message));
  fs.rmSync(root, { recursive: true, force: true });
});
