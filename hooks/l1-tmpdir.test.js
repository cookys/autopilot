'use strict';
// L1 probe for hooks/tests/run.sh's temp-dir containment (plan: tmp-residue-containment, KR2).
//
// Under `bash hooks/tests/run.sh`, the L1 `node --test` pass runs with TMPDIR set to a short
// per-run `apl1.XXXXXX` dir and AUTOPILOT_L1_TMP naming it. This probe asserts the child really
// sees that dir as os.tmpdir(), that it is a live (flock-held) directory holding the liveness
// sidecar, and optionally records what it saw in AUTOPILOT_L1_PROBE_OUT for the containment
// test (hooks/tests/l1-tmpdir-containment.test.sh) to compare against its own observations.
// A standalone `node --test hooks/l1-tmpdir.test.js` has no AUTOPILOT_L1_TMP: out of scope (D3).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const l1Tmp = process.env.AUTOPILOT_L1_TMP;

test('L1 runs inside the run.sh per-run temp dir', { skip: !l1Tmp && 'not launched by hooks/tests/run.sh' }, () => {
  assert.ok(/^apl1\.[A-Za-z0-9]{6}$/.test(path.basename(l1Tmp)), `unexpected dir name ${l1Tmp}`);
  assert.strictEqual(fs.realpathSync(os.tmpdir()), fs.realpathSync(l1Tmp), 'os.tmpdir() must be the contained dir');
  assert.ok(Buffer.byteLength(l1Tmp) <= 60, 'short enough for AF_UNIX sun_path (108) with room for nesting');
  assert.ok(fs.existsSync(path.join(l1Tmp, '.autopilot-live.lock')), 'liveness sidecar present while the run is alive');
  // A mkdtemp in the default location lands inside the contained dir.
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'l1-probe-'));
  try {
    assert.strictEqual(path.dirname(probe), fs.realpathSync(l1Tmp));
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
  }
  const out = process.env.AUTOPILOT_L1_PROBE_OUT;
  if (out) {
    fs.writeFileSync(out, JSON.stringify({ tmpdir: os.tmpdir(), l1_tmp: l1Tmp, env_tmpdir: process.env.TMPDIR }) + '\n');
  }
});
