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
assert.deepStrictEqual(JSON.parse(fs.readFileSync(changed)), { ...JSON.parse(original), autoCompactWindow: 250000 }); assert.deepStrictEqual(JSON.parse(fs.readFileSync(unset)), { extra: true, autoCompactWindow: 283000 }); assert.equal(fs.readFileSync(bad, 'utf8'), '{broken');
const before = fs.statSync(changed).mtimeMs; const entries = fs.readdirSync(path.dirname(changed)); r = run('--apply', '--yes-go', 'test-go'); assert.equal(r.status, 0); assert.match(r.stdout, /already_aligned/); assert.equal(fs.statSync(changed).mtimeMs, before); assert.deepEqual(fs.readdirSync(path.dirname(changed)), entries);
r = run('--check'); assert.equal(r.status, 0);
console.log('PASS align-autocompact: 6 cases');
