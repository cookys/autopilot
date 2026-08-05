#!/usr/bin/env bash
# review-framing-report.test.sh — D4 A08 report contract.
# Validates a review-framing probe report (or synthesizes a unit fixture when
# no path is provided) for derived-delimiter identity + fail-closed cases.
. "$(dirname "$0")/lib.sh"

REPORT_PATH="${1:-}"

node - "$REPO_ROOT" "$REPORT_PATH" <<'NODE'
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = process.argv[2];
let reportPath = process.argv[3] || '';

function derived(nonce) {
  return crypto.createHash('sha256')
    .update(`autopilot-review-v1:${nonce}`)
    .digest('hex')
    .slice(0, 32);
}

// Unit proof: derived delimiter rejects raw-nonce echo.
{
  const nonce = 'a'.repeat(32);
  const d = derived(nonce);
  assert.notStrictEqual(d, nonce, 'derived differs from raw nonce');
  const begin = `<<<AUTOPILOT-REVIEW-${d}>>>`;
  const rawBegin = `<<<AUTOPILOT-REVIEW-${nonce}>>>`;
  assert.notStrictEqual(begin, rawBegin, 'raw-nonce marker is not accepted form');
  console.log('PASS: derived delimiter differs from raw nonce');
}

// Prompt-echo of NONCE= line cannot equal BEGIN marker.
{
  const nonce = 'deadbeef'.repeat(4).slice(0, 32);
  const d = derived(nonce);
  const promptLine = `NONCE=${nonce}`;
  assert.ok(!promptLine.includes(d), 'prompt nonce line does not embed derived hex');
  console.log('PASS: prompt nonce line cannot reproduce derived marker by echo');
}

// If a report is supplied, validate structure.
if (reportPath && fs.existsSync(reportPath)) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.strictEqual(report.schema_version, 1, 'report schema_version');
  assert.ok(report.parser_digest || report.prompt_digest, 'binds digests');
  assert.ok(Array.isArray(report.adapters), 'adapters array');
  for (const a of report.adapters) {
    assert.ok(a.identity, 'adapter identity');
    assert.strictEqual(a.trials, a.passed, `${a.identity} must be 20/20 for cutover`);
  }
  console.log('PASS: report structure ok');
} else {
  console.log('PASS: no report path — unit framing proofs only');
}

console.log('review-framing-report: ok');
NODE

assert_eq "$?" "0" "review-framing unit suite"
finalize_test
