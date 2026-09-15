'use strict';
const fs = require('fs'); const path = require('path'); const os = require('os');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd-repro-'));
const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo);
const g = (a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' }).trim();
g(['init', '-q', '-b', 'main']); g(['config','user.email','t@t']); g(['config','user.name','t']);
fs.writeFileSync(path.join(repo, 'README'), 'x\n'); g(['add','README']); g(['commit','-qm','init']);
process.env.RUN_LEDGER_MAX_BYTES = process.argv[3] || '1500';
process.env.RUN_LEDGER_MAX_ROTATIONS = process.argv[4] || '1';
const fx = require(path.join(root, 'hooks/tests/lib/implementation-campaign-ledger-fixture'));
try {
  const built = fx.buildTerminalReadyCampaignLedger({ root, repo, ticket: 'd-repro' });
  console.log('OK', built.projection.state.phase);
} catch (e) { console.log('FAIL', e.message); }
const ledger = path.join(repo, '.git', 'autopilot', 'implementation-campaign.jsonl');
for (const f of fs.readdirSync(path.dirname(ledger))) if (f.startsWith('implementation-campaign.jsonl')) {
  const p = path.join(path.dirname(ledger), f); if (fs.statSync(p).isFile()) {
  const rows = fs.readFileSync(p,'utf8').split('\n').filter(Boolean).map(JSON.parse);
  console.log(f, rows.length, rows.filter(r=>r.kind==='journal').map(r=>(r._rotation_carry?'C:':'O:')+(r.op==='campaign_intake'?'intake':JSON.parse(r.payload).event.event_type)).join(' '));
}}
