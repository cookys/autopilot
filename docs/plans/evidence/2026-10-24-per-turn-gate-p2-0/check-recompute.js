// Recompute the derived evidence files from the committed excerpts and compare. Run: node check-recompute.js (from this directory). Exit 1 on any difference.
const fs=require('fs');let bad=0;const rd=f=>fs.readFileSync(f,'utf8');const say=(ok,m)=>{console.log((ok?'ok  ':'FAIL ')+m);if(!ok)bad=1};
const readings=rd('readings.txt').split('\n');
let cost=[];
for(const t of ['t1','t2','t3','t4']){
  const d='raw-excerpts/'+t;const sect=[];let on=false;for(const l of readings){if(l==='## '+t){on=true;continue}if(l.startsWith('## ')){on=false}if(on)sect.push(l)}
  const jl=sect.filter(l=>l.startsWith('{')).map(l=>JSON.parse(l));
  const calc=[];for(const f of fs.readdirSync(d).filter(x=>x.endsWith('hook.log')).sort())for(const l of rd(d+'/'+f).trim().split('\n')){const o=JSON.parse(l),s=o.stdin;calc.push({call:o.call,decision:o.decision,session_id:s.session_id,prompt_id:s.prompt_id,stop_hook_active:s.stop_hook_active})}
  say(JSON.stringify(jl)===JSON.stringify(calc),t+' hook decision lines in readings.txt equal the hook logs');
  for(const f of fs.readdirSync(d).filter(x=>x.startsWith('stream-excerpt'))){for(const l of rd(d+'/'+f).trim().split('\n')){const o=JSON.parse(l);if(o.type==='result')cost.push(o.total_cost_usd)}}
}
const m=/sum=([0-9.e-]+)/.exec(readings.find(l=>l.startsWith('costs'))||'');
say(m&&Math.abs(cost.reduce((a,b)=>a+b,0)+0.032369-Number(m[1]))<1e-9,'cost sum in readings.txt = result objects in excerpts + 0.032369');
// call times: first debug timestamp
const ct=rd('call-times.txt').split('\n').filter(l=>/^t\d \|/.test(l));
for(const l of ct){const [t,sf,first]=l.split(' | ');const tag=sf.replace(/^stream-/,'').replace(/\.jsonl$/,'');const f='raw-excerpts/'+t+'/debug-stop-lines-'+tag+'.txt';const got=rd(f).split('\n')[0].replace('first debug line: ','');say(got===first,t+' '+sf+' first debug timestamp '+first)}
// stop events: number of "Hooks: Stop [" finished lines per trial file equals hooks listed in stop-events.txt
const se=rd('stop-events.txt').split('\n').filter(l=>/^t\d /.test(l));let listed=0;for(const l of se)listed+=(l.match(/ status=\d+ /g)||[]).length;
let counted=0;for(const t of ['t1','t2','t3','t4'])for(const f of fs.readdirSync('raw-excerpts/'+t).filter(x=>x.startsWith('debug-stop-lines')))counted+=(rd('raw-excerpts/'+t+'/'+f).match(/Hooks: Stop \[.*finished with status/g)||[]).length;
say(listed===counted,'stop-events.txt lists '+listed+' hook executions; debug excerpts hold '+counted);
process.exit(bad);
