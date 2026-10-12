const fs=require('fs'),crypto=require('crypto');
const R='/home/cookys/projects/autopilot';
const {canonicalJson}=require(R+'/src/engine/owner-kernel/canonical');
const gen=require(R+'/evals/brain-eval-generator.js');
const {gradeAdministration}=require(R+'/evals/brain-eval-grader.js');
const sha=(s)=>crypto.createHash('sha256').update(s).digest('hex');
const eid=+process.argv[2], dir=process.argv[3];
let nonce;
for(const l of fs.readFileSync(process.env.HOME+'/.autopilot/engine-capability/qualification-evidence.jsonl','utf8').split('\n')){ if(!l)continue; let r;try{r=JSON.parse(l)}catch{continue} if(r.event_id===eid){nonce=r.evidence.run_nonce}}
if(!nonce){console.log('no nonce');process.exit(1)}
const gh=sha(fs.readFileSync(R+'/evals/brain-eval-generator.js','utf8'));
const seed=sha(canonicalJson({run_nonce:nonce,optional_test_salt:null,generator_hash:gh,role:'brain'}));
const admin=gen.generateBrainAdministration(seed);
const traces=[1,2].map(t=>fs.readFileSync(`${dir}/raw/brain-trial-${t}.exchanges.jsonl`,'utf8').split('\n').filter(Boolean).map(l=>{const e=JSON.parse(l);const ls=e.output.split(/\r?\n/);for(let i=ls.length-1;i>=0;i--){const x=ls[i].trim();if(!x.startsWith('{'))continue;try{return JSON.parse(x)}catch{}}return {}}));
const g=gradeAdministration(admin,traces);
console.log(JSON.stringify(g.subjects),'pairdeltas',JSON.stringify(g.pair_deltas));
g.trials.forEach((t,i)=>{console.log('TRIAL',i+1,t.stop_reason,'diligence',t.diligence_pass,'fair',t.fairness_correctness_pass,'conv',t.convergence_pass,'cont',t.containment_pass);
console.log(' plants',t.diligence.plants_caught+'/'+t.diligence.plants_total,JSON.stringify(t.diligence.plant_results.filter(p=>p.verdict=='missed').map(p=>[p.round_id,p.plant_kind])),'FP',t.diligence.clean_false_positives);
console.log(' hardfails',JSON.stringify(t.hard_fails.map(h=>h.round_id+':'+h.rule)));
console.log(' fairness fails',JSON.stringify(t.fairness_arm_tuples.filter(a=>!a.correctness_pass).map(a=>[a.case_id,a.pair_arm,a.label_condition,a.provenance,a.verdict,a.severity])));
console.log(' conv',JSON.stringify(t.convergence));});
