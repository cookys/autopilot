#!/usr/bin/env node
'use strict';
/**
 * Unit tests for scripts/lib/ar-redact-rules.js (node:test wrapper).
 * Run: node --test scripts/ar-redact-rules.test.js < /dev/null
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { redactText, defaultRules, decodeVariant, tag } = require('./lib/ar-redact-rules');
const { planted } = require('./lib/ar-redact-fixtures');

test('tag builds REDACTED marker', () => {
  assert.equal(tag('jwt'), '[REDACTED:jwt]');
});

test('decodeVariant: escapes and percent-encoding', () => {
  assert.equal(decodeVariant('line\\none'), 'line\none');
  assert.equal(decodeVariant('q=%41'), 'q=A');
  assert.equal(decodeVariant('plain'), 'plain');
});

test('decodeVariant: stops after three rounds with no progress', () => {
  const once = 'a\\nb';
  assert.equal(decodeVariant(once), 'a\nb');
  assert.equal(decodeVariant(once), decodeVariant(decodeVariant(once)));
});

test('redactText: empty custom rules leaves text intact', () => {
  const src = 'no secrets in this line';
  const r = redactText(src, []);
  assert.equal(r.text, src);
  assert.equal(r.total, 0);
});

test('redactText: JWT masked with default rules', () => {
  const jwt = planted().jwt;
  const r = redactText(`token ${jwt}`, defaultRules());
  assert.ok(r.text.includes('[REDACTED:jwt]'));
  assert.equal(r.text.includes(jwt), false);
  assert.ok(r.counts.jwt >= 1);
});

test('redactText: decoded variant catches URL-encoded secret', () => {
  const secret = planted().anthropic;
  const enc = encodeURIComponent(secret);
  const r = redactText(`q=${enc}&tail=1`, defaultRules());
  assert.equal(r.text.includes(secret), false);
  assert.ok(r.total >= 1);
});

test('redactText: loopback and version-like IPv4 left alone', () => {
  const src = 'loopback 127.0.0.1 and 0.0.0.0 stay';
  const r = redactText(src, defaultRules());
  assert.equal(r.text, src);
  assert.equal(r.total, 0);
});

test('redactText: public IPv4 redacted', () => {
  const ip = '203.0.113.50';
  const r = redactText(`host ${ip}`, defaultRules());
  assert.ok(r.text.includes('[REDACTED:ipv4]'));
  assert.equal(r.text.includes(ip), false);
});