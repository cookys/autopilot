'use strict';
// g2 item 2: run.js --config-dir refuses the real config dir (or anything inside it, or a symlink to it) and any
// dir holding more than the throwaway credentials file. FAKE dirs only; nothing here reads a real credential.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RUN = path.join(__dirname, '..', 'run.js');
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lead-exam-g2cd-')));
const fakeHome = path.join(tmp, 'home');
const realCfg = path.join(fakeHome, '.claude');
fs.mkdirSync(path.join(realCfg, 'projects'), { recursive: true });
fs.writeFileSync(path.join(realCfg, '.credentials.json'), 'FAKE-CREDENTIAL-NOT-REAL');
const otherReal = path.join(tmp, 'elsewhere-real-config');
fs.mkdirSync(otherReal);
fs.writeFileSync(path.join(otherReal, '.credentials.json'), 'FAKE-CREDENTIAL-NOT-REAL');
const link = path.join(tmp, 'link-to-real');
fs.symlinkSync(realCfg, link);
const linkOther = path.join(tmp, 'link-to-envcfg');
fs.symlinkSync(otherReal, linkOther);
const good = path.join(tmp, 'throwaway');
fs.mkdirSync(good);
fs.writeFileSync(path.join(good, '.credentials.json'), 'FAKE-CREDENTIAL-NOT-REAL');
const extra = path.join(tmp, 'extra');
fs.mkdirSync(extra);
fs.writeFileSync(path.join(extra, '.credentials.json'), 'FAKE-CREDENTIAL-NOT-REAL');
fs.writeFileSync(path.join(extra, 'settings.json'), '{}');
const symcred = path.join(tmp, 'symcred');
fs.mkdirSync(symcred);
fs.symlinkSync(path.join(realCfg, '.credentials.json'), path.join(symcred, '.credentials.json'));

// a refusal exits 2 before any model call; the sentinel PATH of the suite plus a nonexistent --kind keeps this offline
const run = (dir) => spawnSync(process.execPath, [RUN, '--seed', 's', '--out-dir', path.join(tmp, 'out'), '--kind', 'claude', '--model', 'm', '--config-dir', dir], {
  encoding: 'utf8', timeout: 20000,
  env: { PATH: process.env.PATH, HOME: fakeHome, CLAUDE_CONFIG_DIR: otherReal },
});

for (const [label, dir] of [
  ['the real ~/.claude itself', realCfg], ['a dir inside the real ~/.claude', path.join(realCfg, 'projects')],
  ['a symlink to the real ~/.claude', link], ['the CLAUDE_CONFIG_DIR target', otherReal],
  ['a symlink to the CLAUDE_CONFIG_DIR target', linkOther], ['a dir holding more than the credentials file', extra],
  ['a dir whose credentials file is a symlink', symcred], ['a path that does not exist', path.join(tmp, 'nope')],
  ['the HOME dir (it holds the real config dir)', fakeHome],
]) {
  test(`refused with exit 2: ${label}`, () => {
    const r = run(dir);
    assert.strictEqual(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--config-dir/);
    assert.ok(!fs.existsSync(path.join(tmp, 'out')), 'nothing was run or written');
  });
}

test('accepted: a throwaway dir holding only .credentials.json (unit)', () => {
  const { checkConfigDir } = require('../run');
  assert.strictEqual(checkConfigDir(good, { HOME: fakeHome, CLAUDE_CONFIG_DIR: otherReal }), good);
  assert.throws(() => checkConfigDir(link, { HOME: fakeHome }), /real/);
});

test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });
