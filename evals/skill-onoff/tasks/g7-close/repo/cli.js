#!/usr/bin/env node
const { greet } = require('./lib/greet');
console.log(greet(process.argv[2] || 'World'));
