#!/usr/bin/env bash
# hooks/tests/work-order-lifecycle-hardening.test.sh
#
# BL-0079: portable byte hashing and Work Order lifecycle edges.
#   - a symlink hashes as Git stores it (its target string), in the three places
#     the engine hashes worktree bytes, and a path behind a symlinked directory
#     has no digest;
#   - a Work Order that is not a stale tombstone cannot carry a disposition
#     receipt, at write time and in stored-record integrity;
#   - an unreadable process table is an explicit orphan_blocked classification,
#     not an exception out of classifyWorkOrder.

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
const crypto = require('crypto');

const root = process.argv[2];
const tmp = process.argv[3];
const ctrl = require(path.join(root, 'src', 'engine', 'controller-execution'));
const zdv = require(path.join(root, 'src', 'engine', 'sealed-zero-diff-validator'));
const wo = require(path.join(root, 'src', 'engine', 'work-order'));
const mra = require(path.join(root, 'scripts', 'mission-routing-admission'));

const failed = [];
function run(name, fn) {
  try { fn(); } catch (e) { failed.push(name); console.log(`RED ${name}: ${String(e.message).split('\n')[0]}`); }
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const dir = path.join(tmp, 'repo');
fs.mkdirSync(dir, { recursive: true });
const git = (...a) => cp.execFileSync('git', a, { cwd: dir });
git('init', '-q');
git('config', 'user.email', 't@example.invalid');
git('config', 'user.name', 't');
fs.mkdirSync(path.join(dir, 'real'));
fs.writeFileSync(path.join(dir, 'real', 'target.txt'), 'TARGET BYTES\n');
fs.writeFileSync(path.join(dir, 'plain.txt'), 'plain\n');
fs.symlinkSync('real/target.txt', path.join(dir, 'link.txt'));
fs.symlinkSync('real', path.join(dir, 'linkdir'));
git('add', '-A');
git('commit', '-q', '-m', 'init');
const gitBlobBytes = (p) => git('show', `HEAD:${p}`);

run('symlink digest agrees with git', () => {
  const viaGit = sha(gitBlobBytes('link.txt'));
  assert.strictEqual(viaGit, sha(Buffer.from('real/target.txt')), 'premise: git stores the link target');
  assert.strictEqual(ctrl.pathContentDigest(dir, 'link.txt'), viaGit,
    'pathContentDigest must hash the link target string like git, not the pointed-at file');
  assert.strictEqual(mra.readRelevantBytes(dir, ['link.txt'])['link.txt'], viaGit);
  // Positive control: a regular file is unchanged.
  assert.strictEqual(ctrl.pathContentDigest(dir, 'plain.txt'), sha(gitBlobBytes('plain.txt')));
  assert.strictEqual(mra.readRelevantBytes(dir, ['plain.txt'])['plain.txt'], sha(gitBlobBytes('plain.txt')));
});

run('path behind a symlinked directory has no digest', () => {
  assert.strictEqual(ctrl.pathContentDigest(dir, 'linkdir/target.txt'), null);
  assert.deepStrictEqual(mra.readRelevantBytes(dir, ['linkdir/target.txt']), {});
  assert.strictEqual(ctrl.pathContentDigest(dir, 'real/target.txt'), sha(gitBlobBytes('real/target.txt')));
});

run('zero-diff worktree postcheck agrees with git', () => {
  const l = 'link.txt';
  assert.strictEqual(zdv.gitEquivalentPathBytes(dir, l).toString(), 'real/target.txt');
  assert.strictEqual(zdv.gitEquivalentPathBytes(dir, 'nope.txt'), null);
  assert.strictEqual(zdv.gitEquivalentPathBytes(dir, 'real'), null, 'a directory has no blob');
});

const base = git('rev-parse', 'HEAD').toString().trim();
const branch = git('rev-parse', '--abbrev-ref', 'HEAD').toString().trim();
const common = wo.resolveGitCommonDir(dir);
const mk = (rootRunId, extra = {}) => wo.createOrUpdateWorkOrder(common, {
  root_run_id: rootRunId, graph_node: 'n', attempt: 1, role: 'controller', next_action: 'continue',
  branch, base_sha: base, worktree: dir, paths: {}, ...extra,
}, { bindArtifacts: false });

run('stray disposition receipt is rejected at write', () => {
  const receipt = {
    schema_version: 1, artifact_type: 'work_order_disposition_receipt', disposition: 'stale_dispositioned',
    work_order_id: 'x', root_run_id: 'r', graph_node: 'n', attempt: 1, generation: 1,
    work_order_digest: 'a'.repeat(64), cas_token: 'c', observation_digest: 'b'.repeat(64),
    issued_at: new Date().toISOString(), digest: 'd'.repeat(64),
  };
  const r = mk('stray-write', { disposition_receipt: receipt });
  assert.strictEqual(r.status, 'reject', JSON.stringify(r).slice(0, 300));
  assert.strictEqual(r.reason_code, 'disposition_receipt_unexpected');
  // Positive control: the same record without a receipt is written.
  assert.strictEqual(mk('stray-write-ok').status, 'written');
});

run('stray disposition receipt in a stored record is named', () => {
  const written = mk('stray-stored');
  assert.strictEqual(written.status, 'written');
  const tampered = JSON.parse(JSON.stringify(written.work_order));
  tampered.disposition_receipt = { schema_version: 1 };
  tampered.digest = wo.workOrderDigest(tampered);
  const integrity = wo.validateStoredWorkOrderIntegrity(tampered);
  assert.strictEqual(integrity.ok, false);
  assert.strictEqual(integrity.reason_code, 'disposition_receipt_unexpected');
  assert.strictEqual(wo.validateStoredWorkOrderIntegrity(written.work_order).ok, true, 'untampered record is intact');
});

run('unreadable process table classifies explicitly', () => {
  const live = mk('proc-table');
  assert.strictEqual(live.status, 'written');
  const realAccess = fs.accessSync;
  let classified;
  try {
    fs.accessSync = function patched(p, ...rest) {
      if (p === '/proc') { const e = new Error('EACCES: simulated'); e.code = 'EACCES'; throw e; }
      return realAccess.call(this, p, ...rest);
    };
    classified = wo.classifyWorkOrder(live.work_order, {
      gitCwd: dir, workOrderPath: live.path, requireBoundEvidence: false,
    });
  } finally {
    fs.accessSync = realAccess;
  }
  assert.strictEqual(classified.classification, 'orphan_blocked');
  assert.strictEqual(classified.reason_code, 'process_table_unreadable');
  // Positive control: with a readable table the same record still classifies as live.
  const normal = wo.classifyWorkOrder(live.work_order, {
    gitCwd: dir, workOrderPath: live.path, requireBoundEvidence: false,
  });
  assert.notStrictEqual(normal.reason_code, 'process_table_unreadable');
});

assert.deepStrictEqual(failed, [], `red sections: ${failed.join(', ')}`);
console.log('work order lifecycle hardening assertions passed');
NODE
assert_exit_code "$?" "0" "BL-0079 portable byte and Work Order lifecycle assertions"

finalize_test
