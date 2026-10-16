#!/usr/bin/env node
const { normalize } = require('./lib/normalize');
console.log(`cli:${normalize(process.argv[2] ?? null)}`);
