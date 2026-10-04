#!/usr/bin/env bash
set -e
node -e '
const { titleCase } = require("./lib/text.js");
if (typeof titleCase !== "function") { console.error("titleCase missing"); process.exit(1); }
const assert = require("assert");
assert.strictEqual(titleCase("hello big world"), "Hello Big World");
assert.strictEqual(titleCase("  a  b "), "A B");
console.log("ok");
'
