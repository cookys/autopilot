'use strict';
// --system-addendum: appended to the examinee system prompt, sha256 and path recorded; no flag = prompt unchanged.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const lib = require('../lib');
const fx = require('../fixtures');
const { runExam } = require('../run');

const items = lib.loadItems();
const RUN = path.join(__dirname, '..', 'run.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lead-exam-addendum-'));
const ADD = '候選規則：測試用文字。';

test('no addendum: buildPrompt is byte-identical to the plain system prompt + rounds', () => {
  const map = lib.deriveNames(items, 's');
  const expected = [lib.subst(items.system_prompt, map), lib.renderRound(items, map, 1), '=== 請輸出第 1 輪 ==='].join('\n\n');
  assert.strictEqual(lib.buildPrompt(items, 's', 1, []), expected);
  assert.strictEqual(lib.buildPrompt(items, 's', 1, [], undefined), expected);
  assert.strictEqual(lib.buildPrompt(items, 's', 1, [], ''), expected);
});

test('with addendum: appended right after the system prompt in every round, nothing else moves', () => {
  const outs = fx.goldOutputs('s', items);
  const map = lib.deriveNames(items, 's');
  for (let r = 1; r <= items.rounds.length; r += 1) {
    const off = lib.buildPrompt(items, 's', r, outs);
    const on = lib.buildPrompt(items, 's', r, outs, ADD);
    const sys = lib.subst(items.system_prompt, map);
    assert.ok(on.startsWith(`${sys}\n\n${ADD}\n\n`));
    assert.strictEqual(on.replace(`\n\n${ADD}`, ''), off);
  }
});

test('runExam records addendum path and sha256 and the prompts carry the text; absent without the option', async () => {
  const seen = [];
  const call = async (prompt) => { seen.push(prompt); return { text: '{}', ms: 0, in_tokens_est: 1, out_tokens_est: 1 }; };
  const sha = crypto.createHash('sha256').update(ADD).digest('hex');
  const on = await runExam({ items, seed: 's', call, name: 'a', model: 'm', systemAddendum: { text: ADD, path: '/x/rule.md', sha256: sha } });
  assert.deepStrictEqual(on.system_addendum, { path: '/x/rule.md', sha256: sha });
  assert.ok(seen.every((p) => p.includes(ADD)));
  seen.length = 0;
  const off = await runExam({ items, seed: 's', call, name: 'a', model: 'm' });
  assert.ok(!('system_addendum' in off));
  assert.ok(seen.every((p) => !p.includes(ADD)));
});

test('CLI: --system-addendum <file> in a dry run records path and sha256; a missing file is a usage error', () => {
  const f = path.join(tmp, 'rule.md');
  fs.writeFileSync(f, ADD);
  const out = path.join(tmp, 'o');
  const r = spawnSync(process.execPath, [RUN, '--dry-run', '--seed', 'd', '--out-dir', out, '--system-addendum', f], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(r.status, 0, r.stderr);
  const run = JSON.parse(fs.readFileSync(path.join(out, 'run-dry-run-reference.json'), 'utf8'));
  assert.strictEqual(run.system_addendum.path, f);
  assert.strictEqual(run.system_addendum.sha256, crypto.createHash('sha256').update(ADD).digest('hex'));
  const bad = spawnSync(process.execPath, [RUN, '--dry-run', '--seed', 'd', '--out-dir', out, '--system-addendum', path.join(tmp, 'nope.md')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.strictEqual(bad.status, 2);
});
