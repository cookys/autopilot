// assemble.js <S> <land> <role-regex> : copy matching cells (sanitized) into the evidence dir, rewrite README from all copied cells.
const fs=require("fs"),p=require("path");const [S,LAND,ROLE]=process.argv.slice(2);
const E=LAND+"/docs/plans/evidence/2026-11-09-qwen-seat-exams";fs.mkdirSync(E+"/cells",{recursive:true});fs.mkdirSync(E+"/scripts",{recursive:true});
const san=t=>t.split(S).join("$S").split("~").join("~").replace(/192\.168\.\d+\.\d+/g,"<private-ip>");
const cp=(a,b)=>{fs.mkdirSync(p.dirname(b),{recursive:true});const buf=fs.readFileSync(a);fs.writeFileSync(b,/\.(log|json|jsonl|sh|js|md)$|^rc$/.test(p.basename(a))||p.basename(a)==="rc"?san(buf.toString("utf8")):buf)};
for(const d of fs.readdirSync(S+"/cells")){if(!/^\d/.test(d)||!new RegExp(ROLE).test(d))continue;
 const walk=(x,y)=>{for(const f of fs.readdirSync(x,{withFileTypes:true})){f.isDirectory()?walk(x+"/"+f.name,y+"/"+f.name):cp(x+"/"+f.name,y+"/"+f.name)}};walk(S+"/cells/"+d,E+"/cells/"+d)}
for(const f of fs.readdirSync(S+"/scripts"))cp(S+"/scripts/"+f,E+"/scripts/"+f);
for(const f of fs.readdirSync(S+"/identity"))cp(S+"/identity/"+f,E+"/identity/"+f);
// evidence rows
const real=fs.readFileSync(process.env.HOME+"/.autopilot/engine-capability/qualification-evidence.jsonl","utf8").trim().split("\n");
fs.writeFileSync(E+"/new-rows-real-store.jsonl",san(real.slice(15).join("\n"))+"\n");
fs.writeFileSync(E+"/scratch-store-rows.jsonl",san(fs.readFileSync(S+"/qualification-evidence.jsonl","utf8")));
// README
const meta=JSON.parse(require("child_process").execFileSync("node",[S+"/scripts/gen-readme-data.js",S]).toString());
const have=new Set(fs.readdirSync(E+"/cells"));
const rows=meta.filter(c=>have.has(c.cell)).map(c=>{let q="";try{q=c.quality}catch{}
 const att=/attempt1/.test(c.cell);
 return `| ${c.cell} | ${c.start||""} | ${c.end||""} | ${c.wall||""} | ${c.rc} | ${c.status||(att?"no row ("+(c.note?"persist refused":"no cases sent")+")":"")} | ${(q||"").replace(/\|/g,"/")} | ${c.ev||""} |`});
let intro=fs.readFileSync(S+"/readme-intro.md","utf8");
fs.writeFileSync(E+"/README.md",intro+"\n## Cells\n\n| cell dir | start (UTC+8) | end | wall s | rc | status | quality | event id |\n|---|---|---|---|---|---|---|---|\n"+rows.join("\n")+"\n");
