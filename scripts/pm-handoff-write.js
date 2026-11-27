#!/usr/bin/env node
'use strict';
// Write a PM handoff snapshot from the current fleet resume.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { modelNotePath } = require('./lib/compaction-handoff.js');
const { bin } = require('./lib/fleet-task.js');
// The text arrives already redacted by the courier; no answer or an old fleet binary means none.
function lastOperator() {
  const r = spawnSync(bin(), ['pm', 'resume', '--seat', 'pm--claude', '--role', 'pm', '--check', '--json'], { encoding: 'utf8', timeout: 2500 });
  try {
    const text = JSON.parse(r.stdout).last_operator.text;
    return typeof text === 'string' ? text.slice(-2000) : '';
  } catch { return ''; }
}

try {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--sid', '--operator-file', '--resume-file', '--out'].includes(args[i]) || !args[i + 1]) throw new Error('invalid arguments');
    opts[args[i]] = args[i + 1];
  }
  if (!opts['--sid']) throw new Error('--sid required');
  let operator = opts['--operator-file'] ? fs.readFileSync(opts['--operator-file'], 'utf8').slice(-2000) : '';
  let resume;
  if (opts['--resume-file']) resume = fs.readFileSync(opts['--resume-file'], 'utf8');
  else {
    const r = spawnSync(bin(), ['pm', 'resume', '--seat', 'pm--claude', '--role', 'pm'], { encoding: 'utf8', timeout: 25000 });
    if (r.error || r.status !== 0) throw new Error('fleet pm resume failed');
    resume = r.stdout;
  }
  // --resume-file is the offline form: it never calls fleet.
  if (!operator && !opts['--resume-file']) operator = lastOperator();
  operator = operator || '（無）';
  const ids = new Set();
  const rows = [];
  for (const row of resume.split(/\r?\n/)) {
    for (const id of row.match(/(?<![0-9A-Za-z])[0-9A-HJKMNP-TV-Z]{26}(?![0-9A-Za-z])/g) || []) {
      if (!ids.has(id)) { ids.add(id); rows.push(`- ${id} ${row.slice(0, 80)}`); }
    }
  }
  const body = `## 目標\n（無）\n\n## 現況\n見未完成事項及 fleet pm resume。\n\n## 已決事項(不重議)\n（無）\n\n## 下一步\n重查 fleet pm resume 並接續在途工作。\n\n## 驗證方式\n重查任務及其驗證結果。\n\n## Read-order\n先讀本 handoff，再讀 fleet pm resume。\n\n## 陷阱\n本檔為快照，狀態可能已改變。\n\n## 接續表\n\`\`\`yaml\noperator_thread: 無\nartifacts: 無\npending_rulings: 無\nsubagent_outputs: 無\ncard_notes:\n  executor: 無\n\`\`\`\n\n## 操作員最近說的話\n${operator || '（無）'}\n\n## 未完成事項\n${rows.join('\n') || '（無）'}\n`;
  const out = opts['--out'] || modelNotePath(opts['--sid'], {});
  fs.mkdirSync(path.dirname(out), { recursive: true, mode: 0o700 });
  fs.writeFileSync(out, body, { mode: 0o600 });
  fs.chmodSync(out, 0o600);
  process.stdout.write(`${out}\n`);
} catch (e) { process.stderr.write(`${e.message}\n`); process.exitCode = 1; }
