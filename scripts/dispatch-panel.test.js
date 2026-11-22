#!/usr/bin/env node
'use strict';

/**
 * Tests for scripts/dispatch-panel.js (P2 — parallel consultant barrier with de-identification).
 * Run: node --test scripts/dispatch-panel.test.js
 *
 * Uses stub fleet CLI (via PATH) and stub dispatch-author runners (via --author-cmd /
 * AUTOPILOT_DISPATCH_AUTHOR_BIN). Synthetic sensitive strings are constructed at runtime
 * so leak-guard never flags this test file.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

require('./lib/test-git-env');

const REPO_ROOT = path.resolve(__dirname, '..');
const PANEL_JS = path.join(__dirname, 'dispatch-panel.js');

test('findSameFamilyVote identifies the first known family pair', () => {
  const { findSameFamilyVote } = require('./lib/review-family-gate');
  const seats = [
    { name: 'unknown1', family: 'unknown' }, { name: 'unknown2', family: 'unknown' },
    { name: 'empty', family: '' }, { name: 'gpt', family: 'openai' },
    { name: 'grok', family: 'xai' }, { name: 'gpt2', family: 'openai' },
  ];
  assert.equal(findSameFamilyVote(seats.slice(0, 5), (seat) => seat.family), null);
  assert.deepEqual(findSameFamilyVote(seats, (seat) => seat.family), {
    family: 'openai', first: seats[3], second: seats[5],
  });
});

function makeSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-test-'));
  const binDir = path.join(dir, 'bin');
  const logDir = path.join(dir, 'logs');
  const runsDir = path.join(dir, 'runs');
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(runsDir, { recursive: true });

  const fleetBin = path.join(binDir, 'fleet');
  const fleetPayload = JSON.stringify({
    members: [
      { namespace: 'ns', courier: 'courier-zulu-7', member: 'member-omega-99', host: 'gpu-node-44' },
    ],
  });
  fs.writeFileSync(
    fleetBin,
    `#!/usr/bin/env node
'use strict';
if (process.argv[2] === 'directory') {
  process.stdout.write(${JSON.stringify(fleetPayload)} + '\\n');
  process.exit(0);
}
process.exit(1);
`,
    { mode: 0o755 },
  );

  const authorStub = path.join(binDir, 'stub-author.js');
  fs.writeFileSync(
    authorStub,
    `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const val = (flag) => {
  const idx = argv.indexOf(flag);
  return idx >= 0 ? argv[idx + 1] : '';
};
const runner = val('--runner');
const model = val('--model');
if (process.env.DP_TEST_REJECT_AGY_ENDPOINT && runner === 'agy' && val('--endpoint')) {
  process.stderr.write('unexpected agy endpoint\\n');
  process.exit(2);
}
const promptFile = val('--prompt-file');
const logDir = process.env.DP_TEST_LOG_DIR;
const seq = process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2, 8);
const rec = {
  runner,
  model,
  effort: val('--effort'),
  endpoint: val('--endpoint'),
  promptFile,
  cwd: process.cwd(),
  cwdMode: fs.statSync(process.cwd()).mode & 0o777,
  promptMode: fs.statSync(promptFile).mode & 0o777,
  cwdEntries: fs.readdirSync(process.cwd()),
  envKeys: Object.keys(process.env),
  startedAt: Date.now(),
};
fs.writeFileSync(path.join(logDir, 'call-' + seq + '.json'), JSON.stringify(rec));

let delayMs = 20;
try {
  const delays = JSON.parse(process.env.DP_TEST_DELAYS || '{}');
  if (typeof delays[model] === 'number') delayMs = delays[model];
  else if (typeof delays[runner] === 'number') delayMs = delays[runner];
} catch {}

let failSet = {};
try {
  failSet = JSON.parse(process.env.DP_TEST_FAILS || '{}');
} catch {}

setTimeout(() => {
  if (Object.prototype.hasOwnProperty.call(failSet, model)) {
    process.stderr.write('simulated runner failure\\n');
    process.exit(failSet[model]);
  }
  if (process.env.DP_TEST_ENVELOPE === '1') {
    const rawLog = path.join(logDir, 'raw-' + seq + '.txt');
    fs.writeFileSync(rawLog, 'authored-via-envelope:' + runner + ':' + model + '\\n');
    process.stdout.write(JSON.stringify({ runner, model, status: 'authored', raw_log: rawLog, error: null }) + '\\n');
    process.exit(0);
  }
  process.stdout.write('response-from:' + runner + ':' + model + '\\n');
  process.exit(0);
}, delayMs);
`,
    { mode: 0o755 },
  );

  const hostsFile = path.join(dir, 'hosts.json');
  fs.writeFileSync(
    hostsFile,
    JSON.stringify({ strong: ['testhost-panel-a'], contextual: ['testpanelctx'] }) + '\n',
    'utf8',
  );

  return {
    dir,
    binDir,
    logDir,
    runsDir,
    fleetBin,
    authorStub,
    hostsFile,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function readCalls(logDir) {
  return fs
    .readdirSync(logDir)
    .filter((f) => f.startsWith('call-') && f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(logDir, f), 'utf8')));
}

function runPanel(sb, args, extraEnv = {}, scriptPath = PANEL_JS) {
  const env = {
    ...process.env,
    PATH: `${sb.binDir}:${process.env.PATH || '/usr/bin:/bin'}`,
    DP_TEST_LOG_DIR: sb.logDir,
    AUTOPILOT_DISPATCH_RUNS_DIR: sb.runsDir,
    AUTOPILOT_LEAK_GUARD_HOSTS: sb.hostsFile,
    ...extraEnv,
  };
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env,
    timeout: 30000,
  });
}

function writePrompt(sb, name, content) {
  const p = path.join(sb.dir, name);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

test('agy seat does not pass a synthetic endpoint', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Reply OK.\n');
    const outDir = path.join(sb.dir, 'out');
    const res = runPanel(sb, ['--prompt-file', promptFile, '--seat', 'agy:gemini-4-neon-high',
      '--out-dir', outDir, '--author-cmd', sb.authorStub], { DP_TEST_REJECT_AGY_ENDPOINT: '1' });
    assert.equal(res.status, 0, res.stderr);
    const panel = JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'), 'utf8'));
    assert.equal(panel.seats[0].status, 'ok');
  } finally { sb.cleanup(); }
});

test('same family vote is refused before any output or seat', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Compare these proposals.\n');
    const outDir = path.join(sb.dir, 'out');
    const res = runPanel(sb, ['--prompt-file', promptFile, '--seat', 'codex:gpt-6-astra',
      '--seat', 'codex:gpt-6.1-sol', '--out-dir', outDir, '--author-cmd', sb.authorStub]);
    assert.equal(res.status, 4, `expected refusal; actual status ${res.status}, stderr: ${res.stderr}`);
    assert.match(res.stderr, /same_family_vote.*codex:gpt-6-astra.*codex:gpt-6\.1-sol/);
    assert.equal(fs.existsSync(outDir), false);
    assert.equal(readCalls(sb.logDir).length, 0);
  } finally { sb.cleanup(); }
});

test('same family override warns and runs both seats', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Compare these proposals.\n');
    const outDir = path.join(sb.dir, 'out');
    const res = runPanel(sb, ['--prompt-file', promptFile, '--seat', 'codex:gpt-6-astra',
      '--seat', 'codex:gpt-6.1-sol', '--out-dir', outDir, '--author-cmd', sb.authorStub,
      '--allow-same-family']);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /warning: same_family_vote.*codex:gpt-6-astra.*codex:gpt-6\.1-sol/);
    assert.equal(readCalls(sb.logDir).length, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'))).seats.map(s => s.status), ['ok', 'ok']);
  } finally { sb.cleanup(); }
});

test('neon, codex and claude seats run as distinct families', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Compare these proposals.\n');
    const outDir = path.join(sb.dir, 'out');
    const res = runPanel(sb, ['--prompt-file', promptFile, '--seat', 'agy:gemini-4-neon-high',
      '--seat', 'codex:gpt-6-astra', '--seat', 'claude-native:opus',
      '--out-dir', outDir, '--author-cmd', sb.authorStub]);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readCalls(sb.logDir).length, 3);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'))).seats.map(s => s.status), ['ok', 'ok', 'ok']);
  } finally { sb.cleanup(); }
});

test('3 allowed seats run concurrently, wait for slowest, write 0700 D / 0600 prompt & panel.json', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Compare two caching designs: write-through vs write-behind.\n');
    const outDir = path.join(sb.dir, 'out-3');
    const t0 = Date.now();
    const res = runPanel(
      sb,
      [
        '--prompt-file', promptFile,
        '--seat', 'codex:gpt-6.1-sol:high',
        '--seat', 'agy:gemini-4-carbon-high',
        '--seat', 'grok:grok-4.7:low',
        '--out-dir', outDir,
        '--author-cmd', sb.authorStub,
      ],
      {
        DP_TEST_DELAYS: JSON.stringify({ 'gpt-6.1-sol': 50, 'gemini-4-carbon-high': 250, 'grok-4.7': 100 }),
      },
    );
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 0, res.stderr);
    assert.ok(elapsed >= 220, `expected exit after slowest seat (250ms), elapsed=${elapsed}ms`);

    const panelPath = path.join(outDir, 'panel.json');
    assert.equal(fs.existsSync(panelPath), true);
    const panel = JSON.parse(fs.readFileSync(panelPath, 'utf8'));
    assert.equal(panel.schema, 'autopilot.panel/1');
    assert.equal(panel.complete, true);
    assert.equal(panel.seats.length, 3);

    for (const s of panel.seats) {
      assert.equal(s.status, 'ok');
      assert.equal(s.rc, 0);
      assert.ok(s.bytes > 0);
      assert.ok(fs.existsSync(s.out_path));
      assert.equal(path.relative(outDir, s.out_path).startsWith('..'), false);
    }

    assert.equal(fs.statSync(outDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(outDir, 'prompt.txt')).mode & 0o777, 0o600);

    const calls = readCalls(sb.logDir);
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.equal(c.cwdMode, 0o700);
      assert.equal(c.promptFile, path.join(c.cwd, 'brief.md'));
      assert.equal(c.promptMode, 0o600);
      assert.deepEqual(c.cwdEntries, ['brief.md']);
      assert.notEqual(c.cwd, outDir);
      assert.equal(fs.existsSync(c.cwd), false, 'temp seat cwd should be cleaned up');
    }
  } finally {
    sb.cleanup();
  }
});

test('dispatch-author JSON envelope extracts raw_log bytes and AUTOPILOT_DISPATCH_AUTHOR_BIN works', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Evaluate index layout tradeoffs.\n');
    const outDir = path.join(sb.dir, 'out-env');
    const res = runPanel(
      sb,
      ['--prompt-file', promptFile, '--seat', 'grok:grok-4.7', '--out-dir', outDir],
      {
        AUTOPILOT_DISPATCH_AUTHOR_BIN: sb.authorStub,
        DP_TEST_ENVELOPE: '1',
      },
    );
    assert.equal(res.status, 0, res.stderr);
    const panel = JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'), 'utf8'));
    assert.equal(panel.complete, true);
    assert.equal(panel.seats[0].status, 'ok');
    assert.equal(fs.readFileSync(panel.seats[0].out_path, 'utf8'), 'authored-via-envelope:grok:grok-4.7\n');
  } finally {
    sb.cleanup();
  }
});

test('one timeout produces complete:false and status:timeout for the slow seat', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Check retry backoff strategies.\n');
    const outDir = path.join(sb.dir, 'out-timeout');
    const res = runPanel(
      sb,
      [
        '--prompt-file', promptFile,
        '--seat', 'grok:grok-4.7',
        '--seat', 'codex:gpt-6.1-sol',
        '--out-dir', outDir,
        '--timeout', '1s',
        '--author-cmd', sb.authorStub,
      ],
      {
        DP_TEST_DELAYS: JSON.stringify({ 'grok-4.7': 40, 'gpt-6.1-sol': 8000 }),
      },
    );
    assert.equal(res.status, 0, res.stderr);
    const panel = JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'), 'utf8'));
    assert.equal(panel.complete, false);
    assert.equal(panel.seats[0].status, 'ok');
    assert.equal(panel.seats[1].status, 'timeout');
    assert.equal(panel.seats[1].rc, null);
    assert.equal(panel.seats[1].out_path, null);
    assert.equal(panel.seats[1].bytes, 0);
  } finally {
    sb.cleanup();
  }
});

test('de-identification blocks fake email, private IP, fleet names, and secrets with exit 4 and zero writes/spawns', () => {
  const fakeEmail = ['alice', '@', 'internal-corp', '.invalid'].join('');
  const fakeLanIp = ['192', '168', '42', '17'].join('.');
  const fakeSecret = ['sk', 'ant', 'api03', 'AbCdEfGhIjKlMnOpQrStUv'].join('-');
  const cases = [
    { label: 'email', text: `Contact ${fakeEmail} for approval.\n`, needle: fakeEmail },
    { label: 'private_ip', text: `Server is at ${fakeLanIp} port 8080.\n`, needle: fakeLanIp },
    { label: 'member', text: 'Ask member-omega-99 to review this.\n', needle: 'member-omega-99' },
    { label: 'courier', text: 'Routed through courier-zulu-7 yesterday.\n', needle: 'courier-zulu-7' },
    { label: 'host', text: 'Check disk space on gpu-node-44 now.\n', needle: 'gpu-node-44' },
    { label: 'secret', text: `Use token ${fakeSecret} here.\n`, needle: fakeSecret },
  ];

  for (const c of cases) {
    const sb = makeSandbox();
    try {
      const promptFile = writePrompt(sb, `${c.label}.txt`, c.text);
      const outDir = path.join(sb.dir, `out-${c.label}`);
      const res = runPanel(sb, [
        '--prompt-file', promptFile,
        '--seat', 'grok:grok-4.7',
        '--out-dir', outDir,
        '--author-cmd', sb.authorStub,
      ]);
      assert.equal(res.status, 4, `${c.label}: expected exit 4, got ${res.status} (${res.stderr})`);
      assert.equal(readCalls(sb.logDir).length, 0, `${c.label}: expected 0 invocations`);
      assert.equal(fs.existsSync(outDir), false, `${c.label}: nothing may be written under --out-dir`);
      assert.equal(res.stderr.includes(c.needle), false, `${c.label}: stderr must print rule ids only, never matched value`);
    } finally {
      sb.cleanup();
    }
  }
});

test('empty or unreadable prompt file exits 4 with zero writes and zero spawns', () => {
  const sb = makeSandbox();
  try {
    const emptyFile = writePrompt(sb, 'empty.txt', '   \n  \n');
    const missingFile = path.join(sb.dir, 'does-not-exist.txt');
    for (const [label, f] of [['empty', emptyFile], ['missing', missingFile]]) {
      const outDir = path.join(sb.dir, `out-${label}`);
      const res = runPanel(sb, [
        '--prompt-file', f,
        '--seat', 'grok:grok-4.7',
        '--out-dir', outDir,
        '--author-cmd', sb.authorStub,
      ]);
      assert.equal(res.status, 4, `${label}: expected exit 4`);
      assert.equal(readCalls(sb.logDir).length, 0);
      assert.equal(fs.existsSync(outDir), false);
    }
  } finally {
    sb.cleanup();
  }
});

test('missing scanner rule file fails closed with exit 4 and zero spawns', () => {
  const sb = makeSandbox();
  try {
    const shadowRoot = path.join(sb.dir, 'shadow-repo');
    const shadowScripts = path.join(shadowRoot, 'scripts');
    const shadowLib = path.join(shadowScripts, 'lib');
    const shadowHooksShared = path.join(shadowRoot, 'hooks', '_shared');
    fs.mkdirSync(shadowLib, { recursive: true });
    fs.mkdirSync(shadowHooksShared, { recursive: true });

    for (const f of ['dispatch-panel.js', 'ar-redact.js', 'wait-dispatch-results.js']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'scripts', f), path.join(shadowScripts, f));
    }
    fs.copyFileSync(
      path.join(REPO_ROOT, 'hooks', '_shared', 'secret-patterns.js'),
      path.join(shadowHooksShared, 'secret-patterns.js'),
    );
    for (const f of fs.readdirSync(path.join(REPO_ROOT, 'scripts', 'lib'))) {
      if (f === 'ar-redact-rules.js') continue; // omit rule file intentionally
      const src = path.join(REPO_ROOT, 'scripts', 'lib', f);
      if (fs.statSync(src).isFile()) {
        fs.copyFileSync(src, path.join(shadowLib, f));
      }
    }

    const promptFile = writePrompt(sb, 'clean.txt', 'Clean prompt text.\n');
    const outDir = path.join(sb.dir, 'out-missing-rule');
    const res = runPanel(
      sb,
      [
        '--prompt-file', promptFile,
        '--seat', 'grok:grok-4.7',
        '--out-dir', outDir,
        '--author-cmd', sb.authorStub,
      ],
      {},
      path.join(shadowScripts, 'dispatch-panel.js'),
    );
    assert.equal(res.status, 4, res.stderr);
    assert.equal(readCalls(sb.logDir).length, 0);
    assert.equal(fs.existsSync(outDir), false);

    // Corrupt AUTOPILOT_LEAK_GUARD_HOSTS also fails closed with exit 4 and zero spawns.
    const badHosts = path.join(sb.dir, 'bad-hosts.json');
    fs.writeFileSync(badHosts, '{not-json\n', 'utf8');
    const outBad = path.join(sb.dir, 'out-bad-hosts');
    const resBad = runPanel(
      sb,
      [
        '--prompt-file', promptFile,
        '--seat', 'grok:grok-4.7',
        '--out-dir', outBad,
        '--author-cmd', sb.authorStub,
      ],
      { AUTOPILOT_LEAK_GUARD_HOSTS: badHosts },
    );
    assert.equal(resBad.status, 4, resBad.stderr);
    assert.equal(readCalls(sb.logDir).length, 0);
    assert.equal(fs.existsSync(outBad), false);

    // Fake host from AUTOPILOT_LEAK_GUARD_HOSTS blocks prompt with exit 4.
    const hostPrompt = writePrompt(sb, 'host-hit.txt', 'Check node testhost-panel-a status.\n');
    const outHost = path.join(sb.dir, 'out-host-hit');
    const resHost = runPanel(
      sb,
      [
        '--prompt-file', hostPrompt,
        '--seat', 'grok:grok-4.7',
        '--out-dir', outHost,
        '--author-cmd', sb.authorStub,
      ],
    );
    assert.equal(resHost.status, 4, resHost.stderr);
    assert.equal(readCalls(sb.logDir).length, 0);
    assert.equal(fs.existsSync(outHost), false);
  } finally {
    sb.cleanup();
  }
});

test('failing, unparseable, or empty fleet directory exits 4 with zero spawns and zero writes', () => {
  for (const [label, scriptBody] of [
    ['failing', '#!/bin/sh\nexit 1\n'],
    ['bad_json', '#!/bin/sh\necho "not json"\nexit 0\n'],
    ['empty', '#!/bin/sh\necho \'{"members":[]}\'\nexit 0\n'],
  ]) {
    const sb = makeSandbox();
    try {
      fs.writeFileSync(sb.fleetBin, scriptBody, { mode: 0o755 });
      const promptFile = writePrompt(sb, 'clean.txt', 'Clean architecture question.\n');
      const outDir = path.join(sb.dir, `out-fleet-${label}`);
      const res = runPanel(sb, [
        '--prompt-file', promptFile,
        '--seat', 'grok:grok-4.7',
        '--out-dir', outDir,
        '--author-cmd', sb.authorStub,
      ]);
      assert.equal(res.status, 4, `${label}: expected exit 4, got ${res.status} (${res.stderr})`);
      assert.equal(readCalls(sb.logDir).length, 0);
      assert.equal(fs.existsSync(outDir), false);
    } finally {
      sb.cleanup();
    }
  }
});

test('glm seat, other CN seats, unknown runner, and unknown model are barred and never spawned; aliases resolve', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Compare lock strategies.\n');
    const outDir = path.join(sb.dir, 'out-barred');
    const res = runPanel(sb, [
      '--prompt-file', promptFile,
      '--seat', 'glm:glm-5.3',
      '--seat', 'kimi:kimi-code/k3',
      '--seat', 'bogus-runner:gpt-6.1-sol',
      '--seat', 'grok:unknown-mystery-model',
      '--seat', 'codex-cli:gpt-6.1-sol',
      '--seat', 'agy:carbon',
      '--out-dir', outDir,
      '--author-cmd', sb.authorStub,
    ]);
    assert.equal(res.status, 0, res.stderr);
    const panel = JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'), 'utf8'));
    assert.equal(panel.complete, true);
    assert.equal(panel.seats.length, 6);

    assert.equal(panel.seats[0].status, 'barred');
    assert.equal(panel.seats[1].status, 'barred');
    assert.equal(panel.seats[2].status, 'barred');
    assert.equal(panel.seats[3].status, 'barred');
    assert.equal(panel.seats[4].status, 'ok');
    assert.equal(panel.seats[5].status, 'ok');

    const calls = readCalls(sb.logDir);
    assert.equal(calls.length, 2);
    const pairs = calls.map((c) => `${c.runner}:${c.model}`).sort();
    assert.deepEqual(pairs, ['agy:gemini-4-carbon-high', 'codex:gpt-6.1-sol']);
  } finally {
    sb.cleanup();
  }
});

test('child env removes §2.5 base-url and model override vars set in parent', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Compare queue designs.\n');
    const outDir = path.join(sb.dir, 'out-scrub');
    const res = runPanel(
      sb,
      [
        '--prompt-file', promptFile,
        '--seat', 'grok:grok-4.7',
        '--out-dir', outDir,
        '--author-cmd', sb.authorStub,
      ],
      {
        ANTHROPIC_BASE_URL: 'https://parent.invalid/anthropic',
        ANTHROPIC_MODEL: 'claude-override',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'override-sonnet',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'override-haiku',
        OPENAI_BASE_URL: 'https://parent.invalid/openai',
        OPENAI_API_BASE: 'https://parent.invalid/openai-api',
      },
    );
    assert.equal(res.status, 0, res.stderr);
    const calls = readCalls(sb.logDir);
    assert.equal(calls.length, 1);
    const keys = new Set(calls[0].envKeys);
    for (const forbidden of [
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'OPENAI_BASE_URL',
      'OPENAI_API_BASE',
    ]) {
      assert.equal(keys.has(forbidden), false, `child env must not contain ${forbidden}`);
    }
  } finally {
    sb.cleanup();
  }
});

test('symlinked --out-dir is refused (with or without trailing slash)', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Clean prompt.\n');
    const realTarget = path.join(sb.dir, 'real-target');
    const linkDir = path.join(sb.dir, 'link-out');
    fs.mkdirSync(realTarget, { mode: 0o700 });
    fs.symlinkSync(realTarget, linkDir);

    for (const candidate of [linkDir, `${linkDir}/`]) {
      const res = runPanel(sb, [
        '--prompt-file', promptFile,
        '--seat', 'grok:grok-4.7',
        '--out-dir', candidate,
        '--author-cmd', sb.authorStub,
      ]);
      assert.notEqual(res.status, 0, 'symlinked out-dir must be refused');
      assert.equal(readCalls(sb.logDir).length, 0);
      assert.equal(fs.existsSync(path.join(realTarget, 'prompt.txt')), false);
    }
  } finally {
    sb.cleanup();
  }
});

test('path traversal ../x in a model name stays inside --out-dir and failed seat records rc', () => {
  const { safeOutPath } = require('./dispatch-panel');
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Clean prompt.\n');
    const outDir = path.join(sb.dir, 'nested', 'out-trav');
    const travOut = safeOutPath(outDir, 0, 'grok-4.7/../x');
    assert.equal(path.dirname(travOut), outDir);
    assert.equal(path.relative(outDir, travOut).startsWith('..'), false);
    assert.equal(path.isAbsolute(path.relative(outDir, travOut)), false);

    const res = runPanel(
      sb,
      [
        '--prompt-file', promptFile,
        '--seat', 'grok:grok-4.7/../x',
        '--seat', 'codex:gpt-6.1-sol',
        '--out-dir', outDir,
        '--author-cmd', sb.authorStub,
      ],
      {
        DP_TEST_FAILS: JSON.stringify({ 'gpt-6.1-sol': 3 }),
      },
    );
    assert.equal(res.status, 0, res.stderr);
    const panel = JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'), 'utf8'));
    assert.equal(panel.complete, true);
    assert.equal(panel.seats[0].status, 'barred');
    assert.equal(panel.seats[0].rc, null);
    assert.equal(panel.seats[0].out_path, null);
    assert.equal(panel.seats[0].bytes, 0);
    assert.equal(fs.existsSync(path.join(sb.dir, 'nested', 'x')), false);
    assert.equal(fs.existsSync(path.join(sb.dir, 'nested', 'x.out')), false);
    assert.equal(panel.seats[1].status, 'failed');
    assert.equal(panel.seats[1].error, 'simulated runner failure');
    assert.equal(panel.seats[1].rc, 3);
    assert.equal(panel.seats[1].out_path, null);
    assert.equal(panel.seats[1].bytes, 0);
  } finally {
    sb.cleanup();
  }
});

test('cross-runner model mismatch and unknown models on known runners are barred; valid runner models pass', () => {
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Compare model routing.\n');
    const outDir = path.join(sb.dir, 'out-runner-models');
    const res = runPanel(sb, [
      '--prompt-file', promptFile,
      '--seat', 'grok:gpt-6.1-sol',
      '--seat', 'codex:unknown-codex-model',
      '--seat', 'agy:unknown-agy-model',
      '--seat', 'claude-native:unknown-claude-model',
      '--seat', 'claude-native:opus',
      '--seat', 'agy:hydrogen',
      '--out-dir', outDir,
      '--author-cmd', sb.authorStub,
    ]);
    assert.equal(res.status, 0, res.stderr);
    const panel = JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'), 'utf8'));
    assert.equal(panel.complete, true);
    assert.equal(panel.seats.length, 6);
    assert.equal(panel.seats[0].status, 'barred');
    assert.equal(panel.seats[1].status, 'barred');
    assert.equal(panel.seats[2].status, 'barred');
    assert.equal(panel.seats[3].status, 'barred');
    assert.equal(panel.seats[4].status, 'ok');
    assert.equal(panel.seats[5].status, 'ok');

    const calls = readCalls(sb.logDir);
    assert.equal(calls.length, 2);
    const pairs = calls.map((c) => `${c.runner}:${c.model}`).sort();
    assert.deepEqual(pairs, ['agy:gemini-4-hydrogen-high', 'claude-native:opus']);
  } finally {
    sb.cleanup();
  }
});

test('non-ID string arrays in fleet host metadata do not become identifiers', () => {
  const { extractDirectoryIdentifiers } = require('./dispatch-panel');
  const directory = {
    hosts: [{
      info: {
        declared: { hostname: 'box-01', runners: ['claude', 'codex'], roles: ['worker'] },
        observed: { runners: ['claude', 'codex'], roles: ['worker'], details: [{ hostname: 'box-02' }] },
      },
    }],
  };
  assert.deepEqual(extractDirectoryIdentifiers(directory).sort(), ['box-01', 'box-02']);

  for (const allowed of [
    ['box-01'],
    { hostname: ['box-01'] },
    { hosts: ['box-01'] },
  ]) {
    assert.deepEqual(extractDirectoryIdentifiers(allowed), ['box-01']);
  }
  for (const nested of [
    { details: ['worker', { hostname: 'box-01' }] },
    [['worker'], { hostname: 'box-01' }],
    { hostname: [['worker'], { hostname: 'box-01' }] },
    { hosts: [['worker'], { hostname: 'box-01' }] },
  ]) {
    assert.deepEqual(extractDirectoryIdentifiers(nested), ['box-01']);
  }

  const sb = makeSandbox();
  try {
    fs.writeFileSync(sb.fleetBin, `#!/usr/bin/env node
if (process.argv[2] === 'directory') {
  process.stdout.write(${JSON.stringify(JSON.stringify(directory))} + '\\n');
  process.exit(0);
}
process.exit(1);
`, { mode: 0o755 });
    const cleanPrompt = writePrompt(sb, 'clean.txt', 'Compare claude and codex runners for the worker role.\n');
    const clean = runPanel(sb, [
      '--prompt-file', cleanPrompt,
      '--seat', 'grok:grok-4.7',
      '--out-dir', path.join(sb.dir, 'out-clean'),
      '--author-cmd', sb.authorStub,
    ]);
    assert.equal(clean.status, 0, clean.stderr);
    assert.equal(readCalls(sb.logDir).length, 1);

    const leakedPrompt = writePrompt(sb, 'leaked.txt', 'Check box-01 status.\n');
    const outLeak = path.join(sb.dir, 'out-leak');
    const leaked = runPanel(sb, [
      '--prompt-file', leakedPrompt,
      '--seat', 'grok:grok-4.7',
      '--out-dir', outLeak,
      '--author-cmd', sb.authorStub,
    ]);
    assert.equal(leaked.status, 4, leaked.stderr);
    assert.match(leaked.stderr, /fleet_directory_identifier/);
    assert.equal(fs.existsSync(path.join(outLeak, 'prompt.txt')), false);
    assert.equal(readCalls(sb.logDir).length, 1, 'hostname refusal must not spawn a seat');
  } finally {
    sb.cleanup();
  }
});

test('real fleet directory --json shape extracts identifiers recursively, splits @, excludes structural keys, handles empty & --json fallback', () => {
  const { extractDirectoryIdentifiers } = require('./dispatch-panel');

  const realDirectory = {
    members: [
      {
        member: 'member-delta@courier-bravo',
        courier: 'courier-bravo',
        namespace: 'ns-ops',
        state: 'online',
        channels: ['ops-chat'],
        message_kinds: ['chat', 'dispatch'],
      },
    ],
    hosts: [
      {
        namespace: 'ns-ops',
        courier: 'courier-bravo',
        info: {
          declared: { hostname: 'declared-box-01', host: 'declared-host-01' },
          observed: { name: 'observed-node-01' },
          labels: { tier: 'compute' },
        },
        courier_online: true,
        liveness: 'alive',
        tasks: false,
      },
    ],
  };

  const ids = extractDirectoryIdentifiers(realDirectory);
  for (const expected of [
    'member-delta@courier-bravo',
    'member-delta',
    'courier-bravo',
    'ns-ops',
    'declared-box-01',
    'declared-host-01',
    'observed-node-01',
  ]) {
    assert.ok(ids.includes(expected), `missing identifier: ${expected}`);
  }
  for (const forbidden of [
    'members', 'hosts', 'couriers', 'entries', 'directory', 'peers', 'nodes',
    'schema', 'info', 'declared', 'observed', 'labels', 'channels', 'message_kinds', 'state',
    'online', 'alive', 'ops-chat', 'chat', 'dispatch', 'compute',
  ]) {
    assert.equal(ids.includes(forbidden), false, `structural/non-id key leaked as identifier: ${forbidden}`);
  }
  assert.deepEqual(extractDirectoryIdentifiers({ members: [], hosts: [] }), []);

  // End-to-end: clean prompt with structural words passes; identifier prompt and empty dir exit 4
  const sb = makeSandbox();
  try {
    fs.writeFileSync(
      sb.fleetBin,
      `#!/usr/bin/env node
'use strict';
if (process.argv[2] === 'directory' && process.argv.includes('--json')) {
  process.stderr.write("unknown option '--json'\\n");
  process.exit(1);
}
if (process.argv[2] === 'directory') {
  const mode = process.env.DP_TEST_DIR_MODE || 'real';
  if (mode === 'empty') {
    process.stdout.write(JSON.stringify({ members: [], hosts: [] }) + '\\n');
  } else {
    process.stdout.write(${JSON.stringify(JSON.stringify(realDirectory))} + '\\n');
  }
  process.exit(0);
}
process.exit(1);
`,
      { mode: 0o755 },
    );

    const structuralPrompt = writePrompt(
      sb,
      'structural.txt',
      'Compare members, hosts, info, declared, observed, labels, channels, message_kinds, state, schema.\n',
    );
    const outClean = path.join(sb.dir, 'out-real-dir');
    const rClean = runPanel(sb, [
      '--prompt-file', structuralPrompt,
      '--seat', 'grok:grok-4.7',
      '--out-dir', outClean,
      '--author-cmd', sb.authorStub,
    ]);
    assert.equal(rClean.status, 0, rClean.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(outClean, 'panel.json'), 'utf8')).seats[0].status, 'ok');

    const leakedPrompt = writePrompt(sb, 'leaked.txt', 'Check observed-node-01 status.\n');
    const outLeak = path.join(sb.dir, 'out-leak-dir');
    const rLeak = runPanel(sb, [
      '--prompt-file', leakedPrompt,
      '--seat', 'grok:grok-4.7',
      '--out-dir', outLeak,
      '--author-cmd', sb.authorStub,
    ]);
    assert.equal(rLeak.status, 4, rLeak.stderr);
    assert.match(rLeak.stderr, /fleet_directory_identifier/);
    assert.equal(fs.existsSync(path.join(outLeak, 'prompt.txt')), false);
    assert.equal(readCalls(sb.logDir).length, 1, 'only the clean prompt may spawn a seat');

    const outEmpty = path.join(sb.dir, 'out-empty-dir');
    const rEmpty = runPanel(
      sb,
      [
        '--prompt-file', structuralPrompt,
        '--seat', 'grok:grok-4.7',
        '--out-dir', outEmpty,
        '--author-cmd', sb.authorStub,
      ],
      { DP_TEST_DIR_MODE: 'empty' },
    );
    assert.equal(rEmpty.status, 4);
    assert.equal(fs.existsSync(path.join(outEmpty, 'prompt.txt')), false);
    assert.equal(readCalls(sb.logDir).length, 1, 'empty directory must not spawn a seat');
  } finally {
    sb.cleanup();
  }
});

test('extractSeatOutput marks status "authored" failed when raw_log is missing, empty, unreadable, or non-regular file', () => {
  const { extractSeatOutput } = require('./dispatch-panel');
  const sb = makeSandbox();
  try {
    const emptyFile = path.join(sb.dir, 'empty.txt');
    fs.writeFileSync(emptyFile, '');
    const subDir = path.join(sb.dir, 'subdir');
    fs.mkdirSync(subDir);
    const validFile = path.join(sb.dir, 'valid.txt');
    fs.writeFileSync(validFile, 'valid output\n');

    for (const payload of [
      JSON.stringify({ status: 'authored' }),
      JSON.stringify({ status: 'authored', raw_log: '' }),
      JSON.stringify({ status: 'authored', raw_log: null }),
      JSON.stringify({ status: 'authored', raw_log: path.join(sb.dir, 'does-not-exist.txt') }),
      JSON.stringify({ status: 'authored', raw_log: subDir }),
      JSON.stringify({ status: 'authored', raw_log: emptyFile }),
    ]) {
      const res = extractSeatOutput(Buffer.from(payload, 'utf8'));
      assert.equal(res.envelopeOk, false, `expected envelopeOk=false for ${payload}`);
      assert.equal(res.bytesBuf.length, 0);
    }

    const good = extractSeatOutput(Buffer.from(JSON.stringify({ status: 'authored', raw_log: validFile }), 'utf8'));
    assert.equal(good.envelopeOk, true);
    assert.equal(good.bytesBuf.toString('utf8'), 'valid output\n');

    // End-to-end panel: stub author prints authored envelope with missing raw_log
    const badAuthor = path.join(sb.binDir, 'bad-raw-log-author.js');
    fs.writeFileSync(
      badAuthor,
      `#!/usr/bin/env node
process.stdout.write(JSON.stringify({ status: 'authored', raw_log: '' }) + '\\n');
process.exit(0);
`,
      { mode: 0o755 },
    );
    const promptFile = writePrompt(sb, 'clean-env.txt', 'Check envelope error handling.\n');
    const outDir = path.join(sb.dir, 'out-bad-env');
    const rPanel = runPanel(sb, [
      '--prompt-file', promptFile,
      '--seat', 'grok:grok-4.7',
      '--out-dir', outDir,
      '--author-cmd', badAuthor,
    ]);
    assert.equal(rPanel.status, 0, rPanel.stderr);
    const panel = JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'), 'utf8'));
    assert.equal(panel.seats[0].status, 'failed');
    assert.equal(panel.seats[0].bytes, 0);
    assert.equal(panel.seats[0].out_path, null);
  } finally {
    sb.cleanup();
  }
});

test('codex:astra resolves to gpt-6.2-astra and explicit codex:gpt-6-astra remains allowed', () => {
  const { resolveSeat } = require('./dispatch-panel');
  const sb = makeSandbox();
  try {
    const promptFile = writePrompt(sb, 'clean.txt', 'Compare panel seat alias routing.\n');

    const aliasSeat = resolveSeat(
      { raw: 'codex:astra', runner: 'codex', model: 'astra', effort: '' },
      promptFile,
    );
    assert.equal(aliasSeat.allowed, true);
    assert.equal(aliasSeat.runner, 'codex');
    assert.equal(aliasSeat.model, 'gpt-6.2-astra');

    const explicitRollbackSeat = resolveSeat(
      { raw: 'codex:gpt-6-astra', runner: 'codex', model: 'gpt-6-astra', effort: '' },
      promptFile,
    );
    assert.equal(explicitRollbackSeat.allowed, true);
    assert.equal(explicitRollbackSeat.runner, 'codex');
    assert.equal(explicitRollbackSeat.model, 'gpt-6-astra');

    const outDir = path.join(sb.dir, 'out-astra-alias');
    const res = runPanel(sb, [
      '--prompt-file', promptFile,
      '--seat', 'codex:astra',
      '--seat', 'codex:gpt-6-astra',
      '--allow-same-family',
      '--out-dir', outDir,
      '--author-cmd', sb.authorStub,
    ]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stderr, /warning: same_family_vote.*codex:astra.*codex:gpt-6-astra/);
    const panel = JSON.parse(fs.readFileSync(path.join(outDir, 'panel.json'), 'utf8'));
    assert.equal(panel.complete, true);
    assert.equal(panel.seats.length, 2);
    assert.equal(panel.seats[0].seat, 'codex:astra');
    assert.equal(panel.seats[0].status, 'ok');
    assert.equal(fs.readFileSync(panel.seats[0].out_path, 'utf8'), 'response-from:codex:gpt-6.2-astra\n');
    assert.equal(panel.seats[1].seat, 'codex:gpt-6-astra');
    assert.equal(panel.seats[1].status, 'ok');
    assert.equal(fs.readFileSync(panel.seats[1].out_path, 'utf8'), 'response-from:codex:gpt-6-astra\n');

    const calls = readCalls(sb.logDir);
    assert.equal(calls.length, 2);
    const pairs = calls.map((c) => `${c.runner}:${c.model}`).sort();
    assert.deepEqual(pairs, ['codex:gpt-6-astra', 'codex:gpt-6.2-astra']);
  } finally {
    sb.cleanup();
  }
});
