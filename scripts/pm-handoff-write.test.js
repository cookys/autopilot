'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const script = path.join(__dirname, 'pm-handoff-write.js');
const id = '01M8BSC21M4SEMM5H47JRZSPXD';
test('snapshot sections, distinct tasks, operator, permissions and overwrite', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-write-'));
  try {
    const out = path.join(dir, 'out.md'), op = path.join(dir, 'op'), resume = path.join(dir, 'resume');
    fs.writeFileSync(op, 'operator words'); fs.writeFileSync(resume, `IN_FLIGHT ${id} one\nWAIT ${id} two\n`);
    const run = (...args) => spawnSync(process.execPath, [script, '--sid', 'sid', '--out', out, ...args], { encoding: 'utf8' });
    assert.equal(run('--operator-file', op, '--resume-file', resume).status, 0);
    let body = fs.readFileSync(out, 'utf8');
    for (const h of ['目標','現況','已決事項(不重議)','下一步','驗證方式','Read-order','陷阱','接續表','操作員最近說的話','未完成事項']) assert.ok(body.includes(`## ${h}`));
    for (const k of ['operator_thread', 'artifacts', 'pending_rulings', 'subagent_outputs', 'card_notes', 'executor']) assert.ok(body.includes(`${k}:`));
    assert.equal(body.split('\n').filter(line => line.startsWith(`- ${id} `)).length, 1); assert.ok(body.includes('operator words')); assert.equal(fs.statSync(out).mode & 0o777, 0o600);
    fs.writeFileSync(resume, 'empty'); assert.equal(run('--resume-file', resume).status, 0); body = fs.readFileSync(out, 'utf8'); assert.ok(!body.includes(id) && !body.includes('operator words')); assert.ok(body.includes('（無）'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('uses fake fleet and default model note path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-fleet-'));
  try {
    const fleet = path.join(dir, 'fleet'); fs.writeFileSync(fleet, `#!/bin/sh\nprintf '%s\\n' 'IN_FLIGHT ${id} task'\n`, { mode: 0o755 });
    const r = spawnSync(process.execPath, [script, '--sid', 'session'], { encoding: 'utf8', env: { ...process.env, FLEET_BIN: fleet, AUTOPILOT_MODEL_HANDOFF_DIR: dir } });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), path.join(dir, 'session.md')); assert.ok(fs.readFileSync(r.stdout.trim(), 'utf8').includes(id));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('the operator section carries last_operator from fleet pm resume --check', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-lastop-'));
  try {
    const fleet = path.join(dir, 'fleet');
    fs.writeFileSync(fleet, `#!/bin/sh\ncase "$*" in\n  *--check*) printf '%s' '{"last_operator":{"id":"x","at_ms":1,"text":"go with plan C"}}'; exit 1;;\n  *) printf '%s\\n' 'IN_FLIGHT ${id} task';;\nesac\n`, { mode: 0o755 });
    const r = spawnSync(process.execPath, [script, '--sid', 'session'], { encoding: 'utf8', env: { ...process.env, FLEET_BIN: fleet, AUTOPILOT_MODEL_HANDOFF_DIR: dir } });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.readFileSync(r.stdout.trim(), 'utf8').includes('## 操作員最近說的話\ngo with plan C'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
