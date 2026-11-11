'use strict';

require('./lib/test-git-env');

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DEFAULT_CODEX_QUOTA_SUBSTITUTES,
  parseSubstituteSpec,
  loadCodexQuotaSubstitutes,
  classifyCodexQuotaFailure,
  selectCodexQuotaSubstitute,
  formatCodexQuotaNotice,
  buildSubstitutionRecord,
} = require('./lib/qc-panel-codex-fallback');
const { auditObject } = require('./lib/config-audit');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qc-codex-fb-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('DEFAULT_CODEX_QUOTA_SUBSTITUTES orders grok-4.7/high@grok first and gemini-4-carbon-high/high@agy second', () => {
  assert.deepEqual(DEFAULT_CODEX_QUOTA_SUBSTITUTES, [
    'grok-4.7/high@grok',
    'gemini-4-carbon-high/high@agy',
  ]);
  const parsed = DEFAULT_CODEX_QUOTA_SUBSTITUTES.map(parseSubstituteSpec);
  assert.deepEqual(parsed, [
    { engine: 'grok-4.7', runner: 'grok', effort: 'high', family: 'xai' },
    { engine: 'gemini-4-carbon-high', runner: 'agy', effort: 'high', family: 'google' },
  ]);
});

test('parseSubstituteSpec defaults effort to high when omitted and parses optional endpoint', () => {
  assert.deepEqual(parseSubstituteSpec('grok-4.7@grok'), {
    engine: 'grok-4.7',
    runner: 'grok',
    effort: 'high',
    family: 'xai',
  });
  assert.deepEqual(parseSubstituteSpec('GLM-5.3/high@cc-shim:glm'), {
    engine: 'GLM-5.3',
    runner: 'cc-shim',
    effort: 'high',
    endpoint: 'glm',
    family: 'zhipu',
  });
  assert.equal(parseSubstituteSpec(''), null);
  assert.equal(parseSubstituteSpec('missing-runner@'), null);
});

test('classifyCodexQuotaFailure reuses engine-capability-state classifier for 429 and usage-limit only on codex', () => {
  assert.deepEqual(
    classifyCodexQuotaFailure({
      runner: 'codex',
      texts: ["You've hit your usage limit. Upgrade to Pro or try again later."],
    }),
    { matched: true, reason: 'quota_exhausted' },
  );

  assert.deepEqual(
    classifyCodexQuotaFailure({
      runner: 'codex',
      texts: ['HTTP 429 Too Many Requests: rate limit reached for gpt-5.6-sol'],
    }),
    { matched: true, reason: 'rate_limited' },
  );

  // Raw log fallback when stdout error is generic
  withTempDir((dir) => {
    const rawLog = path.join(dir, 'codex-raw.log');
    fs.writeFileSync(rawLog, 'ERROR: exceeded your current quota, please check your plan and billing details\n');
    assert.deepEqual(
      classifyCodexQuotaFailure({
        runner: 'codex',
        texts: ['dispatch-review exited with status 1'],
        rawLogPath: rawLog,
      }),
      { matched: true, reason: 'quota_exhausted' },
    );
  });

  // Non-quota failures on codex return null (preserve today's behaviour)
  assert.equal(
    classifyCodexQuotaFailure({
      runner: 'codex',
      texts: ['seat_idle_timeout: reviewer produced no output for 120s'],
    }),
    null,
  );
  assert.equal(
    classifyCodexQuotaFailure({
      runner: 'codex',
      texts: ['401 Unauthorized: invalid API key'],
    }),
    null,
  );

  // Quota text on a non-codex runner returns null (codex-seat rule only)
  assert.equal(
    classifyCodexQuotaFailure({
      runner: 'opencode',
      texts: ['HTTP 429 Too Many Requests'],
    }),
    null,
  );
});

test('selectCodexQuotaSubstitute picks grok-4.7@grok first when families are compatible', () => {
  const failedSeat = { id: 's0', engine: 'gpt-5.6-sol', runner: 'codex', effort: 'max', family: 'openai' };
  const panelSeats = [
    failedSeat,
    { id: 's1', engine: 'claude-fable-5-1', runner: 'claude-native', effort: 'high', family: 'anthropic' },
  ];
  const sub = selectCodexQuotaSubstitute({
    failedSeat,
    failedIndex: 0,
    panelSeats,
    implementerEngine: 'claude-sonnet-5',
  });
  assert.deepEqual(sub, {
    engine: 'grok-4.7',
    runner: 'grok',
    effort: 'high',
    family: 'xai',
  });
});

test('selectCodexQuotaSubstitute skips substitute matching implementer family and picks second substitute', () => {
  const failedSeat = { id: 's0', engine: 'gpt-5.6-sol', runner: 'codex', effort: 'max', family: 'openai' };
  const panelSeats = [
    failedSeat,
    { id: 's1', engine: 'claude-fable-5-1', runner: 'claude-native', effort: 'high', family: 'anthropic' },
  ];
  const sub = selectCodexQuotaSubstitute({
    failedSeat,
    failedIndex: 0,
    panelSeats,
    implementerEngine: 'grok-4.7',
  });
  assert.deepEqual(sub, {
    engine: 'gemini-4-carbon-high',
    runner: 'agy',
    effort: 'high',
    family: 'google',
  });
});

test('selectCodexQuotaSubstitute skips substitute whose family is already in a 2-seat panel requiring distinct families', () => {
  const failedSeat = { id: 's0', engine: 'gpt-5.6-sol', runner: 'codex', effort: 'max', family: 'openai' };
  const panelSeats = [
    failedSeat,
    { id: 's1', engine: 'grok-4.6', runner: 'grok', effort: 'high', family: 'xai' },
  ];
  const sub = selectCodexQuotaSubstitute({
    failedSeat,
    failedIndex: 0,
    panelSeats,
    implementerEngine: 'claude-sonnet-5',
    crossFamilyRequired: true,
    requiredReviewFamilies: 2,
  });
  assert.deepEqual(sub, {
    engine: 'gemini-4-carbon-high',
    runner: 'agy',
    effort: 'high',
    family: 'google',
  });
});

test('selectCodexQuotaSubstitute skips exact duplicate seat tuple already present in a 3-seat panel', () => {
  const failedSeat = { id: 's0', engine: 'gpt-5.6-sol', runner: 'codex', effort: 'max', family: 'openai' };
  const panelSeats = [
    failedSeat,
    { id: 's1', engine: 'grok-4.7', runner: 'grok', effort: 'high', family: 'xai' },
    { id: 's2', engine: 'claude-fable-5-1', runner: 'claude-native', effort: 'high', family: 'anthropic' },
  ];
  const sub = selectCodexQuotaSubstitute({
    failedSeat,
    failedIndex: 0,
    panelSeats,
    implementerEngine: 'claude-sonnet-5',
    crossFamilyRequired: true,
    requiredReviewFamilies: 2,
  });
  assert.deepEqual(sub, {
    engine: 'gemini-4-carbon-high',
    runner: 'agy',
    effort: 'high',
    family: 'google',
  });
});

test('loadCodexQuotaSubstitutes reads qc_panel.codex_quota_substitutes and config-audit accepts it', () => {
  withTempDir((dir) => {
    const cfgPath = path.join(dir, 'config.json');
    const cfgObj = {
      qc_panel: {
        codex_quota_substitutes: [
          'gemini-4-carbon-high/high@agy',
          'grok-4.7@grok',
        ],
      },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfgObj, null, 2));
    const loaded = loadCodexQuotaSubstitutes({ configFile: cfgPath });
    assert.deepEqual(loaded, [
      { engine: 'gemini-4-carbon-high', runner: 'agy', effort: 'high', family: 'google' },
      { engine: 'grok-4.7', runner: 'grok', effort: 'high', family: 'xai' },
    ]);

    const audit = auditObject(cfgObj);
    assert.deepEqual(audit.unknownKeys, []);
    assert.deepEqual(audit.typeErrors, []);
  });
});

test('formatCodexQuotaNotice and buildSubstitutionRecord emit verbatim Traditional Chinese and machine-readable fields', () => {
  const originalSeat = { id: 's0', engine: 'gpt-5.6-sol', runner: 'codex', effort: 'max' };
  const substitute = { engine: 'grok-4.7', runner: 'grok', effort: 'high', family: 'xai' };
  assert.equal(
    formatCodexQuotaNotice(substitute),
    'codex 額度用完，由 grok-4.7@grok 代打',
  );
  const record = buildSubstitutionRecord({
    originalSeat,
    substitute,
    reason: 'quota_exhausted',
  });
  assert.deepEqual(record, {
    original_seat: {
      id: 's0',
      engine: 'gpt-5.6-sol',
      runner: 'codex',
      effort: 'max',
    },
    substitute: {
      engine: 'grok-4.7',
      runner: 'grok',
      effort: 'high',
      family: 'xai',
    },
    reason: 'quota_exhausted',
    notice: 'codex 額度用完，由 grok-4.7@grok 代打',
  });
});
