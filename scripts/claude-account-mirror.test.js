#!/usr/bin/env node
'use strict';
// G40 D3 CLI layer (DAG D3, PM parity): pick / status / run read the local quota mirror.
//   G40-N87  with no quota/ dir, an empty one or a damaged mirror (and ctx.liveDir null or odd), the stdout, stderr,
//            exit code and audit bytes equal the golden file made from unmodified develop. status gains exactly one
//            coverage line (stripped before the compare); no alias line gains a field.
//   G40-N88  a tight or refusal mirror row changes the CLI result; an ok row does not.
// Tempdir only, FAKE- tokens, Node claude shim only. No real home, credential or network.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const gen = require('./lib/fixtures/gen-account-pick-g37-golden');
const { cli } = require('./claude-account.js');
const { makeFixture, R429_USAGE } = require('./lib/account-fixtures/shim-install.js');
const observation = require('./lib/account-observation');

const golden = JSON.parse(fs.readFileSync(gen.GOLDEN_FILE, 'utf8'));
const NOW = gen.NOW;
const NOW_S = NOW / 1000;
const deps = gen.loadDeps();

const COVERAGE = /^observations newest_age: /;
const stripCoverage = (out) => out.split('\n').filter((l) => !COVERAGE.test(l)).join('\n');

async function go(fx, args) {
  let out = '';
  let err = '';
  const code = await cli(args, { env: fx.env, realHome: fx.realHome, warn: () => {}, now: () => NOW, write: (fd, d) => { if (fd === 1) out += d.toString(); else err += d.toString(); } });
  return { code, out, err };
}

const win = (kind, u, over) => Object.assign({ kind, utilization: u, resets_at: NOW_S + 3600, source: 'passive', observed_at: NOW_S - 10 }, over || {});
function writeRow(fx, alias, windows, over) {
  const b = observation.buildRecord(Object.assign({ provider: 'claude', alias, visibility: 'L3', windows }, over || {}));
  assert.ok(b.ok, JSON.stringify(b));
  const w = observation.writeLocalRow(fx.liveDir, b.record);
  assert.ok(w.ok, JSON.stringify(w));
}
const aliasLines = (out) => out.split('\n').filter((l) => l.startsWith('alias='));
const SNAP = (alias, pct) => ({ schema: 'codeforge.quota/1', alias, root: null, written_at_ms: NOW - 60e3, five_hour: { pct, resets_at: NOW_S + 3600 }, seven_day: null });

// ------------------------------------------------------------------ N87

for (const variant of ['none', 'empty-dir', 'corrupt']) {
  test(`G40-N87: golden CLI scenarios replay byte for byte with mirror variant ${variant} (status minus the coverage line)`, async () => {
    for (const c of golden.cli) {
      const got = await gen.runCliScenario(c.spec, variant, deps);
      assert.strictEqual(got.runs.length, c.result.runs.length);
      got.runs.forEach((r, i) => {
        const want = c.result.runs[i];
        assert.strictEqual(r.code, want.code, `${c.spec.name} ${r.args.join(' ')} code`);
        assert.strictEqual(r.err, want.err, `${c.spec.name} ${r.args.join(' ')} stderr`);
        const isStatus = r.args[0] === 'status' && r.code === 0;
        assert.strictEqual(isStatus ? stripCoverage(r.out) : r.out, want.out, `${c.spec.name} ${r.args.join(' ')} stdout`);
        if (isStatus) assert.strictEqual(r.out.split('\n').filter((l) => COVERAGE.test(l)).length, 1, 'exactly one coverage line');
      });
      assert.strictEqual(got.audit, c.result.audit, `${c.spec.name} audit bytes`);
    }
  });
}

test('G40-N87: coverage line shows none for every alias when there is no observation, with and without a quota dir', async () => {
  for (const variant of ['none', 'empty-dir', 'corrupt']) {
    const c = golden.cli.find((x) => x.spec.name === 'mixed');
    const got = await gen.runCliScenario(c.spec, variant, deps);
    const st = got.runs.find((r) => r.args[0] === 'status');
    assert.match(st.out, /observations newest_age: a=none b=none c=none\n/);
  }
});

test('G40-N87: a view whose rows are all unusable (placeholder, stale, peer, bad window) changes nothing but the coverage line', async () => {
  const c = golden.cli.find((x) => x.spec.name === 'mixed');
  const fx = makeFixture({ aliases: c.spec.aliases, snapshots: c.spec.snapshots });
  try {
    const want = [];
    for (const args of [['pick'], ['status'], ['pick', '--exclude', 'a']]) want.push(await go(fx, args));
    writeRow(fx, 'a', [], { visibility: 'L0', source: 'registry' }); // placeholder
    writeRow(fx, 'b', [win('rolling_5h', 0.97, { observed_at: NOW_S - 7 * 3600 })]); // stale tight
    writeRow(fx, 'c', [win('rolling_5h', 0.2, { source: 'estimated' })]); // estimated, below 0.90
    const got = [];
    for (const args of [['pick'], ['status'], ['pick', '--exclude', 'a']]) got.push(await go(fx, args));
    assert.deepStrictEqual(got.map((r) => r.code), want.map((r) => r.code));
    assert.deepStrictEqual(got.map((r) => r.err), want.map((r) => r.err));
    assert.strictEqual(got[0].out, want[0].out);
    assert.strictEqual(got[2].out, want[2].out);
    // alias lines: only the mirror_* fields were added; the G37 prefix of each line is unchanged
    const w = aliasLines(want[1].out);
    const g = aliasLines(got[1].out);
    g.forEach((line, i) => assert.ok(line.startsWith(w[i]), `${line} extends ${w[i]}`));
    assert.match(got[1].out, /observations newest_age: a=none b=\d+s c=\d+s\n/);
    assert.match(g[0], /mirror_class=unknown mirror_age=none$/); // the placeholder row: zero observations
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------ N88 + status fields

test('G40-N88: a tight mirror row changes pick and status; the alias lines without mirror data keep the G37 format', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], snapshots: { a: SNAP('a', 0.2), b: SNAP('b', 0.5) } });
  try {
    assert.strictEqual((await go(fx, ['pick'])).out, 'a class=ok used=0.2 source=snapshot\n');
    writeRow(fx, 'a', [win('rolling_5h', 0.95)]);
    const p = await go(fx, ['pick']);
    assert.strictEqual(p.out, 'b class=ok used=0.5 source=snapshot\n');
    const st = await go(fx, ['status']);
    const [la, lb] = aliasLines(st.out);
    assert.match(la, /^alias=a enabled=yes priority=10 class=tight used=0.95 source=passive cooldown_until=- mirror_class=tight mirror_age=10s observed_at=\d{4}-/);
    assert.match(lb, /^alias=b enabled=yes priority=20 class=ok used=0.5 source=snapshot cooldown_until=-$/);
    assert.match(st.out, /observations newest_age: a=10s b=none\n/);
  } finally { fx.cleanup(); }
});

test('G40-N88: an ok mirror row changes nothing in pick; it shows its age in status', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], snapshots: { b: SNAP('b', 0.5) } });
  try {
    const before = await go(fx, ['pick']);
    writeRow(fx, 'a', [win('rolling_5h', 0.05)]);
    assert.strictEqual((await go(fx, ['pick'])).out, before.out); // unknown a stays unknown: ok b wins either way
    assert.strictEqual(before.out, 'b class=ok used=0.5 source=snapshot\n');
    const only = makeFixture({ aliases: [{ alias: 'a' }] });
    try {
      writeRow(only, 'a', [win('rolling_5h', 0.05)]);
      assert.strictEqual((await go(only, ['pick'])).out, 'a class=unknown used=- source=none\n'); // no KR2 promotion
    } finally { only.cleanup(); }
    assert.match((await go(fx, ['status'])).out, /alias=a .* class=unknown used=- source=none cooldown_until=- mirror_class=ok mirror_age=10s\n/);
  } finally { fx.cleanup(); }
});

// D5: `run` now copies a codeforge snapshot into the mirror before it picks; these two tests hand-write the mirror state, so they turn that adapter off (quota_capture=off).
test('G40-N88: a live refusal row drops the alias (reason refusal) in pick and run, class=cooling in status', async () => {
  const fx = makeFixture({ config: { accounts: { quota_capture: 'off' } }, aliases: [{ alias: 'a' }, { alias: 'b' }], snapshots: { a: SNAP('a', 0.1), b: SNAP('b', 0.5) } });
  try {
    writeRow(fx, 'a', [], { visibility: 'L1', refusal: { observed_at: NOW_S - 10, retry_at: NOW_S + 1200, reason: 'rate_limit' } });
    assert.strictEqual((await go(fx, ['pick'])).out, 'b class=ok used=0.5 source=snapshot\n');
    const r = await go(fx, ['run', '--purpose', 'tst', '--', 'claude', '-p', 'hi']);
    assert.strictEqual(r.code, 0);
    assert.strictEqual(fx.shim.calls().length, 1);
    assert.strictEqual(fx.shim.calls()[0].config_dir, path.join(fx.accountsDir, 'b', 'claude'));
    assert.match((await go(fx, ['status'])).out, /alias=a .* class=cooling used=- source=none cooldown_until=- mirror_class=cooling mirror_age=10s\n/);
    const none = await go(fx, ['pick', '--exclude', 'b']);
    assert.strictEqual(none.code, 3);
    assert.match(none.err, /no_account_available \(a:refusal,b:excluded\)/);
  } finally { fx.cleanup(); }
});

test('G40-N88: an elapsed refusal changes nothing', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], snapshots: { a: SNAP('a', 0.1), b: SNAP('b', 0.5) } });
  try {
    writeRow(fx, 'a', [], { visibility: 'L1', refusal: { observed_at: NOW_S - 3600, retry_at: NOW_S - 60, reason: 'rate_limit' } });
    assert.strictEqual((await go(fx, ['pick'])).out, 'a class=ok used=0.1 source=snapshot\n');
  } finally { fx.cleanup(); }
});

// ------------------------------------------------------------------ tightResetsFor

test('G40-N88: a quota 429 uses the reset of a tight mirror window, estimated included (same class as pick)', async () => {
  const cooldownOf = (fx) => JSON.parse(fs.readFileSync(path.join(fx.cooldownDir, 'a.json'), 'utf8')).cooldown_until_ms;
  const RUN = ['run', '--purpose', 'tst', '--', 'claude', '-p', 'hi'];
  const fx = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: R429_USAGE } });
  const fy = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: R429_USAGE } });
  const fz = makeFixture({ aliases: [{ alias: 'a' }], responses: { a: R429_USAGE } });
  try {
    await go(fz, RUN);
    const dflt = cooldownOf(fz); // no mirror: the G37 default
    assert.strictEqual(dflt, NOW + 30 * 60 * 1000);
    writeRow(fx, 'a', [win('rolling_5h', 0.2), win('weekly', 0.95, { resets_at: NOW_S + 900 })]);
    await go(fx, RUN);
    assert.strictEqual(cooldownOf(fx), (NOW_S + 900) * 1000);
    writeRow(fy, 'a', [win('rolling_5h', 0.2), win('weekly', 0.99, { resets_at: NOW_S + 900, source: 'estimated' })]);
    await go(fy, RUN);
    assert.strictEqual(cooldownOf(fy), (NOW_S + 900) * 1000);
  } finally { fx.cleanup(); fy.cleanup(); fz.cleanup(); }
});

test('G40-N87: a mirror view naming a peer row, even one that says tight, never changes pick (no hub: fail closed)', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], snapshots: { a: SNAP('a', 0.2), b: SNAP('b', 0.5) } });
  try {
    const b = observation.buildRecord({ provider: 'claude', alias: 'a', visibility: 'L3', windows: [win('rolling_5h', 0.97)] });
    const dir = path.join(fx.liveDir, 'quota', 'claude');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ schema: 'fleet.quota-view/1', namespace: 'ns-a', hub_offset: 0,
      rows: [{ writer_courier: 'peer-1', host_role: null, observed_at_hub: NOW_S - 10, skewed: false, record: b.record }] }), { mode: 0o600 });
    fs.writeFileSync(path.join(fx.liveDir, 'quota', 'namespace.json'), JSON.stringify({ schema: 'fleet.quota-ns/1', namespace: 'ns-a' }), { mode: 0o600 });
    assert.strictEqual((await go(fx, ['pick'])).out, 'a class=ok used=0.2 source=snapshot\n');
    const st = await go(fx, ['status']);
    assert.match(st.out, /observations newest_age: a=none b=none\n/);
  } finally { fx.cleanup(); }
});

test('G40-N88: tightResetsFor applies the pick newer-observation rule: a newer ok snapshot keeps the mirror reset out', async () => {
  const cooldownOf = (fx) => JSON.parse(fs.readFileSync(path.join(fx.cooldownDir, 'a.json'), 'utf8')).cooldown_until_ms;
  const RUN = ['run', '--purpose', 'tst', '--', 'claude', '-p', 'hi'];
  const snapAt = (ms) => Object.assign(SNAP('a', 0.2), { written_at_ms: ms });
  const newer = makeFixture({ config: { accounts: { quota_capture: 'off' } }, aliases: [{ alias: 'a' }], responses: { a: R429_USAGE }, snapshots: { a: snapAt(NOW - 1000) } });
  const older = makeFixture({ config: { accounts: { quota_capture: 'off' } }, aliases: [{ alias: 'a' }], responses: { a: R429_USAGE }, snapshots: { a: snapAt(NOW - 3600e3) } });
  try {
    const tight = [win('rolling_5h', 0.2), win('weekly', 0.95, { resets_at: NOW_S + 900 })];
    writeRow(newer, 'a', tight);
    await go(newer, RUN);
    assert.strictEqual(cooldownOf(newer), NOW + 30 * 60 * 1000); // the snapshot (1 s old) beats the mirror row (10 s old)
    writeRow(older, 'a', tight);
    await go(older, RUN);
    assert.strictEqual(cooldownOf(older), (NOW_S + 900) * 1000); // the mirror row is newer than the 1 h old snapshot
  } finally { newer.cleanup(); older.cleanup(); }
});

test('G40-N87: a peer row without a hub stamp (writer_courier not local) never changes pick, status or the coverage line', async () => {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }], snapshots: { a: SNAP('a', 0.2), b: SNAP('b', 0.5) } });
  try {
    const b = observation.buildRecord({ provider: 'claude', alias: 'a', visibility: 'L3', windows: [win('rolling_5h', 0.97)] });
    const dir = path.join(fx.liveDir, 'quota', 'claude');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ schema: 'fleet.quota-view/1', namespace: null, hub_offset: 0,
      rows: [{ writer_courier: 'peer-1', host_role: null, observed_at_hub: null, skewed: false, record: b.record }] }), { mode: 0o600 });
    assert.strictEqual((await go(fx, ['pick'])).out, 'a class=ok used=0.2 source=snapshot\n');
    const st = await go(fx, ['status']);
    assert.match(st.out, /observations newest_age: a=none b=none\n/);
    assert.doesNotMatch(aliasLines(st.out)[0], /mirror_/);
  } finally { fx.cleanup(); }
});
