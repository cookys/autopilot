'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'align-test-'));
const script = path.join(__dirname, 'align-autocompact.js');
const profiles = [];
function fixture(name, content, kind = 'pm', model) {
  const dir = path.join(root, name); fs.mkdirSync(dir); const settings_path = path.join(dir, 'settings.json');
  if (content !== null) fs.writeFileSync(settings_path, content);
  profiles.push({ host: 'host', profile: name, kind, model, settings_path }); return settings_path;
}
const original = JSON.stringify({ autoCompactWindow: 100, modelSettings: { opus: { x: 1 } }, unknown: { a: [1, 2] } });
const changed = fixture('diverged', original, 'lead', 'opus');
const unset = fixture('unset', JSON.stringify({ extra: true }));
fixture('ok', JSON.stringify({ autoCompactWindow: 300000 }), 'worker', 'sonnet');
fixture('absent', null);
const bad = fixture('unreadable', '{broken');
const list = path.join(root, 'profiles.json'); fs.writeFileSync(list, JSON.stringify(profiles));
function run(...args) { return spawnSync(process.execPath, [script, '--profiles', list, ...args], { encoding: 'utf8', env: { ...process.env, HOME: root, TMPDIR: root } }); }
let r = run('--check'); assert.equal(r.status, 1); for (const s of ['ok', 'diverged', 'absent', 'unset', 'unreadable']) assert.match(r.stdout, new RegExp(`\\t${s}\\n`));
r = run('--apply'); assert.equal(r.status, 2); assert.equal(fs.readFileSync(changed, 'utf8'), original); assert.deepEqual(fs.readdirSync(path.dirname(changed)), ['settings.json']);
r = run('--apply', '--yes-go', 'test-go'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /audit\thost\tdiverged/); assert.match(r.stdout, /rollback\tcp --/);
const backup = fs.readdirSync(path.dirname(changed)).find(n => n.startsWith('settings.json.bak.')); assert.ok(backup);
const sha = s => crypto.createHash('sha256').update(s).digest('hex'); assert.equal(sha(fs.readFileSync(path.join(path.dirname(changed), backup))), sha(original));
assert.deepStrictEqual(JSON.parse(fs.readFileSync(changed)), { ...JSON.parse(original), autoCompactWindow: 250000 }); assert.deepStrictEqual(JSON.parse(fs.readFileSync(unset)), { extra: true, autoCompactWindow: 200000 }); assert.equal(fs.readFileSync(bad, 'utf8'), '{broken');
const before = fs.statSync(changed).mtimeMs; const entries = fs.readdirSync(path.dirname(changed)); r = run('--apply', '--yes-go', 'test-go'); assert.equal(r.status, 0); assert.match(r.stdout, /already_aligned/); assert.equal(fs.statSync(changed).mtimeMs, before); assert.deepEqual(fs.readdirSync(path.dirname(changed)), entries);
r = run('--check'); assert.equal(r.status, 0);
// real hangar list shapes: full model ids, null models, a pm with an opus model
const mf = path.join(root, 'mf'); fs.mkdirSync(mf);
const mk = (name, kind, model) => { const f = path.join(mf, name + '.json'); fs.writeFileSync(f, JSON.stringify({})); return { host: 'h', profile: name, kind, model, settings_path: f }; };
const famList = path.join(root, 'fam.json'); fs.writeFileSync(famList, JSON.stringify([mk('w-opus', 'worker', 'claude-opus-5-5'), mk('w-null', 'worker', null), mk('w-sonnet', 'worker', 'claude-sonnet-5-5'), mk('pm-opus', 'pm', 'claude-opus-5-5'), mk('lead-null', 'lead', null)]));
const fam = spawnSync(process.execPath, [script, '--profiles', famList, '--check'], { encoding: 'utf8' });
assert.equal(fam.status, 1, fam.stderr);
const exp = Object.fromEntries(fam.stdout.trim().split('\n').slice(1).map(l => { const c = l.split('\t'); return [c[1], c[4]]; }));
assert.deepStrictEqual(exp, { 'w-opus': '250000', 'w-null': '300000', 'w-sonnet': '300000', 'pm-opus': '200000', 'lead-null': '250000' });
console.log('PASS align-autocompact: 7 cases');
