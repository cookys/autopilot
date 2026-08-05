#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

expect_failure() {
  local label="$1"; local expected="$2"; shift 2
  local output rc
  set +e
  output="$($@ 2>&1)"
  rc=$?
  set -e
  if [ "$rc" -eq 0 ]; then
    fail_test "$label accepted an invalid invocation"
  fi
  assert_contains "$output" "$expected" "$label reports $expected"
}

expect_failure "reservation missing ledger" CLI_ARGUMENT_REQUIRED node "$REPO_ROOT/scripts/validate-next-touch-reservation.js" --pre-spend
expect_failure "reservation unknown option" CLI_UNKNOWN_FLAG node "$REPO_ROOT/scripts/validate-next-touch-reservation.js" --ledger "$TEST_TMP/ledger" --pre-spend --nope x
MISSION_COMMON="$(git -C "$REPO_ROOT" rev-parse --git-common-dir)"
case "$MISSION_COMMON" in /*) ;; *) MISSION_COMMON="$REPO_ROOT/$MISSION_COMMON" ;; esac
MISSION_LEDGER="$MISSION_COMMON/autopilot/implementation-campaign.jsonl"
ARCHIVE_AUTH="$REPO_ROOT/docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json"
expect_failure "reservation authorization path escape" AUTHORITY_PATH_ESCAPE node "$REPO_ROOT/scripts/validate-next-touch-reservation.js" --authorization "$TEST_TMP/auth.json" --ledger "$MISSION_LEDGER" --pre-spend
ln -s "$ARCHIVE_AUTH" "$TEST_TMP/auth-link.json"
expect_failure "reservation authorization symlink escape" AUTHORITY_PATH_ESCAPE node "$REPO_ROOT/scripts/validate-next-touch-reservation.js" --authorization "$TEST_TMP/auth-link.json" --ledger "$MISSION_LEDGER" --pre-spend
node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'next-touch-auth-path-'));
const repo = path.join(parent, 'repo');
execFileSync('git', ['init', '-q', repo]);
const auth = path.join(repo, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json');
fs.mkdirSync(path.dirname(auth), { recursive: true });
const external = path.join(parent, 'external-auth.json');
fs.writeFileSync(external, '{}\n');
fs.symlinkSync(external, auth);
let rejected = false;
try { validation.loadRepoAndAuthority({ repo, authorization: auth }); }
catch (error) { rejected = error.code === 'AUTHORITY_PATH_ESCAPE'; }
fs.rmSync(parent, { recursive: true, force: true });
if (!rejected) throw new Error('canonical authorization symlink was accepted');
NODE
assert_exit_code "$?" "0" "canonical authorization path rejects symlinked external JSON"
expect_failure "terminal unknown option" CLI_UNKNOWN_FLAG node "$REPO_ROOT/scripts/validate-next-touch-terminal.js" --receipt "$TEST_TMP/terminal.json" --base "$(printf 'a%.0s' {1..40})" --candidate "$(printf 'b%.0s' {1..40})" --assert-removed-ledger A01:A14 --integrate-worktree "$TEST_TMP/wt" --nope x
expect_failure "reservation ledger path escape" AUTHORITY_PATH_ESCAPE node "$REPO_ROOT/scripts/validate-next-touch-reservation.js" --authorization "$ARCHIVE_AUTH" --ledger "$TEST_TMP/ledger" --pre-spend

set +e
OUT_CURRENT="$(node "$REPO_ROOT/scripts/validate-next-touch-reservation.js" --authorization "$ARCHIVE_AUTH" --ledger "$MISSION_LEDGER" --pre-spend 2>&1)"
set -e
case "$OUT_CURRENT" in
  *MISSION_GRANT_INVALID*|*MISSION_BLOCKED_OR_TERMINAL*|*PREPARED_AUTHORITY_AMBIGUOUS*) __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1)) ;;
  *) fail "current 7e8e Mission lineage is blocked: expected a blocked authority code" ;;
esac

node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const runtime = require(path.join(root, 'src/mission/runtime'));
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const repoInfo = runtime.canonicalRepository(root);
const preparedPath = path.join(repoInfo.common, 'autopilot/mission/next-touch-debt-retirement/successor-prepared.json');
const prepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
const checked = runtime.validatePreparedReceipt(prepared, repoInfo);
if (checked.state.state !== 'ACTIVE') throw new Error('canonical successor fixture state unexpectedly changed');
const auth = validation.loadRepoAndAuthority({ repo: root, authorization: path.join(root, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json') }).authorization;
const source = validation.sourceDigests(root);
let rejected = false;
try {
  validation.validateMissionReservation(repoInfo, auth, {
    prepared: preparedPath,
    now: '2026-08-05T00:00:00.000Z',
  }, source);
} catch (error) {
  rejected = new Set(['MISSION_GRANT_INVALID', 'MISSION_BLOCKED_OR_TERMINAL', 'PREPARED_AUTHORITY_AMBIGUOUS']).has(error.code);
}
if (!rejected) throw new Error('blocked canonical Mission was accepted');
NODE
assert_exit_code "$?" "0" "canonical prepared receipt is accepted then blocked state is rejected"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const fs = require('fs');
const root = process.argv[2];
const runtime = require(path.join(root, 'src/mission/runtime'));
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const repoInfo = runtime.canonicalRepository(root);
let escaped = false;
try { validation.loadTerminalBundle('/tmp/next-touch-terminal-forbidden.json', repoInfo); }
catch (error) { escaped = error.code === 'AUTHORITY_PATH_ESCAPE'; }
if (!escaped) throw new Error('terminal receipt path escaped the authority store');
const body = { schema_version: 1, artifact_type: 'next_touch_terminal_bundle', marker: 'unit' };
const sealed = { ...body, receipt_digest: validation.canonicalDigest(body) };
if (validation.validateSealedDigest(sealed, 'unit').marker !== 'unit') {
  throw new Error('canonical terminal receipt digest did not validate');
}
const authorityDir = validation.canonicalAuthorityRoot(repoInfo);
const scratch = fs.mkdtempSync(path.join(authorityDir, 'next-touch-bundle-'));
const strictBody = {
  schema_version: 1, artifact_type: 'next_touch_terminal_bundle',
  repo_identity: repoInfo.repo_identity, mission_lineage_id: 'lineage-v1-' + 'a'.repeat(64),
  admission_base_sha: 'a'.repeat(40), review_base_sha: 'b'.repeat(40),
  d8_evaluated_sha: 'c'.repeat(40), d8_publication_sha: 'd'.repeat(40),
  candidate_sha: 'e'.repeat(40), candidate_tree_sha: 'f'.repeat(40),
  source_plan_sha256: '1'.repeat(64), source_rubric_sha256: '2'.repeat(64),
  prepared_receipt: 'prepared.json', mission_state: 'state.json',
  mission_terminal_receipt: 'mission-terminal.json', campaign_terminal_receipt: 'campaign-terminal.json',
  icc_terminal_receipt: 'icc-terminal.json',
  verification_receipts: [], review_receipts: [], final_panel_receipt: 'panel.json',
  ledger_path: 'ledger.jsonl', campaign_id: 'campaign-v1-' + '3'.repeat(64),
  develop_sha: '4'.repeat(40), candidate_ref: 'refs/heads/candidate', source_worktree: repoInfo.repo,
  allowed_path_prefixes: [], integration_state: 'reviewed_archived', merge_receipt: null,
  d8_publication_rebind_receipt: 'd8-rebind.json',
  min_panel_size: 3,
};
strictBody.receipt_digest = validation.canonicalDigest(strictBody);
const strictPath = path.join(scratch, 'terminal.json');
fs.writeFileSync(strictPath, JSON.stringify(strictBody));
if (validation.loadTerminalBundle(strictPath, repoInfo).bundle.integration_state !== 'reviewed_archived') {
  throw new Error('reviewed_archived integration state was not accepted');
}
const symlink = path.join(scratch, 'authority-escape');
fs.symlinkSync('/tmp', symlink, 'dir');
let symlinkRejected = false;
try { validation.loadTerminalBundle(path.join(symlink, 'missing.json'), repoInfo); }
catch (error) { symlinkRejected = error.code === 'AUTHORITY_PATH_ESCAPE'; }
if (!symlinkRejected) throw new Error('authority symlink escape was accepted');
fs.rmSync(scratch, { recursive: true, force: true });
NODE
assert_exit_code "$?" "0" "terminal receipt containment, sealed digest, and integration state checks"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(root);
const develop = require('child_process').execFileSync(
  'git', ['-C', root, 'rev-parse', 'refs/heads/develop'], { encoding: 'utf8' },
).trim();
let rejected = false;
try {
  validation.validateIntegrationPreconditions({
    candidate_ref: 'refs/tags/not-a-head', develop_sha: develop,
    source_worktree: root, allowed_path_prefixes: [], campaign_id: 'campaign-v1-' + 'a'.repeat(64),
  }, { integrate_worktree: root }, repoInfo, {
    candidate: validation.D8_PUBLICATION_SHA, candidateTree: '0'.repeat(40),
  });
} catch (error) {
  rejected = error.code === 'INTEGRATION_AUTHORITY_INVALID';
}
if (!rejected) throw new Error('non-head candidate_ref was accepted for integration');
NODE
assert_exit_code "$?" "0" "integration requires an exact candidate head ref"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const runtime = require(path.join(root, 'src/mission/runtime'));
const validation = require(path.join(root, 'scripts/next-touch-validation'));

function git(cwd, args, options = {}) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', ...options }).trim();
}
function commit(cwd, name, contents, message) {
  fs.writeFileSync(path.join(cwd, name), contents);
  git(cwd, ['add', name]);
  git(cwd, ['commit', '-qm', message]);
}
function fixture(diverged) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'next-touch-integration-'));
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
  if (diverged) commit(repo, 'develop.txt', 'develop\n', 'develop diverged');
  const develop = git(repo, ['rev-parse', 'refs/heads/develop']);
  return { parent, repo, source, base, candidate, candidateTree, develop };
}
function bundle(fixture, campaignId) {
  return {
    candidate_ref: 'refs/heads/candidate',
    source_worktree: fixture.source,
    develop_sha: fixture.develop,
    allowed_path_prefixes: [],
    campaign_id: campaignId,
    integration_state: 'reviewed_archived',
    merge_receipt: null,
  };
}

const positive = fixture(false);
const positiveInfo = runtime.canonicalRepository(positive.repo);
const positiveBundle = bundle(positive, 'campaign-v1-' + 'b'.repeat(64));
const positiveFrozen = { candidate: positive.candidate, candidateTree: positive.candidateTree };
const positiveArgs = { integrate_worktree: positive.repo };
const positivePreflight = validation.validateIntegrationPreconditions(
  positiveBundle, positiveArgs, positiveInfo, positiveFrozen,
);
if (positivePreflight.preflight.can_merge !== true) throw new Error('positive fixture preflight was not safe');
const positivePath = path.join(positiveInfo.common, 'autopilot', 'terminal.json');
runtime.atomicWriteJson(positivePath, positiveBundle);
const first = validation.executeAuthorizedIntegration({
  bundle: positiveBundle, bundlePath: positivePath, repoInfo: positiveInfo,
  frozen: positiveFrozen, args: positiveArgs, preconditions: positivePreflight,
});
if (first.status !== 'integrated' || git(positive.repo, ['rev-parse', 'HEAD']) !== positive.candidate) {
  throw new Error('positive integration did not fast-forward develop');
}
const integratedBundle = JSON.parse(fs.readFileSync(positivePath, 'utf8'));
if (integratedBundle.integration_state !== 'integrated'
    || !integratedBundle.merge_receipt || integratedBundle.merge_receipt.receipt_digest !== first.receipt.receipt_digest) {
  throw new Error('positive integration did not atomically reseal the bundle');
}
const second = validation.executeAuthorizedIntegration({
  bundle: integratedBundle, bundlePath: positivePath, repoInfo: positiveInfo,
  frozen: positiveFrozen, args: positiveArgs,
});
if (second.status !== 'already_integrated' || git(positive.repo, ['rev-parse', 'HEAD']) !== positive.candidate) {
  throw new Error('integrated rerun attempted a second merge or failed idempotency');
}

const injected = fixture(false);
const injectedInfo = runtime.canonicalRepository(injected.repo);
const injectedBundle = bundle(injected, 'campaign-v1-' + 'e'.repeat(64));
const injectedPath = path.join(injectedInfo.common, 'autopilot', 'terminal.json');
runtime.atomicWriteJson(injectedPath, injectedBundle);
const injectedBeforeBytes = fs.readFileSync(injectedPath);
const injectedBeforeHead = git(injected.repo, ['rev-parse', 'HEAD']);
const injectedReceiptDir = path.join(injectedInfo.common, 'autopilot', 'next-touch-debt-retirement');
const originalAtomicWriteJson = runtime.atomicWriteJson;
let injectedWrites = 0;
runtime.atomicWriteJson = (file, value) => {
  injectedWrites += 1;
  originalAtomicWriteJson(file, value);
  if (injectedWrites === 2) throw new Error('injected post-merge bundle persistence failure');
};
let injectedFailure = null;
try {
  validation.executeAuthorizedIntegration({
    bundle: injectedBundle, bundlePath: injectedPath, repoInfo: injectedInfo,
    frozen: { candidate: injected.candidate, candidateTree: injected.candidateTree },
    args: { integrate_worktree: injected.repo },
  });
} catch (error) {
  injectedFailure = error;
} finally {
  runtime.atomicWriteJson = originalAtomicWriteJson;
}
if (!injectedFailure || !/injected post-merge bundle persistence failure/u.test(injectedFailure.message)
    || git(injected.repo, ['rev-parse', 'HEAD']) !== injectedBeforeHead
    || fs.readFileSync(injectedPath).compare(injectedBeforeBytes) !== 0
    || JSON.parse(fs.readFileSync(injectedPath, 'utf8')).integration_state !== 'reviewed_archived'
    || fs.existsSync(path.join(injectedReceiptDir, `merge-execution-${injectedBundle.campaign_id}-${injected.candidate}.json`))) {
  throw new Error('post-merge persistence failure did not roll back develop and authority state');
}
if (fs.existsSync(injectedReceiptDir) && fs.readdirSync(injectedReceiptDir).length !== 0) {
  throw new Error('post-merge persistence failure left authority residue');
}
fs.rmSync(injected.parent, { recursive: true, force: true });

const negative = fixture(true);
const negativeInfo = runtime.canonicalRepository(negative.repo);
const negativeBundle = bundle(negative, 'campaign-v1-' + 'c'.repeat(64));
const negativeFrozen = { candidate: negative.candidate, candidateTree: negative.candidateTree };
const negativePath = path.join(negativeInfo.common, 'autopilot', 'terminal.json');
runtime.atomicWriteJson(negativePath, { integration_state: 'reviewed_archived', merge_receipt: null });
const beforeBytes = fs.readFileSync(negativePath, 'utf8');
const beforeHead = git(negative.repo, ['rev-parse', 'HEAD']);
let blocked = false;
try {
  validation.executeAuthorizedIntegration({
    bundle: negativeBundle, bundlePath: negativePath, repoInfo: negativeInfo,
    frozen: negativeFrozen, args: { integrate_worktree: negative.repo },
  });
} catch (error) {
  blocked = error.code === 'FF_ONLY_NOT_POSSIBLE';
}
if (!blocked || git(negative.repo, ['rev-parse', 'HEAD']) !== beforeHead
    || fs.readFileSync(negativePath, 'utf8') !== beforeBytes) {
  throw new Error('non-FF integration mutated develop or terminal state');
}
fs.rmSync(positive.parent, { recursive: true, force: true });
fs.rmSync(negative.parent, { recursive: true, force: true });
console.log('disposable integration fixtures passed');
NODE
assert_exit_code "$?" "0" "disposable ff-only integration, idempotent rerun, and non-FF no-state-advance"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const source = validation.sourceDigests(root);
const result = validation.validateHeadingSet(
  root,
  validation.ADMISSION_BASE_SHA,
  validation.D8_PUBLICATION_SHA,
  'A01:A14',
  source,
);
if (result.base_heading_count !== 47 || result.removed.length !== 14 || result.additions.length !== 0) {
  throw new Error(`unexpected frozen backlog set diff: ${JSON.stringify(result)}`);
}
NODE
assert_exit_code "$?" "0" "frozen backlog heading ledger maps exact 14-entry removal"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(root);
const auth = validation.loadRepoAndAuthority({ repo: root, authorization: path.join(root, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json') }).authorization;
const source = validation.sourceDigests(root);
const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
validation.validateArchiveState(root, head, source, auth);
const body = {
  schema_version: 1,
  artifact_type: 'next_touch_terminal_bundle',
  repo_identity: repoInfo.repo_identity,
  mission_lineage_id: auth.mission_lineage_id,
  admission_base_sha: validation.ADMISSION_BASE_SHA,
  review_base_sha: validation.REVIEW_BASE_SHA,
  d8_evaluated_sha: validation.D8_EVALUATED_SHA,
  d8_publication_sha: validation.D8_PUBLICATION_SHA,
  candidate_sha: validation.D8_PUBLICATION_SHA,
  candidate_tree_sha: '0'.repeat(40),
  candidate_ref: 'refs/heads/develop',
  source_plan_sha256: source.planSha,
  source_rubric_sha256: source.rubricSha,
  receipt_digest: '0'.repeat(64),
};
let rejected = false;
try { validation.validateTerminalIdentity({ base: validation.REVIEW_BASE_SHA, candidate: validation.D8_PUBLICATION_SHA }, repoInfo, auth, source, { bundle: body, path: '/tmp/outside' }); }
catch (error) { rejected = error.code === 'CANDIDATE_TREE_MISMATCH'; }
if (!rejected) throw new Error('empty/tampered candidate tree was accepted');
NODE
assert_exit_code "$?" "0" "mandatory candidate tree and source digests reject tamper"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const paths = [
  '.autopilot/evidence/grok-implementer-ab.json',
  '.autopilot/evidence/hook-multiplexer-benchmark.json',
  'scripts/validate-grok-implementer-ab.js',
  'scripts/validate-hook-multiplexer-benchmark.js',
  'evals/grok-implementer-ab/seed.json',
  'evals/grok-implementer-ab/tasks.json',
  'hooks/tests/fixtures/hook-multiplexer-benchmark.json',
];
const relative = '.autopilot/evidence/hook-multiplexer-benchmark.json';
const frozen = execFileSync(
  'git', ['-C', root, 'show', `${validation.D8_PUBLICATION_SHA}:${relative}`], { encoding: 'utf8' },
);
const mutated = frozen.replace('"runtime": "v24.16.0"', '"runtime": "v24.16.1"');
if (mutated === frozen) {
  throw new Error('D6 mutation fixture was not prepared');
}
JSON.parse(mutated);
for (const evidencePath of paths) {
  const bytes = execFileSync(
    'git', ['-C', root, 'show', `${validation.D8_PUBLICATION_SHA}:${evidencePath}`], { encoding: 'utf8' },
  );
  validation.assertFrozenEvidenceBytes(bytes, bytes, evidencePath, `frozen evidence ${evidencePath}`);
}
let rejected = false;
try { validation.assertFrozenEvidenceBytes(mutated, frozen, relative, 'mutated D6 report'); }
catch (error) { rejected = error.code === 'EVIDENCE_PIN_INVALID'; }
if (!rejected) throw new Error('internally valid mutated D6 report was accepted');
NODE
assert_exit_code "$?" "0" "frozen D6 report bytes reject an internally valid descendant mutation"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(root);
const auth = validation.loadRepoAndAuthority({ repo: root, authorization: path.join(root, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json') }).authorization;
const missionRoot = path.join(repoInfo.common, 'autopilot/mission');
const bundle = {
  prepared_receipt: path.join(missionRoot, 'next-touch-debt-retirement/successor-prepared.json'),
  mission_state: path.join(missionRoot, 'states/7e8e6806aee84794b0283f27a1f0b04c47919338d97229242ced28ad891258ee.json'),
};
let rejected = false;
try {
  validation.validatePreparedAndMissionState(bundle, { path: path.join(missionRoot, 'terminal.json') }, repoInfo, auth, {});
} catch (error) {
  rejected = new Set(['MISSION_NOT_READY', 'MISSION_STATE_DIGEST_MISMATCH']).has(error.code);
}
if (!rejected) throw new Error('non-terminal Mission state was accepted as terminal evidence');
NODE
assert_exit_code "$?" "0" "canonical prepared/state terminal binding rejects non-ready state"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(root);
const body = {
  schema_version: 1,
  artifact_type: 'implementation_campaign_terminal',
  status: 'follow_up',
  candidate_tree_sha: '0'.repeat(40),
  verification_receipt_digest: '9'.repeat(64),
  repair_generations: 0,
  lifecycle_receipt_ref: { path: 'lifecycle.json', root_run_id: 'run', receipt_digest: '1'.repeat(64) },
  follow_up: [{}],
  unresolved_final_findings: [{}],
  rejected_findings: [],
  sealed_min_panel_size: 3,
  final_panel_count: 0,
  final_panel_seat_receipts: [],
  trace: [],
};
body.receipt_digest = validation.canonicalDigest(body);
let notReady = false;
try { validation.validateImplementationTerminalReceipt(body, body.candidate_tree_sha); }
catch (error) { notReady = error.code === 'ICC_TERMINAL_NOT_READY'; }
if (!notReady) throw new Error('follow-up ICC terminal was accepted');
let escaped = false;
try { validation.validateIccLedger({ ledger_path: '/tmp/forbidden-ledger' }, { path: '/tmp/bundle' }, repoInfo, body); }
catch (error) { escaped = error.code === 'AUTHORITY_PATH_ESCAPE'; }
if (!escaped) throw new Error('ICC ledger path escaped authority store');
NODE
assert_exit_code "$?" "0" "ICC follow-up and ledger path reject"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const base = {
  schema_version: 1, artifact_type: 'next_touch_reviewer_attestation',
  repo_identity: 'git-common-dir:fixture', mission_lineage_id: 'lineage-v1-' + 'a'.repeat(64),
  campaign_id: 'campaign-v1-' + 'a'.repeat(64), base_sha: validation.REVIEW_BASE_SHA,
  candidate_sha: validation.D8_PUBLICATION_SHA, candidate_tree_sha: '0'.repeat(40),
  roster_tuple: 'claude-native/claude-opus/high/anthropic', actor_id: 'reviewer', session_id: 's1',
  reviewer_version: '1', review_input_digest: '1'.repeat(64), diff_digest: '2'.repeat(64),
  verdict: 'NO_SHIP', findings: [], receipt_ref: { path: 'review.json', receipt_digest: '3'.repeat(64) },
};
base.receipt_digest = validation.canonicalDigest(base);
let nonShip = false;
try { validation.validateReviewerAttestation(base, validation.D8_PUBLICATION_SHA, '0'.repeat(40), 'campaign-v1-' + 'a'.repeat(64), { repo_identity: 'git-common-dir:fixture' }, { mission_lineage_id: 'lineage-v1-' + 'a'.repeat(64) }, { review: validation.REVIEW_BASE_SHA }, { path: '/tmp/bundle' }); }
catch (error) { nonShip = error.code === 'REVIEW_ATTESTATION_INVALID'; }
if (!nonShip) throw new Error('non-SHIP review was accepted');
const forged = {
  schema_version: 1, artifact_type: 'next_touch_verifier_attestation',
  repo_identity: 'git-common-dir:fixture', mission_lineage_id: 'lineage-v1-' + 'a'.repeat(64),
  campaign_id: 'campaign-v1-' + 'a'.repeat(64), base_sha: validation.REVIEW_BASE_SHA,
  candidate_sha: 'f'.repeat(40), candidate_tree_sha: '0'.repeat(40),
  roster_tuple: 'agy/Gemini 3.5 Flash (High)/high/google', actor_id: 'verifier', session_id: 's2',
  runner_version: '1', provider_version: '1', command: 'true', command_argv: ['true'],
  command_digest: validation.canonicalDigest({ command: 'true', argv: ['true'] }), result_digest: '4'.repeat(64),
  receipt_ref: { path: 'verification.json', receipt_digest: '5'.repeat(64) },
};
forged.receipt_digest = validation.canonicalDigest(forged);
let wrongCandidate = false;
try { validation.validateVerifierAttestation(forged, validation.D8_PUBLICATION_SHA, '0'.repeat(40), forged.campaign_id, { repo_identity: 'git-common-dir:fixture' }, { mission_lineage_id: forged.mission_lineage_id }, { review: validation.REVIEW_BASE_SHA }, { path: '/tmp/bundle' }); }
catch (error) { wrongCandidate = error.code === 'VERIFIER_ATTESTATION_INVALID'; }
if (!wrongCandidate) throw new Error('wrong-candidate verifier attestation was accepted');
NODE
assert_exit_code "$?" "0" "non-SHIP review and wrong-candidate verifier reject"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(root);
const dir = fs.mkdtempSync(path.join(validation.canonicalAuthorityRoot(repoInfo), 'next-touch-review-'));
const reviewPath = path.join(dir, 'review.json');
const bundlePath = path.join(dir, 'bundle.json');
const campaignId = 'campaign-v1-' + 'e'.repeat(64);
const lineage = 'lineage-v1-' + 'f'.repeat(64);
const candidate = validation.D8_PUBLICATION_SHA;
const candidateTree = '0'.repeat(40);
const frozen = { review: validation.REVIEW_BASE_SHA, candidateTree };
const authorization = { mission_lineage_id: lineage };
const reviewBody = {
  schema_version: 1, artifact_type: 'product_review', base_sha: frozen.review,
  candidate_sha: candidate, candidate_tree_sha: candidateTree,
  findings: [], follow_up: [], unresolved_final_findings: [], verdict: 'SHIP-AS-IS',
};
const sealedReview = { ...reviewBody, receipt_digest: validation.canonicalDigest(reviewBody) };
fs.writeFileSync(reviewPath, JSON.stringify(sealedReview));
const attestationBody = {
  schema_version: 1, artifact_type: 'next_touch_reviewer_attestation',
  repo_identity: repoInfo.repo_identity, mission_lineage_id: lineage, campaign_id: campaignId,
  base_sha: frozen.review, candidate_sha: candidate, candidate_tree_sha: candidateTree,
  roster_tuple: 'claude-native/claude-opus/high/anthropic', actor_id: 'reviewer', session_id: 'review-1',
  reviewer_version: 'test', review_input_digest: '1'.repeat(64), diff_digest: '2'.repeat(64),
  verdict: 'SHIP', findings: [],
  receipt_ref: { path: reviewPath, receipt_digest: sealedReview.receipt_digest },
};
attestationBody.receipt_digest = validation.canonicalDigest(attestationBody);
let accepted = false;
try {
  validation.validateReviewerAttestation(
    attestationBody, candidate, candidateTree, campaignId, repoInfo, authorization,
    frozen, { path: bundlePath }, '2'.repeat(64), '1'.repeat(64),
  );
  accepted = true;
} catch (error) {
  throw new Error(`valid nested reviewer receipt rejected: ${error.code}: ${error.message}`);
}
if (!accepted) throw new Error('valid nested reviewer receipt did not validate');
const wrongBase = { ...reviewBody, base_sha: validation.ADMISSION_BASE_SHA };
const wrongSealed = { ...wrongBase, receipt_digest: validation.canonicalDigest(wrongBase) };
fs.writeFileSync(reviewPath, JSON.stringify(wrongSealed));
attestationBody.receipt_ref = { path: reviewPath, receipt_digest: wrongSealed.receipt_digest };
attestationBody.receipt_digest = validation.canonicalDigest({ ...attestationBody, receipt_digest: undefined });
delete attestationBody.receipt_digest;
attestationBody.receipt_digest = validation.canonicalDigest(attestationBody);
let rejected = false;
try {
  validation.validateReviewerAttestation(
    attestationBody, candidate, candidateTree, campaignId, repoInfo, authorization,
    frozen, { path: bundlePath }, '2'.repeat(64), '1'.repeat(64),
  );
} catch (error) {
  rejected = error.code === 'REVIEW_RECEIPT_INVALID';
}
if (!rejected) throw new Error('nested reviewer receipt with wrong base was accepted');
fs.rmSync(dir, { recursive: true, force: true });
NODE
assert_exit_code "$?" "0" "nested reviewer receipt binds base/candidate/tree and empty findings"

node - "$REPO_ROOT" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(root);
const auth = validation.loadRepoAndAuthority({
  repo: root,
  authorization: path.join(root, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json'),
}).authorization;
const prepared = JSON.parse(fs.readFileSync(
  path.join(repoInfo.common, 'autopilot/mission/next-touch-debt-retirement/successor-prepared.json'), 'utf8',
));
const candidate = validation.D8_PUBLICATION_SHA;
const candidateTree = require('child_process').execFileSync(
  'git', ['-C', root, 'rev-parse', `${candidate}^{tree}`], { encoding: 'utf8' },
).trim();
const candidateRef = `refs/heads/${require('child_process').execFileSync(
  'git', ['-C', root, 'symbolic-ref', '-q', '--short', 'HEAD'], { encoding: 'utf8' },
).trim()}`;
const reportText = fs.readFileSync(path.join(root, '.autopilot/evidence/grok-implementer-ab.json'));
const frozen = {
  candidate, candidateTree,
  d8: { report_sha256: crypto.createHash('sha256').update(reportText).digest('hex') },
};
let missing = false;
try {
  validation.validateD8PublicationRebind(
    { d8_publication_rebind_receipt: null }, { path: path.join(repoInfo.common, 'autopilot/bundle.json') },
    repoInfo, auth, prepared, frozen, {}, {}, {},
  );
} catch (error) { missing = error.code === 'D8_REBIND_MISSING'; }
if (!missing) throw new Error('missing D8 publication rebind was accepted');
const dir = fs.mkdtempSync(path.join(validation.canonicalAuthorityRoot(repoInfo), 'next-touch-rebind-'));
const body = {
  schema_version: 1, artifact_type: 'd8_publication_rebind_receipt', repo_identity: repoInfo.repo_identity,
  mission_lineage_id: auth.mission_lineage_id, task_authority_id: prepared.task_authority_id,
  authorized_branch: 'mission/wrong-lineage', review_base_sha: validation.REVIEW_BASE_SHA,
  evaluated_sha: validation.D8_EVALUATED_SHA, publication_sha: validation.D8_PUBLICATION_SHA,
  publication_report_sha256: frozen.d8.report_sha256, candidate_ref: candidateRef,
  candidate_sha: candidate, candidate_tree_sha: candidateTree,
  mission_terminal_receipt_digest: '1'.repeat(64), campaign_terminal_receipt_digest: '2'.repeat(64),
  icc_terminal_receipt_digest: '3'.repeat(64),
};
const sealed = { ...body, receipt_digest: validation.canonicalDigest(body) };
const receiptPath = path.join(dir, 'rebind.json');
fs.writeFileSync(receiptPath, JSON.stringify(sealed));
let branchRejected = false;
try {
  validation.validateD8PublicationRebind(
    { d8_publication_rebind_receipt: { path: receiptPath, receipt_digest: sealed.receipt_digest }, candidate_ref: candidateRef },
    { path: path.join(dir, 'bundle.json') }, repoInfo, auth, prepared, frozen,
    { receipt_digest: '1'.repeat(64) }, { receipt_digest: '2'.repeat(64) }, { receipt_digest: '3'.repeat(64) },
  );
} catch (error) { branchRejected = error.code === 'D8_REBIND_INVALID'; }
if (!branchRejected) throw new Error('D8 rebind branch mismatch was accepted');
const lineageBody = { ...body, authorized_branch: auth.branch, mission_lineage_id: 'lineage-v1-' + '0'.repeat(64) };
const lineageSealed = { ...lineageBody, receipt_digest: validation.canonicalDigest(lineageBody) };
fs.writeFileSync(receiptPath, JSON.stringify(lineageSealed));
let lineageRejected = false;
try {
  validation.validateD8PublicationRebind(
    { d8_publication_rebind_receipt: { path: receiptPath, receipt_digest: lineageSealed.receipt_digest }, candidate_ref: candidateRef },
    { path: path.join(dir, 'bundle.json') }, repoInfo, auth, prepared, frozen,
    { receipt_digest: '1'.repeat(64) }, { receipt_digest: '2'.repeat(64) }, { receipt_digest: '3'.repeat(64) },
  );
} catch (error) { lineageRejected = error.code === 'D8_REBIND_INVALID'; }
if (!lineageRejected) throw new Error('D8 rebind lineage mismatch was accepted');
const wrongMissionBody = {
  schema_version: 1, artifact_type: 'implementation_campaign_terminal', status: 'ready',
  candidate_tree_sha: candidateTree, verification_receipt_digest: '1'.repeat(64), repair_generations: 0,
  final_panel_count: 3, final_panel_seat_receipts: [], sealed_min_panel_size: 3,
  follow_up: [], rejected_findings: [], unresolved_final_findings: [], lifecycle_receipt_ref: {
    path: 'lifecycle.json', root_run_id: 'campaign-v1-' + 'a'.repeat(64), receipt_digest: '2'.repeat(64),
  }, trace: [],
};
wrongMissionBody.receipt_digest = validation.canonicalDigest(wrongMissionBody);
let missionRejected = false;
try { validation.validateCampaignRuntimeTerminalReceipt(wrongMissionBody, {}, auth); }
catch (error) { missionRejected = error.code === 'CAMPAIGN_TERMINAL_NOT_READY'; }
if (!missionRejected) throw new Error('ICC terminal artifact was accepted as Mission campaign terminal');
const wrongIccBody = {
  schema_version: 1, artifact_type: 'campaign_terminal_receipt', outcome: 'ready',
};
wrongIccBody.receipt_digest = validation.canonicalDigest(wrongIccBody);
let iccRejected = false;
try { validation.validateImplementationTerminalReceipt(wrongIccBody, candidateTree); }
catch (error) { iccRejected = error.code === 'AUTHORITY_INVALID'; }
if (!iccRejected) throw new Error('Mission campaign artifact was accepted as ICC terminal');
fs.rmSync(dir, { recursive: true, force: true });
NODE
assert_exit_code "$?" "0" "D8 publication rebind is mandatory and branch-bound"

finalize_test
