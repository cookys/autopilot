#!/usr/bin/env node
'use strict';
// layout-readers-driver.js - test helper for layout-readers-guard.test.sh. Runs ONE registry-reading reader of a lib tree against a
// target repo and prints what it saw, so the suite can assert which copy of a work record (docs/ or project/) was read.
//   node layout-readers-driver.js ledger <lib-root> <target-repo>       workflow-snapshot: the decision-ledger lines
//   node layout-readers-driver.js gate <lib-root> <target-repo> <rel>    edit gate: isAllowlisted(<rel>, <target-repo>) -> true|false
//   node layout-readers-driver.js denied <lib-root> <target-repo> <rel>  plan-review-context: is <rel> a denied dir for the target
const fs = require('fs');
const os = require('os');
const path = require('path');

const [mode, libRoot, target, rel] = process.argv.slice(2);
const req = (r) => require(path.join(path.resolve(libRoot), r));
if (mode === 'ledger') {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lrd-'));
  const dirs = { sessionMode: path.join(tmp, 'sm'), live: path.join(tmp, 'live'), taskCard: path.join(tmp, 'tc'), dispatchRuns: path.join(tmp, 'runs') };
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
  const snap = req('scripts/lib/workflow-snapshot.js').collect({ sessionId: 'lrd-session', cwd: target, now: Date.now(), dirs, git: () => '' });
  process.stdout.write(snap.lines.join('\n') + '\n');
  fs.rmSync(tmp, { recursive: true, force: true });
} else if (mode === 'gate') {
  process.stdout.write(String(req('hooks/orchestrator-edit-gate-lib.js').isAllowlisted(rel, target)) + '\n');
} else if (mode === 'denied') {
  process.stdout.write(String(req('scripts/lib/plan-review-context.js').deniedDirsFor(target).test(rel)) + '\n');
} else {
  process.stderr.write('usage: layout-readers-driver.js ledger|gate|denied <lib-root> <target-repo> [rel]\n');
  process.exit(2);
}
