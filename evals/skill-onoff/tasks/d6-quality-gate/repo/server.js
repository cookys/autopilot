#!/usr/bin/env node
const args = process.argv.slice(2);
const i = args.indexOf('--port');
const port = i >= 0 ? args[i + 1] : '8080';
console.log(`listening on ${port}`);
