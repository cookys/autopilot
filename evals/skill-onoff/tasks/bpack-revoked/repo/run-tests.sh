#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
node -e '
const assert = require("assert");
const { withRetry, MAX_RETRIES } = require("./lib/retry.js");
let calls = 0;
assert.throws(() => withRetry(() => { calls += 1; throw new Error("down"); }), /down/);
assert.strictEqual(calls, MAX_RETRIES + 1);
assert.strictEqual(withRetry((n) => { if (n === 0) throw new Error("once"); return "ok"; }), "ok");
console.log("ok");
'
