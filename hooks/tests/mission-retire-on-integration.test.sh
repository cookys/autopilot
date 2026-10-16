#!/usr/bin/env bash
# BL-0062: superseded same-graph adoptions are retired automatically at the moment the
# integration step CONFIRMS the merge (next-touch-validation.js executeAuthorizedIntegration),
# not at COMPLETE and never by chronology. `mission-terminal-reconcile.js rollover` stays the
# rescue tool (covered by mission-terminal-rollover.test.sh).
#
# Every scenario drives the REAL integration step: a real fast-forward of develop in a scratch
# clone of this repo (own .git, so observed_head ancestry is real and the live
# .git/autopilot/mission is never touched), over the frozen Mission evidence snapshot from
# fixtures/mission-terminal-rollover. Nothing replays the manual rollover order.
set -uo pipefail
. "$(dirname "$0")/lib.sh"

LIVE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FIXTURE="$LIVE_ROOT/hooks/tests/fixtures/mission-terminal-rollover"
SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/mission-retire-on-integration.XXXXXX")"
trap 'rm -rf "$SCRATCH"; cleanup_test_tmp' EXIT

if ! git clone --quiet --no-hardlinks -- "$LIVE_ROOT" "$SCRATCH/repo" >/dev/null 2>&1; then
  echo "FAIL: could not clone the repo"; exit 1
fi

REPO_ROOT_LIVE="$LIVE_ROOT" SCRATCH_ROOT="$SCRATCH" FIXTURE_DIR="$FIXTURE" node - <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const live = process.env.REPO_ROOT_LIVE;
const repo = path.join(process.env.SCRATCH_ROOT, 'repo');
const fixture = process.env.FIXTURE_DIR;
const runtime = require(path.join(live, 'src/mission/runtime'));
const validation = require(path.join(live, 'scripts/next-touch-validation'));

const INTEGRATED = 'fcca6ea6231e5b68414a3be9075c035a643ee20b121071a91d2a299d8bee02eb';
let pass = 0; let fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`PASS: ${name}`); } else { fail += 1; console.log(`FAIL: ${name} ${detail || ''}`); }
}
function git(cwd, args) { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }

git(repo, ['config', 'user.email', 'retire@example.test']);
git(repo, ['config', 'user.name', 'retire-test']);
const BASE = git(repo, ['rev-parse', 'HEAD']);
const common = fs.realpathSync(git(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
const mroot = path.join(common, 'autopilot', 'mission');
const storeFile = path.join(mroot, 'terminal-rollovers.json');
const oldId = 'git-common-dir:@FIXTURE_COMMON_DIR@';
const newId = `git-common-dir:${common}`;

function rebind(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) { rebind(p); continue; }
    if (!ent.isFile()) continue;
    const text = fs.readFileSync(p, 'utf8');
    if (text.includes(oldId)) fs.writeFileSync(p, text.split(oldId).join(newId));
  }
}
function seed() {
  fs.rmSync(path.join(common, 'autopilot'), { recursive: true, force: true });
  fs.mkdirSync(path.join(common, 'autopilot'), { recursive: true });
  fs.cpSync(path.join(fixture, 'mission'), mroot, { recursive: true });
  rebind(mroot);
}
function mutate(file, fn) { const v = JSON.parse(fs.readFileSync(file, 'utf8')); fn(v); fs.writeFileSync(file, JSON.stringify(v, null, 2)); }
function lifecycleFile() {
  const base = path.join(mroot, 'g8b-final', INTEGRATED);
  for (const at of fs.readdirSync(base).filter((n) => n.startsWith('attempt-'))) {
    const l = path.join(base, at, 'terminal', 'icc-lifecycle-receipt.json');
    if (fs.existsSync(l)) return l;
  }
  throw new Error('fixture has no lifecycle receipt for the integrated adoption');
}

// Fresh develop + a candidate one commit ahead, then the REAL integration step.
function integrate({ divergeDevelop = false } = {}) {
  git(repo, ['checkout', '-q', '-B', 'develop', BASE]);
  const source = path.join(process.env.SCRATCH_ROOT, 'source');
  try { git(repo, ['worktree', 'remove', '--force', source]); } catch { /* none yet */ }
  try { git(repo, ['branch', '-D', 'candidate']); } catch { /* none yet */ }
  git(repo, ['worktree', 'add', '-q', '-b', 'candidate', source, BASE]);
  git(source, ['config', 'user.email', 'retire@example.test']);
  git(source, ['config', 'user.name', 'retire-test']);
  fs.writeFileSync(path.join(source, 'candidate.txt'), `${Math.random()}\n`);
  git(source, ['add', 'candidate.txt']);
  git(source, ['commit', '-qm', 'candidate']);
  const candidate = git(source, ['rev-parse', 'HEAD']);
  const candidateTree = git(source, ['rev-parse', 'HEAD^{tree}']);
  const develop = git(repo, ['rev-parse', 'refs/heads/develop']);
  const repoInfo = runtime.canonicalRepository(repo);
  const prepare = path.join(mroot, 'g8b-final', INTEGRATED, 'prepare-receipt.json');
  const bundle = {
    candidate_ref: 'refs/heads/candidate', source_worktree: source, develop_sha: develop,
    allowed_path_prefixes: [], campaign_id: `campaign-v1-${'b'.repeat(64)}`,
    integration_state: 'reviewed_archived', merge_receipt: null,
    prepared_receipt: { path: prepare, receipt_digest: JSON.parse(fs.readFileSync(prepare, 'utf8')).receipt_digest || '0'.repeat(64) },
  };
  if (!/^[0-9a-f]{64}$/.test(bundle.prepared_receipt.receipt_digest)) bundle.prepared_receipt = prepare;
  const bundlePath = path.join(common, 'autopilot', 'terminal-bundle-retire.json');
  runtime.atomicWriteJson(bundlePath, bundle);
  if (divergeDevelop) {
    fs.writeFileSync(path.join(repo, 'develop.txt'), 'diverged\n');
    git(repo, ['add', 'develop.txt']); git(repo, ['commit', '-qm', 'develop diverged']);
  }
  const frozen = { candidate, candidateTree };
  const args = { integrate_worktree: repo };
  try {
    const result = validation.executeAuthorizedIntegration({ bundle, bundlePath, repoInfo, frozen, args });
    return { result, merged: git(repo, ['rev-parse', 'HEAD']) === candidate };
  } catch (error) { return { error, merged: git(repo, ['rev-parse', 'HEAD']) === candidate }; }
}

// 1. adopted adoption is in the merged history -> the other COMPLETE adoptions retire automatically
seed();
let run = integrate();
const retirement = run.result && run.result.adoption_retirement;
check('integration really fast-forwarded develop', run.merged && run.result && run.result.status === 'integrated', run.error && run.error.message);
check('auto path retires superseded adoptions', retirement && retirement.status === 'retired' && retirement.superseded.length >= 1, JSON.stringify(retirement));
const store = fs.existsSync(storeFile) ? JSON.parse(fs.readFileSync(storeFile, 'utf8')) : { rollovers: {} };
const rec = Object.values(store.rollovers || {})[0];
check('record names the adopted key and never itself as superseded',
  rec && rec.integrated_adoption_key === INTEGRATED && !rec.superseded.some((s) => s.adoption_key === INTEGRATED)
    && rec.superseded.every((s) => s.disposition === `superseded_by:${INTEGRATED}`), JSON.stringify(rec && rec.superseded));
check('record is a content-addressed mission_terminal_rollover with no fabrication',
  rec && rec.artifact_type === 'mission_terminal_rollover' && rec.synthesized_work_orders === 0 && rec.mutated_receipts === 0 && rec.history_rewritten === false);

// 2. (a) adopted adoption is NOT in shipped history -> nothing retired
seed();
mutate(lifecycleFile(), (l) => { l.observed_head = '0123456789abcdef0123456789abcdef01234567'; });
run = integrate();
const unshipped = run.result && run.result.adoption_retirement;
check('(a) not an ancestor of HEAD -> skipped ROLLOVER_NOT_SHIPPED, nothing written',
  unshipped && unshipped.status === 'skipped' && unshipped.reason === 'ROLLOVER_NOT_SHIPPED' && !fs.existsSync(storeFile), JSON.stringify(unshipped));

// 2b. no merge at all (develop moved) -> integration refuses, nothing retired
seed();
run = integrate({ divergeDevelop: true });
check('(a) no merge happened -> integration refuses and nothing is retired', run.error && !run.merged && !fs.existsSync(storeFile), run.error && run.error.message);

// 3. (c) only one adoption of the graph -> untouched
seed();
const regFile = path.join(mroot, 'registry.json');
mutate(regFile, (reg) => {
  const graph = reg.missions[INTEGRATED].mission_graph_digest;
  for (const [k, v] of Object.entries(reg.missions)) if (v.mission_graph_digest === graph && k !== INTEGRATED) delete reg.missions[k];
});
run = integrate();
const single = run.result && run.result.adoption_retirement;
check('(c) single adoption -> nothing_to_retire and no record', single && single.status === 'nothing_to_retire' && !fs.existsSync(storeFile), JSON.stringify(single));

console.log(`\nmission-retire-on-integration.test.sh: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
NODE
exit $?
