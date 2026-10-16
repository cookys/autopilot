#!/usr/bin/env node
// check-qs-answers.js — instrument check for the qs row: for each qs task, build the fixture repo exactly as the runner does
// (lib/qs-build-cell-repo.sh), run the FROZEN selector on it, and assert it equals the hand-authored answer.json.
// A mismatch is an instrument error: fix the fixture or the hand-authored answer by reasoning about the planted graph, never toward the selector.
//   check-qs-answers.js [--corrupt]   --corrupt drops one required suite from s1's expected answer in memory; the check must then FAIL (negative control, exit 3 if it does not).
// Exit 0 all equal . 1 mismatch . 3 negative control did not fail . 2 usage/build error.
'use strict';
const fs = require('fs'); const os = require('os'); const path = require('path'); const cp = require('child_process');
const HERE = __dirname;
const corrupt = process.argv.includes('--corrupt');
const tasks = fs.readdirSync(path.join(HERE, 'tasks')).filter((t) => /^qs-s\d/.test(t)).sort();
let bad = 0;
for (const t of tasks) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-check-'));
  const b = cp.spawnSync('bash', [path.join(HERE, 'lib/qs-build-cell-repo.sh'), t, dir], { encoding: 'utf8' });
  if (b.status !== 0) { console.error(`build failed for ${t}: ${b.stderr}`); process.exit(2); }
  const r = cp.spawnSync('node', ['scripts/affected-suites.js', '--base', 'develop', '--head', 'HEAD', '--json'], { cwd: dir, encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) { console.error(`selector failed for ${t}: ${r.stderr}`); process.exit(2); }
  const sel = JSON.parse(r.stdout);
  const ans = JSON.parse(fs.readFileSync(path.join(HERE, 'tasks', t, 'answer.json'), 'utf8'));
  if (corrupt && t === 'qs-s1-hooks-selective') ans.required = ans.required.slice(1);
  const wantMode = ans.selector_mode || ans.mode;
  const wantSuites = wantMode === 'full' ? [] : (ans.selector_required || ans.required);
  const same = (a, b2) => JSON.stringify([...a].sort()) === JSON.stringify([...b2].sort());
  const ok = sel.mode === wantMode && same(sel.suites, wantSuites) && same(sel.extra_runners, ans.extra_runners);
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${t} selector=${sel.mode}/${sel.suites.length} suites, extra=${JSON.stringify(sel.extra_runners)}`);
  if (!ok) bad++;
}
if (corrupt) process.exit(bad ? 0 : 3);
process.exit(bad ? 1 : 0);
