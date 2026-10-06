#!/usr/bin/env node
'use strict';
const { runAll } = require('./lib/runner');
for (const line of runAll()) console.log(line);
