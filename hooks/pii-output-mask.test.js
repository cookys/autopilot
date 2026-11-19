'use strict';

// Synthetic data only: every value is built at runtime. Run: node --test hooks/pii-output-mask.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { maskPii, scanPii, redactOutput } = require('./_shared/secret-patterns.js');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-mask-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// Independent check-digit builder: tries each last digit until the official weighted sum is 0 mod 10.
const CODES = { A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21,
  N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33 };
function makeId(letter, second, seed) {
  const body = String(seed).padStart(7, '0').slice(-7);
  const c = CODES[letter];
  const weights = [8, 7, 6, 5, 4, 3, 2, 1];
  const digits = [second, ...body].map(Number);
  let sum = Math.floor(c / 10) + (c % 10) * 9 + digits.reduce((a, d, i) => a + d * weights[i], 0);
  return `${letter}${second}${body}${(10 - (sum % 10)) % 10}`;
}
function makeCard(prefix, length) {
  const base = prefix + '7'.repeat(length - prefix.length - 1);
  for (let d = 0; d < 10; d++) {
    const s = base + d;
    let sum = 0;
    for (let i = s.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) {
      let n = Number(s[i]); if (dbl) { n *= 2; if (n > 9) n -= 9; } sum += n;
    }
    if (sum % 10 === 0) return s;
  }
  throw new Error('unreachable');
}
function breakId(id) { return id.slice(0, 9) + String((Number(id[9]) + 1) % 10); }

const validId = makeId('A', 1, 2345678);
const validIdNew = makeId('B', 8, 1234567);
const mobile = ['0912345678', '0912-345-678', '0912 345 678', '+886-912-345-678', '+886912345678'];
const card = makeCard('4', 16);

test('each category is masked and counted without the value', () => {
  const input = [validId, validIdNew, ...mobile, 'user.name+x@example.org', card,
    `${card.slice(0, 4)} ${card.slice(4, 8)} ${card.slice(8, 12)} ${card.slice(12)}`].join('\n');
  const { text, counts } = maskPii(input);
  assert.deepEqual(counts, { tw_national_id: 2, tw_mobile: 5, email: 1, card_number: 2 });
  for (const raw of [validId, validIdNew, ...mobile, 'user.name+x@example.org', card]) assert.ok(!text.includes(raw), raw);
  assert.match(redactOutput(validId), /\[masked: tw_national_id x1\]\n$/);
});

test('checksum and Luhn gate: invalid values are left alone', () => {
  const bad = breakId(validId);
  const badCard = card.slice(0, 15) + String((Number(card[15]) + 1) % 10);
  assert.deepEqual(scanPii(`${bad} ${badCard}`), {});
  assert.equal(redactOutput(`${bad}`), bad);
});

test('long identifiers, hashes and timestamps are not mistaken for PII', () => {
  const clean = [
    String(Date.now() * 1000),               // 16-digit epoch microseconds
    String(Date.now()),                      // 13-digit epoch ms (leading 1)
    String(Date.now()) + '000',              // 16 digits
    'a3f5c9e1b2d4a3f5c9e1b2d4a3f5c9e1b2d4a3f5',
    `0${mobile[0]}`,                         // 11 digits starting 09: longer run
    `${mobile[0]}1`,                         // 11 digits: longer run
    `id${validId}x`,                         // glued to word characters
    '12345678-1234-1234-1234-123456789012',  // uuid-shaped digits
    'git@github.com:org/repo.git',           // scp remote, not an email
    'lodash@4.17.21 pkg@1.2.3',
    `x${makeCard('4', 16)}`,                 // card digits glued to a letter
  ];
  for (const s of clean) assert.deepEqual(scanPii(s), {}, s);
});

// Synthetic player extract: 12 rows, CSV and JSON array.
const rows = Array.from({ length: 12 }, (_, i) => ({
  name: `Player${i}`,
  national_id: makeId(String.fromCharCode(65 + i), i % 2 ? 2 : 1, 1000003 + i * 7919),
  phone: `09${String(10 + i).padStart(2, '0')}${String(100200 + i * 13).padStart(6, '0')}`,
  email: `player${i}@example.test`,
}));
const csv = ['name,national_id,phone,email', ...rows.map((r) => `${r.name},${r.national_id},${r.phone},${r.email}`)].join('\n') + '\n';
const json = JSON.stringify(rows, null, 2) + '\n';
const rawValues = rows.flatMap((r) => [r.national_id, r.phone, r.email]);
const SUMMARY = '[masked: tw_national_id x12, tw_mobile x12, email x12]';

function assertClean(output) {
  for (const raw of rawValues) assert.ok(!output.includes(raw), 'raw value leaked');
}

function hook(file, payload) {
  const env = { ...process.env, AUTOPILOT_BASH_GUARD_SECRET_MODE: 'block' };
  const child = spawnSync(process.execPath, [path.join(__dirname, file)], {
    input: JSON.stringify(payload), encoding: 'utf8', env, timeout: 15000,
  });
  assert.equal(child.status, 0, child.stderr);
  return child.stdout ? JSON.parse(child.stdout) : null;
}

for (const [label, body] of [['csv', csv], ['json', json]]) {
  const file = path.join(tmp, `extract.${label}`);
  fs.writeFileSync(file, body);

  test(`replay ${label}: Bash output is masked with category counts`, () => {
    const response = { stdout: body, stderr: '', interrupted: false, isImage: false, noOutputExpected: false };
    const out = hook('secret-output-redact.js', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_response: response });
    const text = out.hookSpecificOutput.updatedToolOutput.stdout;
    assertClean(text);
    assert.ok(text.includes(SUMMARY), text);
  });

  test(`replay ${label}: Read is denied with a zh-TW safe-inspect pointer`, () => {
    const out = hook('pii-read-guard.js', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: file } });
    const reason = out.hookSpecificOutput.permissionDecisionReason;
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assertClean(reason);
    assert.match(reason, /safe-inspect/);
    assert.match(reason, /個人資料/);
    assert.ok(reason.includes('tw_national_id x12'));
  });

  test(`replay ${label}: Grep content over the file and over its directory is denied`, () => {
    for (const target of [file, tmp]) {
      const out = hook('pii-read-guard.js', {
        hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: { pattern: '.', path: target, output_mode: 'content' },
      });
      assert.equal(out.hookSpecificOutput.permissionDecision, 'deny', target);
    }
  });

  test(`replay ${label}: safe-inspect file shows no raw value`, () => {
    const child = spawnSync(process.execPath, [path.join(root, 'scripts', 'safe-inspect.js'), 'file', file], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assertClean(child.stdout);
  });
}

test('Grep without content output, Glob and clean files pass', () => {
  const file = path.join(tmp, 'extract.csv');
  fs.writeFileSync(file, csv);
  for (const input of [{ pattern: 'x', path: file }, { pattern: 'x', path: file, output_mode: 'files_with_matches' },
    { pattern: 'x', path: file, output_mode: 'count' }]) {
    assert.equal(hook('pii-read-guard.js', { hook_event_name: 'PreToolUse', tool_name: 'Grep', tool_input: input }), null);
  }
  assert.equal(hook('pii-read-guard.js', { hook_event_name: 'PreToolUse', tool_name: 'Glob', tool_input: { pattern: '*' } }), null);
  const clean = path.join(tmp, 'clean.txt');
  fs.writeFileSync(clean, 'hello world\nauthor: a@example.test\n');
  assert.equal(hook('pii-read-guard.js', { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: clean } }), null);
});

test('safe-inspect masks PII inside keys', () => {
  const file = path.join(tmp, 'keys.json');
  fs.writeFileSync(file, JSON.stringify({ [validId]: 'v', [`${mobile[0]}`]: 'w' }));
  const child = spawnSync(process.execPath, [path.join(root, 'scripts', 'safe-inspect.js'), 'file', file], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(!child.stdout.includes(validId) && !child.stdout.includes(mobile[0]));
});

test('negative control: without tw_national_id the replay leaks IDs (so the replay asserts bite)', () => {
  const script = `
    const m = require(${JSON.stringify(path.join(__dirname, '_shared', 'secret-patterns.js'))});
    m.piiPatterns.splice(m.piiPatterns.findIndex((p) => p.name === 'tw_national_id'), 1);
    process.stdout.write(m.redactOutput(${JSON.stringify(csv)}));`;
  const child = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.ok(rows.every((r) => child.stdout.includes(r.national_id)), 'control must leak every ID');
  assert.ok(!child.stdout.includes('tw_national_id'));
});
