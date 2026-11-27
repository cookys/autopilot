'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.resolve(__dirname, 'knowledge-review.js');
const HOOK_SRC = path.resolve(__dirname, '..', 'hooks', 'git', 'pre-commit');

function runCli(args, { home, env = {}, input = undefined, cwd = undefined } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    input,
    cwd,
    env: {
      ...process.env,
      HOME: home,
      CODEFORGE_SELF_SEAT: '',
      CODEFORGE_DATA_DIR: '',
      ...env,
    },
    timeout: 15000,
  });
}

function makeCandidate(laneHash, overrides = {}) {
  const base = {
    topic: 'git-hooks',
    pitfall_type: 'missing-guard',
    solution_type: 'add-check',
    tool: 'node',
    repo: 'autopilot-dev',
    evidence: {
      session_id: 'sess-001',
      time_start: '2026-11-27T10:00:00Z',
      time_end: '2026-11-27T10:05:00Z',
      lane_hash: laneHash,
    },
  };
  return {
    ...base,
    ...overrides,
    evidence: {
      ...base.evidence,
      ...(overrides.evidence || {}),
    },
  };
}

function withTempHome(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kr-test-'));
  try {
    return fn(home);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

test('strict validation rejects free text, extra key, missing key, and foreign lane', () => {
  withTempHome((home) => {
    const lane = 'aabbccddeeff';
    const foreign = '112233445566';

    const valid = makeCandidate(lane);
    const freeTextTopic = makeCandidate(lane, { topic: 'Free Text With Spaces!' });
    const extraKey = { ...makeCandidate(lane), extra: 'nope' };
    const missingKey = makeCandidate(lane);
    delete missingKey.tool;
    const foreignLane = makeCandidate(foreign);

    const payload = JSON.stringify([valid, freeTextTopic, extraKey, missingKey, foreignLane]);
    const res = runCli(['add', '--lane', lane], { home, input: payload });
    assert.equal(res.status, 0, res.stderr);
    const counts = JSON.parse(res.stdout.trim());
    assert.deepEqual(counts, { added: 1, duplicate: 0, rejected: 4 });
  });
});

test('store directory modes 0700 and file modes 0600, plus deduplication and count 2', () => {
  withTempHome((home) => {
    const lane = 'aabbccddeeff';
    const c1 = makeCandidate(lane, { evidence: { session_id: 'sess-alpha' } });
    const c2 = makeCandidate(lane, { evidence: { session_id: 'sess-beta' } });

    const r1 = runCli(['add', '--lane', lane], { home, input: JSON.stringify([c1]) });
    assert.equal(r1.status, 0, r1.stderr);
    assert.deepEqual(JSON.parse(r1.stdout.trim()), { added: 1, duplicate: 0, rejected: 0 });

    // Re-add same session+key -> duplicate
    const rDup = runCli(['add', '--lane', lane], { home, input: JSON.stringify([c1]) });
    assert.equal(rDup.status, 0, rDup.stderr);
    assert.deepEqual(JSON.parse(rDup.stdout.trim()), { added: 0, duplicate: 1, rejected: 0 });

    // Add second session with same key -> count 2
    const r2 = runCli(['add', '--lane', lane], { home, input: JSON.stringify([c2]) });
    assert.equal(r2.status, 0, r2.stderr);
    assert.deepEqual(JSON.parse(r2.stdout.trim()), { added: 1, duplicate: 0, rejected: 0 });

    const listRes = runCli(['list', '--lane', lane, '--json'], { home });
    assert.equal(listRes.status, 0, listRes.stderr);
    const listed = JSON.parse(listRes.stdout.trim());
    assert.equal(listed.length, 1);
    assert.equal(listed[0].count, 2);
    assert.equal(listed[0].status, 'pending');

    const root = path.join(home, '.autopilot', 'knowledge-candidates');
    const laneDir = path.join(root, lane);
    const keyDir = path.join(laneDir, listed[0].key);
    assert.equal(fs.statSync(root).mode & 0o777, 0o700);
    assert.equal(fs.statSync(laneDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(keyDir).mode & 0o777, 0o700);

    const files = fs.readdirSync(keyDir);
    assert.equal(files.length, 2);
    for (const f of files) {
      assert.equal(fs.statSync(path.join(keyDir, f)).mode & 0o777, 0o600);
    }
  });
});

test('list never shows another lane and --all-seats exits 2', () => {
  withTempHome((home) => {
    const laneA = 'aaaaaaaaaaaa';
    const laneB = 'bbbbbbbbbbbb';

    runCli(['add', '--lane', laneA], { home, input: JSON.stringify([makeCandidate(laneA)]) });
    runCli(['add', '--lane', laneB], { home, input: JSON.stringify([makeCandidate(laneB, { topic: 'other-topic' })]) });

    const listA = runCli(['list', '--lane', laneA, '--json'], { home });
    assert.equal(listA.status, 0);
    const itemsA = JSON.parse(listA.stdout.trim());
    assert.equal(itemsA.length, 1);
    assert.equal(itemsA[0].topic, 'git-hooks');

    const allSeats = runCli(['list', '--all-seats'], { home });
    assert.equal(allSeats.status, 2);
  });
});

test('approve and reject update decision.json and filterable via --status', () => {
  withTempHome((home) => {
    const seatName = 'seat-one';
    const lane = crypto.createHash('sha256').update(seatName, 'utf8').digest('hex').slice(0, 12);

    runCli(['add'], {
      home,
      env: { CODEFORGE_SELF_SEAT: seatName },
      input: JSON.stringify([makeCandidate(lane)]),
    });

    const list1 = JSON.parse(runCli(['list', '--json'], { home, env: { CODEFORGE_SELF_SEAT: seatName } }).stdout);
    const key = list1[0].key;

    const app = runCli(['approve', key], { home, env: { CODEFORGE_SELF_SEAT: seatName } });
    assert.equal(app.status, 0, app.stderr);

    const listApproved = JSON.parse(runCli(['list', '--json', '--status', 'approved'], { home, env: { CODEFORGE_SELF_SEAT: seatName } }).stdout);
    assert.equal(listApproved.length, 1);
    assert.equal(listApproved[0].status, 'approved');

    const rej = runCli(['reject', key], { home, env: { CODEFORGE_SELF_SEAT: seatName } });
    assert.equal(rej.status, 0, rej.stderr);

    const listRejected = JSON.parse(runCli(['list', '--json', '--status', 'rejected'], { home, env: { CODEFORGE_SELF_SEAT: seatName } }).stdout);
    assert.equal(listRejected.length, 1);
    assert.equal(listRejected[0].status, 'rejected');

    const badKey = runCli(['approve', 'not-a-valid-key'], { home, env: { CODEFORGE_SELF_SEAT: seatName } });
    assert.equal(badKey.status, 2);
  });
});

test('scan-staged blocks pending/rejected key or session_id, passes after approve, passes with no store', () => {
  withTempHome((home) => {
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo, { recursive: true });
    spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repo, encoding: 'utf8' });

    // No store -> exit 0
    fs.writeFileSync(path.join(repo, 'a.txt'), 'clean\n');
    spawnSync('git', ['add', 'a.txt'], { cwd: repo, encoding: 'utf8' });
    const noStore = runCli(['scan-staged'], { home, cwd: repo });
    assert.equal(noStore.status, 0);

    const lane = '1234567890ab';
    const sessId = 'unique-session-xyz-999';
    runCli(['add', '--lane', lane], {
      home,
      input: JSON.stringify([makeCandidate(lane, { evidence: { session_id: sessId } })]),
    });
    const key = JSON.parse(runCli(['list', '--lane', lane, '--json'], { home }).stdout)[0].key;

    // Stage file containing pending key -> exit 1
    fs.writeFileSync(path.join(repo, 'b.txt'), `leaked ${key}\n`);
    spawnSync('git', ['add', 'b.txt'], { cwd: repo, encoding: 'utf8' });
    const blockKey = runCli(['scan-staged', '--lane', lane], { home, cwd: repo });
    assert.equal(blockKey.status, 1);
    assert.match(blockKey.stderr, new RegExp(key));

    // Stage file containing pending session_id -> exit 1
    fs.writeFileSync(path.join(repo, 'b.txt'), `leaked ${sessId}\n`);
    spawnSync('git', ['add', 'b.txt'], { cwd: repo, encoding: 'utf8' });
    const blockSess = runCli(['scan-staged', '--lane', lane], { home, cwd: repo });
    assert.equal(blockSess.status, 1);

    // Approve -> passes
    assert.equal(runCli(['approve', key, '--lane', lane], { home }).status, 0);
    const passApproved = runCli(['scan-staged', '--lane', lane], { home, cwd: repo });
    assert.equal(passApproved.status, 0);

    // Reject -> blocks again
    assert.equal(runCli(['reject', key, '--lane', lane], { home }).status, 0);
    const blockRejected = runCli(['scan-staged', '--lane', lane], { home, cwd: repo });
    assert.equal(blockRejected.status, 1);
  });
});

test('real hooks/git/pre-commit blocks commit in a temp repo', () => {
  withTempHome((home) => {
    const repo = path.join(home, 'repo-hook');
    fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(repo, '.git', 'hooks'), { recursive: true });

    spawnSync('git', ['init'], { cwd: repo, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo, encoding: 'utf8' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: repo, encoding: 'utf8' });

    fs.copyFileSync(SCRIPT, path.join(repo, 'scripts', 'knowledge-review.js'));
    const hookDest = path.join(repo, '.git', 'hooks', 'pre-commit');
    fs.copyFileSync(HOOK_SRC, hookDest);
    fs.chmodSync(hookDest, 0o755);

    const lane = 'fedcba987654';
    runCli(['add', '--lane', lane], { home, input: JSON.stringify([makeCandidate(lane)]) });
    const key = JSON.parse(runCli(['list', '--lane', lane, '--json'], { home }).stdout)[0].key;

    fs.writeFileSync(path.join(repo, 'leak.txt'), `contains ${key}\n`);
    spawnSync('git', ['add', 'leak.txt'], { cwd: repo, encoding: 'utf8' });

    const commitRes = spawnSync('git', ['commit', '-m', 'test leak'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        HOME: home,
        CODEFORGE_SELF_SEAT: '',
        CODEFORGE_DATA_DIR: '',
      },
      timeout: 15000,
    });
    assert.notEqual(commitRes.status, 0);
    assert.match(commitRes.stderr, new RegExp(key));
  });
});
