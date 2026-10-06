#!/usr/bin/env node
'use strict';
const fs = require('fs');
const { importText } = require('./lib/importer');
const [file, format] = process.argv.slice(2);
if (!file) { console.error('usage: cli.js <file> [format]'); process.exit(1); }
console.log(JSON.stringify(importText(fs.readFileSync(file, 'utf8'), format || 'lines')));
