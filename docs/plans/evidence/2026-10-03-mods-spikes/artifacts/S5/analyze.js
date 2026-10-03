const fs=require('fs');const d=process.argv[2];
const all=[];
for(const f of fs.readdirSync(d)){const L=fs.readFileSync(d+'/'+f,'utf8').trim().split('\n').map(l=>{const [t,v,g,...r]=l.split(' ');return {t:+t,v,g,what:r.join(' ')}});all.push(...L)}
all.sort((a,b)=>a.t-b.t);
const gens=[...new Set(all.map(x=>x.g))];
for(const g of gens){const L=all.filter(x=>x.g===g);const ticks=L.filter(x=>/tick/.test(x.what));
 const gaps=ticks.slice(1).map((x,i)=>x.t-ticks[i].t);
 console.log(g,L[0].v,'first',L[0].t,L[0].what,'| ticks',ticks.length,'first tick',ticks[0]&&ticks[0].t,'last',ticks.length&&ticks[ticks.length-1].t,'| gap ms min/max/mean',Math.min(...gaps),Math.max(...gaps),(gaps.reduce((a,b)=>a+b,0)/gaps.length).toFixed(0),'| events:',L.filter(x=>!/tick/.test(x.what)).map(x=>x.what).join(';'));}
// overlap: for each pair, ticks of later gen before last tick of earlier gen
for(let i=1;i<gens.length;i++){const a=all.filter(x=>x.g===gens[i-1]&&/tick/.test(x.what)),b=all.filter(x=>x.g===gens[i]);
 const lastA=a[a.length-1].t,firstB=b[0].t;console.log('handover',gens[i-1],'->',gens[i],': last old tick',lastA,'first new line',firstB,'delta ms',firstB-lastA,'(neg = overlap)');}
// tick rate in last 5 seconds window across all gens
const now=Date.now();const win=all.filter(x=>/tick/.test(x.what)&&x.t>now-5000);console.log('ticks in last 5s across all gens:',win.length,'by gen',JSON.stringify(win.reduce((m,x)=>(m[x.g]=(m[x.g]||0)+1,m),{})));
