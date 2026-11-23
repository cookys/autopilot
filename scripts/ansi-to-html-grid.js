#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const { cellWidth, ANSI_RE } = require('../mods/tux/width.ts');
const BASE = ['#000000','#cd3131','#0dbc79','#e5e510','#2472c8','#bc3fbc','#11a8cd','#e5e5e5','#666666','#f14c4c','#23d18b','#f5f543','#3b8eea','#d670d6','#29b8db','#ffffff'];
const FG = '#d4d4d4', BG = '#1e1e1e';
function width(ch) {
  const code = ch.codePointAt(0);
  return code < 0x1f000 || code >= 0x20000 ? Math.max(1, cellWidth(code)) : 1;
}
function color(n) {
  if (n < 16) return BASE[n];
  if (n < 232) { n -= 16; const v = [0,95,135,175,215,255]; return hex(v[Math.floor(n/36)], v[Math.floor(n/6)%6], v[n%6]); }
  return hex(...Array(3).fill(8 + (n-232)*10));
}
function hex(...v) { return '#' + v.map(n => n.toString(16).padStart(2, '0')).join(''); }
function sgr(state, params) {
  const p = params === '' ? [0] : params.split(';').map(x => x === '' ? 0 : Number(x));
  for (let i=0; i<p.length; i++) {
    const n=p[i];
    if (n===0) Object.assign(state,{fg:FG,bg:BG,bold:false,inverse:false});
    else if (n===1) state.bold=true;
    else if (n===22) state.bold=false;
    else if (n===7) state.inverse=true;
    else if (n===27) state.inverse=false;
    else if (n===39) state.fg=FG;
    else if (n===49) state.bg=BG;
    else if (n>=30 && n<=37) state.fg=BASE[n-30];
    else if (n>=40 && n<=47) state.bg=BASE[n-40];
    else if (n>=90 && n<=97) state.fg=BASE[n-90+8];
    else if (n>=100 && n<=107) state.bg=BASE[n-100+8];
    else if ((n===38 || n===48) && p[i+1]===5 && Number.isInteger(p[i+2]) && p[i+2]>=0 && p[i+2]<=255) { state[n===38?'fg':'bg']=color(p[i+2]); i+=2; }
    else if ((n===38 || n===48) && p[i+1]===2 && p.slice(i+2,i+5).length===3 && p.slice(i+2,i+5).every(x=>Number.isInteger(x)&&x>=0&&x<=255)) { state[n===38?'fg':'bg']=hex(...p.slice(i+2,i+5)); i+=4; }
  }
}
function render(input) {
  const state={fg:FG,bg:BG,bold:false,inverse:false};
  const rows=['']; let pos=0;
  function add(text) {
    for (const ch of text) {
      if (ch==='\n') { rows.push(''); continue; }
      if (ch==='\r' || ch.codePointAt(0)<32 || ch==='\x7f') continue;
      const [fg,bg]=state.inverse?[state.bg,state.fg]:[state.fg,state.bg];
      const escaped=ch.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/ /g,'&nbsp;');
      rows[rows.length-1] += `<span style="width:${width(ch)}ch;color:${fg};background:${bg};${state.bold?'font-weight:bold;':''}">${escaped}</span>`;
    }
  }
  for (const match of input.matchAll(ANSI_RE)) {
    add(input.slice(pos,match.index));
    if (/^\x1b\[[0-9;]*m$/.test(match[0])) sgr(state,match[0].slice(2,-1));
    pos=match.index+match[0].length;
  }
  add(input.slice(pos));
  if (input.endsWith('\n')) rows.pop();
  return '<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1e1e1e}.grid{font-family:monospace;white-space:pre;line-height:1.25}.row{height:1.25em}.row span{display:inline-block;text-align:center}</style><div class="grid">'+rows.map(row=>'<div class="row">'+row+'</div>').join('')+'</div>\n';
}
if (require.main===module) {
  if (process.argv.length>3) { console.error('Usage: ansi-to-html-grid.js [input-file]'); process.exitCode=2; }
  else { try { process.stdout.write(render(fs.readFileSync(process.argv[2] || 0,'utf8'))); } catch (error) { console.error(error.message); process.exitCode=1; } }
}
module.exports={render};
