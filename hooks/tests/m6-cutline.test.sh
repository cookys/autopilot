#!/usr/bin/env bash
set -euo pipefail
. "$(dirname "$0")/lib.sh"
. "$(dirname "$0")/lib/hippo-sandbox.sh"
hs_setup
R="$(hs_mkrepo cutline)"
mkdir -p "$R/plans" "$R/projects"
printf old > "$R/plans/old.md"
printf old > "$R/projects/old.md"
git -C "$R" add plans projects
GIT_AUTHOR_DATE=2020-01-01T12:00:00Z GIT_COMMITTER_DATE=2020-01-01T12:00:00Z git -C "$R" commit -qm old
printf updated > "$R/plans/old.md"
printf updated > "$R/projects/old.md"
printf new > "$R/plans/new.md"
git -C "$R" add plans projects
GIT_AUTHOR_DATE=2022-01-01T12:00:00Z GIT_COMMITTER_DATE=2022-01-01T12:00:00Z git -C "$R" commit -qm new
node - "$REPO_ROOT/scripts/lib/m6-cutline.js" "$R" <<'NODE'
const assert = require('assert');
const fs = require('fs');
const { execFileSync } = require('child_process');
const m = require(process.argv[2]);
const repo = process.argv[3];
const registry = execFileSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'], {encoding:'utf8'}).trim() + '/autopilot/m6-registry.json';
let calls = 0;
delete process.env.AUTOPILOT_M6_CUTLINE;
assert.strictEqual(m.CUTLINE, null);
assert.deepStrictEqual(m.guardedStoreWrite(repo, 'null.md', () => calls++), {skipped:false});
assert.strictEqual(calls, 1);
assert(m.isRegistered(repo, 'null.md'));
process.env.AUTOPILOT_M6_CUTLINE = '2021-01-01';
const before = fs.readFileSync(registry, 'utf8');
for (const p of ['plans/old.md', 'projects/old.md']) {
  assert(m.isBeforeCutline(repo, p));
  assert.deepStrictEqual(m.guardedStoreWrite(repo, p, () => calls++), {skipped:true}, `old write ${p}`);
  assert.strictEqual(calls, 1, `old callback ${p}`);
  const registered = m.register(repo, p);
  assert.strictEqual(fs.readFileSync(registry, 'utf8'), before, `registry unchanged ${p}`);
  assert.strictEqual(registered, false, `old registration ${p}`);
}
assert.deepStrictEqual(m.guardedStoreWrite(repo, 'plans/new.md', () => calls++), {skipped:false});
assert.strictEqual(calls, 2);
assert(m.isRegistered(repo, 'plans/new.md'));
const after = fs.readFileSync(registry, 'utf8');
assert.throws(() => m.guardedStoreWrite(repo, 'throw.md', () => { throw Error('write failed'); }), /write failed/);
assert.strictEqual(fs.readFileSync(registry, 'utf8'), after);
assert.deepStrictEqual(m.list(repo), ['null.md', 'plans/new.md']);
console.log('PASS m6-cutline');
NODE
