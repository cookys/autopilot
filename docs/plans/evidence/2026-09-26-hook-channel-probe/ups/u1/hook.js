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
  const nonce = `NONCE-UPS-TXT-a1b2c3-T${n}`;
  try {
    fs.appendFileSync(S + '/payloads-u1.jsonl', JSON.stringify({variant:'U1-plain-stdout', turn: n, nonce, raw: JSON.parse(data||'{}')}) + "\n");
  } catch (e) {
    fs.appendFileSync(S + '/payloads-u1.jsonl', JSON.stringify({variant:'U1-plain-stdout', turn: n, nonce, raw_unparsed: data}) + "\n");
  }
  process.stdout.write(nonce + "\n");
  process.exit(0);
});
