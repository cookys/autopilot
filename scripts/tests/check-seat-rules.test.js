#!/usr/bin/env node
/**
 * check-seat-rules.test.js — Unit tests & 6 reverse probes for check-seat-rules.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-seat-rules.js');

function runCheck(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    timeout: 10000,
  });
}

function makeTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seat-rules-test-'));
  fs.mkdirSync(path.join(dir, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'project', 'registry'), { recursive: true });

  fs.writeFileSync(path.join(dir, 'CLAUDE.md'), 'Never leak secrets.\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'Depth-0 must delegate.\n');

  // Minimal deny hook
  fs.writeFileSync(
    path.join(dir, 'hooks', 'deny-hook.js'),
    `process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "blocked" } }));\n`
  );
  // Advisory-only hook
  fs.writeFileSync(
    path.join(dir, 'hooks', 'advisory-hook.js'),
    `process.stdout.write(JSON.stringify({ additionalContext: "just a note" }));\n`
  );

  fs.writeFileSync(
    path.join(dir, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Agent',
            hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/deny-hook.js' }],
          },
        ],
      },
    })
  );

  const registry = {
    schema: 'seat-rules/1',
    rules: [
      { id: 'r-text', source: 'CLAUDE.md', anchor: 'Never leak secrets.', guarantee: 'text', seat: 'all' },
      { id: 'r-agents', source: 'AGENTS.md', anchor: 'Depth-0 must delegate.', guarantee: 'text', seat: 'depth0' },
      {
        id: 'r-hook',
        source: 'CLAUDE.md',
        anchor: 'Never leak secrets.',
        guarantee: 'hook',
        hook: 'hooks/deny-hook.js',
        event: 'PreToolUse',
        matcher: 'Agent',
        deny_fixture: { tool_name: 'Agent', tool_input: {} },
        seat: 'all',
      },
    ],
  };
  fs.writeFileSync(path.join(dir, 'project', 'registry', 'seat-rules.json'), JSON.stringify(registry, null, 2));
  return dir;
}

function testAll() {
  const tmp = makeTempWorkspace();
  try {
    // 0. Positive control
    const okRes = runCheck(['--root', tmp]);
    assert.strictEqual(okRes.status, 0, `Positive control failed: ${okRes.stderr}`);

    // Probe 1: Delete a row's anchor source line -> red
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), 'Nothing here.\n');
    const p1 = runCheck(['--root', tmp]);
    assert.notStrictEqual(p1.status, 0, 'Probe 1 should fail when anchor source line is deleted');
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), 'Never leak secrets.\n');

    // Probe 2: Remove a text rule from a seat's injected content -> red
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'No rules.\n');
    const p2 = runCheck(['--root', tmp]);
    assert.notStrictEqual(p2.status, 0, 'Probe 2 should fail when text rule is removed from seat content');
    fs.writeFileSync(path.join(tmp, 'AGENTS.md'), 'Depth-0 must delegate.\n');

    // Probe 3: Point a hook guarantee to an unwired hook -> red
    const regPath = path.join(tmp, 'project', 'registry', 'seat-rules.json');
    const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    reg.rules[2].hook = 'hooks/unwired-hook.js';
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
    const p3 = runCheck(['--root', tmp]);
    assert.notStrictEqual(p3.status, 0, 'Probe 3 should fail when hook is unwired');

    // Probe 4: Change a deny-class hook's output to advisory -> red
    reg.rules[2].hook = 'hooks/advisory-hook.js';
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
    fs.writeFileSync(
      path.join(tmp, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Agent',
              hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/advisory-hook.js' }],
            },
          ],
        },
      })
    );
    const p4 = runCheck(['--root', tmp]);
    assert.notStrictEqual(p4.status, 0, 'Probe 4 should fail when deny hook outputs advisory only');

    // Restore deny-hook
    reg.rules[2].hook = 'hooks/deny-hook.js';
    fs.writeFileSync(regPath, JSON.stringify(reg, null, 2));
    fs.writeFileSync(
      path.join(tmp, 'hooks', 'hooks.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: 'Agent',
              hooks: [{ type: 'command', command: 'node ${CLAUDE_PLUGIN_ROOT}/hooks/deny-hook.js' }],
            },
          ],
        },
      })
    );

    // Probe 5: --config snapshot disables a hook -> outputs 保證失效：<rule id> and exits non-zero
    const snapPath = path.join(tmp, 'snapshot.json');
    fs.writeFileSync(snapPath, JSON.stringify({ disabledHooks: ['hooks/deny-hook.js'] }));
    const p5 = runCheck(['--root', tmp, '--config', snapPath]);
    assert.notStrictEqual(p5.status, 0, 'Probe 5 should fail when --config disables a hook');
    assert.ok(p5.stderr.includes('保證失效：r-hook'), `Probe 5 should print 保證失效：r-hook, got: ${p5.stderr}`);

    // Probe 6: Source file adds a new rule-style line not registered -> --strict turns red
    fs.writeFileSync(path.join(tmp, 'CLAUDE.md'), 'Never leak secrets.\nNever bypass gates.\n');
    const p6 = runCheck(['--root', tmp, '--strict']);
    assert.notStrictEqual(p6.status, 0, 'Probe 6 should fail under --strict for unregistered rule-style line');

    console.log('PASS: all 6 reverse probes and positive control passed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

testAll();
