#!/usr/bin/env node
'use strict';
// mk-settings.js <out.json> <hook.js> <wired-label> <Event[,Event...]>
const fs = require('fs');
const [out, hook, label, events] = process.argv.slice(2);
const hooks = {};
for (const ev of events.split(',')) hooks[ev] = [{ hooks: [{ type: 'command', command: `${process.execPath} ${hook} ${ev} ${label}` }] }];
fs.writeFileSync(out, JSON.stringify({ hooks }, null, 2) + '\n');
