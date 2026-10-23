#!/usr/bin/env node
'use strict';
const fs=require('fs');
const event=process.argv[2]||'?';
const logf=process.env.P0_LOG, cnt=process.env.P0_COUNTER;
let raw=''; try{raw=fs.readFileSync(0,'utf8');}catch(e){}
let stdin=null; try{stdin=JSON.parse(raw);}catch(e){stdin=raw;}
if(process.env.P0_ONLY && process.env.P0_ONLY!==event){ fs.appendFileSync(logf,JSON.stringify({ts:new Date().toISOString(),event,decision:'allow(ignored)',stdin})+'\n'); process.exit(0); }
let remaining=0, call=0;
try{ const c=JSON.parse(fs.readFileSync(cnt,'utf8')); remaining=c.remaining|0; call=c.calls|0; }catch(e){}
call+=1;
let out='';
if(remaining>0){
  remaining-=1;
  const reasons=['REASON-ONE: before stopping, reply with the single word ALPHA.','REASON-TWO: before stopping, reply with the single word BETA.','REASON-THREE: reply GAMMA.'];
  out=JSON.stringify({decision:'block',reason:reasons[Math.min(call-1,2)]});
}
fs.writeFileSync(cnt,JSON.stringify({remaining,calls:call}));
fs.appendFileSync(logf,JSON.stringify({ts:new Date().toISOString(),event,call,decision:out?'block':'allow',stdout:out,stdin})+'\n');
if(out) process.stdout.write(out);
process.exit(0);
