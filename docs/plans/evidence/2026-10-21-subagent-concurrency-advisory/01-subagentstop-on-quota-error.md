# SubagentStop on a quota error

UNVERIFIED bullet: whether SubagentStop fires on a quota error.

Date: 2026-10-22

Cells: `m-quota`, `m-quota-unbounded-retry`.

A real usage-limit error cannot be forced under `claude -p`. What was done instead: `proxy.js` answers every `/v1/messages` request with HTTP 429 `rate_limit_error` once `SubagentStart` has been captured in the hooks file. `claude` was pointed at that proxy with `ANTHROPIC_BASE_URL`.

`m-quota/proxy.js` (same program for both cells):

```javascript
// pass-through proxy to api.anthropic.com; after SubagentStart appears in HOOKS file, answer every /v1/messages with HTTP 429 rate_limit_error
const http=require('http'),https=require('https'),fs=require('fs');
const [port,hooks,log]=process.argv.slice(2);
http.createServer((req,res)=>{
 const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
  const trip=fs.existsSync(hooks)&&fs.readFileSync(hooks,'utf8').includes('SubagentStart')&&req.url.startsWith('/v1/messages');
  fs.appendFileSync(log,`${Date.now()} ${req.method} ${req.url} trip=${trip}\n`);
  if(trip){const b=JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'This request would exceed your account\'s rate limit. (simulated by proxy)'}});
   res.writeHead(429,{'content-type':'application/json','retry-after':'1'});return res.end(b);}
  const h={...req.headers,host:'api.anthropic.com'};
  const u=https.request({host:'api.anthropic.com',path:req.url,method:req.method,headers:h},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res)});
  u.on('error',e=>{res.writeHead(502);res.end(String(e))});u.end(Buffer.concat(chunks));
 });
}).listen(+port,'127.0.0.1');
```


Commands, in the shape of `runc.sh` (prompt on the `claude` argument list, stdin from `/dev/null`):

`m-quota`: `CLAUDE_CODE_MAX_RETRIES=1`, `runc.sh` timeout `100`, prompt `Use the Agent tool (foreground) to spawn one subagent that runs 'echo hi'. Then reply DONE.`

`m-quota-unbounded-retry`: no `CLAUDE_CODE_MAX_RETRIES` cap, `runc.sh` timeout `150`. The process was killed by `timeout` (`rc=124`). `out.json` in that cell is empty (0 bytes), so no `is_error` or `api_error_status` field was captured for the unbounded run.

`m-quota/hooks.summary.txt` (full file):

```text
t+0.0s PreToolUse[Task|Agent] {"session_id":"82c2127c-5c02-46fb-8a43-8219413fc480","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run echo hi","prompt":"Run the shell command `echo hi` and report its output. Nothing else is needed.","subagent_type":"general-purpose"},"tool_use_id":"toolu_01Fx1seYuXDCaqqfQUC9RwxV"}
t+0.1s SubagentStart {"session_id":"82c2127c-5c02-46fb-8a43-8219413fc480","agent_id":"aca954e9901c07873","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
```


`m-quota-unbounded-retry/hooks.summary.txt` (full file):

```text
t+0.0s PreToolUse[Task|Agent] {"session_id":"1edfadd8-cf88-433a-87db-c35931f49100","hook_event_name":"PreToolUse","tool_name":"Agent","tool_input":{"description":"Run echo hi","prompt":"Run the shell command `echo hi` and report its output. Nothing else is needed.","subagent_type":"general-purpose"},"tool_use_id":"toolu_01LJbNiBBCpCjESBXGynH3Wf"}
t+0.1s SubagentStart {"session_id":"1edfadd8-cf88-433a-87db-c35931f49100","agent_id":"a1217ddb5634e69e3","agent_type":"general-purpose","hook_event_name":"SubagentStart"}
```


`m-quota/out.json` is one JSON line. Fields other than the five below were omitted (not a whole-line trim of a multi-line file):

```json
{
  "is_error": true,
  "api_error_status": 429,
  "subtype": "success",
  "result": "API Error: Server is temporarily limiting requests (not your usage limit) \u00b7 This request would exceed your account's rate limit. (simulated by proxy)",
  "session_id": "82c2127c-5c02-46fb-8a43-8219413fc480"
}
```


`m-quota/err.txt`:

```text
rc=1
```


`m-quota-unbounded-retry/err.txt`:

```text
rc=124
```


`m-quota/proxy.log` (full file, 8 lines; the task asked for the head, and the file is the head):

```text
1792604070695 HEAD /api/hello trip=false
1792604071948 POST /v1/messages?beta=true trip=false
1792604074291 POST /v1/messages?beta=true trip=true
1792604074339 POST /v1/messages?beta=true trip=true
1792604075338 POST /v1/messages?beta=true trip=true
1792604075368 POST /v1/messages?beta=true trip=true
1792604075587 POST /v1/messages?beta=true trip=true
1792604076604 POST /v1/messages?beta=true trip=true
```


`m-quota-unbounded-retry/proxy.log` (full file, 22 lines). Whole lines were not deleted:

```text
1792603875528 HEAD /api/hello trip=false
1792603876745 POST /v1/messages?beta=true trip=false
1792603879229 POST /v1/messages?beta=true trip=true
1792603879264 POST /v1/messages?beta=true trip=true
1792603880265 POST /v1/messages?beta=true trip=true
1792603880272 POST /v1/messages?beta=true trip=true
1792603881300 POST /v1/messages?beta=true trip=true
1792603881403 POST /v1/messages?beta=true trip=true
1792603883578 POST /v1/messages?beta=true trip=true
1792603883836 POST /v1/messages?beta=true trip=true
1792603888093 POST /v1/messages?beta=true trip=true
1792603888179 POST /v1/messages?beta=true trip=true
1792603896301 POST /v1/messages?beta=true trip=true
1792603896990 POST /v1/messages?beta=true trip=true
1792603914497 POST /v1/messages?beta=true trip=true
1792603915062 POST /v1/messages?beta=true trip=true
1792603950845 POST /v1/messages?beta=true trip=true
1792603953387 POST /v1/messages?beta=true trip=true
1792603986411 POST /v1/messages?beta=true trip=true
1792603991861 POST /v1/messages?beta=true trip=true
1792604019544 POST /v1/messages?beta=true trip=true
1792604024169 POST /v1/messages?beta=true trip=true
```


After `SubagentStart`, no `SubagentStop` and no `Stop` were captured in either run. The capped run's result text says the server is limiting requests and that this is not the account usage limit, and the proxy log shows `trip=true` on `/v1/messages` after the hook file contained `SubagentStart`.

Verdict: SIMULATED, not a true quota error. The true-quota case is ACCEPTED RISK (cannot reproduce under `-p`). Fallback from plan Options: the stamp ages out through `AGENT_STALE_MS` (30 minutes); no quota parser.
