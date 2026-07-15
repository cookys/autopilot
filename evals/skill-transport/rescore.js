#!/usr/bin/env node
'use strict';
// rescore.js — recompute the `caught` field of every known-bad row in a matrix JSONL from the
// STORED verdict+findings and the current predicate set. Auditability tool: proves `caught` is a
// pure function of (verdict, findings, predicate) and lets a predicate finalized during Phase-0
// validation be applied to already-collected rows WITHOUT re-spending. Rows without a `findings`
// field are left untouched (and reported), since they predate findings storage.
// Node built-ins only. Usage: rescore.js --in <jsonl> [--match-dir <d>] [--write]
const fs = require('fs');
const path = require('path');
const { isNonShipVerdict, predicateSatisfied, loadPredicate } = require('./match-eval.js');

function arg(n){ const i=process.argv.indexOf('--'+n); return i>=0?process.argv[i+1]:undefined; }
const IN = arg('in');
const MATCH_DIR = arg('match-dir') || path.join(__dirname,'match');
const WRITE = process.argv.includes('--write');
if (!IN){ process.stderr.write('usage: rescore.js --in <jsonl> [--match-dir <d>] [--write]\n'); process.exit(2); }

const lines = fs.readFileSync(IN,'utf8').split('\n');
let changed=0, nofind=0, out=[];
const predCache={};
for (const line of lines){
  if(!line.trim()){ out.push(line); continue; }
  let r; try { r=JSON.parse(line); } catch(e){ out.push(line); continue; }
  if (r.case_set==='known-bad'){
    if (typeof r.findings !== 'string'){ nofind++; out.push(JSON.stringify(r)); continue; }
    let pred = predCache[r.case]; if(!pred){ try{pred=loadPredicate(r.case,MATCH_DIR); predCache[r.case]=pred;}catch(e){ out.push(JSON.stringify(r)); continue; } }
    const newCaught = isNonShipVerdict(r.verdict) && predicateSatisfied(pred, r.findings);
    if (r.caught !== newCaught){ changed++; process.stderr.write(`rescored ${r.cell_key}: ${r.caught} -> ${newCaught}\n`); r.caught=newCaught; }
  }
  out.push(JSON.stringify(r));
}
process.stderr.write(`rescore: changed=${changed} rows_without_findings=${nofind}${WRITE?' (WRITTEN)':' (dry-run; pass --write)'}\n`);
if (WRITE){ fs.writeFileSync(IN, out.join('\n')); }
