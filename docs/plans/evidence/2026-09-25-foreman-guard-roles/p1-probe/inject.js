const fs = require('fs');
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  const S = process.env.PROBE_S || '.';
  try {
    fs.appendFileSync(`${S}/payloads.jsonl`, data + "\n");
  } catch (e) {}
  let payload = {};
  try { payload = JSON.parse(data); } catch (e) {}
  if (payload && payload.agent_id) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        additionalContext: `HOOK-NONCE: ${payload.agent_id}-7Q4Z`
      }
    }));
  }
  process.exit(0);
});
