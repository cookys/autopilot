// usage: node analyze-p1.js <run dir> ; independent methods A (JSON parse) and B (text match) must agree
const fs=require("fs");const R=process.argv[2];const rows=[];
for(let n=1;n<=30;n++){const id="C-"+String(n).padStart(2,"0");const d=R+"/runs/"+id;
 const t=fs.readFileSync(d+"/oracle.log","utf8");
 const s=t.indexOf("{");let dep=0,e=-1;for(let i=s;i<t.length;i++){if(t[i]=="{")dep++;else if(t[i]=="}"){dep--;if(!dep){e=i;break}}}
 const o=JSON.parse(t.slice(s,e+1));
 const A={m1:o.constraints_pass===true,m2:o.features_pass===true};
 const g=k=>{const m=t.match(new RegExp("\""+k+"\"\\s*:\\s*(true|false)"));return m?m[1]==="true":null};
 const B={m1:g("constraints_pass"),m2:g("features_pass")};
 if(A.m1!==B.m1||A.m2!==B.m2)throw new Error("method mismatch "+id);
 const r=JSON.parse(fs.readFileSync(d+"/result.json","utf8"));
 const c=fs.readFileSync(R+"/costs.tsv","utf8").split("\n").find(l=>l.startsWith(id+"\t")).split("\t");
 rows.push({id,M1:A.m1,M2:A.m2,M3:A.m1&&A.m2,f:Object.values(o.features).map(v=>v?1:0).join(""),turns:r.turns_completed,fc:r.failure_class,dur:r.duration,cost:+c[2]});}
const cnt=k=>rows.filter(x=>x[k]).length;
let tsv="id\tM1\tM2\tM3\tfeatures_1_5\tturns\tfailure_class\tduration_s\tfinal_cost_usd\n"+rows.map(x=>[x.id,x.M1,x.M2,x.M3,x.f,x.turns,x.fc,x.dur,x.cost.toFixed(6)].join("\t")).join("\n")+"\n";
fs.writeFileSync(process.argv[3]||"results-table.tsv",tsv);
const lg=(n)=>{let s=0;for(let i=2;i<=n;i++)s+=Math.log(i);return s};
const lC=(n,k)=>lg(n)-lg(k)-lg(n-k);
function fisher(a,n1,b,n2){const K=a+b,N=n1+n2;const p=(x)=>Math.exp(lC(n1,x)+lC(n2,K-x)-lC(N,K));const po=p(a);let s=0;for(let x=Math.max(0,K-n2);x<=Math.min(n1,K);x++){const px=p(x);if(px<=po*(1+1e-9))s+=px}return Math.min(1,s)}
const M2=cnt("M2");
console.log(JSON.stringify({n:rows.length,M1:cnt("M1"),M2,M3:cnt("M3"),complete5:rows.filter(x=>x.turns===5).length,m3_is_and:rows.every(x=>x.M3===(x.M1&&x.M2)),cost:rows.reduce((a,x)=>a+x.cost,0).toFixed(4),dur:rows.reduce((a,x)=>a+x.dur,0),p_vs_23of30:fisher(M2,30,23,30).toFixed(4),p_vs_11of29:fisher(M2,30,11,29).toFixed(4),p_vs_11of30:fisher(M2,30,11,30).toFixed(4)}));
const pf=[0,1,2,3,4].map(i=>rows.filter(x=>x.f[i]==="1").length);console.log("per-feature pass",pf.join(","));
console.log("first15 M2",rows.slice(0,15).filter(x=>x.M2).length,"last15 M2",rows.slice(15).filter(x=>x.M2).length);
