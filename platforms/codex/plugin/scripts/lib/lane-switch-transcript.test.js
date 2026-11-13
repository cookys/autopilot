'use strict';
// P2 step 4 (plan project/plans/2026-11-10-profile-switch.md). Temp dirs only.
// Negative controls (names start with "negative control"), shown red first
// (evidence-discipline §58). Against a build that overwrote differing bytes and
// still copied after a failed collect, `node --test scripts/lib/lane-switch-transcript.test.js`
// exited 1: tests 11, pass 6, fail 5. The five failures were exactly these
// controls; copy, subagents and home stayed green. The guards in
// lane-switch-transcript.js are what turn the same file green.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { collectAndCopy, cwdKey } = require('./lane-switch-transcript.js');
const { journalFile } = require('./switch-journal.js');

const ORDER = '01M70ABCDE';
const LANE = 'l1';
const SID = 'sid-123';
const CWD = '/work/lane';
const KEY = '-work-lane';
const NOW = '2026-11-13T00:00:00.000Z';

function withFx(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lswtx-'));
  const fx = { home, base: path.join(home, 'state') };
  try { fn(fx); } finally { fs.rmSync(home, { recursive: true, force: true }); }
}
function configDir(home, profile) {
  return profile === 'home' ? path.join(home, '.claude') : path.join(home, '.claude-profiles', profile);
}
function projectOf(home, profile) { return path.join(configDir(home, profile), 'projects', KEY); }
function seed(home, profile, rel, body) {
  const full = path.join(projectOf(home, profile), ...rel.split('/'));
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
}
function envOf() {
  return { PATH: '/usr/bin', CODEFORGE_DATA_DIR: 'should-strip', CLAUDE_CONFIG_DIR: 'should-replace', UNRELATED: 'keep' };
}
function callsRun(status) {
  const calls = [];
  const run = (cmd, args, options) => { calls.push({ cmd, args, options }); return { status }; };
  return { calls, run };
}
function go(fx, run, extraOpts, extraDeps) {
  return collectAndCopy({
    from: 'oldp', to: 'newp', cwd: CWD, sessionId: SID, order: ORDER, lane: LANE,
    home: fx.home, base: fx.base, ...extraOpts,
  }, { run, now: NOW, env: envOf(), ...extraDeps });
}
function rows(base) {
  const file = journalFile(base);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}
function assertCollect(calls, dir, homeOld) {
  assert.strictEqual(calls.length, 1);
  const c = calls[0];
  assert.strictEqual(c.cmd, 'codeforge');
  assert.deepStrictEqual(c.args, ['usage', 'collect']);
  assert.deepStrictEqual(c.options.stdio, ['ignore', 'ignore', 'ignore']);
  assert.strictEqual(Object.hasOwn(c.options.env, 'CODEFORGE_DATA_DIR'), false);
  if (homeOld) assert.strictEqual(Object.hasOwn(c.options.env, 'CLAUDE_CONFIG_DIR'), false);
  else assert.strictEqual(c.options.env.CLAUDE_CONFIG_DIR, dir);
  assert.strictEqual(c.options.env.PATH, '/usr/bin');
  assert.strictEqual(c.options.env.UNRELATED, 'keep');
}
function tracingFs(log) {
  const wrap = (name, fn) => (...args) => { log.push(`${name} ${args[0]}`); return fn.apply(fs, args); };
  return {
    lstatSync: wrap('lstat', fs.lstatSync),
    statSync: wrap('stat', fs.statSync),
    readdirSync: wrap('readdir', fs.readdirSync),
    mkdirSync: wrap('mkdir', fs.mkdirSync),
    copyFileSync: wrap('copy', fs.copyFileSync),
    readFileSync: wrap('read', fs.readFileSync),
    openSync: wrap('open', fs.openSync),
    readSync: fs.readSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    renameSync: () => { log.push('rename'); throw new Error('rename'); },
    unlinkSync: () => { log.push('unlink'); throw new Error('unlink'); },
    rmSync: () => { log.push('rm'); throw new Error('rm'); },
  };
}

test('cwdKey is the Claude Code project slug', () => {
  assert.strictEqual(cwdKey('/home/cookys/projects/autopilot'), '-home-cookys-projects-autopilot');
  assert.strictEqual(cwdKey('/tmp/a.b_c d'), '-tmp-a-b-c-d');
  assert.strictEqual(cwdKey(CWD), KEY);
});

test('copy keeps the source and collects without CODEFORGE_DATA_DIR or --quiet', () => {
  withFx((fx) => {
    const body = 'transcript-line\n';
    const src = seed(fx.home, 'oldp', `${SID}.jsonl`, body);
    const parent = envOf();
    const { calls, run } = callsRun(0);
    const result = go(fx, run, {}, { env: parent });
    const dest = path.join(projectOf(fx.home, 'newp'), `${SID}.jsonl`);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, undefined);
    assert.deepStrictEqual(result.copied, [`${SID}.jsonl`]);
    assert.deepStrictEqual(result.skipped, []);
    assert.strictEqual(fs.readFileSync(src, 'utf8'), body);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), body);
    fs.appendFileSync(dest, 'extra\n');
    assert.strictEqual(fs.readFileSync(src, 'utf8'), body);
    assert.strictEqual(parent.CODEFORGE_DATA_DIR, 'should-strip');
    assertCollect(calls, configDir(fx.home, 'oldp'), false);
    const row = rows(fx.base)[0];
    assert.deepStrictEqual({
      ts: row.ts, order: row.order, lane: row.lane, step: row.step, from: row.from, to: row.to, outcome: row.outcome, detail: row.detail,
    }, {
      ts: NOW, order: ORDER, lane: LANE, step: 'collect-copy', from: 'oldp', to: 'newp', outcome: 'ok', detail: 'copied=1 skipped=0',
    });
  });
});

test('subagents directory is copied and the source directory remains', () => {
  withFx((fx) => {
    seed(fx.home, 'oldp', `${SID}.jsonl`, 'main\n');
    seed(fx.home, 'oldp', `${SID}/subagents/a.txt`, 'aaa\n');
    seed(fx.home, 'oldp', `${SID}/subagents/nested/b.txt`, 'bbb\n');
    const { calls, run } = callsRun(0);
    const result = go(fx, run);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.copied.sort(), [
      `${SID}.jsonl`, `${SID}/subagents/a.txt`, `${SID}/subagents/nested/b.txt`,
    ].sort());
    assert.deepStrictEqual(result.skipped, []);
    const destRoot = projectOf(fx.home, 'newp');
    assert.strictEqual(fs.readFileSync(path.join(destRoot, SID, 'subagents', 'nested', 'b.txt'), 'utf8'), 'bbb\n');
    assert.strictEqual(fs.readFileSync(path.join(projectOf(fx.home, 'oldp'), SID, 'subagents', 'a.txt'), 'utf8'), 'aaa\n');
    assertCollect(calls, configDir(fx.home, 'oldp'), false);
  });
});

test('home profile reads ~/.claude and leaves CLAUDE_CONFIG_DIR unset', () => {
  withFx((fx) => {
    seed(fx.home, 'home', `${SID}.jsonl`, 'from-home\n');
    const { calls, run } = callsRun(0);
    const result = go(fx, run, { from: 'home' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(projectOf(fx.home, 'newp'), `${SID}.jsonl`), 'utf8'), 'from-home\n');
    assert.strictEqual(fs.readFileSync(path.join(projectOf(fx.home, 'home'), `${SID}.jsonl`), 'utf8'), 'from-home\n');
    assertCollect(calls, null, true);
    assert.strictEqual(rows(fx.base)[0].from, 'home');
  });
});

test('destination home is ~/.claude', () => {
  withFx((fx) => {
    seed(fx.home, 'oldp', `${SID}.jsonl`, 'to-home\n');
    const { run } = callsRun(0);
    const result = go(fx, run, { to: 'home' });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.readFileSync(path.join(projectOf(fx.home, 'home'), `${SID}.jsonl`), 'utf8'), 'to-home\n');
    assert.strictEqual(rows(fx.base)[0].to, 'home');
  });
});

test('a session id with a slash never runs collect', () => {
  withFx((fx) => {
    const calls = [];
    assert.throws(() => go(fx, () => { calls.push(1); return { status: 0 }; }, { sessionId: 'a/b' }));
    assert.deepStrictEqual(calls, []);
    assert.deepStrictEqual(rows(fx.base), []);
  });
});

test('negative control: identical existing target is skipped', () => {
  withFx((fx) => {
    const src = seed(fx.home, 'oldp', `${SID}.jsonl`, 'same-bytes\n');
    const dest = seed(fx.home, 'newp', `${SID}.jsonl`, 'same-bytes\n');
    const stamp = new Date('2020-01-01T00:00:00Z');
    fs.utimesSync(dest, stamp, stamp);
    const mtime = fs.statSync(dest).mtimeMs;
    const { run } = callsRun(0);
    const result = go(fx, run);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.copied, []);
    assert.deepStrictEqual(result.skipped, [`${SID}.jsonl`]);
    assert.strictEqual(fs.statSync(dest).mtimeMs, mtime);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'same-bytes\n');
    assert.strictEqual(fs.readFileSync(src, 'utf8'), 'same-bytes\n');
    assert.strictEqual(rows(fx.base)[0].detail, 'copied=0 skipped=1');
  });
});

test('negative control: differing target is refused and nothing else is copied', () => {
  withFx((fx) => {
    const src = seed(fx.home, 'oldp', `${SID}.jsonl`, 'source-v\n');
    seed(fx.home, 'oldp', `${SID}/subagents/a.txt`, 'sub\n');
    const dest = seed(fx.home, 'newp', `${SID}.jsonl`, 'other-v\n');
    const { run } = callsRun(0);
    const result = go(fx, run);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'dest_differs');
    assert.deepStrictEqual(result.copied, []);
    assert.deepStrictEqual(result.skipped, []);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'other-v\n');
    assert.strictEqual(fs.readFileSync(src, 'utf8'), 'source-v\n');
    assert.ok(!fs.existsSync(path.join(projectOf(fx.home, 'newp'), SID, 'subagents', 'a.txt')));
    assert.strictEqual(rows(fx.base)[0].outcome, 'refused');
    assert.strictEqual(rows(fx.base)[0].detail, 'dest_differs');
  });
});

test('negative control: collect failure stops before copy', () => {
  withFx((fx) => {
    const src = seed(fx.home, 'oldp', `${SID}.jsonl`, 'body\n');
    const { calls, run } = callsRun(2);
    const result = go(fx, run);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'collect_failed');
    assert.deepStrictEqual(result.copied, []);
    assert.deepStrictEqual(result.skipped, []);
    assert.ok(!fs.existsSync(projectOf(fx.home, 'newp')));
    assert.strictEqual(fs.readFileSync(src, 'utf8'), 'body\n');
    assertCollect(calls, configDir(fx.home, 'oldp'), false);
    assert.strictEqual(rows(fx.base)[0].outcome, 'collect_failed');
    assert.strictEqual(rows(fx.base)[0].detail, 'status=2');
  });
});

test('negative control: a thrown collect copies nothing', () => {
  withFx((fx) => {
    seed(fx.home, 'oldp', `${SID}.jsonl`, 'body\n');
    const result = go(fx, () => { throw new Error('boom'); });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'collect_failed');
    assert.ok(!fs.existsSync(projectOf(fx.home, 'newp')));
    assert.strictEqual(rows(fx.base)[0].detail, 'spawn_error');
    assert.ok(!JSON.stringify(rows(fx.base)).includes('boom'));
  });
});

test('negative control: a symlink transcript is not opened or copied', () => {
  withFx((fx) => {
    const oldDir = configDir(fx.home, 'oldp');
    fs.mkdirSync(oldDir, { recursive: true });
    const cred = path.join(oldDir, '.credentials.json');
    const claudeJson = path.join(oldDir, '.claude.json');
    fs.writeFileSync(cred, 'SENTINEL-CRED\n');
    fs.writeFileSync(claudeJson, 'SENTINEL-JSON\n');
    fs.mkdirSync(projectOf(fx.home, 'oldp'), { recursive: true });
    fs.symlinkSync(cred, path.join(projectOf(fx.home, 'oldp'), `${SID}.jsonl`));
    const log = [];
    const { run } = callsRun(0);
    const result = go(fx, run, {}, { fs: tracingFs(log) });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, 'symlink_refused');
    assert.ok(!fs.existsSync(path.join(projectOf(fx.home, 'newp'), `${SID}.jsonl`)));
    assert.ok(!log.some((line) => line.includes('.credentials.json') || line.includes('.claude.json')));
    assert.ok(!log.some((line) => /^(read|open|copy) /.test(line) || line === 'rename' || line === 'unlink' || line === 'rm'));
    assert.strictEqual(fs.readFileSync(cred, 'utf8'), 'SENTINEL-CRED\n');
    assert.strictEqual(fs.readFileSync(claudeJson, 'utf8'), 'SENTINEL-JSON\n');
    assert.ok(!JSON.stringify(result).includes('SENTINEL'));
    assert.strictEqual(rows(fx.base)[0].outcome, 'refused');
  });
});
