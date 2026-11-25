'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dnt-bind-'));
const records = path.join(root, 'records'); fs.mkdirSync(records);
const mapping = path.join(root, 'mapping.json');
const out = path.join(root, 'out');
const ids = Array.from({length: 9}, (_, i) => String(i + 1).padStart(26, '0'));
function record(i, options = {}) {
  fs.writeFileSync(path.join(records, ids[i] + '.md'), `---\nid: ${ids[i]}\nkind: ${options.kind || 'decision'}\ncreated: ${options.created || '2026-11-14T18:25:00Z'}\n${options.source ? `source: ${options.source}\n` : ''}---\n${options.body || ''}\n`);
}
function run(entries, extra = []) {
  fs.writeFileSync(mapping, JSON.stringify({entries}));
  return spawnSync(process.execPath, [path.join(__dirname, 'decided-no-task-bind.js'), '--records', records, '--mapping', mapping, '--now', '2026-11-25T00:00:00Z', ...extra], {encoding: 'utf8'});
}
function snapshot() { return fs.readdirSync(records).sort().map(n => `${n} ${crypto.createHash('sha256').update(fs.readFileSync(path.join(records, n))).digest('hex')}`).join('\n'); }
record(0); record(1); record(2, {body: `task:${ids[0]}`}); record(3, {body: 'no-task: reason'});
record(4, {source: 'card d-1234abcd'}); record(5, {source: 'history-claim imported'});
record(6, {created: '2026-11-14T18:24:59Z'}); record(7, {kind: 'note'}); record(8, {body: `not-task:${ids[0]}`});
const before = snapshot();
const entries = [{id: ids[0], task: ids[2]}, {id: ids[1], no_task: 'ruling'}, {id: ids[8], no_task: 'no work'}];
let r = run(entries, ['--out', out]);
assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /before\s*[:=]\s*3/); assert.match(r.stdout, /after\s*[:=]\s*0/);
assert.equal(fs.readFileSync(path.join(out, 'proposal.tsv'), 'utf8').trim().split('\n').length, 3);
assert.equal(fs.readFileSync(path.join(out, 'audit.log'), 'utf8').trim().split('\n').length, 3);
assert.equal(snapshot(), before, 'records unchanged');
r = run(entries.slice(0, 1)); assert.equal(r.status, 1); assert.match(r.stdout, /after\s*[:=]\s*2/); assert.match(r.stdout, new RegExp(ids[1]));
for (const [i, entry] of entries.entries()) fs.appendFileSync(path.join(records, entry.id + '.md'), i === 0 ? `task:${entry.task}\n` : `no-task:${entry.no_task}\n`);
r = run(entries, ['--out', out]); assert.equal(r.status, 0, r.stderr); assert.equal((r.stdout.match(/already_bound/g) || []).length, 3); assert.equal(fs.readFileSync(path.join(out, 'proposal.tsv'), 'utf8'), '');
for (const entry of [{id: 'Z'.repeat(26), task: ids[0]}, {id: ids[2], task: 'bad'}, {id: ids[2], no_task: '  '}, {id: ids[2], task: ids[0], no_task: 'both'}]) {
  r = run([entry]); assert.notEqual(r.status, 0); assert.match(r.stdout + r.stderr, /unknown|error/i);
}
console.log('PASS: 8 cases (classification, full coverage, partial coverage, idempotence, unknown, invalid task, empty reason, conflicting fields); records SHA-256 unchanged');
