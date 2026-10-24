#!/usr/bin/env node
'use strict';

// qualification-effort-label.test.js — BL-0166. The --effort label on an exam row is typed by
// the operator; the effort the provider actually sends rides separate QRP_* env vars. This pins
// the comparison, including the case that produced 13 mislabelled rows on 2026-10-14: the label
// said a tier, the env var was never set, the endpoint default ran.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkEffortLabel, EFFORT_CHECK_STATUSES } = require('./lib/qualification-effort-label');

let assertions = 0;
function equal(a, b, m) { assertions += 1; assert.deepStrictEqual(a, b, m); }
const run = (label, listed, env) => checkEffortLabel({ label, listedEnvNames: listed, env });

// match
equal(run('low', ['QRP_HTTP_EFFORT'], { QRP_HTTP_EFFORT: 'low' }).status, 'match', 'http label equals the wire value');
equal(run('default', ['QRP_HTTP_EFFORT'], {}).status, 'match', 'listed but unset sends nothing; label default is honest');
equal(run('default', ['QRP_HTTP_EFFORT'], { QRP_HTTP_EFFORT: 'default' }).sent, 'default', 'an explicit default is the same as nothing');
equal(run('high', ['QRP_TRANSPORT', 'QRP_CLI_KIND', 'QRP_CLI_EFFORT'], { QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'codex', QRP_CLI_EFFORT: 'high' }).status, 'match', 'cli label equals QRP_CLI_EFFORT');
equal(run('none', ['QRP_TRANSPORT', 'QRP_CLI_KIND'], { QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'agy' }).status, 'match', 'agy has no effort dimension; label none is honest');

// kimi-code takes KIMI_MODEL_THINKING_EFFORT (low|high|max), so the provider sends the effort
// and the label is compared with the value, not with `none`
const kimiNames = ['QRP_TRANSPORT', 'QRP_CLI_KIND', 'QRP_CLI_EFFORT'];
equal(run('high', kimiNames, { QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'kimi', QRP_CLI_EFFORT: 'high' }).status, 'match', 'kimi label equals QRP_CLI_EFFORT');
equal(run('high', kimiNames, { QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'kimi', QRP_CLI_EFFORT: 'high' }).sent, 'high', 'kimi records the value actually sent');
equal(run('default', kimiNames, { QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'kimi' }).status, 'match', 'kimi with no effort variable sends nothing; label default is honest');
equal(run('none', kimiNames, { QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'kimi', QRP_CLI_EFFORT: 'high' }).status, 'mismatch', 'kimi is no longer an effort-less kind; label none is false');
equal(run('low', kimiNames, { QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'kimi', QRP_CLI_EFFORT: 'max' }).status, 'mismatch', 'kimi wrong value is a mismatch');

// mismatch: the incident
const incident = run('high', ['QRP_HTTP_EFFORT', 'QRP_BASE_URL'], {});
equal(incident.status, 'mismatch', 'label high with QRP_HTTP_EFFORT unset is a mismatch');
equal([incident.label, incident.sent], ['high', 'default'], 'the check records what was actually sent');
equal(run('high', ['QRP_BASE_URL', 'QRP_MODEL'], {}).status, 'mismatch', 'provider in play but no effort var passed through at all: the label was never sent');
equal(run('low', ['QRP_HTTP_EFFORT'], { QRP_HTTP_EFFORT: 'high' }).status, 'mismatch', 'wrong value');
equal(run('low', ['QRP_CLI_EFFORT', 'QRP_TRANSPORT', 'QRP_CLI_KIND'], { QRP_CLI_EFFORT: 'low', QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'agy' }).status, 'mismatch', 'agy ignores QRP_CLI_EFFORT, so a tier label on it is false');
equal(run('high', ['QRP_HTTP_EFFORT'], { QRP_HTTP_EFFORT: 'high' }).status, 'match', 'control: same shape as the wrong-value case, right value');
// a var that exists in the environment but is NOT listed never reaches the provider (broker scrubs env)
equal(run('high', ['QRP_BASE_URL'], { QRP_HTTP_EFFORT: 'high' }).status, 'mismatch', 'an unlisted effort var is scrubbed by the broker; it does not count as sent');

// unverifiable: not our provider, nothing to compare against
equal(run('high', [], {}).status, 'unverifiable', 'no QRP_* name listed: a custom panel command, nothing to check');
equal(run('high', ['SOME_TOKEN'], {}).status, 'unverifiable', 'unrelated env names do not make it our provider');
equal(EFFORT_CHECK_STATUSES, ['match', 'mismatch', 'unverifiable'], 'status vocabulary is closed');

// grok clamps the effort before sending (qualification-review-provider.js, via lib/grok-effort).
// A label equal to the pre-clamp value would otherwise read as a match while a different level ran.
const grokNames = ['QRP_TRANSPORT', 'QRP_CLI_KIND', 'QRP_CLI_EFFORT'];
const grokEnv = (effort) => ({ QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'grok', QRP_CLI_EFFORT: effort });
const clampedMax = run('max', grokNames, grokEnv('max'));
equal([clampedMax.status, clampedMax.sent], ['mismatch', 'xhigh'], 'grok max is clamped to xhigh; label max is false');
equal(run('xhigh', grokNames, grokEnv('max')).status, 'match', 'control: the clamped value as the label matches');
equal(run('high', grokNames, grokEnv('high')).status, 'match', 'control: an unclamped grok level matches verbatim');
{
  // per-model live enum via a stub binary (never the real grok): grok-4.5 rejects xhigh
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effort-label-grok-'));
  const stub = path.join(dir, 'grok-stub');
  fs.writeFileSync(stub, "#!/bin/sh\necho \"unknown effort level '__autopilot_probe__'; use one of: high, medium, low\"\n", { mode: 0o755 });
  const names = [...grokNames, 'QRP_MODEL', 'QRP_CLI_BIN'];
  const env = { ...grokEnv('xhigh'), QRP_MODEL: 'grok-4.5', QRP_CLI_BIN: stub };
  const r = run('xhigh', names, env);
  equal([r.status, r.sent], ['mismatch', 'high'], 'the live per-model enum clamp is applied too (grok-4.5: xhigh -> high)');
  fs.rmSync(dir, { recursive: true, force: true });
}
{
  const src = fs.readFileSync(path.join(__dirname, 'qualification-review-provider.js'), 'utf8');
  assertions += 1;
  assert.ok(/require\('\.\/lib\/grok-effort'\)/.test(src) && !/function grokEffortClamp/.test(src),
    'the provider requires the shared clamp; no second copy');
}

// emitted-row shape: a null row (instrument_error path) stays null, never a row made only of effort_check
const { buildEmittedRow } = require('./engine-qualify');
const mismatch = run('high', ['QRP_HTTP_EFFORT'], {});
equal(buildEmittedRow(null, mismatch), null, 'row:null with an observable effort check is emitted as null');
equal(buildEmittedRow({ a: 1 }, mismatch), { a: 1, effort_check: mismatch }, 'control: a real row gets the check');
equal(buildEmittedRow({ a: 1 }, run('high', [], {})), { a: 1 }, 'control: unverifiable adds nothing');

console.log(`qualification-effort-label: ${assertions} assertions passed`);
