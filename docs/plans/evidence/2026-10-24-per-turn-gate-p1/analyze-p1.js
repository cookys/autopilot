const fs=require("fs");const R=process.argv[2];const rows=[];
for(let n=1;n<=28;n++){const id="C-"+String(n).padStart(2,"0");const d=R+"/runs/"+id;
let o=null;try{const t=fs.readFileSync(d+"/oracle.log","utf8");const s=t.indexOf("{");let dep=0,e=-1;for(let i=s;i<t.length;i++){if(t[i]=="{")dep++;else if(t[i]=="}"){dep--;if(!dep){e=i;break}}}o=JSON.parse(t.slice(s,e+1))}catch(e){}
const r=JSON.parse(fs.readFileSync(d+"/result.json","utf8"));
const c=fs.readFileSync(R+"/costs.tsv","utf8").split("\n").find(l=>l.startsWith(id+"\t"));
const m1=o?!!o.constraints_pass:null,m2=o?!!o.features_pass:null;
rows.push({id,m1,m2,m3:o?(m1&&m2):null,turns:r.turns_completed,fc:r.failure_class,dur:r.duration,cost:+c.split("\t")[2],feat:o&&o.features});}
fs.writeFileSync(R+"/rows.json",JSON.stringify(rows));
const f=k=>rows.filter(x=>x[k]).length;
console.log("n",rows.length,"oracle",rows.filter(x=>x.m1!==null).length,"M1",f("m1"),"M2",f("m2"),"M3",f("m3"),"complete5",rows.filter(x=>x.turns===5).length);
console.log("cost",rows.reduce((a,x)=>a+x.cost,0).toFixed(4),"dur",rows.reduce((a,x)=>a+x.dur,0));
console.log(rows.map(x=>x.id+":"+(x.m2?1:0)+(x.turns<5?"!":"")).join(" "));
