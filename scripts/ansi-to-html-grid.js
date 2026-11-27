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
function gate(inputText, htmlText) {
  const failures=[];
  const colorSequences=[...inputText.matchAll(/\x1b\[([0-9;]*)m/g)].filter(m => m[1].split(';').some(x => /^(?:3[0-8]|4[0-8]|9[0-7]|10[0-7])$/.test(x)));
  if (!colorSequences.length) failures.push({check:'color',rc:3,message:'capture 沒有色碼；請用 tmux capture-pane -e -p 重新擷取'});
  const lines=inputText.replace(/\x1b\[[0-9;]*m/g,'').split('\n');
  if (inputText.endsWith('\n')) lines.pop();
  const rows=[...htmlText.matchAll(/<div class="row">([\s\S]*?)<\/div>/g)];
  let borderWidth;
  const independentWidth=line => [...line].reduce((sum,ch) => {
    const c=ch.codePointAt(0);
    return sum + ((c>=0x4e00&&c<=0x9fff)||(c>=0x3000&&c<=0x303f)||(c>=0x3040&&c<=0x30ff)||(c>=0xff00&&c<=0xff60)||(c>=0xffe0&&c<=0xffe6)||(c>=0xac00&&c<=0xd7a3) ? 2 : 1);
  },0);
  // Split layouts: a row may end at the inner divider of two frames. That is fine only when the row above has a vertical bar in the same cell.
  const barAbove=(i,col) => { let at=0; for (const ch of lines[i-1] ?? '') { at+=independentWidth(ch); if (at===col) return /[│┃║├┤┬┴┼╮╯┐┘]/.test(ch); } return false; };
  for (let i=0;i<Math.max(lines.length,rows.length);i++) {
    const line=lines[i] ?? '';
    const actual=independentWidth(line);
    const htmlWidth=rows[i] ? [...rows[i][1].matchAll(/<span\b[^>]*\bwidth:(\d+)ch[^>]*>/g)].reduce((n,m)=>n+Number(m[1]),0) : -1;
    let expected=htmlWidth;
    if (/[│┃║┐┘┤┓┛┫╮╯╗╝]\s*$/.test(line)) {
      const right=independentWidth(line.trimEnd());
      if (borderWidth===undefined) borderWidth=right;
      else if (right!==borderWidth && !barAbove(i,right)) { failures.push({check:'width',rc:4,message:`第 ${i+1} 行寬度不符：${right} / ${borderWidth}`}); break; }
    }
    if (actual!==expected || !rows[i] || i>=lines.length) { failures.push({check:'width',rc:4,message:`第 ${i+1} 行寬度不符：${actual} / ${expected}`}); break; }
  }
  const nOut=[...htmlText.matchAll(/<span\b[^>]*style="[^"]*(?:^|[;"\s])(?:color|background|font-weight)\s*:/g)].length;
  // L-00-base: 61 color sequences produce 4157 styled spans; 0.5 tolerates
  // consolidation while still detecting substantial loss of styled output.
  if (nOut < Math.max(1, 0.5*colorSequences.length)) failures.push({check:'spans',rc:5,message:`色彩 span 數不足：${nOut} / ${colorSequences.length}`});
  return {ok:failures.length===0,failures};
}
if (require.main===module) {
  if (process.argv.length>3) { console.error('Usage: ansi-to-html-grid.js [input-file]'); process.exitCode=2; }
  else { try { const input=fs.readFileSync(process.argv[2] || 0,'utf8'); const html=render(input); const result=gate(input,html); if (result.ok) process.stdout.write(html); else { for (const failure of result.failures) console.error(failure.message); process.exitCode=result.failures[0].rc; } } catch (error) { console.error(error.message); process.exitCode=1; } }
}
module.exports={render,gate};
