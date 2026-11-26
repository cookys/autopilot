#!/usr/bin/env node
'use strict';
// The HTTP/CLI adapter sends each case to a model operator, so the Chinese-model gate
// (01M83DHGJ4) must apply: restricted operator + unscanned/dirty payload is refused,
// and a payload with an internal marker never reaches the network.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const PROVIDER = path.join(__dirname, 'qualification-review-provider.js');

function run(env, content) {
  return spawnSync(process.execPath, [PROVIDER], {
    input: `${JSON.stringify({ role: 'reviewer', payload: { format: 'case_content', content } })}\n`,
    encoding: 'utf8',
    timeout: 30000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, QRP_TRANSPORT: 'http', QRP_PROMPT_MODE: 'reviewer', QRP_PROVIDER: 'zhipu', QRP_MODEL: 'glm-5.4', QRP_AUTH_TOKEN: 'x', AUTOPILOT_ACCOUNTS_DIR: path.join(require('os').tmpdir(), 'qrp-cn-gate-no-accounts'), ...env },
  });
}
const REMOTE = { QRP_BASE_URL: 'https://open.bigmodel.cn/api/anthropic' };
const LOCAL = { QRP_BASE_URL: 'http://127.0.0.1:9' };
const DIRTY = 'diff --git a/a.js b/a.js\n+// see /home/cookys/projects/autopilot/secret and host <host>.internal\n';
let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed += 1; }

const dirty = run({ ...REMOTE, QRP_CN_WORK_TIER: 'T1' }, DIRTY);
check(/cn_model_dispatch_barred zhipu restricted_operator_brief_scan/.test(dirty.stderr), `dirty payload to restricted operator is refused even when the tier is declared (got: ${dirty.stderr.slice(0, 200)})`);
const off = run({ ...REMOTE, AUTOPILOT_TEST_CN_GATE_OFF: '1', QRP_BASE_URL: 'http://127.0.0.1:9' }, DIRTY);
check(!/cn_model_dispatch_barred/.test(off.stderr), 'negative control: with the gate off the same payload is not refused (the pre-fix bypass)');
const local = run(LOCAL, DIRTY);
check(!/cn_model_dispatch_barred/.test(local.stderr), 'local gateway host stays allowed');
const clean = run(LOCAL, 'diff --git a/a.js b/a.js\n+const x = 1;\n');
check(!/cn_model_dispatch_barred/.test(clean.stderr), 'clean payload to a local gateway is not refused');
// Host-declared tier (PM 01M89N3DW6): clean payload to a restricted operator.
const CLEAN = 'diff --git a/a.js b/a.js\n+const x = 1;\n';
const noTier = run(REMOTE, CLEAN);
check(/cn_model_dispatch_barred/.test(noTier.stderr), `negative control: no QRP_CN_WORK_TIER is refused (got: ${noTier.stderr.slice(0, 160)})`);
const t2 = run({ ...REMOTE, QRP_CN_WORK_TIER: 'T2' }, CLEAN);
check(/cn_model_dispatch_barred/.test(t2.stderr), 'negative control: T2 is refused');
const mmT1 = run({ QRP_BASE_URL: 'https://api.minimax.io/anthropic', QRP_PROVIDER: 'minimax', QRP_MODEL: 'MiniMax-M3', QRP_CN_WORK_TIER: 'T1' }, CLEAN);
check(/cn_model_dispatch_barred/.test(mmT1.stderr), `negative control: MiniMax with T1 is refused (got: ${mmT1.stderr.slice(0, 160)})`);
// The passing case is checked on the gate directly so the test never calls out to the network.
const fs = require('fs'); const os = require('os');
const gate = require('./lib/cn-model-dispatch-gate');
let rt, srcDir; const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'qrp-cn-test-'));
try {
  const TPL = 'Brief-Class: clean-sandbox\nTask: Review a small diff.\nInputs: None.\nOutput: Verdict.\nLimits: None.\n';
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qrp-cn-src-')); const srcRepo = srcDir; require('child_process').execFileSync('git', ['init', '-q'], { cwd: srcRepo }); fs.writeFileSync(path.join(srcRepo, 'a.txt'), 'const peculiar = alpha beta gamma delta epsilon zeta eta theta iota kappa lambda;\n'); require('child_process').execFileSync('git', ['add', 'a.txt'], { cwd: srcRepo });
  rt = fs.mkdtempSync('/dev/shm/cn-gate-test-');
  const f = path.join(sandbox, 'case.txt'); fs.writeFileSync(f, TPL);
  const base = { runner: 'qrp-http', model: 'glm-5.4', endpoint: REMOTE.QRP_BASE_URL, cwd: sandbox, files: [f], sourceRepo: srcRepo, env: { XDG_RUNTIME_DIR: rt } };
  check(gate.check({ ...base, tier: 'T1' }).allowed === true, 'T1 declared by the host passes the gate for a clean payload');
  check(gate.check({ ...base, tier: '' }).allowed === false, 'negative control: an empty tier does not pass');
} finally { fs.rmSync(sandbox, { recursive: true, force: true }); if (rt) fs.rmSync(rt, { recursive: true, force: true }); if (srcDir) fs.rmSync(srcDir, { recursive: true, force: true }); }
// api.z.ai is Zhipu's international host: it must be classified as the restricted zhipu operator, not "unknown endpoint".
const zai = run({ QRP_BASE_URL: 'https://api.z.ai/api/anthropic', QRP_CN_WORK_TIER: 'T1' }, DIRTY);
check(/cn_model_dispatch_barred zhipu restricted_operator_brief_scan/.test(zai.stderr), `api.z.ai is a restricted zhipu endpoint and a dirty payload is scanned there (got: ${zai.stderr.slice(0, 160)})`);
const t1dirty = run({ ...REMOTE, QRP_CN_WORK_TIER: 'T1' }, DIRTY);
check(/cn_model_dispatch_barred/.test(t1dirty.stderr), 'T1 does not pass a payload with internal markers');
console.log(`PASS [qualification-review-provider-cn-gate] ${passed} assertions`);
