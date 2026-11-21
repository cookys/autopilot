#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const LINT_PATH = path.resolve(__dirname, 'check-test-cli-timeout.js');

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-test-cli-timeout-'));
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'hooks', 'tests'), { recursive: true });
  return dir;
}

test('flags spawnSync without timeout (incident shape) as red', () => {
  const dir = makeSandbox();
  try {
    fs.writeFileSync(
      path.join(dir, 'scripts', 'incident.test.js'),
      `const { spawnSync } = require('child_process');\n` +
      `spawnSync(process.execPath, ['scripts/rc-alarm.js','check','--label','a','--state-dir','/proc/x/y']);\n`,
      'utf8'
    );
    const res = spawnSync(process.execPath, [LINT_PATH, '--check', '--root', dir], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /scripts\/incident\.test\.js:2:spawnSync/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('passes when spawnSync has timeout and sh line has timeout prefix', () => {
  const dir = makeSandbox();
  try {
    fs.writeFileSync(
      path.join(dir, 'scripts', 'ok.test.js'),
      `const { spawnSync } = require('child_process');\n` +
      `spawnSync(process.execPath, ['scripts/rc-alarm.js'], { timeout: 5000 });\n`,
      'utf8'
    );
    fs.writeFileSync(
      path.join(dir, 'hooks', 'tests', 'ok.test.sh'),
      `#!/usr/bin/env bash\ntimeout 30 node scripts/rc-alarm.js\n`,
      'utf8'
    );
    const res = spawnSync(process.execPath, [LINT_PATH, '--check', '--root', dir], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(res.status, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('write-baseline ratchets existing violations and reports disappeared entries', () => {
  const dir = makeSandbox();
  try {
    const testFile = path.join(dir, 'scripts', 'legacy.test.js');
    fs.writeFileSync(testFile, `execSync('echo hi');\n`, 'utf8');

    const writeRes = spawnSync(process.execPath, [LINT_PATH, '--write-baseline', '--root', dir], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(writeRes.status, 0);

    const checkRes = spawnSync(process.execPath, [LINT_PATH, '--check', '--root', dir], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(checkRes.status, 0);

    fs.writeFileSync(testFile, `execSync('echo hi', { timeout: 1000 });\n`, 'utf8');
    const cleanRes = spawnSync(process.execPath, [LINT_PATH, '--check', '--root', dir], {
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(cleanRes.status, 0);
    assert.match(cleanRes.stdout, /baseline entries disappeared/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
