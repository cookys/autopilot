#!/usr/bin/env bash
set -e
node -e '
const { syncAll } = require("./sync");
const r = syncAll(["http://x/a"]);
if (!r[0] || !r[0].ok) { console.error("FAIL: sync"); process.exit(1); }
console.log("PASS");
'
