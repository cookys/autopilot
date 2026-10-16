#!/usr/bin/env node
const { parse } = require('./lib/parser');
console.log(JSON.stringify(parse(process.argv.slice(2).join(' '))));
