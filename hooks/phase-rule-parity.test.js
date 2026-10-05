'use strict';
// hooks/phase-rule-parity.test.js — mods P1W W4 REPAIR-2 (phase-length-units): the phase WRITER
// (scripts/session-mode.js parsePhase) and the READER (src/status/phase-input.js validPhase) must reach identical
// verdicts. Both are fed the same strings. RED before the repair (reader counted UTF-16 units and let C1 through):
// 64-code-point emoji string and C1 control verdicts diverged (2 failures).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const { validPhase } = require(path.join(root, 'src/status/phase-input.js'));
const cli = path.join(root, 'scripts/session-mode.js');
const fs = require('node:fs');
const os = require('node:os');

// parsePhase is not exported; load it through its source with the main guard avoided by extracting the function.
const src = fs.readFileSync(cli, 'utf8');
const m = src.match(/const PHASE_MAX = \d+;/)[0] + '\n' + src.match(/function parsePhase[\s\S]*?\n}\n/)[0] + '\nmodule.exports = parsePhase;';
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'phase-parity-')), 'p.js');
fs.writeFileSync(tmp, m);
const parsePhase = require(tmp);

const cases = {
  'plain ascii': 'implement W1',
  '64 CJK': '實'.repeat(64),
  '64 code points with emoji': '😀'.repeat(64),
  '65 code points': 'a'.repeat(65),
  'C1 control': 'abc\u0085def',
  'DEL': 'abc\u007fdef',
};

for (const [name, value] of Object.entries(cases)) {
  test(`writer and reader agree: ${name}`, () => {
    const writerOk = parsePhase(value).error === undefined;
    assert.strictEqual(validPhase(value), writerOk);
  });
}
test('expected verdicts', () => {
  const v = Object.fromEntries(Object.entries(cases).map(([k, s]) => [k, validPhase(s)]));
  assert.deepStrictEqual(v, { 'plain ascii': true, '64 CJK': true, '64 code points with emoji': true, '65 code points': false, 'C1 control': false, DEL: false });
});
