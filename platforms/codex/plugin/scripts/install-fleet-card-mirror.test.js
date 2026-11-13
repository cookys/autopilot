'use strict';

// install-fleet-card-mirror.js writes only under the HOME it is given. It must not
// call systemctl, and a second install of the same bytes is a no-op.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const INSTALL = path.join(__dirname, 'install-fleet-card-mirror.js');
const MARKER = 'autopilot:fleet-card-mirror/1';

function run(args, home) {
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(
    path.join(bin, 'systemctl'),
    '#!/bin/sh\necho called > "$HOME/systemctl-called"\nexit 99\n',
    { mode: 0o755 }
  );
  return spawnSync(process.execPath, [INSTALL, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: home,
      TMPDIR: home,
    },
  });
}

function unitDir(home) {
  return path.join(home, '.config', 'systemd', 'user');
}

test('install is opt-in, idempotent, and never calls systemctl', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-card-mirror-install-'));
  const realService = path.join(os.homedir(), '.config', 'systemd', 'user', 'fleet-card-mirror.service');
  const realBefore = fs.existsSync(realService);

  const bare = run([], home);
  assert.strictEqual(bare.status, 2);
  assert.ok(!fs.existsSync(unitDir(home)));

  const first = run(['install'], home);
  assert.strictEqual(first.status, 0, first.stderr);
  const dir = unitDir(home);
  const service = fs.readFileSync(path.join(dir, 'fleet-card-mirror.service'), 'utf8');
  const timer = fs.readFileSync(path.join(dir, 'fleet-card-mirror.timer'), 'utf8');
  assert.ok(service.includes(MARKER));
  assert.ok(timer.includes(MARKER));
  assert.ok(!service.includes('<repo>'));
  assert.match(service, /ExecStart=\/usr\/bin\/env node .+\/scripts\/fleet-card-mirror\.js sync\n/);
  assert.match(timer, /^OnCalendar=\*:0\/5$/m);
  assert.match(timer, /^Persistent=true$/m);
  assert.match(timer, /^RandomizedDelaySec=30$/m);
  assert.match(first.stdout, /enable: systemctl --user daemon-reload/);
  assert.ok(!fs.existsSync(path.join(home, 'systemctl-called')));

  const second = run(['install'], home);
  assert.strictEqual(second.status, 0, second.stderr);
  assert.match(second.stdout, /unchanged: fleet-card-mirror.service/);
  assert.match(second.stdout, /unchanged: fleet-card-mirror.timer/);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'fleet-card-mirror.service'), 'utf8'), service);

  const dry = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-card-mirror-dry-'));
  const dryRun = run(['install', '--dry-run'], dry);
  assert.strictEqual(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /would write: fleet-card-mirror.service/);
  assert.ok(!fs.existsSync(unitDir(dry)));

  assert.strictEqual(fs.existsSync(realService), realBefore);
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(dry, { recursive: true, force: true });
});

test('uninstall removes only our units', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-card-mirror-uninstall-'));
  assert.strictEqual(run(['install'], home).status, 0);
  const gone = run(['uninstall'], home);
  assert.strictEqual(gone.status, 0, gone.stderr);
  assert.ok(!fs.existsSync(path.join(unitDir(home), 'fleet-card-mirror.service')));
  assert.ok(!fs.existsSync(path.join(unitDir(home), 'fleet-card-mirror.timer')));
  assert.strictEqual(run(['uninstall'], home).status, 0);

  const foreignHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-card-mirror-foreign-'));
  const foreignDir = unitDir(foreignHome);
  fs.mkdirSync(foreignDir, { recursive: true });
  const foreign = path.join(foreignDir, 'fleet-card-mirror.service');
  fs.writeFileSync(foreign, '# not ours\n[Service]\nExecStart=/bin/true\n');
  const refused = run(['uninstall'], foreignHome);
  assert.strictEqual(refused.status, 1);
  assert.strictEqual(fs.readFileSync(foreign, 'utf8'), '# not ours\n[Service]\nExecStart=/bin/true\n');
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(foreignHome, { recursive: true, force: true });
});
