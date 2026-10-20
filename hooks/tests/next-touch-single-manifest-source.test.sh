#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# RED at 06f77273f965ed0949ae9aa5d8c93ea80234898c: writer-only extra manifest key, hand-built verifier, replay MERGE_RECEIPT_INVALID: integrated receipt manifest is not the authorized intent

copy="$(mktemp -d "$TEST_TMP/manifest-source.XXXXXX")"
tar -C "$REPO_ROOT" --exclude .git --exclude node_modules -cf - . | tar -C "$copy" -xf -

python3 - "$copy/src/status/merge-intent.js" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
text = path.read_text()
needle = "    schema_version: SCHEMA_VERSION,\n    artifact_type: ARTIFACT_TYPE,\n    repo: resolved.repo,"
insert = "    schema_version: SCHEMA_VERSION,\n    negative_control_extra: true,\n    artifact_type: ARTIFACT_TYPE,\n    repo: resolved.repo,"
count = text.count(needle)
if count != 1:
    raise SystemExit(f"composer anchor count {count}")
path.write_text(text.replace(needle, insert, 1))
PY

node - "$copy" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const sourceText = fs.readFileSync(path.join(root, 'src/status/merge-intent.js'), 'utf8');
if (!sourceText.includes('negative_control_extra: true')) {
  throw new Error('temp composer was not mutated');
}
const runtime = require(path.join(root, 'src/mission/runtime'));
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const mergeIntent = require(path.join(root, 'src/status/merge-intent'));

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}
function commit(cwd, name, contents, message) {
  fs.writeFileSync(path.join(cwd, name), contents);
  git(cwd, ['add', name]);
  git(cwd, ['commit', '-qm', message]);
}

const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-source-'));
const repo = path.join(parent, 'repo');
const source = path.join(parent, 'source');
fs.mkdirSync(repo);
git(repo, ['init', '-q', '-b', 'develop']);
git(repo, ['config', 'user.email', 'next-touch@example.test']);
git(repo, ['config', 'user.name', 'next-touch-test']);
commit(repo, 'base.txt', 'base\n', 'base');
const base = git(repo, ['rev-parse', 'HEAD']);
git(repo, ['worktree', 'add', '-q', '-b', 'candidate', source, base]);
commit(source, 'candidate.txt', 'candidate\n', 'candidate');
const candidate = git(source, ['rev-parse', 'HEAD']);
const candidateTree = git(source, ['rev-parse', 'HEAD^{tree}']);
const develop = git(repo, ['rev-parse', 'refs/heads/develop']);
const info = runtime.canonicalRepository(repo);
const bundle = {
  candidate_ref: 'refs/heads/candidate',
  source_worktree: source,
  develop_sha: develop,
  allowed_path_prefixes: ['docs/', 'src/'],
  campaign_id: 'campaign-v1-' + 'd'.repeat(64),
  integration_state: 'reviewed_archived',
  merge_receipt: null,
};
const frozen = { candidate, candidateTree };
const args = { integrate_worktree: repo };
const pre = validation.validateIntegrationPreconditions(bundle, args, info, frozen);
if (!pre.sealed.manifest.negative_control_extra) {
  throw new Error('writer seal did not follow the mutated composer');
}
const bundlePath = path.join(info.common, 'autopilot', 'terminal.json');
runtime.atomicWriteJson(bundlePath, bundle);
const first = validation.executeAuthorizedIntegration({
  bundle, bundlePath, repoInfo: info, frozen, args, preconditions: pre,
});
if (first.status !== 'integrated' || first.receipt.manifest_seal !== pre.sealed.seal) {
  throw new Error('mutated composer did not seal the integrated receipt');
}
const integrated = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const second = validation.executeAuthorizedIntegration({
  bundle: integrated, bundlePath, repoInfo: info, frozen, args,
});
if (second.status !== 'already_integrated' || second.receipt.manifest_seal !== first.receipt.manifest_seal) {
  throw new Error('shared composer did not revalidate the integrated receipt');
}
const recomposed = mergeIntent.composeMergeIntentManifest({
  repo: info.repo,
  root_run_id: bundle.campaign_id,
  edges: pre.sealed.manifest.edges,
  forbidden_reverse_edges: pre.sealed.manifest.forbidden_reverse_edges,
  allowed_path_prefixes: ['src/', 'docs/', 'docs/'],
});
if (recomposed.manifest.negative_control_extra !== true
    || recomposed.manifest.preservation_policy.allowed_path_prefixes.join(',') !== 'docs/,src/'
    || recomposed.seal !== first.receipt.manifest_seal) {
  throw new Error('recompose did not preserve the shared seal and sorted prefixes');
}
fs.rmSync(parent, { recursive: true, force: true });
console.log('shared merge-intent composer survived an extra manifest key');
NODE
assert_exit_code "$?" "0" "integrated receipt seal follows the single manifest composer"

finalize_test
