const fs=require("fs"),p=require("path");const S=process.argv[2];const out=[];
for(const d of fs.readdirSync(S+"/cells").filter(x=>/^\d/.test(x)).sort((a,b)=>parseInt(a)-parseInt(b)||a.localeCompare(b))){
 const D=S+"/cells/"+d;const r=f=>{try{return fs.readFileSync(D+"/"+f,"utf8")}catch{return""}};
 const log=r("run.log").split("\n").filter(Boolean);const st=log.find(l=>/START/.test(l)),en=log.find(l=>/ END rc=/.test(l));
 let j=null;try{j=JSON.parse(r("emit-row.json"))}catch{}
 out.push({cell:d,start:st&&st.slice(0,25),end:en&&en.slice(0,25),rc:r("rc").trim(),status:j&&j.status,quality:j&&JSON.stringify(j.quality),wall:j&&j.usage&&j.usage.total_wall_s,tok:j&&j.usage&&j.usage.total_tokens,ev:j&&j.evidence_store&&j.evidence_store.event_id,note:(r("stderr.log").match(/cannot persist[^\n]*/)||[""])[0].slice(0,60)});
}
console.log(JSON.stringify(out,null,1));
