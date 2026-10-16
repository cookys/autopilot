#!/usr/bin/env node
// summarize.js: one line per out/<dir>: status, quality, per-case outcomes from raw/owner-exchanges.jsonl
const fs=require('fs'),path=require('path');
const O=path.join(__dirname,'out');
for(const d of fs.readdirSync(O).sort()){
  const p=path.join(O,d); if(!fs.statSync(p).isDirectory()) continue;
  let line=d+': ';
  try{const r=JSON.parse(fs.readFileSync(path.join(p,'emit-row.json'),'utf8'));line+=`${r.status} ${JSON.stringify(r.quality)} wall=${r.latency&&r.latency.sample_wall_time_s}s`;}catch(e){line+='no emit-row';}
  try{const lines=fs.readFileSync(path.join(p,'raw/owner-exchanges.jsonl'),'utf8').trim().split('\n').map(JSON.parse);line+=` exch=${lines.length} keys=${Object.keys(lines[0]).join('|')}`;}catch(e){}
  console.log(line);
}
