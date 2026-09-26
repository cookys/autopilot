const fs = require('fs');
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    fs.appendFileSync(__dirname + '/../payloads.jsonl', JSON.stringify({variant:'V2-PostToolUseFailure', raw: JSON.parse(data||'{}')}) + "\n");
  } catch (e) {
    try { fs.appendFileSync(__dirname + '/../payloads.jsonl', JSON.stringify({variant:'V2-PostToolUseFailure', raw_unparsed: data}) + "\n"); } catch(e2){}
  }
  const out = { hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext: "NONCE-PTUF-b81e2d" } };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
