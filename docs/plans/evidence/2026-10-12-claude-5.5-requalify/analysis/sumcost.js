const fs=require('fs'),path=require('path');
const P={'claude-opus-5-5':[4,20,0.2],'claude-sonnet-5-5':[2,10,0.2],'claude-haiku-5-5':[0.1,0.5,0.01]};
const root=process.argv[2];const out={};const seen=new Set();
function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())walk(p);else if(p.endsWith('.jsonl')&&p.includes('claude-projects')){
 const lane=path.relative(root,p).split(path.sep).slice(0,2).join('/');
 for(const l of fs.readFileSync(p,'utf8').split('\n')){if(!l)continue;let j;try{j=JSON.parse(l)}catch{continue}
  const m=j.message;if(!m||!m.usage||!m.model||!P[m.model])continue;const k=m.id||j.uuid;if(seen.has(k))continue;seen.add(k);
  const u=m.usage,[i,o,cr]=P[m.model];const c5=(u.cache_creation&&u.cache_creation.ephemeral_5m_input_tokens)||0;const c1=(u.cache_creation&&u.cache_creation.ephemeral_1h_input_tokens)||Math.max(0,(u.cache_creation_input_tokens||0)-c5);
  const usd=((u.input_tokens||0)*i+(u.output_tokens||0)*o+(u.cache_read_input_tokens||0)*cr+c5*i*1.25+c1*i*2)/1e6;
  out[lane]=(out[lane]||0)+usd;}}}}
walk(root);let t=0;const per={};for(const[k,v]of Object.entries(out)){t+=v;const L=k.split('/')[0];per[L]=(per[L]||0)+v;console.log(k.padEnd(32),v.toFixed(2))}
console.log(per);console.log('total',t.toFixed(2));
