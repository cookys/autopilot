#!/usr/bin/env bash
# hooks/tests/campaign-contract-capacity-caps.test.sh
#
# BL-0081: the executable contract validator holds the same capacity caps as the
# schema. max_owned_worktrees / temp_capacity_limit / max_prompt_bytes /
# max_finding_recurrence feed the controller's admission ceilings verbatim, so an
# out-of-range value must not seal. Absent stays absent (the schema marks them
# optional), and in-range values still seal.

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
const check = require(path.join(root, 'scripts', 'implementation-campaign-check'));
const schema = JSON.parse(fs.readFileSync(path.join(root, 'schemas', 'implementation-campaign-contract.schema.json'), 'utf8'));

const repo = path.join(tmp, 'repo');
fs.mkdirSync(repo, { recursive: true });
const git = (...a) => cp.execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
git('init', '-q', '-b', 'main');
git('config', 'user.email', 't@example.invalid');
git('config', 'user.name', 't');
fs.writeFileSync(path.join(repo, 'f.txt'), 'x\n');
git('add', 'f.txt');
git('commit', '-q', '-m', 'init');
const base = git('rev-parse', 'HEAD');

const contract = (extra = {}) => ({
  schema_version: 1,
  ticket: 'caps-fixture',
  profile: 'poc',
  mission_grant_ref: crypto.createHash('sha256').update('grant').digest('hex'),
  repo_identity: check.canonicalRepoIdentity(repo),
  base_sha: base,
  branch: 'main',
  vertical_acceptance: ['caps fixture'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'node fixture.js',
  rubric_ids: ['CAPS-FIXTURE1'],
  ...extra,
});
const validate = (c) => check.validateContract(c, {
  repo,
  repoIdentity: check.canonicalRepoIdentity(repo),
  objectFormat: check.repoObjectFormat(repo),
  missionMode: 'off',
});

const failed = [];
function run(name, fn) {
  try { fn(); } catch (e) { failed.push(name); console.log(`RED ${name}: ${String(e.message).split('\n')[0]}`); }
}

const caps = ['max_owned_worktrees', 'temp_capacity_limit', 'max_prompt_bytes', 'max_finding_recurrence'];

run('baseline contract seals (premise)', () => {
  assert.deepStrictEqual(validate(contract()), []);
});
run('absent caps stay absent', () => {
  const errs = validate(contract());
  assert.ok(!errs.some((e) => caps.some((c) => e.startsWith(c))), errs.join('; '));
});
run('in-range caps seal, including both bounds', () => {
  for (const key of caps) {
    const { minimum, maximum } = schema.properties[key];
    for (const value of [minimum, maximum]) {
      assert.deepStrictEqual(validate(contract({ [key]: value })), [], `${key}=${value}`);
    }
  }
});
run('out-of-range or non-integer caps do not seal', () => {
  for (const key of caps) {
    const { minimum, maximum } = schema.properties[key];
    for (const bad of [maximum + 1, 999999999, minimum - 1, 1.5, '4', null]) {
      const errs = validate(contract({ [key]: bad }));
      assert.ok(errs.some((e) => e.startsWith(`${key}:`)), `${key}=${JSON.stringify(bad)} must be rejected, got: ${errs.join('; ')}`);
    }
  }
});

assert.deepStrictEqual(failed, [], `red sections: ${failed.join(', ')}`);
console.log('campaign contract capacity cap assertions passed');
NODE
assert_exit_code "$?" "0" "BL-0081 campaign contract capacity cap assertions"

finalize_test
