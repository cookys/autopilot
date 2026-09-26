const fs = require('fs');
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    fs.appendFileSync(__dirname + '/../payloads.jsonl', JSON.stringify({variant:'V1-PostToolUse', raw: JSON.parse(data||'{}')}) + "\n");
  } catch (e) {
    try { fs.appendFileSync(__dirname + '/../payloads.jsonl', JSON.stringify({variant:'V1-PostToolUse', raw_unparsed: data}) + "\n"); } catch(e2){}
  }
  const out = { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "NONCE-PTU-7f3a9c" } };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
