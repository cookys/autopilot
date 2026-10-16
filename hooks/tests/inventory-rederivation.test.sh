#!/usr/bin/env bash
# hooks/tests/inventory-rederivation.test.sh
#
# BL-0082: owned-resource inventory rows are re-derived from Git instead of
# trusting the flags a previous generation stored.
#   - an orphan branch (worktree gone, ref remains) with commits is still debt,
#     whatever the stale row said about uniqueness;
#   - a stale `active: true` that nothing corroborates is dropped, on a missing
#     worktree; terminal-receipt-backed and registered rows are left alone;
#   - a path that exists but Git does not know is unknown residue.
# Each case has a control that must NOT change (the row Git corroborates).

set -euo pipefail
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID 2>/dev/null || true

MY_TMP=$(mktemp -d)
cleanup() {
  rm -rf "$MY_TMP"
  cleanup_test_tmp
}
trap cleanup EXIT

node - "$REPO_ROOT" "$MY_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const root = process.argv[2];
const tmp = process.argv[3];
const ctrl = require(path.join(root, 'src', 'engine', 'controller-execution'));

const failed = [];
function run(name, fn) {
  try { fn(); } catch (e) { failed.push(name); console.log(`RED ${name}: ${String(e.message).split('\n')[0]}`); }
}

const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });
const git = (...a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
git('init', '-q');
git('config', 'user.email', 't@example.invalid');
git('config', 'user.name', 't');
fs.writeFileSync(path.join(repo, 'f'), 'x\n');
git('add', 'f');
git('commit', '-q', '-m', 'base');
const base = git('rev-parse', 'HEAD');

// Orphan branch: a commit on top of base, with no worktree.
git('branch', 'orphan-with-commit');
git('checkout', '-q', 'orphan-with-commit');
fs.writeFileSync(path.join(repo, 'g'), 'new work\n');
git('add', 'g');
git('commit', '-q', '-m', 'orphan work');
git('checkout', '-q', '-');
git('branch', 'orphan-clean', base);

// A real registered worktree on its own branch.
const wtPath = path.join(tmp, 'registered-wt');
git('worktree', 'add', '-q', '-b', 'wt-branch', wtPath, base);

const baseRow = (extra) => ({
  kind: 'worktree', identity_known: true, base_sha: base, ...extra,
});
const reconstruct = (rows, extra = {}) => ctrl.reconstructOwnedInventory({
  gitCwd: repo,
  controller: { resource_inventory: rows },
  baseSha: base,
  ...extra,
});
const byId = (inv, id) => inv.inventory.find((r) => r.resource_id === id);
const outcome = (row) => ctrl.classifyResourceOutcome(row);

run('orphan branch with commits is debt despite a stale clean row', () => {
  const ghost = path.join(tmp, 'gone-1');
  const inv = reconstruct([baseRow({
    resource_id: ghost, path: ghost, worktree: ghost, branch: 'orphan-with-commit',
    unique: false, clean: true, dirty: false, active: false,
  })]);
  assert.strictEqual(inv.ok, true);
  const row = byId(inv, ghost);
  assert.strictEqual(row.unique, true, 'uniqueness is re-read from the surviving branch');
  const cls = outcome(row);
  assert.strictEqual(cls.disposition, 'retained_unique');
  assert.strictEqual(cls.blocks_dispatch, true);
});

run('a branch still at its recorded tip keeps the controller observation (control)', () => {
  const ghost = path.join(tmp, 'gone-5');
  const tip = git('rev-parse', 'orphan-with-commit');
  const inv = reconstruct([baseRow({
    resource_id: ghost, path: ghost, worktree: ghost, branch: 'orphan-with-commit', tip,
    unique: false, clean: true, dirty: false, active: false,
  })]);
  const row = byId(inv, ghost);
  assert.strictEqual(row.unique, false, 'normal retained candidate: not re-derived');
  assert.strictEqual(row.tip_before_rederivation, undefined);
});

run('a branch that moved past its recorded tip is re-read', () => {
  const ghost = path.join(tmp, 'gone-6');
  const inv = reconstruct([baseRow({
    resource_id: ghost, path: ghost, worktree: ghost, branch: 'orphan-with-commit', tip: base,
    unique: false, clean: true, dirty: false, active: false,
  })]);
  const row = byId(inv, ghost);
  assert.strictEqual(row.unique, true, 'the leaf kept committing after the controller recorded the row');
  assert.strictEqual(row.tip_before_rederivation, base);
  assert.strictEqual(outcome(row).blocks_dispatch, true);
});

run('orphan branch without commits is not unique (control)', () => {
  const ghost = path.join(tmp, 'gone-2');
  const inv = reconstruct([baseRow({
    resource_id: ghost, path: ghost, worktree: ghost, branch: 'orphan-clean', unique: true, clean: false,
  })]);
  const row = byId(inv, ghost);
  assert.strictEqual(row.unique, false, 'a stale unique:true is also corrected downwards by Git');
  assert.strictEqual(row.branch_exists, true);
});

run('stale active on a missing worktree is dropped', () => {
  const ghost = path.join(tmp, 'gone-3');
  const inv = reconstruct([baseRow({
    resource_id: ghost, path: ghost, worktree: ghost, branch: null, active: true, terminal: false, clean: true,
  })]);
  const row = byId(inv, ghost);
  assert.strictEqual(row.active, false);
  assert.strictEqual(row.active_rederived, 'worktree_not_registered');
  assert.notStrictEqual(outcome(row).disposition, 'active');
});

run('terminal-receipt-backed active row is left alone (control)', () => {
  const ghost = path.join(tmp, 'gone-4');
  const inv = reconstruct([baseRow({
    resource_id: ghost, path: ghost, worktree: ghost, branch: null, active: true, terminal: true,
    terminal_receipt_digest: 'a'.repeat(64),
  })]);
  assert.strictEqual(byId(inv, ghost).active, true);
});

run('active on a registered worktree survives (control: the live candidate holder)', () => {
  const row = baseRow({
    resource_id: wtPath, path: wtPath, worktree: wtPath, branch: 'wt-branch', active: true, terminal: false,
  });
  const inv = reconstruct([row]);
  assert.strictEqual(byId(inv, wtPath).active, true, 'registered worktree: the active claim is corroborated by Git');
  assert.strictEqual(byId(inv, wtPath).worktree_registered, undefined);
});

run('an unregistered path that exists is unknown residue', () => {
  const stray = path.join(tmp, 'stray-dir');
  fs.mkdirSync(stray);
  const inv = reconstruct([baseRow({
    resource_id: stray, path: stray, worktree: stray, branch: null, clean: true,
  })]);
  const row = byId(inv, stray);
  assert.strictEqual(row.identity_known, false);
  assert.strictEqual(outcome(row).disposition, 'retained_unknown');
});

// --- BL-0082: creation-intent records (written before `git worktree add`) ---------------
const intentDir = path.join(repo, '.git', 'autopilot-worktree-creation');
fs.mkdirSync(intentDir, { recursive: true });
const writeIntent = (name, rec) => fs.writeFileSync(path.join(intentDir, name), typeof rec === 'string' ? rec : JSON.stringify(rec));
const intent = (root, p, branch) => ({
  schema: 1, root_run_id: root, run_id: 'r1', loop_id: 'l1', branch, base_sha: base, planned_path: p,
});
const reconstructRoot = (root) => ctrl.reconstructOwnedInventory({
  gitCwd: repo, controller: { resource_inventory: [] }, rootRunId: root, baseSha: base,
});

run('a built-but-unregistered worktree is discoverable through its creation intent', () => {
  const built = path.join(tmp, 'built-never-registered');
  git('worktree', 'add', '-q', '-b', 'intent-branch', built, base);
  writeIntent('built.json', intent('root-A', built, 'intent-branch'));
  const inv = reconstructRoot('root-A');
  assert.strictEqual(inv.ok, true);
  const row = byId(inv, built);
  assert.ok(row, 'the worktree appears in the inventory although the controller never registered it');
  assert.strictEqual(row.from_creation_intent, true);
  assert.strictEqual(row.branch, 'intent-branch');
});

run('another root\'s intent is not ours (control)', () => {
  const inv = reconstructRoot('root-B');
  assert.strictEqual(inv.ok, true);
  assert.strictEqual(inv.inventory.length, 0);
});

run('an intent from a crash before the add leaves nothing to inventory', () => {
  const never = path.join(tmp, 'never-created');
  writeIntent('never.json', intent('root-C', never, 'never-branch'));
  const inv = reconstructRoot('root-C');
  assert.strictEqual(inv.ok, true);
  assert.strictEqual(byId(inv, never), undefined);
});

run('a malformed intent record fails closed', () => {
  writeIntent('bad.json', '{not json');
  const inv = reconstructRoot('root-A');
  assert.strictEqual(inv.ok, false);
  assert.strictEqual(inv.source, 'git_error');
  assert.match(inv.reason, /intent unreadable/);
  fs.rmSync(path.join(intentDir, 'bad.json'));
  writeIntent('bad.json', { root_run_id: 'root-A' });
  assert.strictEqual(reconstructRoot('root-A').ok, false, 'an incomplete record also fails closed');
  fs.rmSync(path.join(intentDir, 'bad.json'));
});

assert.deepStrictEqual(failed, [], `red sections: ${failed.join(', ')}`);
console.log('inventory re-derivation assertions passed');
NODE
assert_exit_code "$?" "0" "BL-0082 inventory re-derivation assertions"

finalize_test
