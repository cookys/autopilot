#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

# The Mission artifacts this suite validates against are not versioned — they
# were the residue of one real run on one machine, so a clean clone had nothing
# to read and the suite crashed on ENOENT. Build the equivalent once here and
# hand the repository path to every block that needs it; the module header
# explains how the fixture reproduces the originals' behaviour.
NTV_FIXTURE_REPO="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const path = require('path');
const [root, scratch] = process.argv.slice(2);
const {
  buildNextTouchMissionFixture,
} = require(path.join(root, 'hooks/tests/lib/next-touch-mission-fixture'));
process.stdout.write(buildNextTouchMissionFixture({ root, scratch }).fixtureRepo);
NODE
)"
[ -n "$NTV_FIXTURE_REPO" ] && [ -d "$NTV_FIXTURE_REPO" ] \
  || { echo "next-touch Mission fixture build failed" >&2; exit 1; }

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
node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const runtime = require(path.join(root, 'src/mission/runtime'));
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const {
  describeNextTouchMissionFixture,
} = require(path.join(root, 'hooks/tests/lib/next-touch-mission-fixture'));
const fixture = describeNextTouchMissionFixture({ root, fixtureRepo: process.argv[3] });
const repoInfo = fixture.repoInfo;
const preparedPath = fixture.preparedPath;
const prepared = JSON.parse(fs.readFileSync(preparedPath, 'utf8'));
const checked = runtime.validatePreparedReceipt(prepared, repoInfo);
if (checked.state.state !== 'ACTIVE') throw new Error('prepared fixture state is not ACTIVE');
const auth = validation.loadRepoAndAuthority({ repo: fixture.fixtureRepo, authorization: fixture.authorizationPath }).authorization;
const source = validation.sourceDigests(fixture.fixtureRepo);
let rejected = false;
try {
  validation.validateMissionReservation(repoInfo, auth, {
    prepared: preparedPath,
    now: '2026-08-05T00:00:00.000Z',
  }, source);
} catch (error) {
  rejected = new Set(['MISSION_GRANT_INVALID', 'MISSION_BLOCKED_OR_TERMINAL', 'PREPARED_AUTHORITY_AMBIGUOUS']).has(error.code);
}
if (!rejected) throw new Error('blocked Mission was accepted');
NODE
assert_exit_code "$?" "0" "prepared receipt is accepted then blocked state is rejected"

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const path = require('path');
const fs = require('fs');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const runtime = require(path.join(root, 'src/mission/runtime'));
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
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
  g8b_integration_authorization: { path: 'g8b.json', receipt_digest: '0'.repeat(64) },
  min_panel_size: 3,
};
strictBody.receipt_digest = validation.canonicalDigest(strictBody);
const strictPath = path.join(scratch, 'terminal.json');
fs.writeFileSync(strictPath, JSON.stringify(strictBody));
const loadedStrict = validation.loadTerminalBundle(strictPath, repoInfo);
if (loadedStrict.bundle.integration_state !== 'reviewed_archived'
    || !loadedStrict.bundle.g8b_integration_authorization
    || loadedStrict.bundle.g8b_integration_authorization.path !== 'g8b.json') {
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
const source = validation.sourceDigests(root);
const historical = validation.loadRepoAndAuthority({
  repo: root,
  authorization: path.join(root, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json'),
}).authorization;
const common = repoInfo.common;
const directory = fs.mkdtempSync(path.join(validation.canonicalAuthorityRoot(repoInfo), 'g8b-validation-'));
const bundlePath = path.join(directory, 'terminal.json');
const g8bPath = path.join(directory, 'g8b.json');
const develop = execFileSync('git', ['-C', root, 'rev-parse', 'refs/heads/develop'], { encoding: 'utf8' }).trim();
const archiveAuth = JSON.parse(fs.readFileSync(
  path.join(root, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json'),
  'utf8',
));
const roster = {
  implementer: 'grok/Grok-4.5/high/xai',
  verifier: 'agy/Gemini 3.5 Flash (High)/high/google',
  reviewer: 'claude-native/claude-opus/high/anthropic',
};
const makeBody = (overrides = {}) => ({
  schema_version: 1,
  artifact_type: 'g8b_integration_authorization',
  authority_mode: 'fresh_non_successor',
  repo_identity: repoInfo.repo_identity,
  ticket: 'mission-g8b-fresh-authority',
  project: 'next-touch-debt-retirement',
  graph_node_id: 'next-touch-debt-retirement',
  authorized_branch: 'mission/g8b-fresh-authority',
  candidate_ref: 'refs/heads/mission/g8b-fresh-authority',
  mission_lineage_id: 'lineage-v1-' + '1'.repeat(64),
  adoption_key: '1'.repeat(64),
  task_authority_id: '2'.repeat(64),
  mission_policy_digest: '3'.repeat(64),
  mission_graph_digest: '4'.repeat(64),
  policy_hash: '5'.repeat(64),
  source_plan_path: 'docs/plans/2026-08-03-next-touch-debt-retirement.md',
  source_rubric_path: 'docs/plans/2026-08-03-next-touch-debt-retirement.rubric.md',
  source_plan_sha256: source.planSha,
  source_rubric_sha256: source.rubricSha,
  admission_base_sha: validation.ADMISSION_BASE_SHA,
  mission_claim_base_sha: validation.REVIEW_BASE_SHA,
  review_base_sha: validation.REVIEW_BASE_SHA,
  product_candidate_sha: validation.G8B_PRODUCT_CANDIDATE_SHA,
  product_candidate_tree_sha: validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
  integration_candidate_sha: validation.G8B_PRODUCT_CANDIDATE_SHA,
  integration_candidate_tree_sha: validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
  integration_candidate_ref: 'refs/heads/mission/g8b-fresh-authority',
  develop_ref: 'refs/heads/develop',
  develop_sha: develop,
  d8_evaluated_sha: validation.D8_EVALUATED_SHA,
  d8_publication_sha: validation.D8_PUBLICATION_SHA,
  d8_report_path: '.autopilot/evidence/grok-implementer-ab.json',
  d8_report_sha256: '804706b6fe50994abfc332190342dba0c49dad1b1f06c166ac69547461728c6b',
  archive_plan_path: 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/2026-08-03-next-touch-debt-retirement.md',
  archive_rubric_path: 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/2026-08-03-next-touch-debt-retirement.rubric.md',
  historical_archive_authorization_path: 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json',
  historical_archive_authorization_sha256: '3266fb2c98133e788e23eec3e261a902c40529e0363ece2b12e01c9e31a338ba',
  historical_archive_authorization_digest: validation.canonicalDigest(archiveAuth),
  task_authority_ref: { path: 'task-authority.json', task_authority_id: '2'.repeat(64) },
  prepared_receipt_ref: { path: 'prepared.json', receipt_digest: '6'.repeat(64) },
  mission_state_ref: { path: 'state.json', state_hash: '7'.repeat(64) },
  mission_terminal_receipt_ref: { path: 'mission-terminal.json', receipt_digest: '8'.repeat(64) },
  campaign_terminal_receipt_ref: { path: 'campaign-terminal.json', receipt_digest: '9'.repeat(64) },
  icc_terminal_receipt_ref: { path: 'icc-terminal.json', receipt_digest: 'a'.repeat(64) },
  mission_terminal_receipt_digest: '8'.repeat(64),
  campaign_terminal_receipt_digest: '9'.repeat(64),
  icc_terminal_receipt_digest: 'a'.repeat(64),
  claim_id: 'claim-v1-' + 'b'.repeat(64),
  claim_binding_digest: 'c'.repeat(64),
  mission_campaign_id: 'campaign-v2-' + 'd'.repeat(64),
  campaign_id: 'campaign-v1-' + 'e'.repeat(64),
  roster,
  ...overrides,
});
function writeBody(body) {
  const sealed = { ...body, receipt_digest: validation.canonicalDigest(body) };
  fs.writeFileSync(g8bPath, JSON.stringify(sealed));
  return sealed;
}
function run(body, options = {}) {
  const sealed = writeBody(body);
  const bundle = {
    g8b_integration_authorization: { path: 'g8b.json', receipt_digest: sealed.receipt_digest },
    candidate_sha: sealed.integration_candidate_sha,
    candidate_tree_sha: sealed.integration_candidate_tree_sha,
    candidate_ref: sealed.integration_candidate_ref,
    develop_sha: sealed.develop_sha,
    mission_lineage_id: sealed.mission_lineage_id,
    campaign_id: sealed.campaign_id,
    prepared_receipt: sealed.prepared_receipt_ref,
    mission_state: sealed.mission_state_ref,
    mission_terminal_receipt: sealed.mission_terminal_receipt_ref,
    campaign_terminal_receipt: sealed.campaign_terminal_receipt_ref,
    icc_terminal_receipt: sealed.icc_terminal_receipt_ref,
    ...(options.bundle || {}),
  };
  let error = null;
  try {
    validation.validateG8bIntegrationAuthorization(
      bundle,
      { path: bundlePath, bundle },
      repoInfo,
      source,
    { candidate: sealed.integration_candidate_sha, authorization: options.authorization, prepared: options.prepared },
      historical,
    );
  } catch (caught) { error = caught; }
  return error;
}
let missing = null;
try {
  validation.validateG8bIntegrationAuthorization(
    {}, { path: bundlePath, bundle: {} }, repoInfo, source,
    { candidate: validation.G8B_PRODUCT_CANDIDATE_SHA }, historical,
  );
} catch (error) { missing = error; }
if (!missing || missing.code !== 'G8B_AUTHORITY_MISSING') throw new Error('missing fresh G8b authority was accepted');
let tampered = null;
fs.writeFileSync(g8bPath, '{}');
try {
  validation.validateG8bIntegrationAuthorization(
    { g8b_integration_authorization: { path: 'g8b.json', receipt_digest: '0'.repeat(64) } },
    { path: bundlePath, bundle: {} }, repoInfo, source,
    { candidate: validation.G8B_PRODUCT_CANDIDATE_SHA }, historical,
  );
} catch (error) { tampered = error; }
if (!tampered || tampered.code !== 'G8B_RECEIPT_BINDING_MISMATCH') throw new Error('tampered fresh G8b receipt was accepted');
const blocked = run(makeBody({
  mission_lineage_id: 'lineage-v1-7d89f8d57856fb7f31c7ee0f97b25aba28faccabdd7b89303c4804359c08da51',
}));
if (!blocked || blocked.code !== 'G8B_AUTHORITY_INVALID') throw new Error('blocked 7d89 lineage was accepted');
const blockedTicket = run(makeBody({ ticket: 'mission-7e8e6806aee8-next-touch-debt-retirement-a5' }));
if (!blockedTicket || blockedTicket.code !== 'G8B_AUTHORITY_INVALID') throw new Error('blocked successor ticket was accepted');
const successor = run(makeBody({ adoption_key: '7e8e6806aee84794b0283f27a1f0b04c47919338d97229242ced28ad891258ee' }));
if (!successor || successor.code !== 'G8B_AUTHORITY_INVALID') throw new Error('successor adoption key was accepted');
const blockedBranch = run(makeBody({
  authorized_branch: 'mission/7e8e6806aee8/next-touch-debt-retirement-a5',
  candidate_ref: 'refs/heads/mission/7e8e6806aee8/next-touch-debt-retirement-a5',
  integration_candidate_ref: 'refs/heads/mission/7e8e6806aee8/next-touch-debt-retirement-a5',
}));
if (!blockedBranch || blockedBranch.code !== 'G8B_AUTHORITY_INVALID') throw new Error('blocked successor branch was accepted');
const branch = run(makeBody({ authorized_branch: 'mission/g8b-other' }));
if (!branch || branch.code !== 'G8B_CANDIDATE_BINDING_MISMATCH') throw new Error('cross-branch G8b receipt was accepted');
const candidate = run(makeBody({ product_candidate_sha: validation.REVIEW_BASE_SHA }));
if (!candidate || candidate.code !== 'G8B_BINDING_MISMATCH') throw new Error('cross-product G8b receipt was accepted');
const tree = run(makeBody({ product_candidate_tree_sha: 'f'.repeat(40) }));
if (!tree || tree.code !== 'G8B_BINDING_MISMATCH') throw new Error('cross-tree G8b receipt was accepted');
const missingMissionClaimBaseBody = makeBody();
delete missingMissionClaimBaseBody.mission_claim_base_sha;
const missingMissionClaimBase = run(missingMissionClaimBaseBody);
if (!missingMissionClaimBase || missingMissionClaimBase.code !== 'G8B_SCHEMA_INVALID') {
  throw new Error('missing Mission claim base was accepted');
}
const tamperedMissionClaimBase = run(makeBody({ mission_claim_base_sha: validation.ADMISSION_BASE_SHA }));
if (!tamperedMissionClaimBase || tamperedMissionClaimBase.code !== 'G8B_BINDING_MISMATCH') {
  throw new Error('tampered Mission claim base was accepted');
}
const plan = run(makeBody({ source_plan_sha256: 'f'.repeat(64) }));
if (!plan || plan.code !== 'G8B_BINDING_MISMATCH') throw new Error('cross-plan G8b receipt was accepted');
const d8 = run(makeBody({ d8_report_sha256: 'f'.repeat(64) }));
if (!d8 || d8.code !== 'G8B_BINDING_MISMATCH') throw new Error('cross-D8 G8b receipt was accepted');
const cliBypass = run(makeBody(), { authorization: path.join(root, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json') });
if (!cliBypass || cliBypass.code !== 'G8B_CLI_BYPASS_REJECTED') throw new Error('CLI authority bypass was accepted');
fs.rmSync(directory, { recursive: true, force: true });
console.log('G8b authority missing/tamper/lineage/cross-binding/CLI negatives passed');
NODE
assert_exit_code "$?" "0" "fresh G8b authority is bundle-bound and rejects stale/cross-bound authority"

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const mission = require(path.join(root, 'src/engine/mission-convergence'));
const composition = require(path.join(root, 'src/engine/campaign-composition'));
const source = validation.sourceDigests(root);
const historical = validation.loadRepoAndAuthority({
  repo: root,
  authorization: path.join(root, 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json'),
}).authorization;
const rootInfo = runtime.canonicalRepository(ntvFixtureRepo);
const authorityEnvelopePath = path.join(
  rootInfo.common, 'autopilot/mission/next-touch-debt-retirement/task-authority.envelope.json',
);
const hash = (value) => crypto.createHash('sha256').update(
  typeof value === 'string' ? value : mission.canonicalJson(value),
).digest('hex');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'g8b-runtime-positive-'));
const repo = path.join(temp, 'repo');
const git = (args, options = {}) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options,
}).trim();
try {
  execFileSync('git', ['clone', '-q', '--no-local', root, repo]);
  git(['config', 'user.email', 'g8b-fixture@example.invalid']);
  git(['config', 'user.name', 'G8b Runtime Fixture']);
  // Order matters. A clone made while the source repo sits on develop has HEAD
  // on develop too, and moving a checked-out branch's ref leaves every file
  // looking modified, so the checkout that follows refuses. Leave develop
  // first, then move it. This is why the block passed on a feature branch and
  // failed in CI, which always runs on develop.
  git(['checkout', '-q', '-B', 'fixture-base', validation.REVIEW_BASE_SHA]);
  git(['update-ref', 'refs/heads/develop', validation.G8B_DEVELOP_PREMERGE_SHA]);
  const repoInfo = runtime.canonicalRepository(repo);

  const taskAuthority = JSON.parse(fs.readFileSync(authorityEnvelopePath, 'utf8'));
  const lineage = `lineage-v1-${'f'.repeat(64)}`;
  const graph = {
    schema_version: 1,
    artifact_type: 'mission_execution_graph',
    nodes: [{
      id: 'next-touch-debt-retirement',
      source_plan_ids: ['G8B'],
      source_rubric_ids: ['G8B-R1'],
      dependencies: [],
      acceptance_ids: ['g8b-runtime-positive'],
      verification_commands: ['node -e "process.exit(0)"'],
      gate_attempt_budget: 1,
      reservation: {
        campaigns: 1, wall_seconds: 100, tool_calls: 2, engine_attempts: 1,
        external_wait_seconds: 0, canonical_changed_files: 1, output_bytes: 1024,
      },
      campaign: {
        profile: 'poc',
        allowed_path_prefixes: ['docs/'],
        spec: {
          path: 'docs/BACKLOG.md',
          section: 'Mission authority store 與 cross-harness enforcement hardening',
        },
        required_paths: ['docs/BACKLOG.md'],
        output_paths: ['docs/BACKLOG.md'],
        max_changed_files: 1,
        baseline_churn: 10,
        max_growth_ratio: 1.5,
        max_extra_churn: 5,
        max_repair_generations: 0,
        max_wall_seconds: 100,
      },
    }],
  };
  const graphDigest = hash(graph);
  taskAuthority.task_id = 'g8b-runtime-positive';
  taskAuthority.mission_lineage_id = lineage;
  taskAuthority.mission_graph_digest = graphDigest;
  const taskAuthorityBody = { ...taskAuthority };
  delete taskAuthorityBody.task_authority_id;
  taskAuthority.task_authority_id = validation.canonicalDigest(taskAuthorityBody);
  const policy = {
    schema_version: 1,
    enforcement_mode: 'enforce',
    max_campaigns: 2,
    max_wall_seconds: 1000,
    max_tool_calls: 20,
    max_engine_attempts: 8,
    max_external_wait_seconds: 100,
    max_canonical_changed_files: 4,
    max_output_bytes: 4096,
    max_stagnant_campaigns: 2,
    max_deliverables: 1,
    max_parallel: 1,
    max_batches: 1,
    max_graph_depth: 1,
    max_gate_attempts: 2,
    closure_ratio: 0.75,
    grant_expiry_seconds: 3600,
  };
  const policyDigest = taskAuthority.mission_policy_digest;
  const adoptionKey = lineage.slice('lineage-v1-'.length);
  const dependencies = {
    resolveMissionPolicy: () => ({ policy, policy_digest: policyDigest }),
    freezeMissionExecutionGraph: () => ({ graph, graph_digest: graphDigest }),
    deriveMissionAdoptionKey: () => adoptionKey,
    deriveMissionLineageId: () => lineage,
  };
  process.env.AUTOPILOT_TEST_ALLOW_MISSION_RUNTIME_SEAMS = '1';
  const prepared = runtime.prepareMissionRuntimeForTest({
    repo,
    taskAuthority,
    executionGraph: graph,
    authoritativeGovernance: { mission_convergence: policy },
    preparedAt: '2026-08-06T00:00:00.000Z',
  }, dependencies);
  const grant = runtime.grantMissionCampaign({
    repo,
    preparedReceipt: prepared.receipt,
    nodeId: 'next-touch-debt-retirement',
    now: '2026-08-06T00:01:00.000Z',
  });
  const store = runtime.openPreparedMissionStateStore({ repo, preparedReceipt: prepared.receipt });
  const claimed = store.load();
  const claim = claimed.claims[grant.claim_id];
  const campaignId = `campaign-v1-${'c'.repeat(64)}`;
  const terminal = runtime.reconcileMissionCampaignTerminal({
    store,
    grantRef: claim.binding_digest,
    claimId: claim.claim_id,
    iccCampaignId: campaignId,
    rawCampaignContractDigest: hash('g8b-raw-campaign'),
    outcome: 'ready',
    possiblyEffectful: true,
    observedAt: '2026-08-06T00:02:00.000Z',
  });
  if (terminal.status !== 'applied') throw new Error(`fresh campaign terminal failed: ${terminal.reason || terminal.status}`);
  const state = store.load();
  if (state.state !== 'COMPLETE' || !state.terminal) throw new Error('fresh Mission did not reach COMPLETE');
  const residueBody = { lifecycle_residue: [] };
  const residue = { ...residueBody, residue_digest: mission.sha256(mission.canonicalJson(residueBody)) };
  const missionTerminal = mission.buildMissionTerminalReceipt(state, residue);
  const panelSeat = (index, runner, model, family) => {
    const body = {
      schema_version: 1,
      artifact_type: 'implementation_campaign_final_panel_seat',
      seat_index: index,
      runner,
      model,
      effort: 'high',
      endpoint: null,
      family,
      status: 'reviewed',
      verdict: 'a'.repeat(64),
      review_digest: 'b'.repeat(64),
      reason: null,
    };
    return { ...body, receipt_digest: validation.canonicalDigest(body) };
  };
  const seats = [
    panelSeat(1, 'grok', 'Grok-4.5', 'xai'),
    panelSeat(2, 'agy', 'Gemini 3.5 Flash (High)', 'google'),
    panelSeat(3, 'claude-native', 'claude-opus', 'anthropic'),
  ];
  let iccBody = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_terminal',
    status: 'ready',
    candidate_tree_sha: validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
    verification_receipt_digest: 'd'.repeat(64),
    repair_generations: 0,
    sealed_min_panel_size: 3,
    final_panel_count: 3,
    final_panel_seat_receipts: seats,
    follow_up: [],
    rejected_findings: [],
    unresolved_final_findings: [],
    lifecycle_receipt_ref: {
      path: 'lifecycle.json', root_run_id: campaignId, receipt_digest: 'e'.repeat(64),
    },
    trace: [],
  };
  let iccTerminal = { ...iccBody, receipt_digest: validation.canonicalDigest(iccBody) };
  const directory = fs.mkdtempSync(path.join(validation.canonicalAuthorityRoot(repoInfo), 'g8b-positive-'));
  const paths = {
    taskAuthority: path.join(directory, 'task-authority.json'),
    prepared: path.join(directory, 'prepared.json'),
    state: prepared.state_path,
    missionTerminal: path.join(directory, 'mission-terminal.json'),
    campaignTerminal: path.join(directory, 'campaign-terminal.json'),
    iccTerminal: path.join(directory, 'icc-terminal.json'),
    bundle: path.join(directory, 'terminal.json'),
    g8b: path.join(directory, 'g8b.json'),
  };
  fs.writeFileSync(paths.taskAuthority, JSON.stringify(taskAuthority));
  fs.writeFileSync(paths.prepared, JSON.stringify(prepared.receipt));
  fs.writeFileSync(paths.missionTerminal, JSON.stringify(missionTerminal));
  fs.writeFileSync(paths.campaignTerminal, JSON.stringify(terminal.receipt));
  fs.writeFileSync(paths.iccTerminal, JSON.stringify(iccTerminal));
  const tree = git(['rev-parse', `${validation.G8B_PRODUCT_CANDIDATE_SHA}^{tree}`]);
  const index = path.join(temp, 'fixture-index');
  const indexEnv = { ...process.env, GIT_INDEX_FILE: index };
  execFileSync('git', ['-C', repo, 'read-tree', `${validation.G8B_PRODUCT_CANDIDATE_SHA}^{tree}`], { env: indexEnv });
  for (const relative of [
    'scripts/dispatch-hetero.sh',
    'platforms/codex/plugin/scripts/dispatch-hetero.sh',
    'scripts/dispatch-review.sh',
    'platforms/codex/plugin/scripts/dispatch-review.sh',
    'hooks/tests/dispatch-detached-campaign-authority.test.sh',
  ]) {
    const entry = execFileSync('git', [
      '-C', root, 'ls-tree', '38046a7170afafc35aec5986a8dd285e33e31c80', '--', relative,
    ], { encoding: 'utf8' }).trim();
    const [mode, , blob] = entry.split(/\s+/u);
    const gateFile = path.join(temp, relative.replaceAll('/', '-'));
    fs.mkdirSync(path.dirname(gateFile), { recursive: true });
    fs.writeFileSync(gateFile, execFileSync('git', ['-C', root, 'cat-file', 'blob', blob]));
    const cloneBlob = execFileSync('git', ['-C', repo, 'hash-object', '-w', gateFile], { encoding: 'utf8' }).trim();
    if (cloneBlob !== blob) throw new Error(`merge-result blob changed while importing ${relative}`);
    execFileSync('git', ['-C', repo, 'update-index', '--add', '--cacheinfo', `${mode},${cloneBlob},${relative}`], { env: indexEnv });
  }
  const validatorBytes = fs.readFileSync(path.join(root, 'scripts/next-touch-validation.js'));
  const mirrorBytes = fs.readFileSync(path.join(root, 'platforms/codex/plugin/scripts/next-touch-validation.js'));
  if (!validatorBytes.equals(mirrorBytes)) throw new Error('fresh validator mirror bytes diverged before integration');
  for (const [relative, mode, bytes] of [
    ['scripts/next-touch-validation.js', '100644', validatorBytes],
    ['platforms/codex/plugin/scripts/next-touch-validation.js', '100644', mirrorBytes],
    ['hooks/tests/next-touch-validation.test.sh', '100755', fs.readFileSync(path.join(root, 'hooks/tests/next-touch-validation.test.sh'))],
  ]) {
    const file = path.join(temp, relative.replaceAll('/', '-'));
    fs.writeFileSync(file, bytes);
    const blob = execFileSync('git', ['-C', repo, 'hash-object', '-w', file], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', repo, 'update-index', '--add', '--cacheinfo', `${mode},${blob},${relative}`], { env: indexEnv });
  }
  const integrationTree = execFileSync('git', ['-C', repo, 'write-tree'], { env: indexEnv, encoding: 'utf8' }).trim();
  const integration = execFileSync('git', [
    '-C', repo, 'commit-tree', integrationTree,
    '-p', validation.G8B_PRODUCT_CANDIDATE_SHA, '-p', validation.G8B_DEVELOP_PREMERGE_SHA,
  ], { input: 'g8b runtime integration\n', encoding: 'utf8' }).trim();
  fs.rmSync(index, { force: true });
  const branch = grant.branch;
  git(['update-ref', `refs/heads/${branch}`, integration]);
  git(['checkout', '-q', branch]);
  const integrationTreeTruth = git(['rev-parse', `${integration}^{tree}`]);
  if (integrationTreeTruth !== integrationTree || tree !== validation.G8B_PRODUCT_CANDIDATE_TREE_SHA) {
    throw new Error('fresh integration tree was not sealed to product/develop gate merge');
  }
  iccBody = { ...iccBody, candidate_tree_sha: integrationTree };
  iccTerminal = { ...iccBody, receipt_digest: validation.canonicalDigest(iccBody) };
  fs.writeFileSync(paths.iccTerminal, JSON.stringify(iccTerminal));
  const ref = (file, receiptDigest) => ({ path: path.basename(file), receipt_digest: receiptDigest });
  const g8bBody = {
    schema_version: 1,
    artifact_type: 'g8b_integration_authorization',
    authority_mode: 'fresh_non_successor',
    repo_identity: repoInfo.repo_identity,
    ticket: grant.branch.replaceAll('/', '-'),
    project: 'next-touch-debt-retirement',
    graph_node_id: 'next-touch-debt-retirement',
    authorized_branch: branch,
    candidate_ref: `refs/heads/${branch}`,
    mission_lineage_id: lineage,
    adoption_key: adoptionKey,
    task_authority_id: taskAuthority.task_authority_id,
    mission_policy_digest: taskAuthority.mission_policy_digest,
    mission_graph_digest: graphDigest,
    policy_hash: taskAuthority.policy_hash,
    source_plan_path: validation.PLAN_PATH || 'docs/plans/2026-08-03-next-touch-debt-retirement.md',
    source_rubric_path: validation.RUBRIC_PATH || 'docs/plans/2026-08-03-next-touch-debt-retirement.rubric.md',
    source_plan_sha256: source.planSha,
    source_rubric_sha256: source.rubricSha,
    admission_base_sha: validation.ADMISSION_BASE_SHA,
    mission_claim_base_sha: validation.REVIEW_BASE_SHA,
    review_base_sha: validation.REVIEW_BASE_SHA,
    product_candidate_sha: validation.G8B_PRODUCT_CANDIDATE_SHA,
    product_candidate_tree_sha: validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
    integration_candidate_sha: integration,
    integration_candidate_tree_sha: integrationTree,
    integration_candidate_ref: `refs/heads/${branch}`,
    develop_ref: 'refs/heads/develop',
    develop_sha: validation.G8B_DEVELOP_PREMERGE_SHA,
    d8_evaluated_sha: validation.D8_EVALUATED_SHA,
    d8_publication_sha: validation.D8_PUBLICATION_SHA,
    d8_report_path: '.autopilot/evidence/grok-implementer-ab.json',
    d8_report_sha256: '804706b6fe50994abfc332190342dba0c49dad1b1f06c166ac69547461728c6b',
    archive_plan_path: 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/2026-08-03-next-touch-debt-retirement.md',
    archive_rubric_path: 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/2026-08-03-next-touch-debt-retirement.rubric.md',
    historical_archive_authorization_path: 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json',
    historical_archive_authorization_sha256: '3266fb2c98133e788e23eec3e261a902c40529e0363ece2b12e01c9e31a338ba',
    historical_archive_authorization_digest: validation.canonicalDigest(historical),
    task_authority_ref: { path: path.basename(paths.taskAuthority), task_authority_id: taskAuthority.task_authority_id },
    prepared_receipt_ref: ref(paths.prepared, prepared.receipt.receipt_digest),
    mission_state_ref: { path: paths.state, state_hash: mission.stateHash(state) },
    mission_terminal_receipt_ref: ref(paths.missionTerminal, missionTerminal.receipt_digest),
    campaign_terminal_receipt_ref: ref(paths.campaignTerminal, terminal.receipt.receipt_digest),
    icc_terminal_receipt_ref: ref(paths.iccTerminal, iccTerminal.receipt_digest),
    mission_terminal_receipt_digest: missionTerminal.receipt_digest,
    campaign_terminal_receipt_digest: terminal.receipt.receipt_digest,
    icc_terminal_receipt_digest: iccTerminal.receipt_digest,
    claim_id: claim.claim_id,
    claim_binding_digest: claim.binding_digest,
    mission_campaign_id: claim.campaign_id,
    campaign_id: campaignId,
    roster: {
      implementer: 'grok/Grok-4.5/high/xai',
      verifier: 'agy/Gemini 3.5 Flash (High)/high/google',
      reviewer: 'claude-native/claude-opus/high/anthropic',
    },
  };
  const g8bSealed = { ...g8bBody, receipt_digest: validation.canonicalDigest(g8bBody) };
  fs.writeFileSync(paths.g8b, JSON.stringify(g8bSealed));
  const bundle = {
    g8b_integration_authorization: { path: path.basename(paths.g8b), receipt_digest: g8bSealed.receipt_digest },
    prepared_receipt: g8bSealed.prepared_receipt_ref,
    mission_state: g8bSealed.mission_state_ref,
    mission_terminal_receipt: g8bSealed.mission_terminal_receipt_ref,
    campaign_terminal_receipt: g8bSealed.campaign_terminal_receipt_ref,
    icc_terminal_receipt: g8bSealed.icc_terminal_receipt_ref,
    mission_lineage_id: lineage,
    candidate_sha: integration,
    candidate_tree_sha: integrationTree,
    candidate_ref: `refs/heads/${branch}`,
    develop_sha: validation.G8B_DEVELOP_PREMERGE_SHA,
    campaign_id: campaignId,
  };
  const checked = validation.validateG8bIntegrationAuthorization(
    bundle,
    { path: paths.bundle, bundle },
    repoInfo,
    source,
    { candidate: integration },
    historical,
  );
  if (!checked || checked.integrationCandidate !== integration
      || checked.state.state !== 'COMPLETE' || checked.claim.claim_id !== claim.claim_id) {
    throw new Error('fresh G8b runtime-positive result was incomplete');
  }
  const freshStateBundle = {
    prepared_receipt: g8bSealed.prepared_receipt_ref,
    mission_state: g8bSealed.mission_state_ref,
  };
  const freshStateChecked = validation.validatePreparedAndMissionState(
    freshStateBundle,
    { path: paths.bundle },
    repoInfo,
    checked.authorization,
    {},
  );
  if (freshStateChecked.state.state !== 'COMPLETE'
      || freshStateChecked.stateRef.value.state !== 'COMPLETE') {
    throw new Error('fresh G8b state reference did not pass generic Mission state validation');
  }
  let wrongStateHash = null;
  try {
    validation.validatePreparedAndMissionState(
      {
        ...freshStateBundle,
        mission_state: { path: paths.state, state_hash: '0'.repeat(64) },
      },
      { path: paths.bundle },
      repoInfo,
      checked.authorization,
      {},
    );
  } catch (error) { wrongStateHash = error; }
  if (!wrongStateHash || wrongStateHash.code !== 'G8B_MISSION_STATE_BINDING_MISMATCH') {
    throw new Error(`wrong fresh state hash was accepted: ${wrongStateHash && wrongStateHash.code}`);
  }
  let mixedStateRef = null;
  try {
    validation.validatePreparedAndMissionState(
      {
        ...freshStateBundle,
        mission_state: {
          path: paths.state,
          state_hash: g8bSealed.mission_state_ref.state_hash,
          receipt_digest: '0'.repeat(64),
        },
      },
      { path: paths.bundle },
      repoInfo,
      checked.authorization,
      {},
    );
  } catch (error) { mixedStateRef = error; }
  if (!mixedStateRef || mixedStateRef.code !== 'AUTHORITY_INVALID') {
    throw new Error(`mixed Mission state schema was accepted: ${mixedStateRef && mixedStateRef.code}`);
  }
  const validBundle = () => ({
    g8b_integration_authorization: { path: path.basename(paths.g8b), receipt_digest: '' },
    prepared_receipt: g8bSealed.prepared_receipt_ref,
    mission_state: g8bSealed.mission_state_ref,
    mission_terminal_receipt: g8bSealed.mission_terminal_receipt_ref,
    campaign_terminal_receipt: g8bSealed.campaign_terminal_receipt_ref,
    icc_terminal_receipt: g8bSealed.icc_terminal_receipt_ref,
    mission_lineage_id: lineage,
    candidate_sha: integration,
    candidate_tree_sha: integrationTree,
    candidate_ref: `refs/heads/${branch}`,
    develop_sha: validation.G8B_DEVELOP_PREMERGE_SHA,
    campaign_id: campaignId,
  });
  const expectG8b = (label, code, bodyOverrides = {}, bundleOverrides = {}, candidateArg = integration) => {
    const body = { ...g8bBody, ...bodyOverrides };
    const sealed = { ...body, receipt_digest: validation.canonicalDigest(body) };
    fs.writeFileSync(paths.g8b, JSON.stringify(sealed));
    const bundleForCase = {
      ...validBundle(),
      ...bundleOverrides,
      g8b_integration_authorization: { path: path.basename(paths.g8b), receipt_digest: sealed.receipt_digest },
      candidate_sha: bundleOverrides.candidate_sha || body.integration_candidate_sha,
      candidate_tree_sha: bundleOverrides.candidate_tree_sha || body.integration_candidate_tree_sha,
      candidate_ref: bundleOverrides.candidate_ref || body.integration_candidate_ref,
      develop_sha: bundleOverrides.develop_sha || body.develop_sha,
      campaign_id: bundleOverrides.campaign_id || body.campaign_id,
    };
    let caught = null;
    try {
      validation.validateG8bIntegrationAuthorization(
        bundleForCase,
        { path: paths.bundle, bundle: bundleForCase },
        repoInfo,
        source,
        { candidate: candidateArg },
        historical,
      );
    } catch (error) { caught = error; }
    if (!caught || caught.code !== code) {
      throw new Error(`${label}: expected ${code}, got ${caught && caught.code}`);
    }
  };
  const tamperedIndex = path.join(temp, 'fixture-tampered-index');
  const tamperedEnv = { ...process.env, GIT_INDEX_FILE: tamperedIndex };
  execFileSync('git', ['-C', repo, 'read-tree', integrationTree], { env: tamperedEnv });
  const tamperedDispatch = path.join(temp, 'dispatch-hetero-tampered.sh');
  const dispatchBytes = execFileSync('git', [
    '-C', repo, 'show', `${integration}:scripts/dispatch-hetero.sh`,
  ], { encoding: 'utf8' });
  fs.writeFileSync(tamperedDispatch, `${dispatchBytes}\n# preserved tokens but altered blob\n`);
  const tamperedBlob = execFileSync('git', [
    '-C', repo, 'hash-object', '-w', tamperedDispatch,
  ], { encoding: 'utf8' }).trim();
  execFileSync('git', [
    '-C', repo, 'update-index', '--add', '--cacheinfo', `100755,${tamperedBlob},scripts/dispatch-hetero.sh`,
  ], { env: tamperedEnv });
  const tamperedTree = execFileSync('git', ['-C', repo, 'write-tree'], {
    env: tamperedEnv, encoding: 'utf8',
  }).trim();
  const tamperedIntegration = execFileSync('git', [
    '-C', repo, 'commit-tree', tamperedTree,
    '-p', validation.G8B_PRODUCT_CANDIDATE_SHA, '-p', validation.G8B_DEVELOP_PREMERGE_SHA,
  ], { input: 'tampered detached gate blob\n', encoding: 'utf8' }).trim();
  const tamperedBranch = `${branch}-tampered`;
  git(['update-ref', `refs/heads/${tamperedBranch}`, tamperedIntegration]);
  expectG8b('tampered detached gate blob', 'G8B_INTEGRATION_GATE_INVALID', {
    authorized_branch: tamperedBranch,
    candidate_ref: `refs/heads/${tamperedBranch}`,
    integration_candidate_ref: `refs/heads/${tamperedBranch}`,
    integration_candidate_sha: tamperedIntegration,
    integration_candidate_tree_sha: tamperedTree,
  }, {
    candidate_sha: tamperedIntegration,
    candidate_tree_sha: tamperedTree,
    candidate_ref: `refs/heads/${tamperedBranch}`,
  }, tamperedIntegration);
  fs.rmSync(tamperedIndex, { force: true });
  const mirrorTamperedIndex = path.join(temp, 'fixture-mirror-tampered-index');
  const mirrorTamperedEnv = { ...process.env, GIT_INDEX_FILE: mirrorTamperedIndex };
  execFileSync('git', ['-C', repo, 'read-tree', integrationTree], { env: mirrorTamperedEnv });
  const mirrorTamperedFile = path.join(temp, 'next-touch-validation-mirror-tampered.js');
  const mirrorBytesForTamper = execFileSync('git', [
    '-C', repo, 'show', `${integration}:platforms/codex/plugin/scripts/next-touch-validation.js`,
  ], { encoding: 'utf8' });
  fs.writeFileSync(mirrorTamperedFile, `${mirrorBytesForTamper}\n// mirror tamper\n`);
  const mirrorTamperedBlob = execFileSync('git', [
    '-C', repo, 'hash-object', '-w', mirrorTamperedFile,
  ], { encoding: 'utf8' }).trim();
  execFileSync('git', [
    '-C', repo, 'update-index', '--add', '--cacheinfo',
    `100644,${mirrorTamperedBlob},platforms/codex/plugin/scripts/next-touch-validation.js`,
  ], { env: mirrorTamperedEnv });
  const mirrorTamperedTree = execFileSync('git', ['-C', repo, 'write-tree'], {
    env: mirrorTamperedEnv, encoding: 'utf8',
  }).trim();
  const mirrorTamperedIntegration = execFileSync('git', [
    '-C', repo, 'commit-tree', mirrorTamperedTree,
    '-p', validation.G8B_PRODUCT_CANDIDATE_SHA, '-p', validation.G8B_DEVELOP_PREMERGE_SHA,
  ], { input: 'tampered validator mirror\n', encoding: 'utf8' }).trim();
  const mirrorTamperedBranch = `${branch}-mirror-tampered`;
  git(['update-ref', `refs/heads/${mirrorTamperedBranch}`, mirrorTamperedIntegration]);
  expectG8b('tampered validator mirror', 'G8B_INTEGRATION_PARITY_INVALID', {
    authorized_branch: mirrorTamperedBranch,
    candidate_ref: `refs/heads/${mirrorTamperedBranch}`,
    integration_candidate_ref: `refs/heads/${mirrorTamperedBranch}`,
    integration_candidate_sha: mirrorTamperedIntegration,
    integration_candidate_tree_sha: mirrorTamperedTree,
  }, {
    candidate_sha: mirrorTamperedIntegration,
    candidate_tree_sha: mirrorTamperedTree,
    candidate_ref: `refs/heads/${mirrorTamperedBranch}`,
  }, mirrorTamperedIntegration);
  fs.rmSync(mirrorTamperedIndex, { force: true });
  const syntheticTreeMerge = execFileSync('git', [
    '-C', repo, 'commit-tree', validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
    '-p', validation.G8B_PRODUCT_CANDIDATE_SHA, '-p', validation.G8B_DEVELOP_PREMERGE_SHA,
  ], { input: 'synthetic b3 tree\n', encoding: 'utf8' }).trim();
  const syntheticBranch = `${branch}-synthetic`;
  git(['update-ref', `refs/heads/${syntheticBranch}`, syntheticTreeMerge]);
  expectG8b('synthetic product-tree merge', 'G8B_INTEGRATION_SCOPE_INVALID', {
    authorized_branch: syntheticBranch,
    candidate_ref: `refs/heads/${syntheticBranch}`,
    integration_candidate_ref: `refs/heads/${syntheticBranch}`,
    integration_candidate_sha: syntheticTreeMerge,
    integration_candidate_tree_sha: validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
  }, {
    candidate_sha: syntheticTreeMerge,
    candidate_tree_sha: validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
    candidate_ref: `refs/heads/${syntheticBranch}`,
  }, syntheticTreeMerge);
  expectG8b('cross integration tree', 'G8B_CANDIDATE_BINDING_MISMATCH', {
    integration_candidate_tree_sha: validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
  });
  expectG8b('cross integration ref', 'G8B_CANDIDATE_BINDING_MISMATCH', {
    candidate_ref: 'refs/heads/develop',
    integration_candidate_ref: 'refs/heads/develop',
  });
  expectG8b('cross develop sha', 'G8B_BINDING_MISMATCH', { develop_sha: validation.ADMISSION_BASE_SHA });
  expectG8b('cross develop ref', 'G8B_BINDING_MISMATCH', { develop_ref: 'refs/heads/fixture-base' });
  const productOnly = execFileSync('git', [
    '-C', repo, 'commit-tree', integrationTree,
    '-p', validation.G8B_DEVELOP_PREMERGE_SHA,
  ], { input: 'develop-only integration\n', encoding: 'utf8' }).trim();
  git(['update-ref', `refs/heads/${branch}-product-only`, productOnly]);
  expectG8b('cross product ancestry', 'G8B_PRODUCT_ANCESTRY_INVALID', {
    authorized_branch: `${branch}-product-only`,
    candidate_ref: `refs/heads/${branch}-product-only`,
    integration_candidate_ref: `refs/heads/${branch}-product-only`,
    integration_candidate_sha: productOnly,
    integration_candidate_tree_sha: integrationTree,
  }, {
    candidate_sha: productOnly,
    candidate_tree_sha: integrationTree,
    candidate_ref: `refs/heads/${branch}-product-only`,
  }, productOnly);
  const developOnly = execFileSync('git', [
    '-C', repo, 'commit-tree', integrationTree,
    '-p', validation.G8B_PRODUCT_CANDIDATE_SHA,
  ], { input: 'product-only integration\n', encoding: 'utf8' }).trim();
  git(['update-ref', `refs/heads/${branch}-develop-only`, developOnly]);
  expectG8b('cross develop ancestry', 'G8B_DEVELOP_ANCESTRY_INVALID', {
    authorized_branch: `${branch}-develop-only`,
    candidate_ref: `refs/heads/${branch}-develop-only`,
    integration_candidate_ref: `refs/heads/${branch}-develop-only`,
    integration_candidate_sha: developOnly,
    integration_candidate_tree_sha: integrationTree,
  }, {
    candidate_sha: developOnly,
    candidate_tree_sha: integrationTree,
    candidate_ref: `refs/heads/${branch}-develop-only`,
  }, developOnly);
  expectG8b('terminal candidate cross-bind', 'G8B_TERMINAL_BINDING_MISMATCH', {}, {
    candidate_sha: validation.G8B_PRODUCT_CANDIDATE_SHA,
  });
  expectG8b('terminal tree cross-bind', 'G8B_TERMINAL_BINDING_MISMATCH', {}, {
    candidate_tree_sha: validation.G8B_PRODUCT_CANDIDATE_TREE_SHA,
  });
  expectG8b('terminal ref cross-bind', 'G8B_TERMINAL_BINDING_MISMATCH', {}, {
    candidate_ref: 'refs/heads/develop',
  });
  expectG8b('terminal digest cross-bind', 'G8B_TERMINAL_BINDING_MISMATCH', {
    mission_terminal_receipt_digest: 'f'.repeat(64),
  });
  expectG8b('terminal campaign cross-bind', 'G8B_TERMINAL_BINDING_MISMATCH', {
    campaign_id: `campaign-v1-${'f'.repeat(64)}`,
  });

  // Exercise the real integration transition with the fresh G8b candidate.
  // The generic executor creates the authentic sealed merge receipt; the
  // G8b validator then has to accept the integrated state and the executor
  // must replay it as an idempotent no-op.
  const integrationTarget = path.join(temp, 'g8b-integration-target');
  git(['worktree', 'add', '-q', integrationTarget, 'develop']);
  const integrationBundlePath = path.join(directory, 'integration-terminal.json');
  const integrationBundle = {
    candidate_ref: `refs/heads/${branch}`,
    source_worktree: repo,
    develop_sha: validation.G8B_DEVELOP_PREMERGE_SHA,
    allowed_path_prefixes: [],
    campaign_id: campaignId,
    integration_state: 'reviewed_archived',
    merge_receipt: null,
  };
  runtime.atomicWriteJson(integrationBundlePath, integrationBundle);
  const integrationFrozen = { candidate: integration, candidateTree: integrationTree };
  const integrationArgs = { integrate_worktree: integrationTarget };
  const integrationPreflight = validation.validateIntegrationPreconditions(
    integrationBundle,
    integrationArgs,
    repoInfo,
    integrationFrozen,
  );
  const firstIntegration = validation.executeAuthorizedIntegration({
    bundle: integrationBundle,
    bundlePath: integrationBundlePath,
    repoInfo,
    frozen: integrationFrozen,
    args: integrationArgs,
    preconditions: integrationPreflight,
  });
  if (firstIntegration.status !== 'integrated'
      || git(['rev-parse', 'refs/heads/develop']) !== integration) {
    throw new Error('fresh G8b integration did not advance develop exactly once');
  }
  const integratedBundle = {
    ...bundle,
    source_worktree: repo,
    allowed_path_prefixes: [],
    integration_state: 'integrated',
    merge_receipt: {
      path: firstIntegration.receipt_path,
      receipt_digest: firstIntegration.receipt.receipt_digest,
    },
  };
  fs.writeFileSync(paths.g8b, JSON.stringify(g8bSealed));
  const integratedChecked = validation.validateG8bIntegrationAuthorization(
    integratedBundle,
    { path: paths.bundle, bundle: integratedBundle },
    repoInfo,
    source,
    { candidate: integration },
    historical,
  );
  if (!integratedChecked || integratedChecked.integrationCandidate !== integration) {
    throw new Error('integrated G8b authorization did not validate the authentic merge receipt');
  }
  const beforeReplayHead = git(['rev-parse', 'HEAD']);
  const replay = validation.executeAuthorizedIntegration({
    bundle: integratedBundle,
    bundlePath: paths.bundle,
    repoInfo,
    frozen: integrationFrozen,
    args: integrationArgs,
  });
  if (replay.status !== 'already_integrated'
      || git(['rev-parse', 'HEAD']) !== beforeReplayHead
      || execFileSync('git', ['-C', integrationTarget, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== integration) {
    throw new Error('integrated G8b rerun was not an idempotent no-op');
  }
  git(['update-ref', 'refs/heads/develop', validation.G8B_DEVELOP_PREMERGE_SHA]);
  let developDrift = null;
  try {
    validation.validateG8bIntegrationAuthorization(
      integratedBundle,
      { path: paths.bundle, bundle: integratedBundle },
      repoInfo,
      source,
      { candidate: integration },
      historical,
    );
  } catch (error) { developDrift = error; }
  if (!developDrift || developDrift.code !== 'G8B_INTEGRATED_BINDING_INVALID') {
    throw new Error(`integrated develop drift was accepted: ${developDrift && developDrift.code}`);
  }
  git(['update-ref', 'refs/heads/develop', integration]);
  const authenticReceipt = JSON.parse(fs.readFileSync(firstIntegration.receipt_path, 'utf8'));
  const wrongTargetReceiptBody = {
    ...authenticReceipt,
    edges: authenticReceipt.edges.map((edge) => ({ ...edge, target_ref: 'refs/heads/not-develop' })),
  };
  delete wrongTargetReceiptBody.receipt_digest;
  const wrongTargetReceipt = {
    ...wrongTargetReceiptBody,
    receipt_digest: validation.canonicalDigest(wrongTargetReceiptBody),
  };
  const wrongTargetReceiptPath = path.join(directory, 'g8b-wrong-target-merge.json');
  fs.writeFileSync(wrongTargetReceiptPath, JSON.stringify(wrongTargetReceipt));
  const wrongTargetBundle = {
    ...integratedBundle,
    merge_receipt: {
      path: wrongTargetReceiptPath,
      receipt_digest: wrongTargetReceipt.receipt_digest,
    },
  };
  let wrongTarget = null;
  try {
    validation.validateG8bIntegrationAuthorization(
      wrongTargetBundle,
      { path: paths.bundle, bundle: wrongTargetBundle },
      repoInfo,
      source,
      { candidate: integration },
      historical,
    );
  } catch (error) { wrongTarget = error; }
  if (!wrongTarget || wrongTarget.code !== 'G8B_INTEGRATED_BINDING_INVALID') {
    throw new Error(`integrated wrong target was accepted: ${wrongTarget && wrongTarget.code}`);
  }
  console.log('G8b integrated rerun, authentic receipt binding, and drift/target guards passed');
  fs.writeFileSync(paths.g8b, JSON.stringify(g8bSealed));
  fs.rmSync(directory, { recursive: true, force: true });
  console.log('G8b fresh runtime-positive and integration binding negatives passed');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
NODE
assert_exit_code "$?" "0" "fresh G8b validator accepts normalized Mission/ICC runtime integration"

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
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
const legacyDigestBundle = {
  ...bundle,
  mission_state: {
    path: bundle.mission_state,
    receipt_digest: '0'.repeat(64),
  },
};
let legacyDigestError = null;
try {
  validation.validatePreparedAndMissionState(
    legacyDigestBundle,
    { path: path.join(missionRoot, 'terminal.json') },
    repoInfo,
    auth,
    {},
  );
} catch (error) { legacyDigestError = error; }
if (!legacyDigestError || legacyDigestError.code !== 'RECEIPT_REF_DIGEST_INVALID') {
  throw new Error(`legacy Mission state receipt-digest ref did not use legacy resolver: ${legacyDigestError && legacyDigestError.code}`);
}
NODE
assert_exit_code "$?" "0" "canonical prepared/state terminal binding rejects non-ready state"

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const campaignCli = require(path.join(root, 'src/campaign/cli'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
const ledgerPath = path.join(repoInfo.common, 'autopilot/implementation-campaign.jsonl');
const ledgerLines = fs.readFileSync(ledgerPath, 'utf8').trim().split('\n');
if (ledgerLines.length < 2) throw new Error('ICC ledger fixture is not multi-line JSONL');
const rows = campaignCli.loadRows(ledgerPath);
let terminal = null;
for (const campaignId of [...new Set(rows.map((row) => row && row.run_id).filter(Boolean))]) {
  try {
    const projection = campaignCli.projectCampaign(rows, campaignId);
    if (projection.state.phase === 'TERMINAL_READY') {
      terminal = { campaignId, projection };
      break;
    }
  } catch (_error) {
    // Ignore unrelated or intentionally incomplete campaigns in the shared ledger.
  }
}
if (!terminal) throw new Error('ICC ledger fixture has no terminal-ready campaign');
const { campaignId, projection } = terminal;
const bundlePath = path.join(repoInfo.common, 'autopilot', 'next-touch-ledger-test-bundle.json');
const iccTerminal = { lifecycle_receipt_ref: projection.lifecycle_receipt_ref };
const frozen = {
  candidate: projection.candidate_reference.commit,
  candidateTree: projection.candidate_reference.tree_sha,
  review: projection.candidate_reference.base,
};
const validateLedger = (ledgerRef) => validation.validateIccLedger(
  { ledger_path: ledgerRef, campaign_id: campaignId },
  { path: bundlePath },
  repoInfo,
  iccTerminal,
  frozen,
);
const checked = validateLedger(ledgerPath);
if (checked.campaignId !== campaignId
    || checked.ledgerRef.file !== ledgerPath
    || checked.projection.state.phase !== 'TERMINAL_READY') {
  throw new Error('multi-line ICC JSONL ledger did not pass path-only validation');
}
let escaped = null;
try {
  validateLedger('/tmp/next-touch-ledger-forbidden');
} catch (error) { escaped = error; }
if (!escaped || escaped.code !== 'AUTHORITY_PATH_ESCAPE') {
  throw new Error(`ICC ledger path escape was accepted: ${escaped && escaped.code}`);
}
let extraSchema = null;
try {
  validateLedger({ path: ledgerPath, receipt_digest: '0'.repeat(64) });
} catch (error) { extraSchema = error; }
if (!extraSchema || extraSchema.code !== 'AUTHORITY_INVALID') {
  throw new Error(`ICC ledger extra schema was accepted: ${extraSchema && extraSchema.code}`);
}
let missing = null;
try {
  validateLedger(path.join(repoInfo.common, 'autopilot', 'missing-ledger.jsonl'));
} catch (error) { missing = error; }
if (!missing || missing.code !== 'ICC_AUTHORITY_MISSING') {
  throw new Error(`missing ICC ledger was accepted: ${missing && missing.code}`);
}
NODE
assert_exit_code "$?" "0" "ICC JSONL ledger resolver accepts multiline ledger and rejects invalid refs"

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
const directory = fs.mkdtempSync(path.join(validation.canonicalAuthorityRoot(repoInfo), 'next-touch-verifier-'));
try {
  const campaignId = 'campaign-v1-' + 'c'.repeat(64);
  const candidate = 'd'.repeat(40);
  const candidateTree = 'a'.repeat(40);
  const lineage = 'lineage-v1-' + 'f'.repeat(64);
  const request = {
    tree_sha: candidateTree,
    argv_hash: validation.canonicalDigest(['/bin/sh', '-c', 'true']),
    env_fingerprint: 'e'.repeat(64),
  };
  request.request_digest = validation.canonicalDigest(request);
  const receiptBody = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_verification',
    campaign_id: campaignId,
    tree_sha: request.tree_sha,
    argv_hash: request.argv_hash,
    env_fingerprint: request.env_fingerprint,
    request_digest: request.request_digest,
    verdict: 'GREEN',
    exit_status: 0,
    writer_lease_closed: true,
    detached_checkout: true,
    runner_argv_attested: true,
    writer_fence_digest: 'f'.repeat(64),
    checkout_attestation_digest: '1'.repeat(64),
    stdout_digest: '2'.repeat(64),
    stderr_digest: '3'.repeat(64),
    started_at: '2026-08-06T00:00:00.000Z',
    ended_at: '2026-08-06T00:00:01.000Z',
  };
  const receipt = {
    ...receiptBody,
    receipt_digest: validation.canonicalDigest(receiptBody),
  };
  const checkedReceipt = validation.validateVerificationReceipt(receipt, candidateTree, campaignId);
  if (checkedReceipt.receipt_digest !== receipt.receipt_digest) {
    throw new Error('canonical GREEN verifier receipt lost its authenticated digest');
  }
  const receiptPath = path.join(directory, 'verification.json');
  fs.writeFileSync(receiptPath, JSON.stringify(receipt));
  const attestationBody = {
    schema_version: 1,
    artifact_type: 'next_touch_verifier_attestation',
    repo_identity: repoInfo.repo_identity,
    mission_lineage_id: lineage,
    campaign_id: campaignId,
    base_sha: validation.REVIEW_BASE_SHA,
    candidate_sha: candidate,
    candidate_tree_sha: candidateTree,
    roster_tuple: 'agy/Gemini 3.5 Flash (High)/high/google',
    actor_id: 'verifier',
    session_id: 'verifier-session',
    runner_version: 'test',
    provider_version: 'test',
    command: 'true',
    command_argv: ['true'],
    command_digest: validation.canonicalDigest({ command: 'true', argv: ['true'] }),
    result_digest: validation.canonicalDigest({
      receipt_digest: receipt.receipt_digest,
      verdict: receipt.verdict,
      exit_status: receipt.exit_status,
      stdout_digest: receipt.stdout_digest,
      stderr_digest: receipt.stderr_digest,
    }),
    receipt_ref: { path: receiptPath, receipt_digest: receipt.receipt_digest },
  };
  const attestation = {
    ...attestationBody,
    receipt_digest: validation.canonicalDigest(attestationBody),
  };
  const checkedAttestation = validation.validateVerifierAttestation(
    attestation,
    candidate,
    candidateTree,
    campaignId,
    repoInfo,
    { mission_lineage_id: lineage },
    { review: validation.REVIEW_BASE_SHA },
    { path: path.join(directory, 'bundle.json') },
  );
  if (checkedAttestation.receipt_digest !== receipt.receipt_digest) {
    throw new Error('verifier attestation did not bind the canonical GREEN receipt digest');
  }
  const expectReceiptFailure = (value, code, label) => {
    let caught = null;
    try { validation.validateVerificationReceipt(value, candidateTree, campaignId); }
    catch (error) { caught = error; }
    if (!caught || caught.code !== code) {
      throw new Error(`${label}: expected ${code}, got ${caught && caught.code}`);
    }
  };
  expectReceiptFailure(
    { ...receipt, receipt_digest: '0'.repeat(64) },
    'RECEIPT_DIGEST_INVALID',
    'tampered verifier receipt digest',
  );
  const badVerdictBody = { ...receipt };
  delete badVerdictBody.receipt_digest;
  expectReceiptFailure(
    { ...badVerdictBody, verdict: 'RED', receipt_digest: validation.canonicalDigest({ ...badVerdictBody, verdict: 'RED' }) },
    'VERIFIER_RECEIPT_INVALID',
    'tampered verifier verdict',
  );
  const badRequestBody = { ...receipt };
  expectReceiptFailure(
    { ...badRequestBody, request_digest: '4'.repeat(64) },
    'RECEIPT_DIGEST_INVALID',
    'tampered verifier request',
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
NODE
assert_exit_code "$?" "0" "canonical GREEN verifier receipt preserves digest and rejects tampering"

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
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

node - "$REPO_ROOT" "$NTV_FIXTURE_REPO" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const ntvFixtureRepo = process.argv[3];
const validation = require(path.join(root, 'scripts/next-touch-validation'));
const runtime = require(path.join(root, 'src/mission/runtime'));
const repoInfo = runtime.canonicalRepository(ntvFixtureRepo);
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
