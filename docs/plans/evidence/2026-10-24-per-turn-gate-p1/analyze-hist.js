const fs=require('fs');const H=process.argv[2];
const SIDKEY='session'+'_id';
function objs(txt){const o=[];let d=0,s=-1;for(let i=0;i<txt.length;i++){const c=txt[i];if(c==='{'){if(d===0)s=i;d++}else if(c==='}'){d--;if(d===0&&s>=0){try{o.push(JSON.parse(txt.slice(s,i+1)))}catch(e){}s=-1}}}return o}
function oracleJson(t){const i=t.indexOf('{');let d=0;for(let k=i;k<t.length;k++){if(t[k]==='{')d++;else if(t[k]==='}'){d--;if(d===0)return JSON.parse(t.slice(i,k+1))}}return null}
const P={in:1e-6,out:5e-6,cc1h:2e-6,cr:1e-7};
const out={};
for(const e of ['exp1','exp2']){
  const rows=[];
  for(const id of fs.readdirSync(`${H}/${e}`).filter(x=>/^C-/.test(x)).sort()){
    const d=`${H}/${e}/${id}/attempt-1`;
    const o=oracleJson(fs.readFileSync(d+'/oracle.log','utf8'));
    const r=JSON.parse(fs.readFileSync(d+'/result.json','utf8'));
    const res=objs(fs.readFileSync(d+'/run.log','utf8')).filter(x=>x.type==='result');
    const sids=new Set(res.map(x=>x[SIDKEY]));
    let maxdev=0;let prev=0;const incs=[];
    for(const x of res){const u=x.usage;const est=u.input_tokens*P.in+u.output_tokens*P.out+(u.cache_creation_input_tokens)*P.cc1h+u.cache_read_input_tokens*P.cr;const inc=x.total_cost_usd-prev;incs.push([est,inc]);prev=x.total_cost_usd}
    rows.push({id,M1:o?!!o.constraints_pass:null,M2:o?!!o.features_pass:null,M3:o?!!(o.constraints_pass&&o.features_pass):null,f:o?o.features:null,c:o?o.constraints:null,dur:r.duration,turns:r.turns_completed,fc:r.failure_class,ver:r.runner_version,n_res:res.length,sess:sids.size,first:res[0]&&res[0].total_cost_usd,final:res.length?res[res.length-1].total_cost_usd:null,incs,models:[...new Set(res.flatMap(x=>Object.keys(x.modelUsage||{})))]});
  }
  out[e]=rows;
}
fs.writeFileSync(process.argv[3],JSON.stringify(out));
for(const e of ['exp1','exp2']){const R=out[e];const ok=R.filter(r=>r.M2!==null);
 const cnt=k=>R.filter(r=>r[k]).length;
 const fin=R.filter(r=>r.final!=null).map(r=>r.final);const fst=R.filter(r=>r.first!=null).map(r=>r.first);
 let dev=0,n=0;for(const r of R)for(const [est,inc] of r.incs){dev=Math.max(dev,Math.abs(est-inc)/Math.max(inc,1e-9));n++}
 console.log(e,'runs',R.length,'M1',cnt('M1'),'M2',cnt('M2'),'M3',cnt('M3'),'oracle-missing',R.filter(r=>r.M2===null).length,'fc',[...new Set(R.map(r=>r.fc))],'ver',[...new Set(R.map(r=>r.ver))],'models',[...new Set(R.flatMap(r=>r.models))],'sessions/run',[...new Set(R.map(r=>r.sess))],'results/run',[...new Set(R.map(r=>r.n_res))]);
 console.log('  mean first',(fst.reduce((a,b)=>a+b,0)/fst.length).toFixed(4),'mean final',(fin.reduce((a,b)=>a+b,0)/fin.length).toFixed(4),'max final',Math.max(...fin).toFixed(3),'n',fin.length,'| cumulative-check: max relative deviation of (usage-priced estimate vs increment)',dev.toFixed(3),'over',n,'objects');
 console.log('  mean duration',(R.reduce((a,r)=>a+r.dur,0)/R.length).toFixed(0));
}
