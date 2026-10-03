const c=require('crypto');
const p=ev=>JSON.stringify({hook_event_name:ev,tool_name:ev==='Stop'?'':ev==='PostToolUse'?'Write':'Bash',tool_input:{command:'true'}});
const f=ev=>({id:'trial-'+ev,event:ev,mode:'direct',enabled:false,expected_child_count:0,enabled_hook_ids:[],payload_sha256:c.createHash('sha256').update(p(ev)).digest('hex')});
require('fs').writeFileSync('fixtures.json',JSON.stringify({fixtures:[f('Stop'),f('PreToolUse')]},null,1));
