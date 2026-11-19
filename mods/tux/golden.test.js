// mods/tux/golden.test.js — locks the shared tux bytes: manifest shas, version drift, and every golden file.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { collect, sameFiles } = require('../../scripts/tux-manifest.js');
const { bodies } = require('./golden-render.js');

const here = __dirname;
const goldenDir = path.join(here, 'golden');

function readVersion() {
  const text = fs.readFileSync(path.join(here, 'VERSION'), 'utf8').trim();
  assert.match(text, /^\d+$/);
  return Number(text);
}

function drifts(base, head) {
  if (base === null || head.version !== base.version) return false;
  return !sameFiles(base.files || {}, head.files);
}

test('manifest shas match the tree and manifest.version equals VERSION', () => {
  const files = collect();
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'VERSION.manifest'), 'utf8'));
  const version = readVersion();
  assert.equal(manifest.version, version);
  assert.equal(sameFiles(manifest.files, files), true);
  const covered = Object.keys(files);
  assert.ok(covered.includes('format.ts') && covered.includes('golden/glyphs.json') && covered.includes('tokens.json'));
  assert.equal(Object.hasOwn(manifest.files, 'VERSION'), false);
  assert.equal(Object.hasOwn(manifest.files, 'VERSION.manifest'), false);
});

test('origin/develop manifest: a changed sha at the same version is red; no baseline is not a failure', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'VERSION.manifest'), 'utf8'));
  const shown = spawnSync('git', ['show', 'origin/develop:mods/tux/VERSION.manifest'], { encoding: 'utf8' });
  if (shown.status !== 0) return;
  const base = JSON.parse(shown.stdout);
  assert.equal(drifts(base, manifest), false);
});

test('negative: flip one byte of format.ts without recomputing the manifest is red', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'VERSION.manifest'), 'utf8'));
  const buf = Buffer.from(fs.readFileSync(path.join(here, 'format.ts')));
  buf[0] ^= 1;
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  assert.notEqual(sha, manifest.files['format.ts']);
  const flipped = { ...manifest.files, 'format.ts': sha };
  assert.equal(sameFiles(manifest.files, flipped), false);
});

test('negative: recomputing a changed sha without bumping VERSION is red; a bump is not', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(here, 'VERSION.manifest'), 'utf8'));
  const changed = { ...manifest.files, 'format.ts': '0'.repeat(64) };
  assert.equal(drifts(manifest, { version: manifest.version, files: changed }), true);
  assert.equal(drifts(manifest, { version: manifest.version + 1, files: changed }), false);
});

test('every golden file matches a fresh render', async () => {
  const out = await bodies();
  const names = fs.readdirSync(goldenDir).filter((n) => n !== '.' && n !== '..').sort();
  assert.deepEqual(names, Object.keys(out).sort());
  for (const [name, body] of Object.entries(out)) {
    assert.equal(fs.readFileSync(path.join(goldenDir, name), 'utf8'), body, name);
  }
});

test('pctInt(0.29)=29, pct(0.29)="29%", 0.896 floors to 89', async () => {
  const format = await import(path.join(here, 'format.ts'));
  assert.equal(format.pctInt(0.29), 29);
  assert.equal(format.pct(0.29), '29%');
  assert.equal(format.pctInt(0.896), 89);
  assert.equal(format.pct(0.896), '89%');
  assert.equal(format.pctInt(0.58), 58);
  const doc = JSON.parse(fs.readFileSync(path.join(goldenDir, 'pct-cases.json'), 'utf8'));
  const at = (r) => doc.cases.find((c) => c.ratio === r);
  assert.deepEqual(at(0.29), { ratio: 0.29, pctInt: 29, pct: '29%' });
  assert.deepEqual(at(0.896), { ratio: 0.896, pctInt: 89, pct: '89%' });
});

test('width cases cover emoji, CJK, East Asian Ambiguous, ZWJ and VS16', async () => {
  const width = await import(path.join(here, 'width.ts'));
  assert.equal(width.displayWidth('\u2193'), 1);
  assert.equal(width.displayWidth('中'), 2);
  assert.equal(width.displayWidth('👨\u200d👩\u200d👧'), 6);
  assert.equal(width.displayWidth('⚠\ufe0f'), 1);
  assert.equal(width.cellWidth(0xfe0f), 0);
  const doc = JSON.parse(fs.readFileSync(path.join(goldenDir, 'width-cases.json'), 'utf8'));
  for (const c of doc.cases) assert.equal(width.displayWidth(c.text), c.width, c.name);
  const by = Object.fromEntries(doc.cases.map((c) => [c.name, c.width]));
  assert.equal(by['ambiguous-down'], 1);
  assert.equal(by['zwj-family'], 6);
  assert.equal(by['vs16-warning'], 1);
  assert.equal(by.cjk, 6);
  assert.equal(by['emoji-cat'], 2);
});

test('dur cases keep the ui.ts units', async () => {
  const format = await import(path.join(here, 'format.ts'));
  assert.equal(format.dur(29000), '29s');
  assert.equal(format.dur(300000), '5m');
  assert.equal(format.dur(29100000), '8h05m');
  assert.equal(format.dur(360000000), '4d04h');
  assert.equal(format.dur(2332800000), '27d');
  assert.equal(format.dur(-1), '—');
  const doc = JSON.parse(fs.readFileSync(path.join(goldenDir, 'dur-cases.json'), 'utf8'));
  for (const c of doc.cases) assert.equal(format.dur(c.ms), c.dur);
});

test('panel cases: unknown tone drops, pet icon kept, money poison clears side', async () => {
  const { load } = require('./golden-render.js');
  const { panel } = await load();
  const doc = JSON.parse(fs.readFileSync(path.join(goldenDir, 'panel-cases.json'), 'utf8'));
  assert.equal(doc.schema, 'codeforge.panel/1');
  assert.deepEqual(doc.tones, 'subtle inactive dim bold mono success'.split(' '));
  assert.deepEqual(doc.tierKeys, { panel: [40, 60, 80, 100, 120], side: [30, 40, 50] });
  assert.equal(doc.tones.includes('warning'), false);
  assert.equal(doc.tones.includes('error'), false);
  for (const c of doc.cases) {
    const got = c.fn === 'readPet' ? panel.readPet(c.input) : panel.readLegacyUsage(c.input, c.nowMs);
    assert.deepEqual(got, c.expect, c.name);
  }
  const unknown = doc.cases.find((c) => c.name === 'unknown-tone');
  assert.equal(unknown.expect.usage['40'][0][0].text, 'keep');
  assert.equal(unknown.expect.usage['40'][0][0].tone, undefined);
  const pet = doc.cases.find((c) => c.name === 'pet-icon');
  assert.equal(pet.expect.pet.icon.id, 'cat');
  const poison = doc.cases.find((c) => c.name === 'usage-side-poison');
  assert.equal(poison.expect.side, null);
  assert.equal(JSON.stringify(poison.expect.usage).includes('$'), false);
  const missing = doc.cases.find((c) => c.name === 'missing-fields');
  assert.equal(missing.expect.pet, null);
});

test('layout-bottom keeps the tab row last; moving it to the top is red', () => {
  for (const name of ['layout-bottom-80.txt', 'layout-bottom-120.txt']) {
    const text = fs.readFileSync(path.join(goldenDir, name), 'utf8');
    const lines = text.split('\n');
    assert.equal(lines.at(-1), '');
    const strip = lines.at(-2);
    assert.ok(strip.length > 0, name);
    const moved = [strip, ...lines.slice(0, -2), ''].join('\n');
    assert.notEqual(moved, text);
    assert.notEqual(moved.split('\n').at(-2), strip);
  }
});

test('glyphs.json is the GLYPHS table and tabrow-80 locks the pet fallback', async () => {
  const glyphs = await import(path.join(here, 'glyphs.ts'));
  assert.equal(fs.readFileSync(path.join(goldenDir, 'glyphs.json'), 'utf8'), JSON.stringify(glyphs.GLYPHS, null, 2) + '\n');
  const tab80 = fs.readFileSync(path.join(goldenDir, 'tabrow-80.txt'), 'utf8');
  assert.match(tab80, /petIconLabel 79 /);
  assert.match(tab80, /petIconLabel 80 /);
  assert.match(tab80, /petTabFits 79 /);
  assert.match(tab80, /petTabFits 80 /);
  const line79 = tab80.split('\n').find((l) => l.startsWith('petIconLabel 79 '));
  const line80 = tab80.split('\n').find((l) => l.startsWith('petIconLabel 80 '));
  assert.equal(line79.slice('petIconLabel 79 '.length), glyphs.GLYPHS.pet.icons.cat.fallback);
  assert.equal(line80.slice('petIconLabel 80 '.length), glyphs.GLYPHS.pet.icons.cat.emoji);
});
