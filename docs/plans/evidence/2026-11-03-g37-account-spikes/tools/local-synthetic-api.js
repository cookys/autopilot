// Fully local synthetic API: never forwards anything. Mode via argv[2]: 429 | 401 | 429-usage
// Logs method, url, and for auth only a label (FAKE token / DECOY token / other) - never raw values.
const http=require('http'),fs=require('fs');
const [mode,portFile,log]=process.argv.slice(2);
const srv=http.createServer((req,res)=>{
 const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
  const a=(req.headers['authorization']||'')+' '+(req.headers['x-api-key']||'');
  const label=a.includes('FAKE-ENVTOKEN')?'env-token':a.includes('DECOY-CREDSTOKEN')?'creds-token':a.trim()?'other':'none';
  fs.appendFileSync(log,JSON.stringify({m:req.method,u:req.url.split('?')[0],auth:label,beta:!!req.headers['anthropic-beta']})+'\n');
  if(!req.url.startsWith('/v1/messages')){res.writeHead(404,{'content-type':'application/json'});return res.end('{}');}
  let code=401,body={type:'error',error:{type:'authentication_error',message:'invalid x-api-key (local synthetic)'}},h={'content-type':'application/json'};
  if(mode==='429'){code=429;h['retry-after']='1';body={type:'error',error:{type:'rate_limit_error',message:"This request would exceed your account's rate limit. (local synthetic)"}};}
  if(mode==='429-hdr'){code=429;Object.assign(h,{'anthropic-ratelimit-unified-status':'rejected','anthropic-ratelimit-unified-5h-status':'rejected','anthropic-ratelimit-unified-5h-utilization':'1.02','anthropic-ratelimit-unified-5h-reset':'1799999999','anthropic-ratelimit-unified-7d-status':'allowed','anthropic-ratelimit-unified-7d-utilization':'0.41','anthropic-ratelimit-unified-7d-reset':'1800500000','anthropic-ratelimit-unified-representative-claim':'five_hour','anthropic-ratelimit-unified-reset':'1799999999'});body={type:'error',error:{type:'rate_limit_error',message:'Claude AI usage limit reached (local synthetic)'}};}
  if(mode==='429-usage'){code=429;h['retry-after']='1';body={type:'error',error:{type:'rate_limit_error',message:'Claude AI usage limit reached|1799999999 (local synthetic)'}};}
  res.writeHead(code,h);res.end(JSON.stringify(body));
 });
});
srv.listen(0,'127.0.0.1',()=>fs.writeFileSync(portFile,String(srv.address().port)));
