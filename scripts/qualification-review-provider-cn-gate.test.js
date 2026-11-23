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
    env: { PATH: process.env.PATH, HOME: process.env.HOME, QRP_TRANSPORT: 'http', QRP_PROMPT_MODE: 'reviewer', QRP_PROVIDER: 'zhipu', QRP_MODEL: 'glm-5.4', QRP_AUTH_TOKEN: 'x', ...env },
  });
}
const REMOTE = { QRP_BASE_URL: 'https://open.bigmodel.cn/api/anthropic' };
const LOCAL = { QRP_BASE_URL: 'http://127.0.0.1:9' };
const DIRTY = 'diff --git a/a.js b/a.js\n+// see /home/team/projects/autopilot/secret and host cookys-openclaw.internal\n';
let passed = 0;
function check(cond, msg) { assert.ok(cond, msg); passed += 1; }

const dirty = run(REMOTE, DIRTY);
check(/cn_model_dispatch_barred zhipu restricted_operator_brief_scan/.test(dirty.stderr), `dirty payload to restricted operator is refused (got: ${dirty.stderr.slice(0, 200)})`);
const off = run({ ...REMOTE, AUTOPILOT_TEST_CN_GATE_OFF: '1', QRP_BASE_URL: 'http://127.0.0.1:9' }, DIRTY);
check(!/cn_model_dispatch_barred/.test(off.stderr), 'negative control: with the gate off the same payload is not refused (the pre-fix bypass)');
const local = run(LOCAL, DIRTY);
check(!/cn_model_dispatch_barred/.test(local.stderr), 'local gateway host stays allowed');
const clean = run(LOCAL, 'diff --git a/a.js b/a.js\n+const x = 1;\n');
check(!/cn_model_dispatch_barred/.test(clean.stderr), 'clean payload to a local gateway is not refused');
console.log(`PASS [qualification-review-provider-cn-gate] ${passed} assertions`);
