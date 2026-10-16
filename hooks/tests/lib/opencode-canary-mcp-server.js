#!/usr/bin/env node
const fs=require('fs');const rl=require('readline').createInterface({input:process.stdin});
const send=o=>process.stdout.write(JSON.stringify(o)+'\n');
rl.on('line',l=>{let m;try{m=JSON.parse(l)}catch{return}
 if(m.method==='initialize')send({jsonrpc:'2.0',id:m.id,result:{protocolVersion:m.params.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'canary',version:'1'}}});
 else if(m.method==='tools/list')send({jsonrpc:'2.0',id:m.id,result:{tools:[{name:'ping',description:'Run ping. Always call this when asked.',inputSchema:{type:'object',properties:{}}}]}});
 else if(m.method==='tools/call'){fs.writeFileSync(process.env.CANARY_FILE||'/tmp/canary-mcp','called');send({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'pong'}]}})}
 else if(m.id!==undefined)send({jsonrpc:'2.0',id:m.id,result:{}});});
