#!/usr/bin/env node
'use strict';
// extract-tokens.js — best-effort per-review token count from a dispatcher raw_log.
// The shared review JSON deliberately carries no tokens field (dispatch-review.sh SSOT), so
// cost telemetry is recovered here from the runner's raw log if — and only if — a reliable
// count is present. Returns the integer total (input+output) on stdout, or NOTHING (empty)
// when no trustworthy count can be extracted. NEVER fabricates. Node built-ins only.
//
// Recognized shapes (in order):
//   1. whole-file JSON with a usage object   -> usage.input_tokens + usage.output_tokens
//   2. JSONL lines, last object carrying usage
//   3. loose regex  input_tokens ... N / output_tokens ... N
//   4. codex-chrome footer  "tokens used: N"
//
// Usage: extract-tokens.js --log <path> [--runner <name>]
const fs = require('fs');
function arg(name){ const i=process.argv.indexOf('--'+name); return i>=0?process.argv[i+1]:undefined; }
const logPath = arg('log');
if (!logPath){ process.exit(0); }
let txt='';
try { txt = fs.readFileSync(logPath,'utf8'); } catch(e){ process.exit(0); }

function usageSum(u){
  if (!u || typeof u!=='object') return null;
  const inp = Number(u.input_tokens ?? u.inputTokens ?? u.prompt_tokens ?? u.input);
  const out = Number(u.output_tokens ?? u.outputTokens ?? u.completion_tokens ?? u.output);
  const parts=[]; if(Number.isFinite(inp)) parts.push(inp); if(Number.isFinite(out)) parts.push(out);
  if (parts.length===0) return null;
  return parts.reduce((a,b)=>a+b,0);
}
function findUsage(obj, depth){
  if (depth>6 || obj===null || typeof obj!=='object') return null;
  if (obj.usage){ const s=usageSum(obj.usage); if(s!=null) return s; }
  const direct = usageSum(obj); if (direct!=null && (('input_tokens'in obj)||('output_tokens'in obj))) return direct;
  for (const k of Object.keys(obj)){
    const v=obj[k];
    if (v && typeof v==='object'){ const s=findUsage(v,depth+1); if(s!=null) return s; }
  }
  return null;
}

// 1. whole-file JSON
try { const o=JSON.parse(txt); const s=findUsage(o,0); if(s!=null){ process.stdout.write(String(s)); process.exit(0);} } catch(e){}

// 2. JSONL — last line with a usage
let last=null;
for (const line of txt.split('\n')){
  const t=line.trim(); if(!t) continue;
  try { const o=JSON.parse(t); const s=findUsage(o,0); if(s!=null) last=s; } catch(e){}
}
if (last!=null){ process.stdout.write(String(last)); process.exit(0); }

// 3. loose regex
const mi = txt.match(/input_tokens["'\s:]+(\d+)/i);
const mo = txt.match(/output_tokens["'\s:]+(\d+)/i);
if (mi || mo){
  const s=(mi?parseInt(mi[1],10):0)+(mo?parseInt(mo[1],10):0);
  if (s>0){ process.stdout.write(String(s)); process.exit(0);}
}

// 4. codex chrome
const mc = txt.match(/tokens used[:\s]+(\d[\d,]*)/i);
if (mc){ process.stdout.write(String(parseInt(mc[1].replace(/,/g,''),10))); process.exit(0); }

// nothing trustworthy
process.exit(0);
