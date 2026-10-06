#!/usr/bin/env node
'use strict';
const { banner } = require('./lib/banner');
const { parse } = require('./lib/options');
const opts = parse(process.argv.slice(2));
if (!opts.quiet) console.log(banner(opts));
console.log('run: ' + (opts.rest.join(' ') || 'nothing'));
