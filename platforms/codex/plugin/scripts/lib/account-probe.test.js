'use strict';
// G40 D4 pure probe functions (plan 5.3, 10). Run: node --test scripts/lib/account-probe.test.js
//   G40-N13/N14/N76  staleCandidates   G40-N66  probeModeAllowed + BL-0375 probePolicy/resolveProbeMode/periodicDue (red cases, mutants)   G40-N73  checkProbeConfig   N27-style argv equality
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

// ---- BL-0375 probe policy per provider ---------------------------------------------------------------------------------
const { loadPatched } = require('./account-fixtures/shim-install');
const SRC = path.join(__dirname, 'account-probe.js');
const EV = 'docs/plans/evidence/2026-11-03-g40-agent-lane-quota/capability-matrix.md';
const Q5 = { percent: 0.5, window: 'rolling_5h', evidence: EV };
// A provider-neutral fixture manifest: starts_window trio at the top level, Q5 in the tinyprobe capture.
const man = (sw, conf, ev, q5) => {
  const m = { provider: 'fx', starts_window: sw, capture: [{ mode: 'tinyprobe', argv_template: ['x', '<PROMPT>'] }] };
  if (conf !== undefined) m.starts_window_confidence = conf;
  if (ev !== undefined) m.starts_window_evidence = ev;
  if (q5 !== undefined) m.capture[0].quota_share_per_probe = q5;
  return m;
};
const GLM = man(true, 'high', EV, Q5); // measured: a probe starts the window (19.8)
const MINIMAX = man(false, 'medium', EV, Q5); // leans false, medium only
const CONFIRMED = man(false, 'high', EV, Q5);

// Every red-light case of the amendment (A.6) as data. Returns the list of violated expectations: [] for the real module.
function redCases(mod) {
  const bad = [];
  const expect = (name, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${name}: got ${JSON.stringify(got)} want ${JSON.stringify(want)}`); };
  const periodic = [
    ['unknown never periodic (even high + evidence + Q5)', man('unknown', 'high', EV, Q5), false],
    ['unknown, bare', man('unknown'), false],
    ['true never periodic (even high + evidence + Q5)', GLM, false],
    ['false + medium', MINIMAX, false],
    ['false + low', man(false, 'low', EV, Q5), false],
    ['false, confidence absent', man(false, undefined, EV, Q5), false],
    ['false + high, no evidence', man(false, 'high', undefined, Q5), false],
    ['false + high + evidence, no Q5', man(false, 'high', EV), false],
    ['false + high + evidence + malformed Q5', man(false, 'high', EV, { percent: 0, window: 'rolling_5h', evidence: EV }), false],
    ['false + high + evidence + Q5', CONFIRMED, true],
  ];
  for (const [name, m, want] of periodic) {
    expect(`periodic ${name}`, mod.probePolicy(m).periodic, want);
    expect(`unset ${name}`, mod.resolveProbeMode(m, undefined), want ? 'scheduled' : 'stale');
    expect(`explicit scheduled ${name}`, mod.probeModeAllowed(m, 'scheduled'), want);
    expect(`explicit off ${name}`, mod.resolveProbeMode(m, 'off'), 'off');
    expect(`explicit stale ${name}`, mod.resolveProbeMode(m, 'stale'), 'stale');
    const due = mod.periodicDue({ manifest: m, accounts: A('a'), merged: { a: merged(0.3, 7200) }, cooldowns: {}, exclude: [], nowS: NOW_S, demand: new Set(['a']) });
    expect(`due ${name}`, due, want ? ['a'] : []);
  }
  const base = { manifest: CONFIRMED, accounts: A('a', 'b', 'c'), cooldowns: {}, exclude: [], nowS: NOW_S };
  expect('due needs the demand set', mod.periodicDue(Object.assign({ merged: { a: merged(0.3, 7200), b: merged(0.3, 7200), c: merged(0.3, 7200) }, demand: new Set(['b']) }, base)), ['b']);
  expect('due: newer than 30 min is skipped', mod.periodicDue(Object.assign({ merged: { a: merged(0.3, 1700), b: merged(0.3, 1900), c: merged(0.95, 7200, 'tight') }, demand: new Set(['a', 'b', 'c']) }, base)), ['b']);
  expect('due without a demand set', mod.periodicDue(Object.assign({ merged: {}, demand: undefined }, base)), []);
  expect('no tinyprobe: unset is off', mod.resolveProbeMode({ starts_window: false }, undefined), 'off');
  expect('undefined manifest: unset is off', mod.resolveProbeMode(undefined, undefined), 'off');
  return bad;
}

test('G40-N13/N66 (BL-0375): the policy table, every red-light case, on the real module', () => {
  assert.deepStrictEqual(redCases(p), []);
  assert.strictEqual(p.probeModeAllowed(MANIFEST, 'scheduled'), false, 'Claude: unknown');
  assert.strictEqual(p.resolveProbeMode(MANIFEST, undefined), 'stale', 'Claude unset: on-demand only');
  for (const m of ['off', 'stale']) assert.strictEqual(p.probeModeAllowed(MANIFEST, m), true);
  assert.strictEqual(p.probeModeAllowed(MANIFEST, 'always'), false);
  assert.strictEqual(p.probeModeAllowed(undefined, 'scheduled'), false);
  assert.strictEqual(p.probeModeAllowed(CONFIRMED, 'scheduled'), true);
  assert.strictEqual(p.resolveProbeMode(GLM, undefined), 'stale', 'glm=true: on-demand only');
  assert.strictEqual(p.resolveProbeMode(MINIMAX, undefined), 'stale', 'minimax=false/medium: on-demand only');
});

test('G40-N13 (BL-0375) flip: unknown -> confirmed false flips unset to scheduled with no config edit, and back; without Q5 it stays stale', () => {
  assert.strictEqual(p.resolveProbeMode(man('unknown'), undefined), 'stale');
  assert.strictEqual(p.resolveProbeMode(man(false, 'high', EV, Q5), undefined), 'scheduled');
  assert.strictEqual(p.resolveProbeMode(man('unknown'), undefined), 'stale', 'flipped back');
  assert.strictEqual(p.resolveProbeMode(man(false, 'high', EV), undefined), 'stale', 'no Q5 record');
});

test('G40-N13 negative control (BL-0375): dropping confirmed=false, the Q5 condition or the high condition each turns the red cases red', () => {
  const mutants = {
    'drop starts_window===false': ["m.starts_window === false && m.starts_window_confidence === 'high'", "m.starts_window_confidence === 'high'"],
    'drop high': ["m.starts_window === false && m.starts_window_confidence === 'high' &&", 'm.starts_window === false &&'],
    'drop Q5': ['periodic: !!t && confirmed && q5', 'periodic: !!t && confirmed'],
    'drop evidence': [" && nonEmpty(m.starts_window_evidence);", ';'],
    'unset always scheduled': ["return probePolicy(manifest).periodic ? 'scheduled' : 'stale';", "return 'scheduled';"],
    'unset is off (old default)': ["return probePolicy(manifest).periodic ? 'scheduled' : 'stale';", "return 'off';"],
    'due ignores demand': ['.filter((a) => o.demand.has(a))', ''],
    'due ignores the periodic gate': ['if (!probePolicy(o.manifest).periodic || !(o.demand instanceof Set)) return [];', 'if (!(o.demand instanceof Set)) return [];'],
  };
  for (const [name, rep] of Object.entries(mutants)) {
    const mod = loadPatched(SRC, [rep]);
    assert.ok(redCases(mod).length > 0, `mutant "${name}" was not caught`);
  }
});

test('G40-N13 (BL-0375): demandAliases counts only alias lines of runs in the last 24 h, never probe lines or pre-attempt lines', () => {
  const now = NOW_S * 1000;
  const r = (alias, ageS, purpose, outcome) => ({ ts: now - ageS * 1000, alias, purpose: purpose || 'tst', attempt: 1, outcome: outcome === undefined ? 'ok' : outcome });
  const got = p.demandAliases([r('a', 60), r('b', 86400), r('c', 86401), r('-', 5, 'tst', 'mode_off'), r('d', 5, 'quota-probe'), r('e', -5), r('f', 5, 'tst', ''), null], now);
  assert.deepStrictEqual([...got].sort(), ['a', 'b']);
  assert.strictEqual(p.demandAliases(undefined, now).size, 0);
  assert.strictEqual(p.demandAliases([r('a', 1)], NaN).size, 0);
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
