'use strict';
// G37 N11 static check: no autopilot hook may serialise the whole process.env (it would carry the account token).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const BAD = [
  /JSON\.stringify\(\s*process\.env\b/,
  /(?:inspect|dump)\(\s*process\.env\b/,
  /console\.\w+\(\s*process\.env\s*[,)]/,
  /(?:writeFileSync|appendFileSync|write)\([^;]*JSON\.stringify\(\s*\{\s*\.\.\.process\.env/,
  /Object\.(?:entries|assign)\(\s*process\.env\b[^)]*\)\s*\.\s*(?:map|join)/,
];

function findings(files) {
  const out = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const re of BAD) if (re.test(src)) out.push(`${path.basename(f)}: ${re}`);
  }
  return out;
}
function hookFiles() {
  return fs.readdirSync(__dirname).filter((n) => n.endsWith('.js') && !n.endsWith('.test.js')).map((n) => path.join(__dirname, n));
}

test('no hook serialises process.env wholesale', () => {
  assert.deepStrictEqual(findings(hookFiles()), []);
});

test('NEG: a hook that serialises process.env is detected', () => {
  const tmp = path.join(require('os').tmpdir(), `envser-${process.pid}.js`);
  fs.writeFileSync(tmp, "require('fs').writeFileSync('/x', JSON.stringify(process.env));\n");
  try { assert.strictEqual(findings([tmp]).length, 1); } finally { fs.rmSync(tmp, { force: true }); }
});
