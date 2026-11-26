// gen-locales.test.js — node --test mods/live/gen-locales.test.js: the --check fixtures (a planted literal label must fail with exit 1).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const here = __dirname;
const FILES = ['model.ts', 'tabs.ts', 'ui.ts', 'pane.tsx', 'band.tsx', 'band-onerow.ts', 'speedview.ts', 'register.ts', 'addrcomplete.ts', 'i18n.ts', 'shell.ts', 'consoletabs.ts', 'commandtab.ts', 'consolepages.ts', 'askpm.ts', 'pettab.ts', 'pages/frame.ts', 'pages/help.ts', 'pages/index.ts', 'pages/rows.ts', 'pages/quota-pick.ts', 'pages/quota.ts', 'pages/now.ts', 'pages/fleet.ts', 'pages/decide.ts', 'pages/review.ts', 'locales.ts', 'pages/dispatch.ts', 'pages/spend.ts', 'pages/metering.ts', 'pages/hygiene.ts', 'pages/room.ts'];
function fixture(extra, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genloc-'));
  const dir = path.join(root, 'live');
  fs.mkdirSync(path.join(dir, 'locales'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'pages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tux'), { recursive: true });
  for (const f of FILES) fs.copyFileSync(path.join(here, f), path.join(dir, f));
  for (const f of ['en.json', 'zh-TW.json']) fs.copyFileSync(path.join(here, 'locales', f), path.join(dir, 'locales', f));
  fs.copyFileSync(path.join(here, 'gen-locales.js'), path.join(dir, 'gen-locales.js'));
  fs.copyFileSync(path.join(here, '..', 'tux', 'tokens.json'), path.join(root, 'tux', 'tokens.json'));
  if (extra) fs.appendFileSync(path.join(dir, 'model.ts'), `\n${extra}\n`);
  if (mutate) mutate(root, dir);
  return dir;
}
const check = (dir) => {
  try { return spawnSync(process.execPath, [path.join(dir, 'gen-locales.js'), '--check'], { encoding: 'utf8' }); } finally { fs.rmSync(path.dirname(dir), { recursive: true, force: true }); }
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
test('--check exits 1 when a locale term.* string disagrees with tokens.terms', () => {
  const r = check(fixture('', (_root, dir) => {
    const p = path.join(dir, 'locales', 'en.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j['term.pet'] = 'NOT-PET';
    fs.writeFileSync(p, JSON.stringify(j));
  }));
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /term\.pet/);
});
