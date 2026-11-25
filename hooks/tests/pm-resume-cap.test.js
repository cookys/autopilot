'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { capResumeSections, buildResumeBlock } = require('../lib/pm-resume.js');

function runTests() {
  // 1. Reverse probe: 20 IN_FLIGHT rows (300 chars each = 6000+ chars) + 5 NEEDS_REPLY rows + overflowing WAITING_ON_PM.
  const inFlightRows = Array.from({ length: 20 }, (_, i) => {
    const prefix = `01M89VND4KYEMRFWDJEEAED${String(i).padStart(3, '0')} `;
    return prefix + 'x'.repeat(300 - prefix.length);
  });
  const needsReplyRows = Array.from({ length: 5 }, (_, i) => `NR-${i} please reply to this item`);
  const waitingRows = Array.from({ length: 40 }, (_, i) => `WAIT-${i} ` + 'w'.repeat(100));

  const fixture = [
    'IN_FLIGHT (20)',
    ...inFlightRows,
    'NEEDS_REPLY (5)',
    ...needsReplyRows,
    'WAITING_ON_PM (40)',
    ...waitingRows,
  ].join('\n');

  const capped = capResumeSections(fixture, { softCapChars: 3000, maxRowChars: 400 });

  for (const row of inFlightRows) {
    assert(capped.includes(row), `Missing IN_FLIGHT row: ${row.slice(0, 30)}`);
  }
  for (const row of needsReplyRows) {
    assert(capped.includes(row), `Missing NEEDS_REPLY row: ${row}`);
  }
  assert(/已省略 \d+ 列/.test(capped), 'Expected truncated section to include 已省略 N 列');
  assert(!capped.includes(waitingRows[39]), 'Expected overflowing WAITING_ON_PM tail to be omitted');

  // Verify non-exempt section stays within softCapChars (3000).
  const waitingStart = capped.indexOf('WAITING_ON_PM (40)');
  assert(waitingStart !== -1, 'Expected WAITING_ON_PM header to be present');
  const waitingPortion = capped.slice(waitingStart);
  assert(/WAITING_ON_PM 已省略 \d+ 列/.test(capped), 'omission marker must name the section');
  assert(waitingPortion.length <= 3000, `Other sections exceeded 3000 chars: ${waitingPortion.length}`);

  // 2. Single row > 400 chars in IN_FLIGHT / NEEDS_REPLY is shortened, not dropped.
  const longRow = '01M89VND4KYEMRFWDJEEAED999 ' + 'z'.repeat(500);
  const longFixture = ['IN_FLIGHT (1)', longRow].join('\n');
  const longCapped = capResumeSections(longFixture, { softCapChars: 3000, maxRowChars: 400 });
  const resultLines = longCapped.split('\n');
  assert.strictEqual(resultLines.length, 2, 'Long row must not be dropped');
  assert(resultLines[1].length <= 400, `Long row exceeded 400 chars: ${resultLines[1].length}`);
  assert(resultLines[1].startsWith('01M89VND4KYEMRFWDJEEAED999 '), 'Long row prefix must be preserved');

  // 3. buildResumeBlock: startup uses capResumeSections, compact uses digestResume.
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-resume-cap-'));
  try {
    const env = { HOME: tmpHome, FLEET_ADDRESS: 'hangar--claude@host' };
    const runner = () => ({ status: 0, stdout: fixture, stderr: '' });

    const startupOut = buildResumeBlock({ source: 'startup', session_id: 's1' }, { env, runner });
    assert(startupOut.includes(inFlightRows[19]), 'startup must keep all 20 IN_FLIGHT rows');
    assert(startupOut.includes(needsReplyRows[4]), 'startup must keep all 5 NEEDS_REPLY rows');
    assert(/已省略 \d+ 列/.test(startupOut), 'startup must truncate overflowing other sections');

    const compactOut = buildResumeBlock({ source: 'compact', session_id: 's2' }, { env, runner });
    assert(compactOut.includes('其餘自己查：fleet pm resume --seat hangar--claude --role lead --all'), 'compact must keep digestResume behavior');
  } finally {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }

  
  // 4. Real fleet format: one row per line, keyed by leading token.
  const real = ['RESUME x', ...Array.from({length: 20}, (_, i) => 'IN_FLIGHT 01M89' + i + ' ' + 'y'.repeat(300)), 'NEEDS_REPLY 0（無）', ...Array.from({length: 60}, (_, i) => 'TASK 01M' + i + ' ' + 't'.repeat(100))].join('\n');
  const realOut = capResumeSections(real);
  assert.strictEqual(realOut.split('\n').filter((l) => l.startsWith('IN_FLIGHT')).length, 20, 'all real-format IN_FLIGHT rows kept');
  assert(/TASK 已省略 \d+ 列/.test(realOut), 'real-format TASK overflow reports omission');
  assert(realOut.split('\n').filter((l) => l.startsWith('IN_FLIGHT')).every((l) => l.length <= 400), 'real-format rows shortened to 400');

  // 5. Reverse probe: whole-output slice (the old behavior) would lose rows.
  assert(real.slice(0, 3000).split('\n').filter((l) => l.startsWith('IN_FLIGHT')).length < 20, 'sanity: naive slice drops rows');
  console.log('PASS: pm-resume-cap.test.js');
}

runTests();
