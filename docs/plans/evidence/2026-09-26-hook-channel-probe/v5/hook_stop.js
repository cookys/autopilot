const fs = require('fs');
const flag = __dirname + '/fired.flag';
let data = '';
process.stdin.on('data', d => data += d);
process.stdin.on('end', () => {
  try {
    fs.appendFileSync(__dirname + '/../payloads.jsonl', JSON.stringify({variant:'V5-Stop-exit2', raw: JSON.parse(data||'{}'), already_fired: fs.existsSync(flag)}) + "\n");
  } catch (e) {}
  if (!fs.existsSync(flag)) {
    fs.writeFileSync(flag, '1');
    process.stderr.write("NONCE-STOP-X2-a17be4\n");
    process.exit(2);
  }
  process.exit(0);
});
