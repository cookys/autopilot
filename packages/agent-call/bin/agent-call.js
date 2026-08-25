#!/usr/bin/env node
'use strict';

const path = require('path');
const { runCli } = require('../src/cli');

runCli(process.argv.slice(2), { binPath: path.resolve(__filename) })
  .then((status) => { process.exitCode = status; })
  .catch((error) => {
    process.stderr.write(`agent-call: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
