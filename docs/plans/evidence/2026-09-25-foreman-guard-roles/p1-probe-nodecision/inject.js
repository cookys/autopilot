const fs = require('fs');
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    fs.appendFileSync('/tmp/claude-1000/-home-cookys-projects-autopilot/ee9eb17b-41da-4ab1-9beb-06049b64c5bd/scratchpad/p1probe2/payloads.jsonl', data + "\n");
  } catch (e) {}
  let payload = {};
  try { payload = JSON.parse(data); } catch (e) {}
  if (payload && payload.agent_id) {
    const out = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: `HOOK-NONCE: ${payload.agent_id}-7Q4Z` } };
    process.stdout.write(JSON.stringify(out));
  }
  process.exit(0);
});
