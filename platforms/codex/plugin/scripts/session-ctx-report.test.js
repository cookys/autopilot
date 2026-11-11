'use strict';

/**
 * Tests for scripts/session-ctx-report.js (ctx-reset W1).
 * Run: env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID node --test scripts/session-ctx-report.test.js < /dev/null
 *
 * Temp AUTOPILOT_LIVE_DIR only. Never touches ~/.claude.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CLI = path.join(__dirname, 'session-ctx-report.js');
const {
  decide,
  DEFAULTS,
} = require('./session-ctx-report.js');

const NOW = '2026-11-12T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const PLANTED = 'PLANTED_SECRET_FIELD_VALUE_9f3a';

function mkLive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scr-live-'));
  fs.mkdirSync(path.join(dir, 'context'), { recursive: true, mode: 0o700 });
  return dir;
}

function writeLive(liveDir, sid, rec) {
  const file = path.join(liveDir, 'context', `${sid}.json`);
  fs.writeFileSync(file, JSON.stringify(rec), { mode: 0o600 });
  return file;
}

function cli(args, envExtra = {}) {
  const env = { ...process.env, ...envExtra };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  // Drop threshold envs unless the caller sets them.
  for (const k of Object.keys(env)) {
    if (k.startsWith('AUTOPILOT_CTX_RESET_') && !(k in envExtra)) delete env[k];
  }
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env,
    input: '',
  });
}

/** Minutes before the fixed decide-clock NOW (candidates tests). */
function isoMinutesAgo(min) {
  return new Date(NOW_MS - min * 60000).toISOString();
}

/** Minutes before the real wall clock (list tests — list uses Date.now()). */
function wallMinutesAgo(min) {
  return new Date(Date.now() - min * 60000).toISOString();
}

function baseSession(over = {}) {
  return {
    session_id: 'sess-a',
    ctx_tokens: 300000,
    last_active: isoMinutesAgo(30),
    holds_claim: false,
    open_tasks: 0,
    running_go: false,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// (a) list: two valid, one malformed, one schema 2 → skipped 2
// ---------------------------------------------------------------------------
test('(a) list reads two valid files, skips malformed and schema 2; skipped: 2', () => {
  const live = mkLive();
  try {
    writeLive(live, 'alpha', {
      schema_version: 1,
      session_id: 'alpha',
      written_at: wallMinutesAgo(10),
      model: { id: 'claude-opus-4-20250514' },
      context_window: { total_input_tokens: 120000, context_window_size: 200000 },
      mystery: PLANTED,
    });
    writeLive(live, 'beta', {
      schema_version: 1,
      session_id: 'beta',
      written_at: wallMinutesAgo(20),
      model: {},
      context_window: { total_input_tokens: 80000, context_window_size: 200000 },
    });
    writeLive(live, 'broken', '{ not json');
    writeLive(live, 'schema2', {
      schema_version: 2,
      session_id: 'schema2',
      written_at: wallMinutesAgo(5),
      context_window: { total_input_tokens: 999999, context_window_size: 1000000 },
      mystery: PLANTED,
    });
    // tasks sidecar must be ignored entirely (neither counted nor listed)
    fs.writeFileSync(
      path.join(live, 'context', 'alpha.tasks.json'),
      JSON.stringify({ schema_version: 1, session_id: 'alpha', written_at: wallMinutesAgo(1),
        context_window: { total_input_tokens: 1, context_window_size: 1 } }),
    );

    const r = cli(['list', '--json'], { AUTOPILOT_LIVE_DIR: live });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.skipped, 2);
    assert.equal(out.sessions.length, 2);
    const ids = out.sessions.map((s) => s.session_id).sort();
    assert.deepEqual(ids, ['alpha', 'beta']);
    const alpha = out.sessions.find((s) => s.session_id === 'alpha');
    assert.equal(alpha.ctx_tokens, 120000);
    assert.equal(alpha.window, 200000);
    assert.equal(alpha.model, 'claude-opus-4-20250514');
    assert.equal(typeof alpha.idle_min, 'number');
    assert.ok(alpha.idle_min >= 9);
  } finally {
    fs.rmSync(live, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (e) list output never leaks a planted unknown-field string
// ---------------------------------------------------------------------------
test('(e) list output never contains a planted string from an unknown live-file field', () => {
  const live = mkLive();
  try {
    writeLive(live, 'alpha', {
      schema_version: 1,
      session_id: 'alpha',
      written_at: wallMinutesAgo(3),
      model: { id: 'claude-sonnet-4-20250514' },
      context_window: { total_input_tokens: 1000, context_window_size: 200000 },
      secret_bag: PLANTED,
      note: PLANTED,
    });
    const json = cli(['list', '--json'], { AUTOPILOT_LIVE_DIR: live });
    assert.equal(json.status, 0, json.stderr);
    assert.equal(json.stdout.includes(PLANTED), false, 'JSON must not echo unknown fields');
    const plain = cli(['list'], { AUTOPILOT_LIVE_DIR: live });
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(plain.stdout.includes(PLANTED), false, 'plain table must not echo unknown fields');
    assert.match(plain.stdout, /工作階段/);
    assert.match(plain.stdout, /閒置\(分\)/);
  } finally {
    fs.rmSync(live, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) decide: one case per rule + first-match (excluded and claim beat hard)
// ---------------------------------------------------------------------------
test('(b) decide: one case per rule including first-match order', () => {
  const opts = { ...DEFAULTS };
  const cases = [
    { name: 'excluded', s: baseSession({ excluded: true }), decision: 'keep', reason: 'excluded' },
    { name: 'claim', s: baseSession({ holds_claim: true }), decision: 'keep', reason: 'claim' },
    { name: 'running_go', s: baseSession({ running_go: true }), decision: 'keep', reason: 'running_go' },
    { name: 'open_task', s: baseSession({ open_tasks: 2 }), decision: 'keep', reason: 'open_task' },
    {
      name: 'skipped_by_session',
      s: baseSession({ skip_until: isoMinutesAgo(-60) }), // 60 min in the future
      decision: 'keep',
      reason: 'skipped_by_session',
    },
    {
      name: 'cooldown',
      s: baseSession({ last_reset: isoMinutesAgo(30) }), // within default 120 min
      decision: 'keep',
      reason: 'cooldown',
    },
    {
      name: 'hard',
      s: baseSession({ ctx_tokens: 250000, last_active: isoMinutesAgo(5) }),
      decision: 'reset',
      reason: 'hard',
    },
    {
      name: 'soft',
      s: baseSession({ ctx_tokens: 150000, last_active: isoMinutesAgo(15) }),
      decision: 'reset',
      reason: 'soft',
    },
    {
      name: 'below_threshold',
      s: baseSession({ ctx_tokens: 100000, last_active: isoMinutesAgo(60) }),
      decision: 'keep',
      reason: 'below_threshold',
    },
    {
      name: 'not_idle',
      s: baseSession({ ctx_tokens: 200000, last_active: isoMinutesAgo(2) }),
      decision: 'keep',
      reason: 'not_idle',
    },
    // first-match: excluded beats hard
    {
      name: 'excluded-beats-hard',
      s: baseSession({ excluded: true, ctx_tokens: 400000, last_active: isoMinutesAgo(60) }),
      decision: 'keep',
      reason: 'excluded',
    },
    // first-match: claim beats hard
    {
      name: 'claim-beats-hard',
      s: baseSession({ holds_claim: true, ctx_tokens: 400000, last_active: isoMinutesAgo(60) }),
      decision: 'keep',
      reason: 'claim',
    },
  ];

  const input = { now: NOW, sessions: cases.map((c, i) => ({ ...c.s, session_id: `s-${i}-${c.name}` })) };
  const rows = decide(input, opts);
  assert.equal(rows.length, cases.length);
  for (let i = 0; i < cases.length; i += 1) {
    assert.equal(rows[i].decision, cases[i].decision, cases[i].name);
    assert.equal(rows[i].reason, cases[i].reason, cases[i].name);
  }
});

// ---------------------------------------------------------------------------
// (c) last_sent later than last_active → not idle
// ---------------------------------------------------------------------------
test('(c) last_sent later than last_active makes the session not idle', () => {
  const rows = decide({
    now: NOW,
    sessions: [baseSession({
      session_id: 'sess-sent',
      ctx_tokens: 300000,
      last_active: isoMinutesAgo(60),
      last_sent: isoMinutesAgo(1), // recent fleet send → still active
    })],
  }, { ...DEFAULTS });
  assert.equal(rows[0].decision, 'keep');
  assert.equal(rows[0].reason, 'not_idle');
});

// ---------------------------------------------------------------------------
// (d) env and flag overrides; flag wins; bad value → exit 2
// ---------------------------------------------------------------------------
test('(d) env and flag overrides; flag wins; bad value → exit 2', () => {
  const live = mkLive();
  const inputPath = path.join(live, 'in.json');
  try {
    // soft via env alone: ctx 160000 idle 20 → with soft=180000 keep below_threshold
    fs.writeFileSync(inputPath, JSON.stringify({
      now: NOW,
      sessions: [baseSession({
        session_id: 'ov',
        ctx_tokens: 160000,
        last_active: isoMinutesAgo(20),
      })],
    }));

    const envOnly = cli(
      ['candidates', '--input', inputPath, '--json'],
      { AUTOPILOT_LIVE_DIR: live, AUTOPILOT_CTX_RESET_SOFT: '180000' },
    );
    assert.equal(envOnly.status, 0, envOnly.stderr);
    assert.equal(JSON.parse(envOnly.stdout)[0].reason, 'below_threshold');

    // flag wins over env: --soft 150000 restores soft reset
    const flagWins = cli(
      ['candidates', '--input', inputPath, '--json', '--soft', '150000'],
      { AUTOPILOT_LIVE_DIR: live, AUTOPILOT_CTX_RESET_SOFT: '180000' },
    );
    assert.equal(flagWins.status, 0, flagWins.stderr);
    assert.equal(JSON.parse(flagWins.stdout)[0].decision, 'reset');
    assert.equal(JSON.parse(flagWins.stdout)[0].reason, 'soft');

    // hard idle via env
    const hardIdle = cli(
      ['candidates', '--input', inputPath, '--json', '--hard', '100000', '--hard-idle-min', '10'],
      { AUTOPILOT_LIVE_DIR: live },
    );
    // ctx 160k >= 100k, idle 20 >= 10 → hard
    assert.equal(hardIdle.status, 0, hardIdle.stderr);
    assert.equal(JSON.parse(hardIdle.stdout)[0].reason, 'hard');

    for (const bad of [
      ['--soft', '0'],
      ['--soft', '-1'],
      ['--hard', 'abc'],
      ['--soft-idle-min', ''],
      ['--cooldown-min', 'nope'],
    ]) {
      const r = cli(
        ['candidates', '--input', inputPath, '--json', bad[0], bad[1]],
        { AUTOPILOT_LIVE_DIR: live },
      );
      assert.equal(r.status, 2, `expected exit 2 for ${bad.join(' ')}: ${r.stderr}`);
    }

    const badEnv = cli(
      ['candidates', '--input', inputPath, '--json'],
      { AUTOPILOT_LIVE_DIR: live, AUTOPILOT_CTX_RESET_HARD: '-5' },
    );
    assert.equal(badEnv.status, 2, badEnv.stderr);

    const missingInput = cli(['candidates', '--json'], { AUTOPILOT_LIVE_DIR: live });
    assert.equal(missingInput.status, 2);
  } finally {
    fs.rmSync(live, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Negative control: drop holds_claim rule → (b) claim-beats-hard goes red; restore
// ---------------------------------------------------------------------------
test('negative control: dropping holds_claim rule makes claim-beats-hard return reset/hard', () => {
  const src = fs.readFileSync(CLI, 'utf8');
  const needle = 'if (s && s.holds_claim) return keep(\'claim\');';
  assert.ok(src.includes(needle), 'holds_claim rule must exist in source for the control to be meaningful');
  const mutated = src.replace(needle, '/* negative-control: holds_claim removed */');
  assert.notEqual(mutated, src);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scr-neg-'));
  const mutantPath = path.join(tmpDir, 'session-ctx-report.js');
  const libDir = path.join(tmpDir, 'lib');
  try {
    fs.mkdirSync(libDir, { recursive: true });
    // The mutant still requires ./lib/live-state-dir.js — point it at the real one via a stub.
    fs.writeFileSync(
      path.join(libDir, 'live-state-dir.js'),
      `module.exports = require(${JSON.stringify(path.join(__dirname, 'lib', 'live-state-dir.js'))});\n`,
    );
    fs.writeFileSync(mutantPath, mutated);

    const mutant = require(mutantPath);
    const input = {
      now: NOW,
      sessions: [baseSession({
        session_id: 'claim-hard',
        holds_claim: true,
        ctx_tokens: 400000,
        last_active: isoMinutesAgo(60),
      })],
    };
    const broken = mutant.decide(input, { ...DEFAULTS });
    assert.equal(broken[0].decision, 'reset', 'without holds_claim the hard rule must fire');
    assert.equal(broken[0].reason, 'hard');

    // Restore check: the real module still keeps claim.
    const good = decide(input, { ...DEFAULTS });
    assert.equal(good[0].decision, 'keep');
    assert.equal(good[0].reason, 'claim');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
