'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
test('daily does not claim success without required inputs', () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, 'switchboard-quality.js'), 'daily', '--date', '2026-11-17'], { encoding: 'utf8', env: { HOME: require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'quality-')) } });
  assert.notEqual(result.status, 0, 'missing input must not report pass');
});
test('baseline consumes configured extractor output', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quality-baseline-'));
  try {
    const extractor = path.join(home, 'extract');
    fs.writeFileSync(extractor, '#!/bin/sh\nprintf \'%s\\n\' \'{"ts":"2026-11-17T00:00:00Z","tokens":100,"turns":2}\'\n', {mode: 0o700});
    fs.mkdirSync(path.join(home, '.autopilot'));
    fs.writeFileSync(path.join(home, '.autopilot', 'config.json'), JSON.stringify({switchboard:{extract_script:extractor}}));
    const result = spawnSync(process.execPath, [path.join(__dirname, 'switchboard-quality.js'), 'baseline', '--days', '7'], {encoding:'utf8', env:{HOME:home}});
    assert.equal(result.status, 0, result.stderr);
    const baseline = JSON.parse(fs.readFileSync(path.join(home,'.autopilot','switchboard','quality','baseline.json')));
    assert.deepEqual(baseline.daily, [{date:'2026-11-17', turns:2, tokens_per_turn:50}]);
  } finally { fs.rmSync(home, { recursive:true, force:true }); }
});
