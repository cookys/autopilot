'use strict';
// G40 D4 pure probe functions (plan 5.3, 10). Run: node --test scripts/lib/account-probe.test.js
//   G40-N13/N14/N76  staleCandidates   G40-N66  probeModeAllowed   G40-N73  checkProbeConfig   N27-style argv equality
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const p = require('./account-probe');

const MANIFEST = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'quota-adapters', 'claude.json'), 'utf8'));
const NOW_S = 1_800_000_000;
const A = (...names) => names.map((alias, i) => ({ alias, priority: 10 * (i + 1) }));
const merged = (used, ageS, cls) => ({ class: cls || 'ok', used, refusal: null, windows: ageS === null ? [] : [{ kind: 'rolling_5h', observed_at: NOW_S - ageS }] });

test('G40-N27: probeArgv equals the manifest tinyprobe template with only <PROMPT> replaced, byte for byte', () => {
  const t = MANIFEST.capture.find((x) => x.mode === 'tinyprobe').argv_template;
  const got = p.probeArgv(MANIFEST, p.PROBE_PROMPT);
  assert.strictEqual(got.length, t.length);
  t.forEach((x, i) => assert.strictEqual(got[i], x === '<PROMPT>' ? p.PROBE_PROMPT : x));
  assert.ok(!got.includes('--strict-mcp-config'), 'plan 5.3: that flag has no live run and is not in the argv');
  assert.deepStrictEqual(got.slice(0, 2), ['claude', '-p']);
  assert.ok(got.includes('--no-session-persistence') && got.includes('--verbose'));
});

test('G40-N27: probeArgv throws on a manifest without a usable template, a doubled placeholder or an empty prompt', () => {
  assert.throws(() => p.probeArgv({ capture: [] }, 'x'), /probe_manifest_missing/);
  assert.throws(() => p.probeArgv(undefined, 'x'), /probe_manifest_missing/);
  assert.throws(() => p.probeArgv({ capture: [{ mode: 'tinyprobe', argv_template: ['a', '<PROMPT>', '<PROMPT>'] }] }, 'x'), /placeholder/);
  assert.throws(() => p.probeArgv({ capture: [{ mode: 'tinyprobe', argv_template: ['a'] }] }, 'x'), /placeholder/);
  assert.throws(() => p.probeArgv(MANIFEST, ''), /prompt_empty/);
});

test('G40-N14: a tight, cooling, refused, excluded or fresh alias is not a candidate; a stale ok or never-observed alias is', () => {
  const m = {
    tight: merged(0.95, 7200, 'tight'), tightByUsed: merged(0.91, 7200), cooling: merged(0.1, 7200, 'cooling'),
    refused: Object.assign(merged(null, null), { refusal: { observed_at: NOW_S - 5 } }), fresh: merged(0.3, 600), stale: merged(0.3, 7200),
  };
  const accts = A('tight', 'tightByUsed', 'cooling', 'refused', 'fresh', 'stale', 'never', 'excl', 'cd');
  const got = p.staleCandidates(accts, Object.assign({ excl: merged(0.3, 7200), cd: merged(0.3, 7200) }, m), { cd: (NOW_S + 60) * 1000 }, ['excl'], NOW_S, 60);
  assert.deepStrictEqual(got, ['stale', 'never']);
  assert.deepStrictEqual(p.staleCandidates(A('stale'), { stale: merged(0.3, 7200) }, { stale: (NOW_S - 1) * 1000 }, [], NOW_S, 60), ['stale'], 'an expired cooldown does not block');
  assert.deepStrictEqual(p.staleCandidates(A('x'), { x: merged(0.3, 3600) }, {}, [], NOW_S, 60), [], 'exactly at the threshold is still fresh');
  assert.deepStrictEqual(p.staleCandidates(A('x'), { x: merged(0.3, 3601) }, {}, [], NOW_S, 60), ['x']);
  assert.deepStrictEqual(p.staleCandidates(undefined, undefined, undefined, undefined, NOW_S, 60), []);
});

test('G40-N66: scheduled is allowed only for starts_window false with evidence; unknown and true are not; off and stale always', () => {
  const man = (sw, ev) => ({ capture: [Object.assign({ mode: 'tinyprobe', argv_template: ['x', '<PROMPT>'], starts_window: sw }, ev ? { evidence: ev } : {})] });
  assert.strictEqual(p.probeModeAllowed(MANIFEST, 'scheduled'), false, 'Claude: unknown');
  assert.strictEqual(p.probeModeAllowed(man('unknown', 'e.md'), 'scheduled'), false);
  assert.strictEqual(p.probeModeAllowed(man(true, 'e.md'), 'scheduled'), false);
  assert.strictEqual(p.probeModeAllowed(man(false, null), 'scheduled'), false, 'false without an evidence path');
  assert.strictEqual(p.probeModeAllowed(man(false, 'e.md'), 'scheduled'), true);
  for (const m of ['off', 'stale']) assert.strictEqual(p.probeModeAllowed(MANIFEST, m), true);
  assert.strictEqual(p.probeModeAllowed(MANIFEST, 'always'), false);
  assert.strictEqual(p.probeModeAllowed(undefined, 'scheduled'), false);
});

test('G40-N73: checkProbeConfig range checks', () => {
  assert.strictEqual(p.checkProbeConfig({}), null);
  assert.strictEqual(p.checkProbeConfig({ quota_probe_stale_minutes: 5, quota_probe_timeout_secs: 20, quota_probe: 'stale' }), null);
  assert.strictEqual(p.checkProbeConfig({ quota_probe_stale_minutes: 360 }), null);
  for (const m of [4, 361, 5.5, '60', null, NaN]) assert.match(p.checkProbeConfig({ quota_probe_stale_minutes: m }), /stale_minutes/);
  for (const t of ['x', 0, -1, NaN, null, Infinity]) assert.match(p.checkProbeConfig({ quota_probe_timeout_secs: t }), /timeout_secs/);
  assert.match(p.checkProbeConfig({ quota_probe: 'ON' }), /quota_probe_invalid/);
  assert.strictEqual(p.STALE_MINUTES_DEFAULT, 60);
  assert.strictEqual(p.TIMEOUT_SECS_DEFAULT, 20);
});
