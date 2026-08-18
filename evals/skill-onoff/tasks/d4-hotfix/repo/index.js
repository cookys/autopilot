#!/usr/bin/env node
const name = process.argv[2] || 'world';
cosole.log(`service up: ${name}`); // crash: `cosole` is not defined
