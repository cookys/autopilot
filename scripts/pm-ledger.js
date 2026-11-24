#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const {configPath} = require('./lib/config-path');
function fail(message, code) { console.error(message); process.exit(code); }
function lint(text) {
  if (!text.trim()) return '條目不得為空';
  if ([...text].length > 2000) return '條目超過 2000 字元';
  if (/[a-f\d]{64}/i.test(text)) return '條目含疑似密鑰';
  if (/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(text)) return '條目含控制字元';
  return null;
}
function config() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')).pm_ledger || {}; }
  catch (e) { if (e.code === 'ENOENT') return {}; fail('無法讀取設定', 2); }
}
const cmd = process.argv[2];
if (cmd === 'lint' || cmd === 'write') {
  const text = fs.readFileSync(0, 'utf8');
  const error = lint(text);
  if (error) fail(error, 1);
  if (cmd === 'lint') process.exit(0);
  const file = config().ledger_sh;
  if (typeof file !== 'string' || !file.trim()) fail('未設定 pm_ledger.ledger_sh', 2);
  const result = spawnSync('sh', [file], {input:text, stdio:['pipe','inherit','inherit']});
  if (result.error || result.status === null) fail('無法執行 ledger.sh', 2);
  process.exit(result.status);
}
if (cmd === 'search') {
  const file = config().ledger_file;
  if (typeof file !== 'string' || !file.trim()) fail('未設定 pm_ledger.ledger_file', 2);
  let regex, data;
  try { regex = new RegExp(process.argv[3]); if (process.argv.length !== 4) throw new Error(); }
  catch { fail('搜尋規則無效', 2); }
  try { data = fs.readFileSync(file, 'utf8'); } catch { fail('無法讀取 ledger 檔案', 2); }
  const lines = data.split('\n'); if (lines.at(-1) === '') lines.pop();
  const matches = lines.filter(line => regex.test(line));
  for (const line of matches.slice(-30)) console.log(line);
  if (matches.length > 30) console.log(`…另有 ${matches.length - 30} 行`);
  process.exit(0);
}
fail('用法：pm-ledger lint|write|search <規則>', 2);
