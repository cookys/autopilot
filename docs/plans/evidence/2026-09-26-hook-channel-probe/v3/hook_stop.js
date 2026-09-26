const fs = require('fs');
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    fs.appendFileSync(__dirname + '/../payloads.jsonl', JSON.stringify({variant:'V3-Stop-systemMessage', raw: JSON.parse(data||'{}')}) + "\n");
  } catch (e) {}
  const out = { systemMessage: "NONCE-STOP-SM-4d9f21" };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
