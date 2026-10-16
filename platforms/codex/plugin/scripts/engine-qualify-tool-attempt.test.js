#!/usr/bin/env node
'use strict';

// d-80d327c9 (2026-10-17): an exam seat that attempts a tool when its prompt forbade
// tools has answered THAT case wrong (reason tool_attempt_forbidden); the exam runs on.
// Without the prohibition in the prompt the old classification (transport failure)
// stays; a real connection error is still transport_fail.
//
// The adapter below plays the provider. For a case whose content hash starts with "0"
// it fails the way qualification-review-provider.js does (stderr "model call failed:
// ..." + exit 1); every other case gets a plain pass answer. NEGATIVE CONTROL: with
// the reclassification removed from engine-qualify.js the `forbidden` scenario turns
// transport_fail and this suite goes red (run and recorded in the commit message).

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qualify-tool-attempt-'));
const adapter = path.join(tmp, 'adapter.js');
fs.writeFileSync(adapter, `'use strict';
const fs = require('fs');
const crypto = require('crypto');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const hit = crypto.createHash('sha256').update(request.payload.content).digest('hex')[0] === '0';
if (hit) {
  const failures = {
    forbidden: 'model call failed: tool_forbidden: opencode containment breach: tool event bash:error — answer discarded',
    unforbidden: 'model call failed: opencode containment breach: tool event bash:error — answer discarded',
    connection: 'model call failed: connect ECONNREFUSED 127.0.0.1:1',
  };
  process.stderr.write(failures[process.env.QUAL_SCENARIO] + '\\n');
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  schema_version: 1, provider: 'fake-provider', model: 'tool-attempt-exact',
  output: '{"verdict":"pass","findings":[]}',
}));
`);

let assertions = 0;
function run(scenario) {
  const raw = path.join(tmp, `raw-${scenario}`);
  const child = spawnSync(process.execPath, [
    path.join(__dirname, 'engine-qualify.js'), 'reviewer',
    '--engine', 'tool-attempt', '--model', 'tool-attempt-exact', '--model-version', '2026-07-26',
    '--runner', 'cc-shim', '--runner-version', '1.0.0', '--family', 'openai',
    '--harness-version', 'reviewer-harness-v2', '--effort', 'high',
    '--prompt-config-hash', 'a'.repeat(64), '--semantic-fingerprint', 'b'.repeat(64),
    '--containment-fingerprint', 'c'.repeat(64),
    '--task-class', 'code_review', '--domain', 'repository', '--language', 'en', '--tool', 'diff_read',
    '--trials', '2', '--store', path.join(tmp, `store-${scenario}`), '--raw-dir', raw,
    '--remote-provider-cmd', `${process.execPath} ${adapter}`,
    '--remote-provider', 'fake-provider', '--provider-env', 'QUAL_SCENARIO',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      QUAL_SCENARIO: scenario,
      AUTOPILOT_QUALIFY_NOW: '2026-07-26T00:00:00.000Z',
      AUTOPILOT_QUALIFY_SEED: 'tool-attempt-seed',
      ENGINE_CAPABILITY_DIR: path.join(tmp, `cap-${scenario}`),
      ENGINE_SCORECARD_DIR: path.join(tmp, `score-${scenario}`),
    },
  });
  let verdict = null;
  try { verdict = JSON.parse(child.stdout.trim().split('\n').pop()); } catch { /* reported below */ }
  let rows = [];
  try {
    rows = fs.readFileSync(path.join(raw, 'reviewer-exchanges.jsonl'), 'utf8')
      .split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch { /* transport_fail aborts early; may have partial rows */ }
  return { child, verdict, rows };
}
function check(value, message) { assertions += 1; assert.ok(value, message); }

const forbidden = run('forbidden');
check(forbidden.verdict, `forbidden: verdict JSON parsed (stderr: ${forbidden.child.stderr})`);
check(forbidden.verdict.outcome !== 'transport_fail', 'forbidden: whole exam is NOT transport_fail');
check(forbidden.verdict.evaluation_passed === false, 'forbidden: exam does not pass (a case was wrong)');
const attempts = forbidden.rows.filter((r) => /^tool_attempt_forbidden:/u.test(r.parse_error || ''));
check(attempts.length >= 1, 'forbidden: at least one case carries reason tool_attempt_forbidden');
check(attempts.every((r) => r.transport_ok === true), 'forbidden: that case is not a transport failure');
check(forbidden.rows.length > attempts.length * 2 && forbidden.rows.length >= 30,
  `forbidden: the remaining cases still ran (rows=${forbidden.rows.length})`);

const unforbidden = run('unforbidden');
check(unforbidden.verdict && unforbidden.verdict.outcome === 'transport_fail',
  'unforbidden: no prohibition tag -> current classification (transport_fail)');

const connection = run('connection');
check(connection.verdict && connection.verdict.outcome === 'transport_fail',
  'connection error -> still transport_fail');

console.log(`engine-qualify-tool-attempt.test.js: ${assertions} assertions passed`);
fs.rmSync(tmp, { recursive: true, force: true });
