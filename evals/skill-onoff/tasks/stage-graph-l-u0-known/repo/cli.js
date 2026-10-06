#!/usr/bin/env node
'use strict';
const queue = require('./lib/queue');
const scheduler = require('./lib/scheduler');
queue.push({ name: process.argv[2] || 'demo' });
scheduler.runOnce((job) => console.log('ran ' + job.name));
