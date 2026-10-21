#!/usr/bin/env bash
set -e
node -e '
const { slugify } = require("./lib/text.js");
if (typeof slugify !== "function") { console.error("slugify missing"); process.exit(1); }
const assert = require("assert");
assert.strictEqual(slugify("Hello World"), "hello-world");
assert.strictEqual(slugify("  Many   spaces  "), "many-spaces");
assert.strictEqual(slugify("Ünï-cödé!"), "uni-code");
console.log("ok");
'
