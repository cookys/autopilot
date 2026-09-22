const fs=require('fs');
for(const f of process.argv.slice(2)){
  const rows=fs.readFileSync(f,'utf8').trim().split('\n').map(JSON.parse);
  const last=JSON.parse(rows[rows.length-1].input);
  const claims=last.inherited_summary.claims, receipts=last.receipts;
  let rev=null;
  for(const c of claims){ if(c.kind==='open'&&c.cites===null){
    const p=receipts.find(x=>x.round_issued===c.round_asserted&&x.kind==='verification'&&x.status==='pass'&&x.subject===c.subject);
    if(p) rev={round:c.round_asserted,subject:c.subject};
  }}
  if(!rev){console.log(f,'no reversal');continue;}
  const ar=last.action_receipts||[];
  const prior=ar.filter(a=>a.round_id<rev.round && a.round_id>=rev.round-3);
  const onF=prior.filter(a=>a.target===rev.subject);
  console.log(`${f.replace(/.*evidence\//,'').padEnd(66)} rev@r${rev.round} F=${rev.subject.slice(0,12)}`);
  console.log(`   prior r${rev.round-3}..r${rev.round-1}: ${prior.map(a=>`r${a.round_id}:${a.action}(${(a.target||'-').slice(0,10)})`).join(' ')}`);
  console.log(`   >>> cover story on F: ${onF.length?onF.map(a=>a.action).join(','):'NONE'}`);
}
