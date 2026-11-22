#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  toTaipeiIso,
  normalizeCommand,
  projectUsageOnly,
  classifyTranscript,
} = require('./lib/wasted-turns-classify.js');

const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'wasted-turns');
const CLI_PATH = path.join(__dirname, 'wasted-turns-report.js');

function runTest(name, fn) {
  try {
    fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (err) {
    process.stderr.write(`FAIL ${name}: ${err.stack || err.message}\n`);
    process.exitCode = 1;
  }
}

runTest('toTaipeiIso formats UTC+8 without trailing Z', () => {
  const iso = toTaipeiIso(Date.parse('2026-11-22T00:00:00Z'));
  assert.strictEqual(iso, '2026-11-22T08:00:00+08:00');
  assert.ok(!iso.endsWith('Z'));
});

runTest('categories fixture: hand-computed counts for all 5 categories', () => {
  const raw = fs.readFileSync(path.join(FIXTURES_DIR, 'categories.jsonl'), 'utf8');
  const res = classifyTranscript(raw);

  assert.strictEqual(res.turns_total, 12);
  assert.strictEqual(res.whiff.stop_block.turns, 1);
  assert.strictEqual(res.whiff.hook_block.turns, 1);
  assert.strictEqual(res.whiff.hook_block.by_hook['bash-footgun-guard'], 1);
  assert.strictEqual(res.whiff.help_lookup.turns, 1); // git status --help; echo --help foo is negative
  assert.strictEqual(res.whiff.error_retry.turns, 1); // git   push -> git push; git pull -> git status is negative
  assert.strictEqual(res.whiff_turns, 4);
  assert.ok(res.whiff.repeat_chain.chains.some((c) => c.shape === 'ls -la && pwd' && c.count === 2));

  // Cost check: stop_block had ctx 5000, cacheRead 4000 (hit -> 500)
  assert.strictEqual(res.whiff.stop_block.ctx_tokens, 5000);
  assert.strictEqual(res.whiff.stop_block.cost_hit, 500);
  assert.strictEqual(res.whiff.stop_block.cost_miss, 0);

  // hook_block had ctx 2000, cacheRead 0 (miss -> 4000)
  assert.strictEqual(res.whiff.hook_block.ctx_tokens, 2000);
  assert.strictEqual(res.whiff.hook_block.cost_hit, 0);
  assert.strictEqual(res.whiff.hook_block.cost_miss, 4000);
});

runTest('negative control: different command after error must NOT count as error_retry', () => {
  const raw = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-11-22T02:00:01Z',
      message: {
        id: 'nc1',
        usage: { input_tokens: 100, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
        content: [{ type: 'tool_use', id: 'nct1', name: 'Bash', input: { command: 'git push origin main' } }],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-11-22T02:00:02Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'nct1', content: 'rejected', is_error: true }] },
    }),
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-11-22T02:00:03Z',
      message: {
        id: 'nc2',
        usage: { input_tokens: 100, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 },
        content: [{ type: 'tool_use', id: 'nct2', name: 'Bash', input: { command: 'git status' } }],
      },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-11-22T02:00:04Z',
      message: { content: [{ type: 'tool_result', tool_use_id: 'nct2', content: 'clean', is_error: false }] },
    }),
  ].join('\n');

  // Naive first-word classifier would have matched "git" === "git" (1); fixed classifier must return 0.
  const res = classifyTranscript(raw);
  assert.strictEqual(res.whiff.error_retry.turns, 0);
});

runTest('hook name is the trailing [bracket] token of a real PreToolUse denial', () => {
  const { extractHookBlockName } = require('./lib/wasted-turns-classify.js');
  const real = 'PreToolUse:Bash hook error: blocked reason text. [claude-home-read-guard]fix: read own files';
  assert.strictEqual(extractHookBlockName(real, true), 'claude-home-read-guard');
  assert.strictEqual(extractHookBlockName('PreToolUse:Bash hook error: no name', true), 'Bash');
});

runTest('usage-only privacy: sentinel string never appears in stdout, stderr, or output JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-priv-'));
  try {
    const outPath = path.join(tmpDir, 'out.json');
    const stdout = execFileSync(
      process.execPath,
      [
        CLI_PATH,
        '--usage-only',
        '--transcript',
        path.join(FIXTURES_DIR, 'privacy.jsonl'),
        '--seat',
        'test-seat',
        '--now',
        '2026-11-22T10:00:00Z',
        '--out',
        outPath,
      ],
      { env: { ...process.env, HOME: tmpDir }, encoding: 'utf8', timeout: 10000 }
    );
    const outJson = fs.readFileSync(outPath, 'utf8');
    assert.ok(!stdout.includes('SENTINEL_SECRET_CONTENT_998877'));
    assert.ok(!outJson.includes('SENTINEL_SECRET_CONTENT_998877'));
    const parsed = JSON.parse(outJson);
    assert.strictEqual(parsed.mode, 'usage-only');
    assert.strictEqual(parsed.turns_total, 1);
    assert.strictEqual(parsed.whiff.stop_block, null);
    assert.strictEqual(parsed.whiff_turns, null);
    assert.ok(parsed.window.from.endsWith('+08:00'));
    assert.ok(parsed.window.to.endsWith('+08:00'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

runTest('back-calculation: scaled-down PM 511 turns / 98 whiff (~19%)', () => {
  // 51 turns, 10 whiff (2 stop_block, 4 hook_block, 2 help_lookup, 2 error_retry) => 19.61%
  const lines = [];
  for (let i = 0; i < 51; i++) {
    const id = `bc_${i}`;
    const tid = `bct_${i}`;
    let cmd = `echo step_${i}`;
    let isErr = false;
    let resText = 'ok';
    if (i === 0 || i === 1) {
      lines.push(JSON.stringify({ type: 'system', subtype: 'stop_hook', decision: 'block' }));
    } else if (i >= 2 && i <= 5) {
      resText = '[bash-footgun-guard] denied';
      isErr = true;
    } else if (i === 6 || i === 7) {
      cmd = 'fleet --help';
    } else if (i === 8) {
      cmd = 'git push';
      isErr = true;
      resText = 'error';
    } else if (i === 9) {
      cmd = 'git push';
    } else if (i === 10) {
      cmd = 'git fetch';
      isErr = true;
      resText = 'error';
    } else if (i === 11) {
      cmd = 'git fetch';
    }
    lines.push(JSON.stringify({
      type: 'assistant',
      message: {
        id,
        usage: { input_tokens: 1000, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 },
        content: [{ type: 'tool_use', id: tid, name: 'Bash', input: { command: cmd } }],
      },
    }));
    lines.push(JSON.stringify({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: tid, content: resText, is_error: isErr }] },
    }));
  }
  const res = classifyTranscript(lines.join('\n'));
  assert.strictEqual(res.turns_total, 51);
  assert.strictEqual(res.whiff_turns, 10);
  assert.strictEqual(res.whiff_per_100, 19.61);
  assert.strictEqual(res.whiff_share, 0.1961);
});

runTest('aggregate mode ranks seats by whiff_per_100 descending', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-agg-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'a.json'), JSON.stringify({
      schema: 'autopilot.wasted-turns/1',
      seat: 'seat-a',
      mode: 'self',
      turns_total: 100,
      whiff_turns: 5,
      whiff_per_100: 5,
      whiff: {
        stop_block: { turns: 5, ctx_tokens: 1000, cost_hit: 100, cost_miss: 0 },
        hook_block: { turns: 0, by_hook: {}, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 },
        help_lookup: { turns: 0, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 },
        error_retry: { turns: 0, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 },
      },
    }));
    fs.writeFileSync(path.join(tmpDir, 'b.json'), JSON.stringify({
      schema: 'autopilot.wasted-turns/1',
      seat: 'seat-b',
      mode: 'self',
      turns_total: 100,
      whiff_turns: 20,
      whiff_per_100: 20,
      whiff: {
        stop_block: { turns: 20, ctx_tokens: 2000, cost_hit: 200, cost_miss: 0 },
        hook_block: { turns: 0, by_hook: {}, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 },
        help_lookup: { turns: 0, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 },
        error_retry: { turns: 0, ctx_tokens: 0, cost_hit: 0, cost_miss: 0 },
      },
    }));
    const out = execFileSync(
      process.execPath,
      [CLI_PATH, '--aggregate', tmpDir, '--top', '1'],
      { env: { ...process.env, HOME: tmpDir }, encoding: 'utf8', timeout: 10000 }
    );
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.schema, 'autopilot.wasted-turns.rank/1');
    assert.strictEqual(parsed.top.length, 1);
    assert.strictEqual(parsed.top[0].seat, 'seat-b');
    assert.strictEqual(parsed.fleet.seats_total, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

runTest('classifyTranscriptStream with 1 KiB maxChunk matches classifyTranscript on categories.jsonl', async () => {
  const { classifyTranscriptStream } = require('./lib/wasted-turns-classify.js');
  const fixturePath = path.join(__dirname, 'fixtures', 'wasted-turns', 'categories.jsonl');
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const expected = classifyTranscript(raw);
  const actual = await classifyTranscriptStream([fixturePath], { maxChunk: 1024 });
  assert.deepStrictEqual(actual, expected);
});

runTest('readLinesFromFile skips oversized lines without crashing', async () => {
  const { readLinesFromFile } = require('./lib/wasted-turns-classify.js');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-oversized-'));
  try {
    const filePath = path.join(tmpDir, 'oversized.jsonl');
    const bigLine = JSON.stringify({ type: 'assistant', pad: 'x'.repeat(2048) });
    const smallLine = JSON.stringify({ type: 'assistant', ok: true });
    fs.writeFileSync(filePath, `${smallLine}\n${bigLine}\n${smallLine}\n`, 'utf8');
    let oversizedCount = 0;
    const lines = [];
    for await (const line of readLinesFromFile(filePath, {
      maxChunk: 512,
      maxLineBytes: 1024,
      onOversized: () => { oversizedCount += 1; },
    })) {
      lines.push(line);
    }
    assert.strictEqual(oversizedCount, 1);
    assert.strictEqual(lines.length, 2);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

runTest('3 MB transcript runs under --max-old-space-size=64 in --self and --usage-only modes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-3mb-'));
  try {
    const filePath = path.join(tmpDir, 'large.jsonl');
    const nowIso = '2026-11-22T12:00:00Z';
    const rec = JSON.stringify({
      type: 'assistant',
      timestamp: nowIso,
      message: {
        model: 'claude-sonnet-4-5',
        usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 50, cache_creation_input_tokens: 0 },
        content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo ok' } }],
      },
    }) + '\n';
    const targetBytes = 3 * 1024 * 1024;
    const fd = fs.openSync(filePath, 'w');
    let written = 0;
    while (written < targetBytes) {
      fs.writeSync(fd, rec);
      written += Buffer.byteLength(rec, 'utf8');
    }
    fs.closeSync(fd);

    const env = { ...process.env, HOME: tmpDir, WASTED_TURNS_MAX_CHUNK: '1024' };
    const selfOut = execFileSync(
      process.execPath,
      ['--max-old-space-size=64', CLI_PATH, '--self', '--transcript', filePath, '--now', nowIso],
      { env, encoding: 'utf8', timeout: 30000 }
    );
    const selfParsed = JSON.parse(selfOut);
    assert.strictEqual(selfParsed.mode, 'self');
    assert.ok(selfParsed.turns_total > 0);

    const usageOut = execFileSync(
      process.execPath,
      ['--max-old-space-size=64', CLI_PATH, '--usage-only', '--transcript', filePath, '--now', nowIso],
      { env, encoding: 'utf8', timeout: 30000 }
    );
    const usageParsed = JSON.parse(usageOut);
    assert.strictEqual(usageParsed.mode, 'usage-only');
    assert.ok(usageParsed.turns_total > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
