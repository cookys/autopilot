#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
ROOT="$TEST_TMP/projects"
STATE="$TEST_TMP/state.json"
mkdir -p "$ROOT/project"
node - "$ROOT/project/session.jsonl" "$TEST_TMP/texts.json" <<'NODE'
const fs = require('fs');
const texts = [
  '不要再把我的私密對話原文放到結果之中了請重新檢查',
  '我說過這個路徑 /private/customer/unique-secret-configuration-file.js 不對請重新檢查所有內容並且修正錯誤',
  '/superlongprivatecommandnameabsolutelyunique please handle this task',
  'again this correction contains a private unique sequence of words for testing',
  'why did you include this special confidential sentence in the output',
  'not what i requested please correct this private instruction immediately',
  'you keep repeating the confidential operator instruction from before',
  'as i said please remove this unique private message from the output',
  '錯了請重新處理這個絕對不能輸出的敏感文字內容',
  '不要重來這段包含另一個不能洩漏的操作員專屬對話內容',
];
const cwd = '/private/long-user-directory-with-unique-secret/project-private-name';
const command = 'private-unique-command-name-longer-than-sixty-characters-with-sensitive-content argument';
const records = texts.map(t => ({type:'user',cwd,message:{content:t}}));
records.push({type:'assistant',message:{content:[{type:'tool_use',name:'Bash',input:{command}}]}});
fs.writeFileSync(process.argv[2], records.map(JSON.stringify).join('\n')+'\n');
fs.writeFileSync(process.argv[3], JSON.stringify([...texts,cwd,command]));
NODE
DISTILL_SCAN_ROOT="$ROOT" node "$REPO_ROOT/scripts/distill-scan.js" --json --incremental --state "$STATE" > "$TEST_TMP/out"
node - "$TEST_TMP/texts.json" "$TEST_TMP/out" "$STATE" <<'NODE'
const fs=require('fs');
const inputs=JSON.parse(fs.readFileSync(process.argv[2]));
const out=process.argv.slice(3).map(p=>fs.readFileSync(p,'utf8')).join('\n');
function lcs(a,b){let prev=new Uint32Array(b.length+1), max=0; for(const c of a){const next=new Uint32Array(b.length+1); for(let j=0;j<b.length;j++) if(c===b[j]) max=Math.max(max,next[j+1]=prev[j]+1); prev=next;} return max;}
let bad=false; inputs.forEach((s,i)=>{const n=lcs(s,out); console.log(`${i+1}: ${n}`); if(n>=20)bad=true;}); process.exit(bad?1:0);
NODE
assert_exit_code "$?" 0 "output and state contain no long transcript substring"
finalize_test
