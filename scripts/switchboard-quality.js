#!/usr/bin/env node
'use strict';
// baseline extractor stdout: JSONL rows {ts,id,packet_id,handled,latency_ms,engine,tokens,turns}.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { configPath } = require('./lib/config-path');
function main() {
  const args = process.argv.slice(2);
  const config = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  if (args[0] !== 'baseline') throw Error('缺少必要設定或輸入');
  const days = Number(args[2]);
  if (args[1] !== '--days' || !Number.isInteger(days) || days < 1 || args.length !== 3) throw Error('天數無效');
  const script = config.switchboard && config.switchboard.extract_script;
  if (typeof script !== 'string' || !script) throw Error('未設定擷取腳本');
  const child = spawnSync(script, ['--days', String(days)], { encoding: 'utf8' });
  if (child.error || child.status !== 0) throw Error('擷取腳本執行失敗');
  const rows = child.stdout.split('\n').filter(Boolean).map(JSON.parse);
  const groups = {};
  for (const row of rows) {
    if (typeof row.ts !== 'string' || !Number.isFinite(row.tokens) || !Number.isFinite(row.turns)) throw Error('基準資料格式錯誤');
    const date = row.ts.slice(0, 10);
    const group = groups[date] ||= { tokens: 0, turns: 0 };
    group.tokens += row.tokens; group.turns += row.turns;
  }
  const daily = Object.entries(groups).map(([date, value]) => ({ date, turns: value.turns, tokens_per_turn: value.turns ? value.tokens / value.turns : null }));
  const dir = path.join(process.env.AUTOPILOT_STATE_DIR || path.join(os.homedir(), '.autopilot'), 'switchboard', 'quality');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ daily }, null, 2) + '\n', { mode: 0o600 });
  console.log('基準資料已建立');
}
try { main(); } catch { process.stderr.write('品質檢查失敗：設定或輸入無效\n'); process.exitCode = 1; }
