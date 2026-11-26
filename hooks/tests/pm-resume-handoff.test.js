'use strict';
// S5F A-a read side (Fleet-Task 01M8BSC21M4SEMM5H47JRZSPXD): after /clear the SessionStart resume block carries the
// newest handoff and warns (at the top of the block) when UNLANDED is not "無" or a handoff task id is missing from the resume.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildResumeBlock } = require('../lib/pm-resume.js');

const ID_A = '01M8BSC21M4SEMM5H47JRZSPXD';
const ID_B = '01M8BRKSWB8GGBFWMGJ4M9PZ6B';
const ID_C = '01M89VNHNGCRA45659VGT93S9Y';

function fixture(handoffs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-resume-handoff-'));
  const hdir = path.join(dir, 'handoff');
  fs.mkdirSync(hdir, { recursive: true });
  let t = Date.now() / 1000 - 1000;
  for (const [name, body] of handoffs) {
    const f = path.join(hdir, name);
    fs.writeFileSync(f, body);
    t += 100;
    fs.utimesSync(f, t, t);
  }
  const env = { ...process.env, XDG_RUNTIME_DIR: dir, AUTOPILOT_MODEL_HANDOFF_DIR: hdir, FLEET_ADDRESS: 'cookys/aimax395/pm--claude' };
  return { dir, env, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const resume = (unlanded, ids) => ({
  status: 0, stderr: '',
  stdout: ['RESUME pm--claude 角色 pm', unlanded, ...ids.map((i) => `IN_FLIGHT ${i} x  y`), 'NEEDS_REPLY 0（無）'].join('\n'),
});
const block = (env, source, run) => {
  const saved = process.env.AUTOPILOT_MODEL_HANDOFF_DIR;
  process.env.AUTOPILOT_MODEL_HANDOFF_DIR = env.AUTOPILOT_MODEL_HANDOFF_DIR;
  try { return buildResumeBlock({ source, session_id: 'new-sid' }, { env, runner: () => run }); } finally {
    if (saved === undefined) delete process.env.AUTOPILOT_MODEL_HANDOFF_DIR; else process.env.AUTOPILOT_MODEL_HANDOFF_DIR = saved;
  }
};
const HAND = `## 目標\n接續 S5F\n## 下一步\n1. 做 ${ID_A}\n2. 回 ${ID_B}\n## 操作員最近說的話\n先做讀取端\n`;

test('clear on the PM seat: the newest handoff content is inside the block', () => {
  const f = fixture([['old.md', '## 目標\nOLDOLD\n'], ['new.md', HAND]]);
  try {
    const out = block(f.env, 'clear', resume('UNLANDED 無', [ID_A, ID_B]));
    assert.match(out, /<handoff[^>]*>/);
    assert.ok(out.includes('接續 S5F') && out.includes('先做讀取端'));
    assert.ok(!out.includes('OLDOLD'), 'only the newest handoff is read');
  } finally { f.cleanup(); }
});

test('non-clear sources never read a handoff (negative control)', () => {
  const f = fixture([['new.md', HAND]]);
  try {
    for (const source of ['startup', 'resume', 'compact']) {
      assert.ok(!block(f.env, source, resume('UNLANDED 無', [ID_A, ID_B])).includes('接續 S5F'), source);
    }
  } finally { f.cleanup(); }
});

test('UNLANDED other than 無 puts a warning before the resume data; 無 gives none', () => {
  const f = fixture([['new.md', HAND]]);
  try {
    const bad = block(f.env, 'clear', resume('UNLANDED 有 2 筆（操作員最後一句之後沒有落地紀錄）', [ID_A, ID_B]));
    const w = bad.indexOf('UNLANDED');
    assert.ok(/⚠[^\n]*UNLANDED/.test(bad), 'warning line');
    assert.ok(bad.search(/⚠[^\n]*UNLANDED/) < bad.indexOf('<fleet-pm-resume'), 'warning is above the resume block');
    assert.ok(w >= 0);
    const good = block(f.env, 'clear', resume('UNLANDED 無', [ID_A, ID_B]));
    assert.ok(!/⚠[^\n]*UNLANDED/.test(good));
  } finally { f.cleanup(); }
});

test('a handoff task id missing from the resume is listed in the warning; whole-token match only', () => {
  const f = fixture([['new.md', HAND]]);
  try {
    const miss = block(f.env, 'clear', resume('UNLANDED 無', [ID_A, ID_C]));
    assert.ok(/⚠[^\n]*單號[^\n]*/.test(miss));
    const warn = miss.split('\n').filter((l) => l.startsWith('⚠')).join('\n');
    assert.ok(warn.includes(ID_B) && !warn.includes(ID_A), 'lists only the missing id');
    const none = block(f.env, 'clear', resume('UNLANDED 無', [ID_A, ID_B]));
    assert.ok(!none.split('\n').some((l) => l.startsWith('⚠')));
    // a longer token that merely contains the id must not count as present
    const sub = block(f.env, 'clear', { status: 0, stderr: '', stdout: `UNLANDED 無\nIN_FLIGHT ${ID_A}X ${ID_A}\n${ID_B}Y` });
    assert.ok(sub.split('\n').filter((l) => l.startsWith('⚠')).join('\n').includes(ID_B));
  } finally { f.cleanup(); }
});

test('no handoff file: one line says so, resume still delivered', () => {
  const f = fixture([]);
  try {
    const out = block(f.env, 'clear', resume('UNLANDED 無', [ID_A]));
    assert.ok(out.includes('<fleet-pm-resume'));
    assert.ok(/handoff[^\n]*(沒有|找不到|讀不到)/.test(out));
  } finally { f.cleanup(); }
});
