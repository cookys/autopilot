#!/usr/bin/env node
const { fetchJson } = require('./lib/http');
console.log(JSON.stringify(fetchJson(process.argv[2] || 'http://x/a')));
