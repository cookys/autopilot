// Emulates the selector (scripts/benchmark-hook-multiplexer.js lines 88-124, extracted verbatim via vm) over every hooks.json command entry.
const fs=require('fs'),vm=require('vm'),path=require('path');
const repo='/home/cookys/projects/autopilot';
const src=fs.readFileSync(repo+'/scripts/benchmark-hook-multiplexer.js','utf8').split('\n');
const body=src.slice(87,124).join('\n'); // lines 88..124
const ctx={fs,path,JSON,RegExp,Set,Array};vm.createContext(ctx);
vm.runInContext(body+'\nthis.registrations=registrations;',ctx);
// fixture payload logic copied from lines 76-82
const payloadFor=ev=>JSON.stringify({hook_event_name:ev,tool_name:ev==='Stop'?'':ev==='PostToolUse'?'Write':'Bash',tool_input:{command:'true'}});
const hooks=JSON.parse(fs.readFileSync(repo+'/hooks/hooks.json','utf8'));
const optin=new Set(JSON.parse(fs.readFileSync(repo+'/hooks/opt-in-manifest.json','utf8')).opt_in);
let rows=[];
for(const [ev,groups] of Object.entries(hooks.hooks))for(const g of groups)for(const h of g.hooks){
  const m=h.command.match(/hooks\/([^/]+\.js)(?:\s+(.*))?$/);const script=m&&m[1];
  const sel=ctx.registrations(repo,{event:ev},payloadFor(ev));
  const hit=sel.some(s=>s.scriptName===script&&JSON.stringify(s.args)===JSON.stringify((m[2]||'').trim().split(/\s+/).filter(Boolean)));
  rows.push({ev,matcher:g.matcher||'',script,args:m[2]||'',optin:optin.has(script.slice(0,-3)),selected:hit});
}
console.table(rows);
console.log('total',rows.length,'selected',rows.filter(r=>r.selected).length,'non-selected',rows.filter(r=>!r.selected).length);
console.log('selected scripts:',[...new Set(rows.filter(r=>r.selected).map(r=>r.script+' '+r.args))]);
