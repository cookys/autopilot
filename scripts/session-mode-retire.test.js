'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const ALLOWLIST_PATH = path.join(__dirname, 'session-mode-retire-allowlist.txt');
const RETIRE_PATTERN = /for .*marker.* in .*\.json|node -e.*session-mode|check_session_mode_gate|marker_dir.*\.json|session-mode\.js.*(read|sweep)|readFileSync.*marker|readdirSync.*marker/;

function loadAllowlist() {
  const raw = fs.readFileSync(ALLOWLIST_PATH, 'utf8');
  const allowedPaths = new Set();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = line.split('\t');
    assert.equal(parts.length, 3, `allowlist line must have 3 tab-separated fields: ${line}`);
    allowedPaths.add(parts[0]);
  }
  return allowedPaths;
}

function scanShellFiles(rootDir) {
  const out = execFileSync(
    'git',
    ['grep', '-n', '-E', RETIRE_PATTERN.source, '--', 'scripts/*.sh', 'scripts/**/*.sh', 'hooks/*.sh', 'hooks/**/*.sh'],
    { cwd: rootDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith('evals/skill-onoff/packs/'));
}

test('dispatch-hetero.sh check_session_mode_gate Node heredoc passes node --check', () => {
  const filePath = path.join(REPO_ROOT, 'scripts', 'dispatch-hetero.sh');
  const content = fs.readFileSync(filePath, 'utf8');
  const fnStart = content.indexOf('check_session_mode_gate()');
  assert.notEqual(fnStart, -1, 'check_session_mode_gate() not found');
  const heredocStart = content.indexOf("<<'NODE'", fnStart);
  assert.notEqual(heredocStart, -1, "heredoc <<'NODE' not found in check_session_mode_gate()");
  const bodyStart = content.indexOf('\n', heredocStart) + 1;
  const bodyEnd = content.indexOf('\nNODE\n', bodyStart);
  assert.notEqual(bodyEnd, -1, 'closing NODE delimiter not found');
  const jsBody = content.slice(bodyStart, bodyEnd);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heredoc-check-'));
  try {
    const tmpFile = path.join(tmpDir, 'heredoc.js');
    fs.writeFileSync(tmpFile, jsBody, 'utf8');
    const res = spawnSync(process.execPath, ['--check', tmpFile], { encoding: 'utf8' });
    assert.equal(res.status, 0, `node --check failed: ${res.stderr}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('retirement grep check matches only allowlisted paths', () => {
  const allowedPaths = loadAllowlist();
  let hits = [];
  try {
    hits = scanShellFiles(REPO_ROOT);
  } catch (err) {
    if (err.status !== 1) throw err;
  }
  const unexpected = hits.filter((line) => {
    const filePath = line.split(':')[0];
    return !allowedPaths.has(filePath);
  });
  assert.deepEqual(unexpected, [], `Unexpected retirement grep hits:\n${unexpected.join('\n')}`);
});

test('negative control: unallowlisted old caller fails retirement check', () => {
  const allowedPaths = loadAllowlist();
  const fakeHit = 'scripts/legacy-caller.sh:10:for m in "$marker_dir"/*.json; do';
  const filePath = fakeHit.split(':')[0];
  assert.equal(allowedPaths.has(filePath), false);
  assert.match(fakeHit, RETIRE_PATTERN);
});

test('no caller outside session-mode.js defines or calls unexpiredMarkers or markerFilesOf', () => {
  let out = '';
  try {
    out = execFileSync(
      'git',
      ['grep', '-n', '-E', '\\b(unexpiredMarkers|markerFilesOf)\\b', '--', 'src/', 'scripts/', 'hooks/'],
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (err) {
    if (err.status !== 1) throw err;
  }
  const hits = out
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.startsWith('scripts/session-mode.js:'))
    .filter((line) => !line.startsWith('scripts/session-mode-retire.test.js:'));
  assert.deepEqual(hits, [], `Unexpected references to retired helpers:\n${hits.join('\n')}`);
});
