// gen-locales.test.js — node --test mods/live/gen-locales.test.js: the --check fixtures (a planted literal label must fail with exit 1).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const here = __dirname;
const FILES = ['model.ts', 'ui.ts', 'pane.tsx', 'band.tsx', 'register.ts', 'i18n.ts', 'locales.ts'];
function fixture(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genloc-'));
  fs.mkdirSync(path.join(dir, 'locales'));
  for (const f of FILES) fs.copyFileSync(path.join(here, f), path.join(dir, f));
  for (const f of ['en.json', 'zh-TW.json']) fs.copyFileSync(path.join(here, 'locales', f), path.join(dir, 'locales', f));
  fs.copyFileSync(path.join(here, 'gen-locales.js'), path.join(dir, 'gen-locales.js'));
  if (extra) fs.appendFileSync(path.join(dir, 'model.ts'), `\n${extra}\n`);
  return dir;
}
const check = (dir) => {
  try { return spawnSync(process.execPath, [path.join(dir, 'gen-locales.js'), '--check'], { encoding: 'utf8' }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('the real tree passes --check (exit 0)', () => {
  const r = check(fixture(''));
  assert.strictEqual(r.status, 0, r.stderr);
});
for (const [name, line] of [
  ['single quotes', "const x = kv('x', seg('v'))"],
  ['double quotes', 'const x = kv("x", seg("v"))'],
  ['template literal', 'const x = kv(`x`, seg("v"))'],
  ['a rule title', "const x = rule('Plain title', [], 10)"],
]) {
  test(`--check exits 1 on a literal label (${name})`, () => {
    const r = check(fixture(line));
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /passes a literal label/);
  });
}
test('--check accepts kv(\'\', ...) (an empty key cell) and kv(t(...), ...)', () => {
  const r = check(fixture("const a = kv('', seg('v')); const b = kv(t('label.stage'), seg('v'))"));
  assert.strictEqual(r.status, 0, r.stderr);
});
