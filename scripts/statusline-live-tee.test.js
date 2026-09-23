/**
 * Tests for scripts/statusline-live-tee.js — the live-file writer for hosts without codeforge.
 * The load-bearing test is end-to-end: a status-line tick through the tee, then the real
 * context-budget hook on a ~160k transcript. Without the tee that hook fires T2 on a 1M
 * session (the inference path assumes 200K until usage passes 200K); with it, it must not.
 * Run: node --test scripts/statusline-live-tee.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TEE = path.join(__dirname, 'statusline-live-tee.js');
const HOOK = path.join(__dirname, '..', 'hooks', 'context-budget.js');
const { buildLiveRecord } = require(TEE);
const { readLive, sanitizeSessionId } = require('./lib/live-state-dir.js');

// resolveLiveDir accepts an override only on tmpfs/ramfs; /dev/shm is tmpfs on the Linux hosts
// these hooks run on (same approach as hooks/context-budget.test.js).
function shmTmp(prefix) {
  const base = fs.existsSync('/dev/shm') ? '/dev/shm' : os.tmpdir();
  return fs.mkdtempSync(path.join(base, prefix));
}

function statuslinePayload(sid, overrides = {}) {
  return {
    session_id: sid,
    transcript_path: '/dev/null',
    version: '2.1.280',
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    context_window: {
      context_window_size: 1_000_000,
      used_percentage: 16,
      total_input_tokens: 159_000,
      total_output_tokens: 20_000,
      current_usage: { input_tokens: 10, cache_creation_input_tokens: 990, cache_read_input_tokens: 158_000 },
    },
    ...overrides,
  };
}

function runTee(payload, liveDir, extraArgs = []) {
  return spawnSync('node', [TEE, ...extraArgs], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, AUTOPILOT_LIVE_DIR: liveDir },
  });
}

function runHook(stdinObj, liveDir) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tee-hook-home-'));
  return spawnSync('node', [HOOK], {
    input: JSON.stringify(stdinObj),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home, // hermetic: never read the developer's ~/.autopilot/config.json
      AUTOPILOT_HOOK_CONTEXT_BUDGET: '1',
      AUTOPILOT_CONTEXT_BUDGET_DIR: home,
      AUTOPILOT_LIVE_DIR: liveDir,
    },
  });
}

function transcriptAt(tokens) {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tee-t-')), 't.jsonl');
  fs.writeFileSync(p, JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', usage: {
      input_tokens: 10, cache_read_input_tokens: tokens - 1_000, cache_creation_input_tokens: 990, output_tokens: 5,
    } },
  }) + '\n');
  return p;
}

test('end-to-end: 1M session at ~160k ⇒ T2 without the tee, silent after one tee tick', () => {
  const liveDir = shmTmp('tee-e2e-');
  const sid = 'tee-e2e-sid';
  const t = transcriptAt(159_000);

  // Control: no live file ⇒ inference path ⇒ the spurious T2 this script exists to remove.
  const before = runHook({ transcript_path: t, session_id: sid }, liveDir);
  assert.strictEqual(before.status, 2, 'control must reproduce the misfire, or this test proves nothing');
  assert.match(before.stderr, /Context budget T2/);

  const tee = runTee(statuslinePayload(sid), liveDir);
  assert.strictEqual(tee.status, 0, tee.stderr);

  const after = runHook({ transcript_path: t, session_id: sid }, liveDir);
  assert.strictEqual(after.status, 0, `no T2 at 16% of a 1M window; stderr=${after.stderr}`);
  assert.strictEqual(after.stderr.trim(), '');
});

test('end-to-end: a real 200K window at ~160k still gets T2 through the tee', () => {
  const liveDir = shmTmp('tee-e2e-200k-');
  const sid = 'tee-e2e-200k';
  const payload = statuslinePayload(sid);
  payload.context_window.context_window_size = 200_000;
  payload.context_window.used_percentage = 80;
  assert.strictEqual(runTee(payload, liveDir).status, 0);
  const r = runHook({ transcript_path: transcriptAt(159_000), session_id: sid }, liveDir);
  assert.strictEqual(r.status, 2);
  assert.match(r.stderr, /\(statusline\)/, 'the decision must be attributed to the real window');
});

test('writes a schema_version 1 file that readLive accepts, under the sanitised sid, mode 0600', () => {
  const liveDir = shmTmp('tee-schema-');
  const sid = 'weird id/with:chars';
  assert.strictEqual(runTee(statuslinePayload(sid), liveDir).status, 0);
  const safe = sanitizeSessionId(sid);
  const obj = readLive(liveDir, safe, { kind: 'main' });
  assert.ok(obj, 'readLive must accept the file (schema + freshness)');
  assert.strictEqual(obj.session_id, sid);
  assert.strictEqual(obj.context_window.context_window_size, 1_000_000);
  assert.strictEqual(obj.context_window.total_input_tokens, 159_000);
  assert.strictEqual(obj.model.id, 'claude-opus-5-5');
  const mode = fs.statSync(path.join(liveDir, 'context', `${safe}.json`)).mode & 0o777;
  assert.strictEqual(mode, 0o600);
  assert.deepStrictEqual(fs.readdirSync(path.join(liveDir, 'context')).filter((f) => f.includes('.tmp-')), [],
    'no temp file left behind');
});

test('no window / no session / non-positive window / junk stdin ⇒ nothing written', () => {
  const now = new Date().toISOString();
  assert.strictEqual(buildLiveRecord(statuslinePayload(''), now), null);
  assert.strictEqual(buildLiveRecord({ session_id: 's' }, now), null);
  for (const size of [0, -1, NaN, '1000000', null]) {
    const p = statuslinePayload('s');
    p.context_window.context_window_size = size;
    assert.strictEqual(buildLiveRecord(p, now), null, `size=${String(size)}`);
  }
  const liveDir = shmTmp('tee-junk-');
  const r = runTee('not json at all', liveDir);
  assert.strictEqual(r.status, 0);
  assert.strictEqual(fs.existsSync(path.join(liveDir, 'context')), false);
});

test('wrapped command gets the exact stdin bytes; its stdout and exit status pass through', () => {
  const liveDir = shmTmp('tee-wrap-');
  const raw = JSON.stringify(statuslinePayload('wrap-sid'));
  const echo = 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{process.stdout.write("GOT:"+d);process.exit(7)})';
  const r = runTee(raw, liveDir, ['--', process.execPath, '-e', echo]);
  assert.strictEqual(r.stdout, `GOT:${raw}`);
  assert.strictEqual(r.status, 7);
  assert.ok(readLive(liveDir, 'wrap-sid', { kind: 'main' }), 'live file written before the wrapped command ran');
});

test('wrapped command still runs when the payload is junk (status line never breaks)', () => {
  const liveDir = shmTmp('tee-wrap-junk-');
  const r = runTee('{broken', liveDir, ['--', process.execPath, '-e', 'process.stdout.write("OK")']);
  assert.strictEqual(r.stdout, 'OK');
  assert.strictEqual(r.status, 0);
});

test('missing wrapped binary ⇒ exit 1 with a one-line reason, live file still written', () => {
  const liveDir = shmTmp('tee-missing-');
  const r = runTee(statuslinePayload('missing-sid'), liveDir, ['--', '/nonexistent/statusline-binary']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /cannot run \/nonexistent\/statusline-binary/);
  assert.ok(readLive(liveDir, 'missing-sid', { kind: 'main' }));
});
