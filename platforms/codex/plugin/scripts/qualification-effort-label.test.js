#!/usr/bin/env node
'use strict';

// qualification-effort-label.test.js — BL-0166. The --effort label on an exam row is typed by
// the operator; the effort the provider actually sends rides separate QRP_* env vars. This pins
// the comparison, including the case that produced 13 mislabelled rows on 2026-10-14: the label
// said a tier, the env var was never set, the endpoint default ran.

const assert = require('assert');
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

console.log(`qualification-effort-label: ${assertions} assertions passed`);
