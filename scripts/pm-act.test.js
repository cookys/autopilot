'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pm-act-test-'));
try {
  const config = path.join(dir,'config.json'), planfile = path.join(dir,'act.json'), log = path.join(dir,'log');
  const helper = path.join(dir,'helper.js');
  fs.writeFileSync(helper, `const fs=require('fs');const s=fs.readFileSync(0,'utf8');if(process.argv[2]==='lint')process.exit(s==='bad'?1:0);fs.appendFileSync(process.env.LOG,process.argv[2]+':'+s+'\\n');if(process.argv[2]==='fleet' && JSON.parse(s).message_id && fs.existsSync(process.env.FAIL))process.exit(1);`);
  const command = arg => `${JSON.stringify(process.execPath)} ${JSON.stringify(helper)} ${arg}`;
  const cfg = {pm_act:{ledger_lint_cmd:command('lint'),ledger_write_cmd:command('ledger'),fleet_send_cmd:command('fleet')}};
  const env = {...process.env,HOME:dir,XDG_STATE_HOME:path.join(dir,'state'),AUTOPILOT_CONFIG_FILE:config,LOG:log,FAIL:path.join(dir,'fail')};
  const run = (...args) => spawnSync(process.execPath,[path.join(__dirname,'pm-act.js'),'--plan',planfile,...args],{env,encoding:'utf8'});
  const plan = {schema:'autopilot.pm-act/1',dispatch:[{to:'a',task:'Size: M\nPlan: plan-first'}],reply:[{message_id:'m',content:'hello'}],ledger:[{text:'ok'}]};
  const write = () => {fs.writeFileSync(config,JSON.stringify(cfg));fs.writeFileSync(planfile,JSON.stringify(plan));};
  write(); plan.ledger[0].text='bad'; write(); assert.equal(run().status,2); assert.equal(fs.existsSync(log),false,'preflight must prevent effects');
  plan.ledger[0].text='ok'; plan.dispatch[0].task='Size: M'; write(); assert.equal(run().status,2); assert.equal(fs.existsSync(log),false);
  plan.dispatch[0].task='Size: M\nPlan: plan-first'; write(); assert.equal(run('--check').status,0); assert.equal(fs.existsSync(log),false);
  fs.writeFileSync(env.FAIL,''); const failed=run(); assert.equal(failed.status,1); assert.match(failed.stdout,/done[\s\S]*done[\s\S]*failed/);
  fs.unlinkSync(env.FAIL); assert.equal(run().status,0); const lines=fs.readFileSync(log,'utf8').trim().split('\n'); assert.deepEqual(lines.map(x=>x.split(':')[0]),['ledger','fleet','fleet','fleet']);
  fs.rmSync(env.XDG_STATE_HOME,{recursive:true,force:true}); fs.unlinkSync(log); delete cfg.pm_act.fleet_send_cmd; write();
  const pending=run(); assert.equal(pending.status,0); assert.match(pending.stdout,/message_id/); assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1);
  assert.equal(run('--confirm','d1,m1').status,0); assert.match(run().stdout,/skipped/);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
