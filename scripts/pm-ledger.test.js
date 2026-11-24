'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ledger-test-'));
try {
  const config = path.join(dir, 'config.json'), output = path.join(dir, 'out'), ledger = path.join(dir, 'ledger.sh');
  fs.writeFileSync(ledger, '#!/bin/sh\ncat >> "$LEDGER_OUT"\n');
  fs.writeFileSync(config, JSON.stringify({pm_ledger:{ledger_sh:ledger,ledger_file:output}}));
  const run = (args, input = '') => spawnSync(process.execPath, [path.join(__dirname,'pm-ledger.js'), ...args], {input, encoding:'utf8', env:{...process.env,HOME:dir,AUTOPILOT_CONFIG_FILE:config,LEDGER_OUT:output}});
  for (const input of ['', '  ', 'x'.repeat(2001), 'a'.repeat(64), 'bad\ttext']) assert.equal(run(['lint'], input).status, 1, 'lint must reject invalid input');
  assert.equal(run(['lint'], '合法\n文字').status, 0);
  assert.equal(run(['write'], 'first\n').status, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), 'first\n');
  assert.equal(run(['write'], '').status, 1);
  fs.writeFileSync(output, Array.from({length:35}, (_,i) => `match ${i}\n`).join(''));
  const found = run(['search','match']);
  assert.equal(found.status, 0);
  assert.deepEqual(found.stdout.trimEnd().split('\n'), [...Array.from({length:30}, (_,i)=>`match ${i+5}`), '…另有 5 行']);
  fs.writeFileSync(config, '{}');
  assert.equal(run(['write'], 'valid').status, 2);
  assert.equal(run(['search','x']).status, 2);
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
