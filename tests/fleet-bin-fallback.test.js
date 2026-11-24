'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { bin } = require('../scripts/lib/fleet-task.js');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetbin-'));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fleetbin-empty-'));
fs.mkdirSync(path.join(home, '.local', 'bin'), { recursive: true });
const stub = path.join(home, '.local', 'bin', 'fleet');
fs.writeFileSync(stub, '#!/bin/sh\n');

assert.strictEqual(bin({ HOME: home, PATH: '/nonexistent' }), stub, 'falls back to ~/.local/bin/fleet');
assert.strictEqual(bin({ HOME: home, FLEET_BIN: '/x/fleet' }), '/x/fleet', 'FLEET_BIN wins');
assert.strictEqual(bin({ HOME: empty }), 'fleet', 'no file -> PATH name');
assert.strictEqual(bin({}), 'fleet', 'no HOME -> PATH name');
console.log('# pass 4');
