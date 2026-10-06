#!/usr/bin/env node
'use strict';
const { greet } = require('./lib/greet');
const args = process.argv.slice(2);
if (args[0] === 'greet') {
  console.log(greet(args[1]));
  process.exit(0);
}
console.error('usage: cli.js greet [name]');
process.exit(1);
