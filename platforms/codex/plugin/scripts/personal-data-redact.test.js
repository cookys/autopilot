#!/usr/bin/env node
'use strict';
/**
 * Tests for scripts/lib/personal-data-redact.js
 * Run: node --test scripts/personal-data-redact.test.js < /dev/null
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'personal-data-redact-test-'));
const hostsFile = path.join(TMP, 'leak-guard-hosts.json');
fs.writeFileSync(hostsFile, JSON.stringify({ strong: [], contextual: [] }));
const env = { AUTOPILOT_LEAK_GUARD_HOSTS: hostsFile };

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

// Load after synthetic host list env is fixed (child tests pass env explicitly for subprocesses only).
delete require.cache[require.resolve('./lib/personal-data-patterns')];
delete require.cache[require.resolve('./lib/personal-data-redact')];
process.env.AUTOPILOT_LEAK_GUARD_HOSTS = hostsFile;
const { redactText, redactFile } = require('./lib/personal-data-redact');

test('redactText: benign prose unchanged', () => {
  const src = 'version 3.0.0-alpha.7; no personal paths here.\n';
  const { text, hits } = redactText(src);
  assert.equal(text, src);
  assert.equal(hits.length, 0);
});

test('redactText: home path and private IP become placeholders', () => {
  const src = 'log at /home/synthuser/project/cache and gw 192.168.55.10\n';
  const { text, hits } = redactText(src);
  assert.ok(hits.length >= 2);
  assert.ok(text.includes('$HOME'));
  assert.ok(text.includes('<private-ip>'));
  assert.equal(text.includes('/home/synthuser'), false);
  assert.equal(text.includes('192.168.55.10'), false);
});

test('redactFile: binary file skipped', () => {
  const f = path.join(TMP, 'blob.bin');
  fs.writeFileSync(f, Buffer.from([0x48, 0x00, 0x65]));
  const r = redactFile(f, 'write');
  assert.equal(r.skipped, 'binary');
  assert.equal(r.changed, false);
  assert.equal(r.hits, 0);
});

test('redactFile: check mode reports hits but does not write', () => {
  const f = path.join(TMP, 'check-only.txt');
  const body = 'under /home/checkuser/tmp\n';
  fs.writeFileSync(f, body);
  const before = fs.readFileSync(f, 'utf8');
  const r = redactFile(f, 'check');
  assert.equal(r.changed, true);
  assert.ok(r.hits >= 1);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('redactFile: dry-run does not write', () => {
  const f = path.join(TMP, 'dry.txt');
  fs.writeFileSync(f, 'ip 10.0.0.5\n');
  const before = fs.readFileSync(f, 'utf8');
  const r = redactFile(f, 'dry-run');
  assert.equal(r.changed, true);
  assert.equal(fs.readFileSync(f, 'utf8'), before);
});

test('redactFile: write mode rewrites in place via temp file', () => {
  const f = path.join(TMP, 'write-me.txt');
  fs.writeFileSync(f, 'see /home/writer/data\n', { mode: 0o644 });
  const r = redactFile(f, 'write');
  assert.equal(r.changed, true);
  const after = fs.readFileSync(f, 'utf8');
  assert.ok(after.includes('$HOME'));
  assert.equal(after.includes('/home/writer'), false);
});