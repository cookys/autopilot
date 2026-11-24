#!/usr/bin/env node
'use strict';
const assert = require('assert');
const { maskSecrets, MASK } = require('./mask-secrets');
const fake = ['Zq', '8Kx', 'Lm3Np', '7Rt2Vw', 'Yb5Hc', '9Df4Gj', '1Sa6Pe'].join('');
assert.strictEqual(maskSecrets('key ' + fake + ' end'), 'key ' + MASK + ' end');
assert.strictEqual(maskSecrets('sk-' + 'abcdefghijklmnop1234'), MASK);
assert.strictEqual(maskSecrets('ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1'), MASK);
assert.strictEqual(maskSecrets('commit 8351ccf84a1b2c3d4e5f60718293a4b5c6d7e8f9 merged'), 'commit 8351ccf84a1b2c3d4e5f60718293a4b5c6d7e8f9 merged');
assert.strictEqual(maskSecrets('ordinary words and a path scripts/lib/mask-secrets.test.js'), 'ordinary words and a path scripts/lib/mask-secrets.test.js');
assert.strictEqual(maskSecrets('open-decision-card-visible-test-for-the-panel-band'), 'open-decision-card-visible-test-for-the-panel-band');
assert.strictEqual(maskSecrets(undefined), undefined);
console.log('mask-secrets: 7 ok');
