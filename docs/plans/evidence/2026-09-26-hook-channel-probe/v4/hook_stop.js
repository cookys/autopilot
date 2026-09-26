const fs = require('fs');
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    fs.appendFileSync(__dirname + '/../payloads.jsonl', JSON.stringify({variant:'V4-Stop-additionalContext', raw: JSON.parse(data||'{}')}) + "\n");
  } catch (e) {}
  const out = { hookSpecificOutput: { hookEventName: "Stop", additionalContext: "NONCE-STOP-AC-e02c77" } };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
