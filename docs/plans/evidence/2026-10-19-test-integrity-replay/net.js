const fs=require('fs'),cp=require('child_process');const B=process.argv[2];
const j=JSON.parse(fs.readFileSync(B+'/run/replay.json'));
const A=/\b(assert\w*|expect|ok|eq|equal|deepStrictEqual|strictEqual|fail|t\(|test\(|it\()\b|assert_|\[\[|\bgrep -q\b|toBe|toEqual/;
const groups={};j.records.forEach((r,i)=>{if(r.kind!=='deleted_line')return;(groups[r.merge_sha+'|'+r.file]??=[]).push(i)});
const rows=[];
for(const [k,idx] of Object.entries(groups)){const [m,f]=k.split('|');let d;try{d=cp.execSync(`git -C ${B}/clone diff ${m}^1 ${m} -- '${f}'`,{maxBuffer:1<<28}).toString().split('\n')}catch(e){continue}
 const del=d.filter(l=>l[0]=='-'&&l[1]!='-'&&A.test(l)).length,add=d.filter(l=>l[0]=='+'&&l[1]!='+'&&A.test(l)).length;
 rows.push({m:m.slice(0,8),f,n:idx.length,del,add,net:add-del,whole:d.some(l=>/^deleted file/.test(l))})}
const dec=rows.filter(r=>r.net<0&&!r.whole);
console.log('groups',rows.length,'records',j.records.length,'net-decrease(not whole-file)',dec.length,'whole-file-del',rows.filter(r=>r.whole).length, 'whole recs',rows.filter(r=>r.whole).reduce((a,r)=>a+r.n,0));
dec.sort((a,b)=>a.net-b.net).forEach(r=>console.log(JSON.stringify(r)));
fs.writeFileSync(B+'/run/groups.json',JSON.stringify(rows));
