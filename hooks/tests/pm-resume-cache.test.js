'use strict';
// Fleet-Task 01M87CNSBKR1Q1N190A0P9F0BM: a slow or dead fleet at SessionStart must not leave the first turn without
// in-flight work; the last good `fleet pm resume` output is injected, marked with its age.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildResumeBlock, readMarker } = require('../lib/pm-resume.js');

const ID = '01M8BSC21M4SEMM5H47JRZSPXD';
const ok = { status: 0, stderr: '', stdout: ['RESUME member', `IN_FLIGHT ${ID} x  y`].join('\n') };
const timedOut = { error: Object.assign(new Error('t'), { code: 'ETIMEDOUT' }), signal: 'SIGTERM', status: null };

function env() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-resume-cache-'));
  return { dir, env: { ...process.env, XDG_RUNTIME_DIR: dir, FLEET_ADDRESS: 'cookys/aimax395-team/autopilot--claude' } };
}
const run = (e, r) => buildResumeBlock({ source: 'compact', session_id: 'sid-1' }, { env: e, runner: () => r });

test('timeout after a good run: cached block with its age, in-flight id kept, marker ok', () => {
  const { dir, env: e } = env();
  try {
    assert.ok(run(e, ok).includes(ID));
    const out = run(e, timedOut);
    assert.ok(out.includes('即時讀取失敗') && out.includes('快取') && out.includes('分鐘前'), out);
    assert.ok(out.includes(ID), 'cached in-flight id must be injected');
    assert.strictEqual(readMarker('sid-1', e).ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('timeout with no cache: still the one-line failure, marker not ok (negative control)', () => {
  const { dir, env: e } = env();
  try {
    const out = run(e, timedOut);
    assert.ok(out.includes('resume 讀不到') && !out.includes(ID), out);
    assert.strictEqual(readMarker('sid-1', e).ok, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a cache replay does not refresh the cache timestamp', () => {
  const { dir, env: e } = env();
  try {
    run(e, ok);
    const f = path.join(dir, 'autopilot', 'pm-resume');
    const cacheFile = fs.readdirSync(f).find((n) => n.startsWith('cache-'));
    const p = path.join(f, cacheFile);
    const old = JSON.parse(fs.readFileSync(p, 'utf8'));
    old.at -= 30 * 60000; fs.writeFileSync(p, JSON.stringify(old));
    const out = run(e, timedOut);
    assert.ok(/3\d 分鐘前|30 分鐘前/.test(out), out);
    assert.strictEqual(JSON.parse(fs.readFileSync(p, 'utf8')).at, old.at);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
