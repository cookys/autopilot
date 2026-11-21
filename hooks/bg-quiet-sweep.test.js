#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SWEEP_HOOK = path.join(REPO_ROOT, 'hooks', 'bg-quiet-sweep.js');

function runSweep(env, stdinObj) {
  return execFileSync(process.execPath, [SWEEP_HOOK], {
    env: { ...process.env, ...env },
    input: JSON.stringify(stdinObj),
    encoding: 'utf8',
  });
}

function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-quiet-sweep-test-'));
  try {
    const homeDir = path.join(tmpRoot, 'home');
    const xdgDir = path.join(tmpRoot, 'xdg');
    const sessionId = 'sweep-test-sess';
    const queueDir = path.join(xdgDir, 'autopilot', 'bg-quiet', sessionId);
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(queueDir, { recursive: true });

    const fleetLog = path.join(tmpRoot, 'fleet-argv.log');
    const stubFleet = path.join(tmpRoot, 'fleet-stub');
    fs.writeFileSync(
      stubFleet,
      `#!/usr/bin/env bash\necho "$*" >> "${fleetLog}"\nexit 0\n`,
      { mode: 0o755 }
    );

    const env = {
      HOME: homeDir,
      XDG_RUNTIME_DIR: xdgDir,
      CLAUDE_CODE_SESSION_ID: sessionId,
      FLEET_BIN: stubFleet,
    };

    // Seed .ok and .fail receipts
    fs.writeFileSync(
      path.join(queueDir, 'job-ok.json'),
      JSON.stringify({ id: 'job-ok', watch_id: 'w-ok-1', label: 'ok-suite', log: path.join(queueDir, 'job-ok.log') })
    );
    fs.writeFileSync(
      path.join(queueDir, 'job-ok.ok'),
      JSON.stringify({ id: 'job-ok', label: 'ok-suite', rc: 0 })
    );

    fs.writeFileSync(
      path.join(queueDir, 'job-fail.json'),
      JSON.stringify({ id: 'job-fail', watch_id: 'w-fail-1', label: 'fail-suite', log: path.join(queueDir, 'job-fail.log') })
    );
    fs.writeFileSync(
      path.join(queueDir, 'job-fail.fail'),
      JSON.stringify({ id: 'job-fail', label: 'fail-suite', rc: 3 })
    );

    // 1. UserPromptSubmit sweeps both, cancels only .ok, renames both, emits additionalContext
    const out1 = runSweep(env, { hook_event_name: 'UserPromptSubmit', session_id: sessionId });
    const parsed1 = JSON.parse(out1);
    const ctx = parsed1.hookSpecificOutput.additionalContext;
    assert(ctx.includes('ok-suite'), 'UserPromptSubmit output should include ok-suite label');
    assert(ctx.includes('fail-suite'), 'UserPromptSubmit output should include fail-suite label');

    const fleetCalls = fs.readFileSync(fleetLog, 'utf8').trim().split('\n').filter(Boolean);
    assert.deepStrictEqual(fleetCalls, ['watch --cancel w-ok-1'], 'only .ok should trigger watch --cancel');

    assert(fs.existsSync(path.join(queueDir, 'job-ok.ok.swept')), '.ok should be renamed to .ok.swept');
    assert(!fs.existsSync(path.join(queueDir, 'job-ok.ok')), '.ok should be removed');
    assert(fs.existsSync(path.join(queueDir, 'job-fail.fail.swept')), '.fail should be renamed to .fail.swept');
    assert(!fs.existsSync(path.join(queueDir, 'job-fail.fail')), '.fail should be removed');

    // 2. Second sweep is a no-op
    fs.writeFileSync(fleetLog, '');
    const out2 = runSweep(env, { hook_event_name: 'UserPromptSubmit', session_id: sessionId });
    assert.strictEqual(out2, '', 'second sweep should emit nothing');
    assert.strictEqual(fs.readFileSync(fleetLog, 'utf8'), '', 'second sweep should not call fleet');

    // 3. Stop event sweeps silently (no stdout) and ignores *.tmp
    fs.writeFileSync(
      path.join(queueDir, 'job-stop.json'),
      JSON.stringify({ id: 'job-stop', watch_id: 'w-stop-1', label: 'stop-suite', log: path.join(queueDir, 'job-stop.log') })
    );
    fs.writeFileSync(
      path.join(queueDir, 'job-stop.ok'),
      JSON.stringify({ id: 'job-stop', label: 'stop-suite', rc: 0 })
    );
    fs.writeFileSync(
      path.join(queueDir, 'job-tmp.ok.tmp'),
      JSON.stringify({ id: 'job-tmp', label: 'tmp-suite', rc: 0 })
    );
    const outStop = runSweep(env, { hook_event_name: 'Stop', session_id: sessionId });
    assert.strictEqual(outStop, '', 'Stop event should emit nothing');
    assert(fs.existsSync(path.join(queueDir, 'job-stop.ok.swept')), 'Stop should still sweep .ok');
    assert(fs.existsSync(path.join(queueDir, 'job-tmp.ok.tmp')), '*.tmp files must be ignored');

    // 4. hooks/hooks.json registers bg-quiet-sweep.js under exactly UserPromptSubmit and Stop
    const hooksJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8'));
    const eventsWithSweep = [];
    for (const [event, groups] of Object.entries(hooksJson.hooks || {})) {
      const hasSweep = (groups || []).some((g) =>
        (g.hooks || []).some((h) => typeof h.command === 'string' && h.command.includes('bg-quiet-sweep.js'))
      );
      if (hasSweep) eventsWithSweep.push(event);
    }
    assert.deepStrictEqual(
      eventsWithSweep.sort(),
      ['Stop', 'UserPromptSubmit'],
      `bg-quiet-sweep.js must be registered under exactly UserPromptSubmit and Stop, got: ${eventsWithSweep.join(', ')}`
    );

    console.log('PASS: bg-quiet-sweep.test.js (4/4)');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
