#!/usr/bin/env node
'use strict';
const notes = require('./lib/notes');
const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'add') { console.log(JSON.stringify(notes.add(rest.join(' ')))); process.exit(0); }
if (cmd === 'list') { for (const n of notes.list()) console.log(n.id + ' ' + n.text); process.exit(0); }
console.error('usage: cli.js add <text> | list');
process.exit(1);
