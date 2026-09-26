const fs = require('fs');
const path = require('path');
const S = path.resolve(__dirname, '..');
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  const counterFile = __dirname + '/counter.txt';
  let n = 1;
  try { n = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) + 1; } catch (e) {}
  fs.writeFileSync(counterFile, String(n));
  const nonce = `NONCE-UPS-AC-d4e5f6-T${n}`;
  try {
    fs.appendFileSync(S + '/payloads-u2.jsonl', JSON.stringify({variant:'U2-additionalContext', turn: n, nonce, raw: JSON.parse(data||'{}')}) + "\n");
  } catch (e) {
    fs.appendFileSync(S + '/payloads-u2.jsonl', JSON.stringify({variant:'U2-additionalContext', turn: n, nonce, raw_unparsed: data}) + "\n");
  }
  const out = { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: nonce } };
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
});
