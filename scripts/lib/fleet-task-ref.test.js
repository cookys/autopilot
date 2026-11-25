#!/usr/bin/env node
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  findTaskId,
  checkTaskOpen,
  resolveParentTaskId,
  resolvePmGate,
  emitProgressFailSoft,
} = require('./fleet-task-ref.js');

const SAMPLE_ID = '01M7R609WK44HJP629E6C93Q9N';
const SECOND_ID = '01M7R609WK44HJP629E6C93Q9P';

function withTempStub(scriptBody, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-task-ref-test-'));
  const stub = path.join(dir, 'fleet-stub.sh');
  fs.writeFileSync(stub, `#!/usr/bin/env bash\n${scriptBody}\n`, { mode: 0o755 });
  const prev = process.env.FLEET_BIN;
  process.env.FLEET_BIN = stub;
  try {
    return fn(stub);
  } finally {
    if (prev === undefined) delete process.env.FLEET_BIN;
    else process.env.FLEET_BIN = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('findTaskId extracts first Fleet-Task line ULID', () => {
  const text = `Engine: claude/opus\nFleet-Task: ${SAMPLE_ID}\nFleet-Task: ${SECOND_ID}\n`;
  assert.equal(findTaskId(text), SAMPLE_ID);
});

test('findTaskId ignores bare ULIDs and CRLF is normalized', () => {
  const bare = `Message-Id: ${SAMPLE_ID}\nSomething ${SECOND_ID}\n`;
  assert.equal(findTaskId(bare), null);

  const crlf = `Lane: autopilot\r\nFleet-Task:   ${SAMPLE_ID} \r\n`;
  assert.equal(findTaskId(crlf), SAMPLE_ID);
});

test('findTaskId rejects non-Crockford letters and inline mid-line occurrences', () => {
  assert.equal(findTaskId(`Prefix Fleet-Task: ${SAMPLE_ID}`), null);
  assert.equal(findTaskId('Fleet-Task: 01M7R609WK44HJP629E6C93Q9I'), null); // I forbidden in Crockford
  assert.equal(findTaskId('Fleet-Task: 01M7R609WK44HJP629E6C93Q9L'), null); // L forbidden
  assert.equal(findTaskId('Fleet-Task: 01M7R609WK44HJP629E6C93Q9O'), null); // O forbidden
  assert.equal(findTaskId('Fleet-Task: 01M7R609WK44HJP629E6C93Q9U'), null); // U forbidden
  assert.equal(findTaskId(null), null);
});

test('checkTaskOpen returns open for active statuses', () => {
  withTempStub('printf \'{"id":"%s","status":"in_progress"}\\n\' "$3"', () => {
    assert.deepEqual(checkTaskOpen(SAMPLE_ID), { state: 'open' });
  });
});

test('checkTaskOpen returns closed for done, failed, and cancelled', () => {
  for (const status of ['done', 'failed', 'cancelled']) {
    withTempStub(`printf '{"id":"%s","status":"${status}"}\\n' "$3"`, () => {
      assert.deepEqual(checkTaskOpen(SAMPLE_ID), { state: 'closed' });
    });
  }
});

test('checkTaskOpen returns not_found for not_found JSON or exit error', () => {
  withTempStub('printf \'{"error":"not_found"}\\n\'; exit 1', () => {
    assert.deepEqual(checkTaskOpen(SAMPLE_ID), { state: 'not_found' });
  });
  withTempStub('echo "task not found" >&2; exit 1', () => {
    assert.deepEqual(checkTaskOpen(SAMPLE_ID), { state: 'not_found' });
  });
});

test('checkTaskOpen returns not_found for the courier table error', () => {
  withTempStub(`printf "fleet: no task '%s' in this courier's table\\n" "$3" >&2; exit 1`, () => {
    assert.deepEqual(checkTaskOpen(SAMPLE_ID), { state: 'not_found' });
  });
});

test('checkTaskOpen returns unavailable on missing binary, invalid JSON, or timeout', () => {
  const prev = process.env.FLEET_BIN;
  process.env.FLEET_BIN = '/nonexistent/fleet-binary-missing-12345';
  try {
    assert.deepEqual(checkTaskOpen(SAMPLE_ID), { state: 'unavailable' });
  } finally {
    if (prev === undefined) delete process.env.FLEET_BIN;
    else process.env.FLEET_BIN = prev;
  }

  withTempStub('printf "not json at all\\n"', () => {
    assert.deepEqual(checkTaskOpen(SAMPLE_ID), { state: 'unavailable' });
  });

  withTempStub('sleep 2', () => {
    assert.deepEqual(checkTaskOpen(SAMPLE_ID, { timeoutMs: 80 }), { state: 'unavailable' });
  });
});

test('resolveParentTaskId respects AUTOPILOT_FLEET_TASK -> AUTOPILOT_UPSTREAM_TASK_ID -> brief', () => {
  assert.equal(
    resolveParentTaskId({
      env: { AUTOPILOT_FLEET_TASK: SAMPLE_ID, AUTOPILOT_UPSTREAM_TASK_ID: SECOND_ID },
      text: `Fleet-Task: ${SECOND_ID}\n`,
    }),
    SAMPLE_ID,
  );
  assert.equal(
    resolveParentTaskId({
      env: { AUTOPILOT_UPSTREAM_TASK_ID: SAMPLE_ID },
      text: `Fleet-Task: ${SECOND_ID}\n`,
    }),
    SAMPLE_ID,
  );
  assert.equal(
    resolveParentTaskId({
      env: {},
      text: `Engine: codex\nFleet-Task: ${SECOND_ID}\n`,
    }),
    SECOND_ID,
  );
  assert.equal(
    resolveParentTaskId({
      env: { AUTOPILOT_FLEET_TASK: 'none', AUTOPILOT_UPSTREAM_TASK_ID: SAMPLE_ID },
      text: '',
    }),
    null,
  );
});

test('resolvePmGate handles PM console, exemptions, and fail-open unavailable', () => {
  const pmRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-pm-repo-'));
  const nonPmRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-nonpm-repo-'));
  try {
    fs.mkdirSync(path.join(pmRepo, '.git'));
    fs.writeFileSync(path.join(pmRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    fs.mkdirSync(path.join(pmRepo, '.claude'));
    fs.writeFileSync(
      path.join(pmRepo, '.claude', 'console.json'),
      JSON.stringify({ schema: 'autopilot.console/1', mode: 'program' }),
    );
    fs.mkdirSync(path.join(nonPmRepo, '.git'));
    fs.writeFileSync(path.join(nonPmRepo, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    assert.equal(resolvePmGate({ repoRoot: nonPmRepo, env: {} }).code, 'missing'); // P4: the gate no longer stops at non-PM repos
    assert.equal(resolvePmGate({ repoRoot: pmRepo, env: {} }).code, 'missing');
    assert.equal(resolvePmGate({ repoRoot: pmRepo, hasBinStub: true, env: {} }).allowed, true);
    assert.equal(resolvePmGate({ repoRoot: pmRepo, env: { AUTOPILOT_PARENT_RUN_ID: 'r1' } }).allowed, true);
    assert.equal(resolvePmGate({ repoRoot: pmRepo, env: { AUTOPILOT_DISPATCH_ROLE: 'engine-qualify' } }).allowed, true);

    withTempStub('printf \'{"status":"done"}\\n\'', () => {
      assert.equal(
        resolvePmGate({ repoRoot: pmRepo, fleetTaskArg: SAMPLE_ID, env: {} }).code,
        'closed',
      );
    });
    withTempStub('printf \'{"status":"open"}\\n\'', () => {
      const ok = resolvePmGate({ repoRoot: pmRepo, fleetTaskArg: SAMPLE_ID, env: {} });
      assert.equal(ok.allowed, true);
      assert.equal(ok.taskId, SAMPLE_ID);
    });
    withTempStub('exit 3', () => {
      // Fail-soft progress must never throw even when fleet stub exits 3.
      assert.doesNotThrow(() => emitProgressFailSoft(SAMPLE_ID, '[dispatch:author] r1 start'));
    });
  } finally {
    fs.rmSync(pmRepo, { recursive: true, force: true });
    fs.rmSync(nonPmRepo, { recursive: true, force: true });
  }
});
