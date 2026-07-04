const assert = require('assert');
const { getVersion } = require('../lib/index');
const pkg = require('../package.json');
const market = require('../marketplace.json');

// The code version must match both manifests
assert.strictEqual(getVersion(), pkg.version, "Code version must match package.json");
assert.strictEqual(pkg.version, market.version, "package.json version must match marketplace.json");

console.log("All tests passed.");
