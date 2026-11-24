#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const {configPath} = require('./lib/config-path');
const workOrder = require('./lib/work-order-plan');
function fail(message, code=2) { console.error(message); process.exit(code); }
const args = process.argv.slice(2); let file, check = false, confirmation;
for (let i=0;i<args.length;i++) {
  if (args[i] === '--plan' && args[i+1]) file=args[++i];
  else if (args[i] === '--check') check=true;
  else if (args[i] === '--confirm' && args[i+1]) confirmation=args[++i].split(',').filter(Boolean);
  else fail('參數無效');
}
if (!file) fail('缺少 --plan');
let raw, plan, config;
try { raw=fs.readFileSync(file); plan=JSON.parse(raw); } catch { fail('無法讀取計畫'); }
try { config=JSON.parse(fs.readFileSync(configPath(),'utf8')); } catch (e) { if (e.code === 'ENOENT') config={}; else fail('無法讀取設定'); }
const cfg=config.pm_act || {};
const defaultCmd = action => `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(__dirname,'pm-ledger.js'))} ${action}`;
const lintCmd=cfg.ledger_lint_cmd === undefined ? defaultCmd('lint') : cfg.ledger_lint_cmd;
const writeCmd=cfg.ledger_write_cmd === undefined ? defaultCmd('write') : cfg.ledger_write_cmd;
const errors=[];
if (!plan || typeof plan !== 'object' || Array.isArray(plan) || plan.schema !== 'autopilot.pm-act/1' || Object.keys(plan).some(k=>!['schema','ledger','dispatch','reply'].includes(k))) fail('計畫格式無效');
for (const kind of ['ledger','dispatch','reply']) if (!Array.isArray(plan[kind])) errors.push(`${kind} 必須是陣列`);
if (errors.length) fail(errors.join('\n'));
const validString = value => typeof value === 'string' && value.trim().length > 0;
function run(cmd,input) { return spawnSync(cmd, {shell:true,input,encoding:'utf8',stdio:['pipe','ignore','ignore']}); }
for (const [i,item] of plan.dispatch.entries()) {
  if (!item || !validString(item.to) || !validString(item.task) || (item.class !== undefined && !validString(item.class))) { errors.push(`dispatch ${i+1} 格式無效`); continue; }
  const parsed=workOrder.parse(item.task);
  if (!parsed.size || parsed.size === 'conflict') errors.push(`dispatch ${i+1} 缺少有效 Size`);
  else if (workOrder.isMPlus(parsed.size) && !parsed.plan) errors.push(`dispatch ${i+1} 缺少 Plan`);
}
for (const [i,item] of plan.reply.entries()) if (!item || !validString(item.message_id) || !validString(item.content)) errors.push(`reply ${i+1} 格式無效`);
if (plan.ledger.length && (!validString(lintCmd) || !validString(writeCmd))) errors.push('未設定 ledger 命令');
for (const [i,item] of plan.ledger.entries()) {
  if (!item || typeof item.text !== 'string') { errors.push(`ledger ${i+1} 格式無效`); continue; }
  if (validString(lintCmd) && run(lintCmd,item.text).status !== 0) errors.push(`ledger ${i+1} 檢查失敗`);
}
if (cfg.fleet_send_cmd !== undefined && !validString(cfg.fleet_send_cmd)) errors.push('fleet 命令無效');
if (errors.length) fail(errors.join('\n'));
if (check) { console.log('preflight 通過'); process.exit(0); }
const state=cfg.state_dir || process.env.XDG_STATE_HOME || path.join(os.homedir(),'.local','state');
const dir=path.join(state,'pm-act'); const journalPath=path.join(dir,crypto.createHash('sha256').update(raw).digest('hex')+'.json');
let journal={completed:{}};
try { journal=JSON.parse(fs.readFileSync(journalPath,'utf8')); if (!journal.completed || typeof journal.completed !== 'object') throw new Error(); } catch(e) { if (e.code !== 'ENOENT') fail('無法讀取 journal'); }
function save() { fs.mkdirSync(dir,{recursive:true,mode:0o700}); const temp=journalPath+'.'+process.pid+'.tmp'; fs.writeFileSync(temp,JSON.stringify(journal),{mode:0o600}); fs.renameSync(temp,journalPath); }
const actions=[...plan.ledger.map((item,i)=>({kind:'ledger',item,key:`ledger:${i}`})),...plan.dispatch.map((item,i)=>({kind:'dispatch',item,key:`dispatch:${i}`})),...plan.reply.map((item,i)=>({kind:'reply',item,key:`reply:${i}`}))];
const pending=actions.filter(a=>a.kind !== 'ledger' && !journal.completed[a.key]);
if (confirmation && (cfg.fleet_send_cmd || confirmation.length !== pending.length || confirmation.some(x=>!validString(x)) || new Set(confirmation).size !== confirmation.length)) fail('確認的訊息 ID 數量無效');
let ci=0;
for (const action of actions) {
  if (journal.completed[action.key]) { console.log(`skipped ${action.key} 已完成`); continue; }
  if (action.kind !== 'ledger' && !cfg.fleet_send_cmd) {
    if (confirmation) { journal.completed[action.key]={message_id:confirmation[ci++]}; save(); console.log(`done ${action.key}`); }
    else console.log(`待 PM 呼叫 MCP ${action.kind} ${JSON.stringify(action.item)}`);
    continue;
  }
  const cmd=action.kind === 'ledger' ? writeCmd : cfg.fleet_send_cmd;
  const input=action.kind === 'ledger' ? action.item.text : JSON.stringify({type:action.kind,...action.item});
  const result=run(cmd,input);
  if (result.status !== 0) { console.log(`failed ${action.key}`); process.exit(1); }
  journal.completed[action.key]=true; save(); console.log(`done ${action.key}`);
}
