'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS_DIR = __dirname;
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..');
const DISPATCH_AUTHOR_SH = path.join(SCRIPTS_DIR, 'dispatch-author.sh');
const DISPATCH_HETERO_SH = path.join(SCRIPTS_DIR, 'dispatch-hetero.sh');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-marker-scan-'));
const now = Date.now();
let fixtureSeq = 0;

const EXPIRED_GROUPS = [
  [2000, 25 * 3600000, null, false],
  [2000, 3600000, null, false],
  [500, 3600000, 'l5', true],
  [500, 25 * 3600000, 'l3', false],
];

function createMarkerDir(groups, extra = []) {
  const dir = path.join(sandbox, `markers-${fixtureSeq++}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [count, age, level, campaign] of groups) {
    for (let i = 0; i < count; i++) {
      const sid = `s${age}-${level}-${campaign}-${i}`;
      fs.writeFileSync(
        path.join(dir, `${sid}.json`),
        JSON.stringify({
          session_id: sid,
          level,
          repo_root: REPO_ROOT,
          started_at: new Date(now - age - 3600000).toISOString(),
          expires_at: new Date(now - age).toISOString(),
          campaign_roots: campaign ? ['run'] : [],
        })
      );
    }
  }
  for (const [name, content] of extra) {
    fs.writeFileSync(
      path.join(dir, name),
      typeof content === 'string' ? content : JSON.stringify(content)
    );
  }
  return dir;
}

function extractFunction(scriptPath, fnName) {
  const src = fs.readFileSync(scriptPath, 'utf8');
  const start = src.indexOf(`${fnName}() {`);
  assert.notEqual(start, -1, `Could not find ${fnName}() in ${scriptPath}`);
  const lines = src.slice(start).split('\n');
  const body = [];
  for (const line of lines) {
    body.push(line);
    if (line === '}') break;
  }
  return body.join('\n');
}

function createNodeWrapper({ spyDir } = {}) {
  const binDir = path.join(sandbox, `bin-${fixtureSeq++}`);
  fs.mkdirSync(binDir, { recursive: true });
  const countFile = path.join(binDir, 'node-count.txt');
  const spyCountFile = path.join(binDir, 'spy-reads.txt');
  const spyScript = path.join(binDir, 'fs-spy.js');

  if (spyDir) {
    fs.writeFileSync(
      spyScript,
      `'use strict';
const fs = require('fs');
const path = require('path');
const targetDir = path.resolve(${JSON.stringify(spyDir)});
const outFile = ${JSON.stringify(spyCountFile)};
const origReadFileSync = fs.readFileSync;
fs.readFileSync = function(p, ...args) {
  if (typeof p === 'string') {
    const resolved = path.resolve(p);
    if (resolved === targetDir || resolved.startsWith(targetDir + path.sep)) {
      fs.appendFileSync(outFile, resolved + '\\n');
    }
  }
  return origReadFileSync.call(this, p, ...args);
};
`
    );
  }

  const wrapperPath = path.join(binDir, 'node');
  const requireArg = spyDir ? `--require ${JSON.stringify(spyScript)} ` : '';
  fs.writeFileSync(
    wrapperPath,
    `#!/usr/bin/env bash
echo 1 >> ${JSON.stringify(countFile)}
exec ${JSON.stringify(process.execPath)} ${requireArg}"$@"
`,
    { mode: 0o755 }
  );

  return {
    binDir,
    getNodeCount() {
      if (!fs.existsSync(countFile)) return 0;
      return fs.readFileSync(countFile, 'utf8').trim().split('\n').filter(Boolean).length;
    },
    getSpyReadCount() {
      if (!fs.existsSync(spyCountFile)) return 0;
      return fs.readFileSync(spyCountFile, 'utf8').trim().split('\n').filter(Boolean).length;
    },
    resetCounts() {
      if (fs.existsSync(countFile)) fs.unlinkSync(countFile);
      if (fs.existsSync(spyCountFile)) fs.unlinkSync(spyCountFile);
    },
  };
}

function runGate(scriptPath, markerDir, wrapper, extraEnv = {}) {
  const fnBody = extractFunction(scriptPath, 'check_session_mode_gate');
  const bashScript = `
set -uo pipefail
REPO_ROOT=${JSON.stringify(REPO_ROOT)}
_AUTHOR_SELF_DIR=${JSON.stringify(SCRIPTS_DIR)}
SELF_DIR=${JSON.stringify(SCRIPTS_DIR)}
die_precondition() { echo "DIE:$*" >&2; exit 2; }
${fnBody}
check_session_mode_gate
`;
  return spawnSync('bash', ['-c', bashScript], {
    cwd: REPO_ROOT,
    env: {
      PATH: `${wrapper.binDir}:${process.env.PATH}`,
      HOME: sandbox,
      AUTOPILOT_SESSION_MODE_DIR: markerDir,
      AUTOPILOT_SESSION_ID: 'own-session-id',
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

test('dispatch-author.sh check_session_mode_gate: 5000 expired markers cleared in 1 node process, 2nd run reads 0', () => {
  const dir = createMarkerDir(EXPIRED_GROUPS);
  assert.equal(fs.readdirSync(dir).length, 5000);

  const wrapper = createNodeWrapper({ spyDir: dir });

  const first = runGate(DISPATCH_AUTHOR_SH, dir, wrapper);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(wrapper.getNodeCount(), 1, 'first run must spawn exactly 1 node process');
  assert.equal(fs.readdirSync(dir).length, 0, 'all 5000 expired markers must be unlinked');

  wrapper.resetCounts();

  const second = runGate(DISPATCH_AUTHOR_SH, dir, wrapper);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(wrapper.getNodeCount(), 1, 'second run must spawn exactly 1 node process');
  assert.ok(wrapper.getSpyReadCount() <= 5, `expected <= 5 marker readFileSync calls, got ${wrapper.getSpyReadCount()}`);
  assert.equal(wrapper.getSpyReadCount(), 0, 'second run must read 0 marker files');
});

test('dispatch-author.sh check_session_mode_gate: repo-wide gate rejects another session l5 marker', () => {
  const dir = createMarkerDir([], [
    [
      'other-session.json',
      {
        session_id: 'other-session-id',
        level: 'l5',
        repo_root: REPO_ROOT,
        started_at: new Date(now - 60000).toISOString(),
        expires_at: new Date(now + 3600000).toISOString(),
      },
    ],
  ]);
  const wrapper = createNodeWrapper();
  const res = runGate(DISPATCH_AUTHOR_SH, dir, wrapper);
  assert.notEqual(res.status, 0, 'gate must block on another session live l5 marker');
  assert.match(res.stderr, /session-mode=l5/);
});

test('dispatch-hetero.sh check_session_mode_gate: 5000 expired markers validated in 1 node process and swept to 0', () => {
  const dir = createMarkerDir(EXPIRED_GROUPS);
  assert.equal(fs.readdirSync(dir).length, 5000);

  const wrapper = createNodeWrapper();
  const res = runGate(DISPATCH_HETERO_SH, dir, wrapper);
  assert.equal(res.status, 0, res.stderr);
  // 1 node process for batch validation + 1 node process for `session-mode.js sweep --max 0 --grace-ms 0`
  assert.equal(wrapper.getNodeCount(), 2, 'must spawn 1 node for validation and 1 for sweep');
  assert.equal(fs.readdirSync(dir).length, 0, 'sweep must converge to 0 remaining markers');
});

test('dispatch-hetero.sh check_session_mode_gate: first-offender-wins with live l5 and invalid marker', () => {
  const dir = createMarkerDir([], [
    [
      'a-live-l5.json',
      {
        session_id: 'other-session-id',
        level: 'l5',
        repo_root: REPO_ROOT,
        started_at: new Date(now - 60000).toISOString(),
        expires_at: new Date(now + 3600000).toISOString(),
      },
    ],
    ['b-invalid.json', '{not-valid-json'],
  ]);
  const wrapper = createNodeWrapper();
  const res = runGate(DISPATCH_HETERO_SH, dir, wrapper);
  assert.notEqual(res.status, 0, 'gate must fail closed');
  assert.match(res.stderr, /session-mode=l5/, 'first offender (a-live-l5.json) must be reported');

  const dir2 = createMarkerDir([], [
    ['a-invalid.json', '{not-valid-json'],
    [
      'b-live-l5.json',
      {
        session_id: 'other-session-id',
        level: 'l5',
        repo_root: REPO_ROOT,
        started_at: new Date(now - 60000).toISOString(),
        expires_at: new Date(now + 3600000).toISOString(),
      },
    ],
  ]);
  const wrapper2 = createNodeWrapper();
  const res2 = runGate(DISPATCH_HETERO_SH, dir2, wrapper2);
  assert.notEqual(res2.status, 0, 'gate must fail closed on invalid marker');
  assert.match(res2.stderr, /invalid authoritative session-mode marker/, 'first offender (a-invalid.json) must be reported');
});
