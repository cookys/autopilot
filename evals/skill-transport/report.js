#!/usr/bin/env node
'use strict';
// report.js — fold the skill-transport matrix JSONL into paired tables + decision-rule inputs
// (plan §3, §5). Deterministic, Node built-ins only, NO LLM in the count path.
//
// It reports data; it does NOT declare adopt/refute — the §5 call is depth-0's (the rules are
// advisory clamps against motivated reasoning). The mechanical rule-threshold checks are printed
// as ADVISORY so a human sees where each metric sits relative to its bound.
//
// Per engine × arm it computes: caught known-bad cases (MAJORITY-of-k per cell), no_verdict
// rate, clean over-flag (majority-of-k), specificity, false-pass-on-critical, false-pass-on-major.
// Cross-arm: discordant pairs (pack vs nopack; placebo vs nopack), within-cell flip band, and the
// format_conflict guard (pack no_verdict exceeds nopack by > 1 case on an engine).
//
// Usage: report.js --in <matrix.jsonl> [--match-dir <d>] [--json]

const fs = require('fs');
const path = require('path');

function parseArgs(argv){
  const a={_:[]};
  for(let i=0;i<argv.length;i++){
    const t=argv[i];
    if(t.startsWith('--')){
      const next=argv[i+1];
      if(next===undefined || next.startsWith('--')){ a[t.slice(2)]=true; }
      else { a[t.slice(2)]=next; i++; }
    } else a._.push(t);
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));
const IN = args.in;
const MATCH_DIR = args['match-dir'] || path.join(__dirname, 'match');
const AS_JSON = 'json' in args;
if (!IN) { process.stderr.write('usage: report.js --in <matrix.jsonl> [--json]\n'); process.exit(2); }

// Load per-case class from the predicate sidecars (critical|major).
function caseClass(caseId){
  try { return JSON.parse(fs.readFileSync(path.join(MATCH_DIR, `${caseId}.match.json`),'utf8')).class || 'unknown'; }
  catch(e){ return 'unknown'; }
}

const rows = [];
for (const line of fs.readFileSync(IN,'utf8').split('\n')){
  if(!line.trim()) continue;
  try { rows.push(JSON.parse(line)); } catch(e){ /* skip corrupt */ }
}
if (rows.length === 0){ process.stderr.write('no rows in '+IN+'\n'); process.exit(1); }

const ARMS = ['nopack','pack','placebo'];

// group: engine -> arm -> case -> [rows]
const G = {};
for (const r of rows){
  const e=r.engine, arm=r.arm, c=r.case;
  ((G[e]=G[e]||{})[arm]=G[e][arm]||{})[c]=(G[e][arm][c]||[]);
  G[e][arm][c].push(r);
}

function majorityTrue(reps, field){
  const t = reps.filter(x=>x[field]===true).length;
  return t*2 > reps.length; // strict majority
}
function anyNoVerdict(reps){ return reps.filter(x=>x.no_verdict===true).length; }

// flip band within an arm: # of known-bad cells whose per-repeat `caught` is split (not unanimous).
function flipCount(caseMap){
  let flips=0;
  for (const c of Object.keys(caseMap)){
    const reps = caseMap[c];
    if (reps.length<2) continue;
    const t = reps.filter(x=>x.caught===true).length;
    if (t!==0 && t!==reps.length) flips++;
  }
  return flips;
}

const report = { engines:{} };

for (const e of Object.keys(G).sort()){
  const armData = G[e];
  const known = {}; // arm -> {caught:Set, cases:Set, no_verdict_cells, total_cells, fp_crit, fp_major, flip}
  const clean = {}; // arm -> {overflag:Set, cases:Set, no_verdict_cells, total_cells}
  for (const arm of ARMS){
    if(!armData[arm]) continue;
    const kbCases={}, clCases={};
    for (const c of Object.keys(armData[arm])){
      const reps = armData[arm][c];
      const cs = reps[0].case_set;
      if (cs==='known-bad') kbCases[c]=reps; else if (cs==='clean') clCases[c]=reps;
    }
    // known-bad
    const caughtSet=new Set(); let nvCells=0, totCells=0, fpCrit=0, fpMajor=0, nvCases=0;
    for (const c of Object.keys(kbCases)){
      const reps=kbCases[c]; totCells+=reps.length; nvCells+=anyNoVerdict(reps);
      // a case is "no_verdict-affected" for the per-CASE guard when a majority of its repeats were no_verdict
      if (majorityTrue(reps,'no_verdict')) nvCases++;
      const caught = majorityTrue(reps,'caught');
      if (caught) caughtSet.add(c);
      else { const cl=caseClass(c); if(cl==='critical') fpCrit++; else if(cl==='major') fpMajor++; }
    }
    known[arm]={caught:caughtSet, cases:new Set(Object.keys(kbCases)), nvCells, nvCases, totCells, fpCrit, fpMajor, flip:flipCount(kbCases)};
    // clean
    const overSet=new Set(); let cnv=0, ctot=0;
    for (const c of Object.keys(clCases)){
      const reps=clCases[c]; ctot+=reps.length; cnv+=anyNoVerdict(reps);
      if (majorityTrue(reps,'flagged')) overSet.add(c);
    }
    clean[arm]={overflag:overSet, cases:new Set(Object.keys(clCases)), nvCells:cnv, totCells:ctot};
  }

  // cross-arm discordant pairs
  function discordant(a,b){ // caught in a-only minus caught in b-only  (delta = a advantage)
    if(!known[a]||!known[b]) return null;
    const A=known[a].caught, B=known[b].caught;
    let aOnly=0,bOnly=0;
    for (const c of A) if(!B.has(c)) aOnly++;
    for (const c of B) if(!A.has(c)) bOnly++;
    return {a_only:aOnly, b_only:bOnly, delta:aOnly-bOnly};
  }
  const packVsNo = discordant('pack','nopack');
  const placeboVsNo = discordant('placebo','nopack');

  // format_conflict (plan §2.5): pack arm's no_verdict CASE count exceeds nopack's by > 1 case.
  // Per-CASE (a case is no_verdict-affected when a majority of its repeats were no_verdict),
  // NOT per-cell — so k>1 does not spuriously inflate the margin.
  let formatConflict=false, packNv=null, noNv=null;
  if (known['pack']&&known['nopack']){
    packNv=known['pack'].nvCases; noNv=known['nopack'].nvCases;
    if (packNv - noNv > 1) formatConflict=true;
  }

  report.engines[e]={
    arms:{},
    discordant_pack_vs_nopack: packVsNo,
    discordant_placebo_vs_nopack: placeboVsNo,
    flip_band_nopack: known['nopack']?known['nopack'].flip:null,
    flip_band_pack: known['pack']?known['pack'].flip:null,
    format_conflict: formatConflict,
    format_conflict_detail: (packNv!=null)?{pack_no_verdict_cases:packNv, nopack_no_verdict_cases:noNv}:null,
  };
  for (const arm of ARMS){
    if(!known[arm]&&!clean[arm]) continue;
    const kb=known[arm]||{}, cl=clean[arm]||{};
    const cleanTot = cl.cases?cl.cases.size:0;
    const over = cl.overflag?cl.overflag.size:0;
    report.engines[e].arms[arm]={
      known_bad_total: kb.cases?kb.cases.size:0,
      caught: kb.caught?kb.caught.size:0,
      caught_cases: kb.caught?[...kb.caught].sort():[],
      false_pass_on_critical: kb.fpCrit||0,
      false_pass_on_major: kb.fpMajor||0,
      no_verdict_cells: kb.nvCells||0,
      known_bad_cells: kb.totCells||0,
      clean_total: cleanTot,
      clean_overflag: over,
      clean_overflag_cases: cl.overflag?[...cl.overflag].sort():[],
      specificity: cleanTot? +(1 - over/cleanTot).toFixed(3):null,
      clean_no_verdict_cells: cl.nvCells||0,
      flip_band: kb.flip!=null?kb.flip:null,
    };
  }
}

if (AS_JSON){ process.stdout.write(JSON.stringify(report,null,2)+'\n'); process.exit(0); }

// ---- text render ----
const L=[];
L.push('SKILL-TRANSPORT REVIEWER A/B — matrix report');
L.push('source: '+IN+'   rows: '+rows.length);
L.push('(report is DATA + advisory rule-threshold checks; the §5 adopt/refute call is depth-0\'s)');
for (const e of Object.keys(report.engines).sort()){
  const E=report.engines[e];
  L.push('');
  L.push('==== engine: '+e+' ====');
  const hdr=['arm','kb_caught/tot','fp_crit','fp_major','no_verdict','clean_overflag/tot','specificity','flip_band'];
  L.push(hdr.join('\t'));
  for (const arm of ARMS){
    const A=E.arms[arm]; if(!A) continue;
    L.push([arm,
      `${A.caught}/${A.known_bad_total}`,
      A.false_pass_on_critical,
      A.false_pass_on_major,
      `${A.no_verdict_cells}/${A.known_bad_cells}`,
      `${A.clean_overflag}/${A.clean_total}`,
      A.specificity===null?'-':A.specificity,
      A.flip_band===null?'-':A.flip_band,
    ].join('\t'));
  }
  const d=E.discordant_pack_vs_nopack, p=E.discordant_placebo_vs_nopack;
  L.push('');
  if(d) L.push(`discordant (pack vs nopack): pack-only=${d.a_only} nopack-only=${d.b_only} DELTA=${d.delta>=0?'+':''}${d.delta}`);
  if(p) L.push(`discordant (placebo vs nopack): placebo-only=${p.a_only} nopack-only=${p.b_only} DELTA=${p.delta>=0?'+':''}${p.delta}`);
  L.push(`flip band (nopack)=${E.flip_band_nopack} (pack)=${E.flip_band_pack}`);
  L.push(`format_conflict=${E.format_conflict}${E.format_conflict_detail?` (pack_nv_cases=${E.format_conflict_detail.pack_no_verdict_cases} nopack_nv_cases=${E.format_conflict_detail.nopack_no_verdict_cases})`:''}`);
  // advisory rule-threshold checks (NOT an auto-gate)
  if (d){
    const band = Math.max(E.flip_band_nopack||0, E.flip_band_pack||0);
    const na = E.arms['nopack'], pa = E.arms['pack'];
    const overIncr = (na&&pa)? (pa.clean_overflag - na.clean_overflag):null;
    L.push('-- advisory §5 checks (depth-0 decides) --');
    L.push(`  R-H2-adopt inputs: delta=${d.delta} (need >=+2), exceeds_flip_band=${d.delta>band} (band=${band}), clean_overflag_increase=${overIncr} (need <=1), format_conflict=${E.format_conflict} (need false)`);
    if(p) L.push(`  R-H2-placebo input: placebo_delta=${p.delta} vs ceil(pack_delta/2)=${Math.ceil(d.delta/2)} -> placebo_veto=${p.delta>=Math.ceil(d.delta/2)}`);
    L.push(`  R-H2-refute input: delta<+2 OR delta<=band OR specificity_degrades`);
  }
}
process.stdout.write(L.join('\n')+'\n');
