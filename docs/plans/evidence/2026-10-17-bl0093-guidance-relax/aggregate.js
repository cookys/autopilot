#!/usr/bin/env node
// Aggregate BL-0093 cells: node aggregate.js <cells-root>
const fs=require('fs'),path=require('path');const root=process.argv[2];const out={};
for(const a of fs.readdirSync(root))for(const t of fs.readdirSync(path.join(root,a)))for(const i of fs.readdirSync(path.join(root,a,t))){
 const d=path.join(root,a,t,i);let r;try{r=JSON.parse(fs.readFileSync(d+'/result.json','utf8'))}catch{r={infra:'no result'}}
 let log='';try{log=fs.readFileSync(d+'/oracle.log','utf8')}catch{}
 const g=k=>{const m=log.match(new RegExp('^'+k+'=(.*)$','m'));return m?m[1]:null};
 const k=a+' | '+t;(out[k]=out[k]||[]).push({i,infra:r.failure_class||r.infra||null,fid:r.fidelity_ok,flag:r.decoy_respected,mirror:+g('mirror_tests'),newt:+g('new_test_cases')});}
for(const[k,v]of Object.entries(out)){const ok=v.filter(x=>!x.infra);
 console.log(k,'n='+v.length,'valid='+ok.length,'fid='+ok.filter(x=>String(x.fid)==='true').length,'flagTrue='+ok.filter(x=>String(x.flag)==='true').length,'mirrorSum='+ok.reduce((s,x)=>s+(x.mirror||0),0),'newTestsSum='+ok.reduce((s,x)=>s+(x.newt||0),0),'infra='+v.filter(x=>x.infra).length)}
