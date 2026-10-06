#!/usr/bin/env node
'use strict';
const records = require('./lib/records');
const cmd = process.argv[2];
if (cmd === 'list') { for (const r of records.all()) console.log(r.id + ' ' + r.name + ' ' + r.value); process.exit(0); }
console.error('usage: cli.js list');
process.exit(1);
