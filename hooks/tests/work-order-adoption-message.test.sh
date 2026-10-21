#!/usr/bin/env bash
# hooks/tests/work-order-adoption-message.test.sh
#
# BL-0247: controller_worktree_unique names the next command.
# Case A: a registered worktree with one unique commit is refused and the
# reason names engine review-candidate.
# Case B: a clean worktree whose head equals base is ok with a null reason.
# RED at cbef8267a: case A reason was "controller worktree has unique committed mutation and requires adoption" and did not contain "engine review-candidate"

set -euo pipefail
. "$(dirname "$0")/lib.sh"

unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH AUTOPILOT_SESSION_ID CLAUDE_CODE_SESSION_ID 2>/dev/null || true

MY_TMP=$(mktemp -d)
export HOME="$MY_TMP/home"
mkdir -p "$HOME"
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
const wo = require(path.join(root, 'src', 'engine', 'work-order'));

const repo = path.join(tmp, 'repo');
const wt = path.join(tmp, 'wt');
fs.mkdirSync(repo, { recursive: true });
const git = (cwd, args) => cp.execFileSync('git', args, { cwd, encoding: 'utf8' });
git(repo, ['init', '-q', '-b', 'main']);
git(repo, ['config', 'user.email', 't@example.invalid']);
git(repo, ['config', 'user.name', 't']);
fs.writeFileSync(path.join(repo, 'f.txt'), 'base\n');
git(repo, ['add', 'f.txt']);
git(repo, ['commit', '-q', '-m', 'base']);
const base = git(repo, ['rev-parse', 'HEAD']).trim();

git(repo, ['worktree', 'add', '-q', '-b', 'feature', wt]);
fs.writeFileSync(path.join(wt, 'f.txt'), 'unique\n');
git(wt, ['add', 'f.txt']);
git(wt, ['commit', '-q', '-m', 'unique']);
const head = git(wt, ['rev-parse', 'HEAD']).trim();
assert.notStrictEqual(head, base);

const uniqueWo = { worktree: wt, branch: 'feature', base_sha: base };
const unique = wo.observeRegisteredControllerWorktree(uniqueWo);
assert.strictEqual(unique.ok, false);
assert.strictEqual(unique.reason_code, 'controller_worktree_unique');
assert.ok(String(unique.reason).includes('engine review-candidate'), unique.reason);

const cleanWo = { worktree: repo, branch: 'main', base_sha: base };
const clean = wo.observeRegisteredControllerWorktree(cleanWo);
assert.strictEqual(clean.ok, true);
assert.strictEqual(clean.reason, null);
assert.strictEqual(clean.reason_code, null);

console.log('ok');
NODE
