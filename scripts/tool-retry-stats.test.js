'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('counts retry chains without exposing transcript data', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-stats-'));
  try {
    const rows = [];
    function call(name, id, error) {
      rows.push({type:'assistant', message:{content:[{type:'tool_use', name, id}]}});
      rows.push({type:'user', message:{content:[{type:'tool_result', tool_use_id:id, ...(error ? {is_error:true, content:error} : {content:'ok'})}]}});
    }
    call('Read', 'a', null);
    call('Read', 'b', 'InputValidationError bad parameter name secret-canary-123');
    call('Read', 'c', null);
    call('Bash', 'd', 'something failed secret-canary-123');
    call('Bash', 'e', 'blocked by hook');
    call('Bash', 'f', null);
    const file = path.join(dir, 'fixture.jsonl');
    fs.writeFileSync(file, rows.map(JSON.stringify).join('\n'));
    for (const args of [['--files', file], ['--dir', dir]]) {
      const result = spawnSync(process.execPath, [path.join(__dirname, 'tool-retry-stats.js'), ...args], {encoding:'utf8'});
      assert.equal(result.status, 0, result.stderr);
      assert.ok(!result.stdout.includes('secret-canary-123'));
      const data = JSON.parse(result.stdout);
      assert.deepEqual(data.tools.Read, {calls:3, first_try_ok:1, first_try_rate:0.5, mean_attempts_to_success:1.5, by_class:{bad_param_name:1}});
      assert.deepEqual(data.tools.Bash, {calls:3, first_try_ok:0, first_try_rate:0, mean_attempts_to_success:3, by_class:{other_error:1, other_hook:1}});
      assert.equal(data.overall.calls, 6);
    }
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
