#!/usr/bin/env node
'use strict';
// BL-0034: src/engine/local-deployment.js must reach the same transport verdict as
// scripts/resolve-endpoint.sh for the same URL + _TRANSPORT value. Runs both sides.
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { classifyTransport } = require('../src/engine/local-deployment.js');

const SH = path.join(__dirname, 'resolve-endpoint.sh');
const URLS = [
  'https://api.example.com/v1', 'https://localhost:8000', 'http://localhost:8000', 'http://127.0.0.1:1234/v1',
  'http://[::1]:8000', 'http://10.1.2.3:8000', 'http://172.16.0.1', 'http://172.31.255.1:80/x', 'http://172.32.0.1',
  'http://172.15.0.1', 'http://172.016.0.1', 'http://192.168.1.5:8001', 'http://169.254.1.1', 'http://8.8.8.8',
  'http://10.1', 'http://example.lan', 'http://[fd00::1]:8000', 'http://[fe80::1]', 'http://[2001:db8::1]',
  'http://[fd00:1:2:3:4:5:6::]', 'http://[fd00::1::2]', 'http://999.1.1.1', 'http://10.0.0.256',
  'HTTP://LOCALHOST', 'ftp://10.0.0.1', 'http://10.0.0.1 /x', 'http://10.0.0.1/"x',
];
const TRANSPORTS = ['', 'tls', 'plaintext-private', 'bogus'];

function viaShell(url, transport) {
  const env = { PATH: process.env.PATH, AUTOPILOT_ENDPOINT_PAR_URL: url, AUTOPILOT_ENDPOINT_PAR_TOKEN: 'x' };
  if (transport) env.AUTOPILOT_ENDPOINT_PAR_TRANSPORT = transport;
  const r = spawnSync('bash', [SH, 'par'], { env, encoding: 'utf8' });
  const j = JSON.parse(r.stdout);
  return { safe: j.url_safe === true, class: j.transport_security };
}

let n = 0;
for (const url of URLS) {
  for (const t of TRANSPORTS) {
    const sh = viaShell(url, t);
    const js = classifyTransport(url, t);
    assert.deepEqual({ safe: js.safe, class: js.class }, sh, `parity ${JSON.stringify(url)} transport=${JSON.stringify(t)}`);
    n += 1;
  }
}
// the opt-in case the pre-BL-0034 rule rejected outright must now be accepted on both sides
assert.equal(classifyTransport('http://10.1.2.3:8000', 'plaintext-private').class, 'plaintext_private');
assert.equal(classifyTransport('http://10.1.2.3:8000', '').safe, false);
console.log(`local-deployment transport parity: ${n} cases agree`);
