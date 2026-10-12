// List hooks/tests/*.test.sh suites that mention any code file this branch changed (base 4abd667f).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const W = '/home/cookys/projects/autopilot/.claude/worktrees/autocompact-detect';
const changed = execFileSync('git', ['diff', '--name-only', '4abd667f..HEAD'], { cwd: W, encoding: 'utf8' })
  .split('\n').filter((f) => /^(scripts|hooks|src|bin)\//.test(f) && !/^hooks\/tests\//.test(f) && /\.(js|sh|mjs|json)$/.test(f));
const names = [...new Set(changed.map((f) => path.basename(f)))];
const testsDir = path.join(W, 'hooks/tests');
const suites = new Set();
for (const t of fs.readdirSync(testsDir).filter((f) => f.endsWith('.test.sh'))) {
  const body = fs.readFileSync(path.join(testsDir, t), 'utf8');
  if (names.some((n) => body.includes(n))) suites.add(t);
}
// tests the branch itself touched
for (const f of execFileSync('git', ['diff', '--name-only', '4abd667f..HEAD'], { cwd: W, encoding: 'utf8' }).split('\n')) {
  if (/^hooks\/tests\/[^/]+\.test\.sh$/.test(f) && fs.existsSync(path.join(W, f))) suites.add(path.basename(f));
}
console.error(`changed code files: ${changed.length}`);
console.error(changed.join('\n'));
console.log([...suites].sort().join('\n'));
