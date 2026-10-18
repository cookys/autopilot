const fs=require('fs'),cp=require('child_process');
const B=process.argv[2];const j=JSON.parse(fs.readFileSync(B+'/run/replay.json'));
let s=20261019;const rnd=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296};
const idx=j.records.map((_,i)=>i);for(let i=idx.length-1;i>0;i--){const k=Math.floor(rnd()*(i+1));[idx[i],idx[k]]=[idx[k],idx[i]]}
const pick=idx.slice(0,150).sort((a,b)=>a-b);
const cache={};
const out=[];
pick.forEach((i,n)=>{const r=j.records[i];const m=r.merge_sha||r.merge;const key=m+r.file;
 if(!cache[key]){try{cache[key]=cp.execSync(`git -C ${B}/clone diff ${m}^1 ${m} -- '${r.file}'`,{maxBuffer:1<<28}).toString()}catch(e){cache[key]=''}}
 const d=cache[key].split('\n');const add=d.filter(l=>l[0]=='+'&&l[1]!='+').map(l=>l.slice(1).trim());
 const det=(r.detail||'').trim();const norm=x=>x.replace(/\s+/g,'');
 const exact=add.some(a=>norm(a)==norm(det));
 const sim=add.find(a=>a.length>6&&det.length>6&&(norm(a).includes(norm(det).slice(0,Math.min(20,norm(det).length)))));
 out.push(`#${n} i=${i} ${r.kind} ${r.file}:${r.line} m=${m.slice(0,8)} added=${exact?'EXACT':sim?'SIM':'no'} nadd=${add.length}\n   - ${det.slice(0,160)}${sim&&!exact?'\n   + '+sim.slice(0,160):''}`)});
fs.writeFileSync(B+'/run/sample.txt',out.join('\n'));
fs.writeFileSync(B+'/run/sample.idx.json',JSON.stringify(pick));
console.log(Object.keys(j.records[0]).join(','));
