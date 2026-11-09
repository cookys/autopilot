#!/usr/bin/env node
'use strict';
// Account alias vectors and tiers. Fixtures only: a mktemp dir stands in for HOME and CLAUDE_CONFIG_DIR.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./account-alias.js');

const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'acctalias-'));
const ORG1 = '00000000-0000-4000-8000-000000000001';
const ORG2 = '00000000-0000-4000-8000-000000000002';
const writeClaudeJson = (dir, org, email) => fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { organizationUuid: org, emailAddress: email } }));

test('vectors: org+email hash', () => {
  const d = mk();
  writeClaudeJson(d, ORG1, 'me@example.com');
  assert.strictEqual(A.claudeAccount({ CLAUDE_CONFIG_DIR: d, HOME: d }), 'acct-93b0088a');
  const d2 = mk();
  writeClaudeJson(d2, ORG2, 'Ops@Example.com');
  assert.strictEqual(A.claudeAccount({ CLAUDE_CONFIG_DIR: d2, HOME: d2 }), 'acct-04f8bb94');
});

test('vectors: config dir path hash and codex hash', () => {
  const home = mk();
  assert.strictEqual(A.claudeAccount({ HOME: home, CLAUDE_CONFIG_DIR: '/home/alice/.claude' }), 'acct-6952bbe3');
  assert.strictEqual(A.claudeAccount({ HOME: home, CLAUDE_CONFIG_DIR: '/srv/cc/acct2' }), 'acct-25925d5a');
  assert.strictEqual(A.codexAliasOfPath('/home/alice/.codex'), 'codex-186293cb');
});

test('tier 1: AUTOPILOT_ACCOUNT wins; invalid value falls through', () => {
  const d = mk();
  writeClaudeJson(d, ORG1, 'me@example.com');
  assert.strictEqual(A.claudeAccount({ AUTOPILOT_ACCOUNT: 'ci-runner-2', CLAUDE_CONFIG_DIR: d, HOME: d }), 'ci-runner-2');
  assert.strictEqual(A.claudeAccount({ AUTOPILOT_ACCOUNT: 'Ops@x', CLAUDE_CONFIG_DIR: d, HOME: d }), 'acct-93b0088a');
  assert.strictEqual(A.claudeAccount({ AUTOPILOT_ACCOUNT: 'a'.repeat(25), CLAUDE_CONFIG_DIR: d, HOME: d }), 'acct-93b0088a');
});

test('tier 2 to 3: missing, empty or malformed .claude.json falls to the config dir hash', () => {
  const d = mk();
  const real = fs.realpathSync(d);
  const want = `acct-${A.sha8(real)}`;
  assert.strictEqual(A.claudeAccount({ CLAUDE_CONFIG_DIR: d, HOME: d }), want); // no file
  writeClaudeJson(d, ORG1, '');
  assert.strictEqual(A.claudeAccount({ CLAUDE_CONFIG_DIR: d, HOME: d, AUTOPILOT_ACCOUNT: '' }), want); // empty email
  fs.writeFileSync(path.join(d, '.claude.json'), '{not json');
  assert.strictEqual(A.claudeAccount({ CLAUDE_CONFIG_DIR: d, HOME: d, AUTOPILOT_ACCOUNT: undefined }), want);
});

test('without CLAUDE_CONFIG_DIR: ~/.claude.json then ~/.claude under HOME', () => {
  const home = mk();
  assert.strictEqual(A.claudeAccount({ HOME: home }), `acct-${A.sha8(path.join(home, '.claude'))}`);
  const home2 = mk(); // the result is cached per process and env, so the file is read from a fresh HOME
  writeClaudeJson(home2, ORG1, 'me@example.com');
  assert.strictEqual(A.claudeAccount({ HOME: home2, CLAUDE_CONFIG_DIR: '' }), 'acct-93b0088a');
});

test('codex: needs an existing directory', () => {
  const home = mk();
  assert.strictEqual(A.codexAccount({ HOME: home }), null);
  fs.mkdirSync(path.join(home, '.codex'));
  assert.strictEqual(A.codexAccount({ HOME: home }), `codex-${A.sha8(fs.realpathSync(path.join(home, '.codex')))}`);
  const other = mk();
  assert.strictEqual(A.codexAccount({ HOME: home, CODEX_HOME: other }), `codex-${A.sha8(fs.realpathSync(other))}`);
});
