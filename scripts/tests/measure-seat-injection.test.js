#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const {
  parseTrace,
  measureSkills,
  checkBaseline,
} = require('../measure-seat-injection');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/measure-seat-injection.js');
const TRACE_PATH = path.join(REPO_ROOT, 'project/evidence/s10/pm-events.jsonl');

test('reverse probe: adding 100 chars to a SKILL.md description fails --check-baseline', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 's10-p0-probe-'));
  try {
    const skillDir = path.join(tmpDir, 'skills', 'alpha');
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(skillFile, '---\nname: alpha\ndescription: Use when testing. Not for prod.\n---\n', 'utf8');

    const measured = measureSkills(tmpDir);
    const baselinePath = path.join(tmpDir, 'baseline.json');
    fs.writeFileSync(baselinePath, JSON.stringify({
      schema_version: 1,
      description_total_bytes: measured.description_total_bytes,
      skills: measured.skills,
      targets: [],
    }), 'utf8');

    assert.equal(checkBaseline(tmpDir, baselinePath).ok, true);

    // Mutate description by +100 chars
    fs.writeFileSync(
      skillFile,
      `---\nname: alpha\ndescription: Use when testing. Not for prod.${'x'.repeat(100)}\n---\n`,
      'utf8'
    );

    let failed = false;
    try {
      execFileSync(process.execPath, [
        SCRIPT_PATH,
        '--check-baseline',
        '--root', tmpDir,
        '--baseline', baselinePath,
      ], { encoding: 'utf8', timeout: 5000 });
    } catch (err) {
      failed = err.status !== 0;
    }
    assert.equal(failed, true, '--check-baseline must exit non-zero after +100 chars');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('--from-trace aggregates pm-events.jsonl by event and hook (context_bytes + stdout_bytes)', () => {
  const out = execFileSync(process.execPath, [
    SCRIPT_PATH,
    '--from-trace', TRACE_PATH,
  ], { encoding: 'utf8', timeout: 5000 });
  const parsed = JSON.parse(out);

  assert.equal(parsed.by_event.SessionStart, 169576); // startup 83915 + clear 5402 + compact 80259
  assert.equal(parsed.by_hook.SessionStart, 83915);
  assert.equal(parsed.by_hook['SessionStart:compact'], 80259);
  assert.equal(parsed.by_event.UserPromptSubmit, 33255);
  assert.equal(parsed.by_hook['PreToolUse:Bash'], 41859);
  assert.equal(parsed.by_hook.UserPromptSubmit, 33255);
});

test('targets selection picks top 2 hooks from UserPromptSubmit and PreToolUse', () => {
  const parsed = parseTrace(TRACE_PATH);
  assert.equal(parsed.targets.length, 2);
  assert.equal(parsed.targets[0].hook, 'PreToolUse:Bash');
  assert.equal(parsed.targets[0].baseline_bytes, 41859);
  assert.equal(parsed.targets[0].threshold_50pct, 20929);
  assert.equal(parsed.targets[1].hook, 'UserPromptSubmit');
  assert.equal(parsed.targets[1].baseline_bytes, 33255);
  assert.equal(parsed.targets[1].threshold_50pct, 16627);
});

test('--check-targets compares per-prompt averages and is red without enough prompts', () => {
  const { checkTargets } = require('../measure-seat-injection');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's10-p5-'));
  try {
    const base = path.join(dir, 'baseline.json');
    const trace = path.join(dir, 'trace.jsonl');
    const run = (prompts, hookBytes, baselinePrompts) => {
      fs.writeFileSync(base, JSON.stringify({ baseline_prompts: baselinePrompts, targets: [{ hook: 'UserPromptSubmit', baseline_bytes: 1000 }] }));
      const rows = Array.from({ length: prompts }, () => ({ kind: 'prompt', event: 'Prompt', hook: 'Prompt' }));
      rows.push({ event: 'UserPromptSubmit', hook: 'UserPromptSubmit', context_bytes: hookBytes });
      fs.writeFileSync(trace, rows.map((r) => JSON.stringify(r)).join('\n'));
      return checkTargets(base, trace);
    };
    // baseline 100 B/prompt, limit 50 B/prompt
    assert.equal(run(100, 5000, 10).ok, true, 'a long window with a total above the baseline total still passes');
    assert.equal(run(50, 2600, 10).ok, false, '52 B/prompt is over');
    assert.match(run(49, 0, 10).violations[0], /insufficient sample/);
    assert.match(run(50, 0, undefined).violations[0], /baseline_prompts missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
