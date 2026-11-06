'use strict';
// g3 item 2: a timed-out provider is fully dead before runExam returns and before any error exit of the CLI.
// The stub provider ignores SIGTERM; the run record write then fails; once the CLI has exited no stub pid may live.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUN = path.join(__dirname, '..', 'run.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lead-exam-g3kw-')));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('CLI exit after a failed output write leaves no TERM-ignoring stub process alive', () => {
  const stub = path.join(tmp, 'stubborn-provider.js');
  const pidFile = path.join(tmp, 'pids.txt');
  fs.writeFileSync(stub, `'use strict';
const fs = require('fs');
process.on('SIGTERM', () => {});
fs.appendFileSync(${JSON.stringify(pidFile)}, process.pid + '\\n');
setTimeout(() => {}, 120000);
`);
  fs.writeFileSync(pidFile, '');
  const cfg = path.join(tmp, 'cfg');
  fs.mkdirSync(cfg);
  fs.writeFileSync(cfg + '/.credentials.json', 'FAKE-CREDENTIAL-NOT-REAL');
  const out = path.join(tmp, 'out');
  fs.mkdirSync(path.join(out, 'run-n.json'), { recursive: true }); // the record file is a directory: the write fails
  const r = spawnSync(process.execPath, [RUN, '--seed', 's', '--out-dir', out, '--kind', 'claude', '--model', 'm', '--name', 'n', '--config-dir', cfg], {
    encoding: 'utf8', timeout: 30000,
    env: {
      PATH: process.env.PATH, HOME: path.join(tmp, 'fakehome'),
      LEAD_EXAM_PROVIDER_BIN: stub, LEAD_EXAM_ROUND_TIMEOUT_MS: '300', LEAD_EXAM_HARD_STOP_MS: '400', LEAD_EXAM_KILL_GRACE_MS: '600',
    },
  });
  const pids = fs.readFileSync(pidFile, 'utf8').split('\n').filter(Boolean).map(Number);
  try {
    assert.strictEqual(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /EISDIR|illegal operation/);
    assert.ok(pids.length >= 1, 'the stub ran');
    assert.deepStrictEqual(pids.filter(alive), [], 'no stub process alive right after the CLI exited');
  } finally {
    pids.forEach((p) => { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
