'use strict';

// Shared, read-only authority checks for the next-touch reservation and terminal
// gates.  The two CLIs deliberately remain thin so the source and Codex copies
// cannot acquire divergent policy.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const runtime = require('../src/mission/runtime');
const mission = require('../src/engine/mission-convergence');
const implementation = require('../src/engine/implementation-campaign');
const campaignCli = require('../src/campaign/cli');
const verification = require('../src/engine/campaign-verification');
const composition = require('../src/engine/campaign-composition');
const mergeIntent = require('../src/status/merge-intent');
const mergeExecutor = require('../src/merge/cli');

const ADMISSION_BASE_SHA = 'f6805529bdca4cca76f334d8c82c8f2bf141aaf8';
const REVIEW_BASE_SHA = '1f9c53f4f070b152950a4115660026c4bb4fbede';
const D8_EVALUATED_SHA = '746f22338cfc7078acade53b143fea2d389dedd8';
const D8_PUBLICATION_SHA = 'c43370dd3df0918007fa35afe48f407124298617';
const D8_REPORT_PATH = '.autopilot/evidence/grok-implementer-ab.json';
const D6_REPORT_PATH = '.autopilot/evidence/hook-multiplexer-benchmark.json';
const FROZEN_EVIDENCE_SHA256 = Object.freeze({
  [D8_REPORT_PATH]: '804706b6fe50994abfc332190342dba0c49dad1b1f06c166ac69547461728c6b',
  [D6_REPORT_PATH]: '2dda66ea4e3347d940eb1d156baa592c5854ce7be063af633937357802ad093d',
  'scripts/validate-hook-multiplexer-benchmark.js': '88e862411177fe88135bd7690f937e3c02a38da5b2160b87d6484f141d7b8a5b',
  'hooks/tests/fixtures/hook-multiplexer-benchmark.json': '29a29f709f870b92c0513a27eef7290711efdf37cbc17f4975e9b37597b8c8fc',
  'scripts/validate-grok-implementer-ab.js': '60032e372265fa5252735312adb3a6a01a1a3e9f903c34d0e7f217bfa3ece72d',
  'evals/grok-implementer-ab/seed.json': '580a7a03b4d0e606d374329109f29d80de6774d72ca05dd077ae3c884e5d1239',
  'evals/grok-implementer-ab/tasks.json': 'bc136556a2cbb7445e7317df71fc5f3b3a9850f68241984aeb6a2e3aa12685c5',
});
const PLAN_PATH = 'docs/plans/2026-08-03-next-touch-debt-retirement.md';
const RUBRIC_PATH = 'docs/plans/2026-08-03-next-touch-debt-retirement.rubric.md';
const ARCHIVE_DIR = 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement';
const AUTHORIZATION_PATH = 'docs/projects/2026-08-03-next-touch-debt-retirement/evidence/authorization.json';
const ARCHIVE_AUTHORIZATION_PATH = 'docs/projects/_archive/2026-08-03-next-touch-debt-retirement/evidence/authorization.json';
const SOURCE_MANIFEST_PATH = 'docs/mission-next-touch-debt-retirement-sources.json';
const EXPECTED_AUTH_KEYS = [
  'schema_version', 'ticket', 'project', 'base_sha', 'branch', 'mission_lineage_id',
  'mission_policy_digest', 'mission_graph_digest', 'graph_node_id', 'roster',
  'admitted_headings', 'deliverables', 'status', 'authorized_at', 'notes',
];
const EXPECTED_ROSTER = Object.freeze({
  implementer: 'grok/Grok-4.5/high/xai',
  verifier: 'agy/Gemini 3.5 Flash (High)/high/google',
  reviewer: 'claude-native/claude-opus/high/anthropic',
});
const TERMINAL_BUNDLE_KEYS = Object.freeze([
  'schema_version', 'artifact_type', 'repo_identity', 'mission_lineage_id',
  'admission_base_sha', 'review_base_sha', 'd8_evaluated_sha', 'd8_publication_sha',
  'candidate_sha', 'candidate_tree_sha', 'source_plan_sha256', 'source_rubric_sha256',
  'receipt_digest', 'mission_state', 'prepared_receipt', 'mission_terminal_receipt',
  'campaign_terminal_receipt', 'icc_terminal_receipt', 'verification_receipts', 'review_receipts',
  'final_panel_receipt', 'ledger_path', 'campaign_id', 'develop_sha', 'candidate_ref',
  'source_worktree', 'allowed_path_prefixes', 'min_panel_size', 'integration_state',
  'merge_receipt', 'd8_publication_rebind_receipt',
]);
const TERMINAL_BUNDLE_REQUIRED_KEYS = Object.freeze([
  'schema_version', 'artifact_type', 'repo_identity', 'mission_lineage_id',
  'admission_base_sha', 'review_base_sha', 'd8_evaluated_sha', 'd8_publication_sha',
  'candidate_sha', 'candidate_tree_sha', 'source_plan_sha256', 'source_rubric_sha256',
  'receipt_digest', 'prepared_receipt', 'mission_state', 'mission_terminal_receipt',
  'campaign_terminal_receipt', 'verification_receipts', 'review_receipts',
  'final_panel_receipt', 'ledger_path', 'campaign_id', 'icc_terminal_receipt',
  'develop_sha', 'candidate_ref', 'source_worktree', 'allowed_path_prefixes',
  'integration_state', 'merge_receipt', 'd8_publication_rebind_receipt', 'min_panel_size',
]);
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_OID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const LINEAGE = /^lineage-v1-[0-9a-f]{64}$/u;
const HEAD_REF = /^refs\/heads\/[A-Za-z0-9._/-]+$/u;
const D8_REBIND_KEYS = Object.freeze([
  'schema_version', 'artifact_type', 'repo_identity', 'mission_lineage_id',
  'task_authority_id', 'authorized_branch', 'review_base_sha', 'evaluated_sha',
  'publication_sha', 'publication_report_sha256', 'candidate_ref', 'candidate_sha',
  'candidate_tree_sha', 'mission_terminal_receipt_digest',
  'campaign_terminal_receipt_digest', 'icc_terminal_receipt_digest', 'receipt_digest',
]);
const IMPLEMENTATION_TERMINAL_KEYS = Object.freeze([
  'schema_version', 'artifact_type', 'status', 'candidate_tree_sha',
  'verification_receipt_digest', 'repair_generations', 'sealed_min_panel_size',
  'final_panel_count', 'final_panel_seat_receipts', 'follow_up', 'rejected_findings',
  'unresolved_final_findings', 'lifecycle_receipt_ref', 'trace', 'receipt_digest',
]);

class NextTouchValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'NextTouchValidationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new NextTouchValidationError(code, message);
}

function readJson(file, label) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (error) {
    fail('AUTHORITY_MISSING', `${label} cannot be read: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail('AUTHORITY_INVALID', `${label} is not valid JSON: ${error.message}`);
  }
}

function parseStrictArgs(argv, required, optional = [], booleans = []) {
  const accepted = new Set([...required, ...optional, ...booleans]);
  const booleanSet = new Set(booleans);
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!accepted.has(flag)) fail('CLI_UNKNOWN_FLAG', `unknown option: ${flag}`);
    const key = flag.slice(2).replace(/-/g, '_');
    if (booleanSet.has(flag)) {
      output[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail('CLI_ARGUMENT_REQUIRED', `${flag} requires a value`);
    output[key] = value;
    index += 1;
  }
  for (const flag of required) {
    if (!Object.prototype.hasOwnProperty.call(output, flag.slice(2).replace(/-/g, '_'))) {
      fail('CLI_ARGUMENT_REQUIRED', `${flag} is required`);
    }
  }
  return output;
}

function canonicalAuthorityRoot(repoInfo) {
  return path.join(repoInfo.common, 'autopilot');
}

function realpathWithMissing(file) {
  const suffix = [];
  let cursor = path.resolve(file);
  while (true) {
    try {
      fs.lstatSync(cursor);
      return path.resolve(fs.realpathSync(cursor), ...suffix);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function assertAuthorityPath(file, repoInfo, label) {
  const root = canonicalAuthorityRoot(repoInfo);
  const candidate = path.resolve(file);
  const relative = path.relative(path.resolve(root), candidate);
  let rootReal;
  let candidateReal;
  try {
    rootReal = realpathWithMissing(root);
    candidateReal = realpathWithMissing(candidate);
  } catch (error) {
    fail('AUTHORITY_PATH_INVALID', `${label} cannot resolve authority path: ${error.message}`);
  }
  const realRelative = path.relative(rootReal, candidateReal);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
      || realRelative === '' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
    fail('AUTHORITY_PATH_ESCAPE', `${label} must be inside the Git common-dir authority store`);
  }
  return candidate;
}

function assertCanonicalRepoFile(file, repoInfo, label) {
  const root = path.resolve(repoInfo.repo);
  const candidate = path.resolve(file);
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('AUTHORITY_PATH_ESCAPE', `${label} must remain under the canonical repository root`);
  }
  const parts = relative.split(path.sep).filter(Boolean);
  let cursor = root;
  for (let index = 0; index < parts.length; index += 1) {
    cursor = path.join(cursor, parts[index]);
    let stat;
    try { stat = fs.lstatSync(cursor); }
    catch (error) {
      if (error.code === 'ENOENT') return candidate;
      fail('AUTHORITY_PATH_INVALID', `${label} cannot be inspected: ${error.message}`);
    }
    if (stat.isSymbolicLink()) {
      fail('AUTHORITY_PATH_ESCAPE', `${label} cannot traverse a symbolic link`);
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      fail('AUTHORITY_PATH_INVALID', `${label} has a non-directory parent`);
    }
    if (index === parts.length - 1 && !stat.isFile()) {
      fail('AUTHORITY_PATH_INVALID', `${label} must be a regular file`);
    }
  }
  return candidate;
}

function canonicalDigest(value) {
  return implementation.canonicalDigest(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  return mission.canonicalJson(value);
}

function git(repo, args, allowFailure = false) {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    fail('GIT_AUTHORITY_INVALID', String(result.stderr || result.error || 'git failed').trim());
  }
  return result;
}

function gitText(repo, args) {
  return String(git(repo, args).stdout || '').trim();
}

function gitObject(repo, ref) {
  const value = gitText(repo, ['rev-parse', '--verify', `${ref}^{commit}`]);
  if (!GIT_OID.test(value)) fail('GIT_AUTHORITY_INVALID', `${ref} is not an immutable commit`);
  return value;
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || Object.keys(value).length !== expected.length
      || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    fail('AUTHORITY_INVALID', `${label} keys are invalid`);
  }
}

function assertDigest(value, label) {
  if (!SHA256.test(String(value || ''))) fail('AUTHORITY_INVALID', `${label} must be SHA-256`);
}

function validateSealedDigest(value, label, digestFn = canonicalDigest) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('RECEIPT_INVALID', `${label} must be an object`);
  }
  const body = { ...value };
  const digest = body.receipt_digest;
  delete body.receipt_digest;
  assertDigest(digest, `${label}.receipt_digest`);
  if (digestFn(body) !== digest) fail('RECEIPT_DIGEST_INVALID', `${label} digest is invalid`);
  return body;
}

function loadRepoAndAuthority(args, options = {}) {
  const repo = path.resolve(args.repo || process.cwd());
  let repoInfo;
  try {
    repoInfo = runtime.canonicalRepository(repo);
  } catch (error) {
    fail(error.code || 'REPO_INVALID', error.message);
  }
  const explicitAuthorization = args.authorization
    ? path.resolve(args.authorization)
    : null;
  const activeAuthorization = assertCanonicalRepoFile(
    path.join(repoInfo.repo, AUTHORIZATION_PATH), repoInfo, 'active authorization receipt',
  );
  const archiveAuthorization = assertCanonicalRepoFile(
    path.join(repoInfo.repo, ARCHIVE_AUTHORIZATION_PATH), repoInfo, 'archive authorization receipt',
  );
  if (explicitAuthorization
      && explicitAuthorization !== activeAuthorization
      && explicitAuthorization !== archiveAuthorization) {
    fail('AUTHORITY_PATH_ESCAPE', 'authorization receipt must use the admitted active or archive path');
  }
  // Reservation remains an active-project operation.  Terminal validation is
  // allowed to use the immutable archived authorization after the project
  // directory has been moved, but only when no active receipt remains.
  const authorizationPath = explicitAuthorization
    || (fs.existsSync(activeAuthorization)
      ? activeAuthorization
      : (options.allowArchived === true ? archiveAuthorization : activeAuthorization));
  if (!fs.existsSync(authorizationPath)) {
    fail('AUTHORITY_MISSING', `authorization receipt is missing: ${authorizationPath}`);
  }
  const authorization = readJson(authorizationPath, 'authorization receipt');
  // The admitted authorization schema predates sealed receipt digests.  Terminal
  // authenticity is therefore bound by the exact archive bytes at the candidate
  // Git SHA (validateArchiveState) plus Mission lineage/policy/graph checks;
  // do not invent a second, incompatible authorization schema here.
  assertExactKeys(authorization, EXPECTED_AUTH_KEYS, 'authorization receipt');
  if (authorization.schema_version !== 1
      || authorization.project !== 'next-touch-debt-retirement'
      || authorization.graph_node_id !== 'next-touch-debt-retirement'
      || authorization.status !== 'implemented_pending_independent_qc'
      || !LINEAGE.test(authorization.mission_lineage_id || '')
      || !GIT_OID.test(authorization.base_sha || '')
      || !/^mission\/[A-Za-z0-9._/-]+$/u.test(authorization.branch || '')
      || !Array.isArray(authorization.admitted_headings)
      || !Array.isArray(authorization.deliverables)
      || JSON.stringify(authorization.admitted_headings)
        !== JSON.stringify(Array.from({ length: 14 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`))
      || JSON.stringify(authorization.deliverables) !== JSON.stringify(['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'])
      || JSON.stringify(authorization.roster) !== JSON.stringify(EXPECTED_ROSTER)) {
    fail('AUTHORITY_INVALID', 'authorization identity, roster, or admitted ledger is invalid');
  }
  assertDigest(authorization.mission_policy_digest, 'authorization.mission_policy_digest');
  assertDigest(authorization.mission_graph_digest, 'authorization.mission_graph_digest');
  return {
    repoInfo,
    authorization,
    authorizationPath,
    authorization_source: authorizationPath === archiveAuthorization ? 'archive' : 'active',
  };
}

function readGitFile(repo, ref, relative) {
  const result = git(repo, ['show', `${ref}:${relative}`], true);
  if (result.status !== 0) fail('GIT_AUTHORITY_INVALID', `${ref}:${relative} is unreadable`);
  return String(result.stdout || '');
}

function sourceDigests(repo) {
  const manifestPath = path.join(repo, SOURCE_MANIFEST_PATH);
  const manifest = readJson(manifestPath, 'source manifest');
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.sources)
      || manifest.sources.length !== 1) fail('SOURCE_AUTHORITY_INVALID', 'source manifest is invalid');
  const source = manifest.sources[0];
  if (source.plan_path !== PLAN_PATH.slice('docs/'.length)
      || source.rubric_path !== RUBRIC_PATH.slice('docs/'.length)) {
    fail('SOURCE_AUTHORITY_INVALID', 'source manifest paths are not frozen');
  }
  const planSha = sha256(fs.readFileSync(path.join(repo, 'docs', source.plan_path)));
  const rubricSha = sha256(fs.readFileSync(path.join(repo, 'docs', source.rubric_path)));
  if (source.plan_sha256 !== planSha || source.rubric_sha256 !== rubricSha) {
    fail('SOURCE_AUTHORITY_INVALID', 'active plan/rubric digest does not match source manifest');
  }
  return { planSha, rubricSha, planText: fs.readFileSync(path.join(repo, PLAN_PATH), 'utf8') };
}

function parseHeadingLedger(planText) {
  const result = new Map();
  for (const line of String(planText).split('\n')) {
    const match = /^\|\s*(A\d\d)(?:[–-](A\d\d))?\s*\|\s*D\d\s*\|\s*(.+?)\s*\|\s*$/u.exec(line);
    if (!match) continue;
    const first = Number(match[1].slice(1));
    const last = match[2] ? Number(match[2].slice(1)) : first;
    const headings = match[3].split(';').map((heading) => heading.trim()).filter(Boolean);
    if (headings.length !== last - first + 1) {
      fail('BACKLOG_LEDGER_INVALID', `heading range ${match[1]}-${match[2] || match[1]} does not enumerate exactly once`);
    }
    headings.forEach((heading, offset) => {
      result.set(`A${String(first + offset).padStart(2, '0')}`, heading);
    });
  }
  if (result.size !== 14) fail('BACKLOG_LEDGER_INVALID', 'frozen plan does not contain the 14 admitted headings');
  return result;
}

function headingsAt(repo, ref) {
  return readGitFile(repo, ref, 'docs/BACKLOG.md').split('\n')
    .filter((line) => /^###\s+\S/u.test(line))
    .map((line) => line.replace(/^###\s+/u, '').trim());
}

function validateHeadingSet(repo, admissionBase, candidate, asserted, source) {
  if (admissionBase === candidate) fail('BASE_CANDIDATE_COLLAPSED', 'admission base and candidate must differ');
  const mapping = parseHeadingLedger(source.planText);
  const baseHeadings = headingsAt(repo, admissionBase);
  const candidateHeadings = headingsAt(repo, candidate);
  const baseSet = new Set(baseHeadings);
  const candidateSet = new Set(candidateHeadings);
  const expectedIds = Array.from({ length: 14 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`);
  if (asserted !== 'A01:A14') fail('BACKLOG_LEDGER_INVALID', '--assert-removed-ledger must be exactly A01:A14');
  const missingBase = expectedIds.filter((id) => !baseSet.has(mapping.get(id)));
  const duplicateBase = baseHeadings.filter((heading, index) => baseHeadings.indexOf(heading) !== index);
  const duplicateCandidate = candidateHeadings.filter((heading, index) => candidateHeadings.indexOf(heading) !== index);
  if (missingBase.length || duplicateBase.length) fail('BACKLOG_LEDGER_INVALID', 'admitted headings are not unique in frozen base');
  if (duplicateCandidate.length) fail('BACKLOG_SET_DIFFERENCE_INVALID', 'candidate headings are not unique');
  const removed = expectedIds.filter((id) => !candidateSet.has(mapping.get(id)));
  const additions = candidateHeadings.filter((heading) => !baseSet.has(heading));
  const unexpectedRemovals = baseHeadings.filter((heading) => !candidateSet.has(heading)
    && !expectedIds.some((id) => mapping.get(id) === heading));
  if (JSON.stringify(removed) !== JSON.stringify(expectedIds)
      || additions.length > 0 || unexpectedRemovals.length > 0) {
    fail('BACKLOG_SET_DIFFERENCE_INVALID', 'candidate must remove all and only A01:A14 headings');
  }
  return { removed, additions, base_heading_count: baseHeadings.length };
}

function assertAncestor(repo, ancestor, descendant, code = 'GIT_ANCESTRY_INVALID') {
  const result = git(repo, ['merge-base', '--is-ancestor', ancestor, descendant], true);
  if (result.status !== 0) fail(code, `${ancestor} is not an ancestor of ${descendant}`);
}

function findPreparedReceipt(repoInfo, authorization, args = {}) {
  const root = path.join(canonicalAuthorityRoot(repoInfo), 'mission');
  const explicit = args.prepared ? [path.resolve(args.prepared)] : [];
  const candidates = explicit.length > 0 ? explicit : [];
  if (candidates.length === 0 && fs.existsSync(root)) {
    const visit = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile() && entry.name.endsWith('.json')) candidates.push(file);
      }
    };
    visit(root);
  }
  const matches = [];
  const prefix = String(authorization.branch).split('/')[1] || '';
  for (const file of candidates) {
    let value;
    try { value = readJson(file, 'Mission prepared receipt'); } catch (_error) { continue; }
    if (!value || value.artifact_type !== 'mission_prepare_receipt') continue;
    try { assertAuthorityPath(file, repoInfo, 'prepared receipt'); } catch (_error) { continue; }
    if (value.mission_lineage_id !== authorization.mission_lineage_id
        || value.mission_policy_digest !== authorization.mission_policy_digest
        || value.mission_graph_digest !== authorization.mission_graph_digest) continue;
    if (prefix && !String(value.adoption_key || '').startsWith(prefix)) continue;
    try {
      const verified = runtime.validatePreparedReceipt(value, repoInfo);
      matches.push({ file, value: verified.value, verified });
    } catch (_error) {
      continue;
    }
  }
  if (matches.length !== 1) fail('PREPARED_AUTHORITY_AMBIGUOUS', `expected one prepared Mission receipt, found ${matches.length}`);
  return matches[0];
}

function validateMissionReservation(repoInfo, authorization, args, source) {
  const prepared = findPreparedReceipt(repoInfo, authorization, args);
  const state = prepared.verified.state;
  mission.validateMissionState(state);
  if (state.state !== 'ACTIVE' || state.terminal !== null) {
    fail('MISSION_BLOCKED_OR_TERMINAL', `Mission state is ${state.state}`);
  }
  if (state.mission_lineage_id !== authorization.mission_lineage_id
      || state.mission_policy_digest !== authorization.mission_policy_digest
      || state.mission_graph_digest !== authorization.mission_graph_digest) {
    fail('MISSION_BINDING_MISMATCH', 'Mission state does not match authorization');
  }
  const node = (state.execution_graph.nodes || []).find((entry) => entry.id === authorization.graph_node_id);
  if (!node) fail('MISSION_GRAPH_NODE_UNKNOWN', 'authorized next-touch graph node is absent');
  const claimEntries = Object.values(state.claims || {})
    .filter((claim) => claim.graph_node_id === authorization.graph_node_id);
  const active = claimEntries.filter((claim) => claim.terminal !== true && claim.released !== true);
  if (active.length !== 1) fail('MISSION_GRANT_INVALID', `expected one active next-touch grant, found ${active.length}`);
  const claim = active[0];
  if (claim.base_sha !== authorization.base_sha
      || claim.mission_lineage_id !== authorization.mission_lineage_id
      || claim.task_authority_id !== prepared.value.task_authority_id
      || claim.graph_node_id !== authorization.graph_node_id) {
    fail('MISSION_GRANT_BINDING_MISMATCH', 'grant base, lineage, authority, or node binding is invalid');
  }
  const now = Date.parse(args.now || new Date().toISOString());
  if (!Number.isFinite(now) || !Number.isFinite(Date.parse(claim.expires_at)) || now >= Date.parse(claim.expires_at)) {
    fail('MISSION_GRANT_EXPIRED', 'Mission grant is expired');
  }
  const reservation = node.reservation || {};
  for (const axis of mission.SUPPORTED_AXES) {
    const expected = reservation[axis];
    const observed = claim.reservation && claim.reservation[axis];
    if (!Number.isSafeInteger(expected) || !observed || observed.reserved_active !== expected
        || observed.authorized_ceiling !== state.axes[axis].authorized_ceiling
        || observed.known !== true) {
      fail('MISSION_RESERVATION_MISMATCH', `reservation.${axis} is not canonical`);
    }
  }
  const planRubric = [source.planSha, source.rubricSha].sort();
  if (JSON.stringify([...state.initial_required_acceptance_hashes].sort()) !== JSON.stringify(planRubric)) {
    fail('SOURCE_PLAN_RUBRIC_MISMATCH', 'Mission acceptance hashes do not bind the active plan/rubric');
  }
  return { prepared, state, node, claim };
}

function campaignForClaim(rows, claim) {
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row.payload !== 'string') continue;
    let payload;
    try { payload = JSON.parse(row.payload); } catch (_error) { continue; }
    const state = payload.initial_state;
    if (state && state.ticket === claim.campaign_contract_draft.ticket) ids.add(payload.campaign_id);
  }
  if (ids.size !== 1) fail('ICC_AUTHORITY_INVALID', `expected one ICC campaign for ${claim.campaign_contract_draft.ticket}`);
  const campaignId = [...ids][0];
  let projection;
  try { projection = campaignCli.projectCampaign(rows, campaignId); } catch (error) {
    fail('ICC_AUTHORITY_INVALID', error.message);
  }
  if (!projection || projection.state.ticket !== claim.campaign_contract_draft.ticket
      || projection.state.repo_identity !== claim.campaign_contract_draft.repo_identity) {
    fail('ICC_AUTHORITY_INVALID', 'ICC campaign does not bind the Mission grant');
  }
  return { campaignId, projection };
}

function validateLedger(args, repoInfo, claim) {
  const ledger = assertAuthorityPath(path.resolve(args.ledger), repoInfo, 'campaign ledger');
  if (!fs.existsSync(ledger)) fail('ICC_AUTHORITY_MISSING', `campaign ledger is missing: ${ledger}`);
  let rows;
  try { rows = campaignCli.loadRows(ledger); } catch (error) { fail('ICC_AUTHORITY_INVALID', error.message); }
  return campaignForClaim(rows, claim);
}

function validateReservation(args = {}) {
  if (args.pre_spend !== true) fail('CLI_PRE_SPEND_REQUIRED', '--pre-spend is required');
  const { repoInfo, authorization } = loadRepoAndAuthority(args);
  // Resolve and contain the caller-supplied ledger before inspecting Mission
  // state.  A path escape must never be masked by a later blocked-state result.
  assertAuthorityPath(path.resolve(args.ledger || ''), repoInfo, 'campaign ledger');
  const source = sourceDigests(repoInfo.repo);
  if (authorization.base_sha !== ADMISSION_BASE_SHA) fail('ADMISSION_BASE_MISMATCH', 'authorization base is not the frozen admission base');
  const missionResult = validateMissionReservation(repoInfo, authorization, args, source);
  const ledgerResult = validateLedger(args, repoInfo, missionResult.claim);
  if (new Set(['TERMINAL_READY', 'TERMINAL_FOLLOW_UP', 'TERMINAL_STOP']).has(ledgerResult.projection.state.phase)) {
    fail('ICC_CAMPAIGN_TERMINAL', 'ICC campaign is already terminal');
  }
  return {
    status: 'authorized',
    pre_spend: true,
    repo_identity: repoInfo.repo_identity,
    mission_lineage_id: authorization.mission_lineage_id,
    graph_node_id: authorization.graph_node_id,
    claim_id: missionResult.claim.claim_id,
    mission_campaign_id: missionResult.claim.campaign_id,
    campaign_id: ledgerResult.campaignId,
    reservation: missionResult.claim.reservation,
    source_plan_sha256: source.planSha,
    source_rubric_sha256: source.rubricSha,
  };
}

function loadTerminalBundle(receiptPath, repoInfo) {
  const canonical = assertAuthorityPath(path.resolve(receiptPath || ''), repoInfo, 'terminal bundle');
  if (!fs.existsSync(canonical)) fail('AUTHORITY_MISSING', `terminal bundle is missing: ${canonical}`);
  const bundle = readJson(canonical, 'terminal bundle');
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)
      || TERMINAL_BUNDLE_REQUIRED_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(bundle, key))
      || Object.keys(bundle).some((key) => !TERMINAL_BUNDLE_KEYS.includes(key))) {
    fail('TERMINAL_BUNDLE_INVALID', 'terminal bundle keys are invalid');
  }
  if (bundle.schema_version !== 1 || bundle.artifact_type !== 'next_touch_terminal_bundle') {
    fail('TERMINAL_BUNDLE_INVALID', 'terminal bundle schema/artifact type is invalid');
  }
  if (!Number.isSafeInteger(bundle.min_panel_size) || bundle.min_panel_size < 3) {
    fail('TERMINAL_BUNDLE_INVALID', 'terminal bundle min_panel_size must be an integer >= 3');
  }
  validateSealedDigest(bundle, 'terminal bundle');
  if (!['reviewed_archived', 'integrated'].includes(bundle.integration_state)) {
    fail('INTEGRATION_STATE_INVALID', 'terminal bundle integration_state is invalid');
  }
  if (bundle.integration_state === 'reviewed_archived') {
    if (bundle.merge_receipt !== null) {
      fail('MERGE_RECEIPT_INVALID', 'reviewed_archived terminal bundle must not carry a merge receipt');
    }
  } else {
    if (!bundle.merge_receipt || typeof bundle.merge_receipt !== 'object'
        || Array.isArray(bundle.merge_receipt)) {
      fail('MERGE_RECEIPT_INVALID', 'integrated terminal bundle requires a merge receipt reference');
    }
    assertExactKeys(bundle.merge_receipt, ['path', 'receipt_digest'], 'merge receipt reference');
    assertDigest(bundle.merge_receipt.receipt_digest, 'merge receipt reference receipt_digest');
    const mergePath = assertAuthorityPath(
      path.isAbsolute(bundle.merge_receipt.path)
        ? bundle.merge_receipt.path
        : path.resolve(path.dirname(canonical), bundle.merge_receipt.path),
      repoInfo,
      'merge receipt',
    );
    if (!fs.existsSync(mergePath)) fail('AUTHORITY_MISSING', `merge receipt is missing: ${mergePath}`);
    const merge = readJson(mergePath, 'merge receipt');
    if (merge.receipt_digest !== bundle.merge_receipt.receipt_digest
        || mergeExecutor.verifyMergeExecutionReceipt(merge) !== true
        || merge.status !== 'complete') {
      fail('MERGE_RECEIPT_INVALID', 'integrated terminal bundle merge receipt is not a sealed complete execution');
    }
  }
  return { bundle, path: canonical };
}

function validateD8Publication(repo, candidate) {
  const names = gitText(repo, ['diff', '--name-only', `${D8_EVALUATED_SHA}..${D8_PUBLICATION_SHA}`])
    .split('\n').filter(Boolean).sort();
  if (JSON.stringify(names) !== JSON.stringify([D8_REPORT_PATH])) {
    fail('D8_PUBLICATION_DELTA_INVALID', 'D8 publication must contain only the frozen evidence report');
  }
  assertAncestor(repo, D8_EVALUATED_SHA, D8_PUBLICATION_SHA, 'D8_PUBLICATION_ANCESTRY_INVALID');
  assertAncestor(repo, D8_PUBLICATION_SHA, candidate, 'CANDIDATE_NOT_DESCENDANT_OF_D8');
  const reportText = readGitFile(repo, D8_PUBLICATION_SHA, D8_REPORT_PATH);
  const report = (() => {
    try { return JSON.parse(reportText); } catch (error) {
      fail('D8_REPORT_INVALID', `D8 report is not JSON: ${error.message}`);
    }
  })();
  if (report.base_sha !== REVIEW_BASE_SHA || report.candidate_sha !== D8_EVALUATED_SHA
      || report.mode !== 'live' || report.decision === 'indeterminate') {
    fail('D8_REPORT_INVALID', 'D8 report does not bind the frozen evaluated/review base');
  }
  return { report, report_sha256: sha256(reportText) };
}

function assertFrozenEvidenceBytes(candidateText, frozenText, relative, label) {
  const expectedSha = FROZEN_EVIDENCE_SHA256[relative];
  if (!expectedSha) fail('EVIDENCE_PIN_INVALID', `${label} has no frozen digest`);
  if (sha256(frozenText) !== expectedSha
      || sha256(candidateText) !== expectedSha
      || candidateText !== frozenText) {
    fail('EVIDENCE_PIN_INVALID', `${label} bytes differ from the frozen D8 publication tree`);
  }
  return candidateText;
}

function assertFrozenEvidenceBlob(repo, candidate, relative, label) {
  return assertFrozenEvidenceBytes(
    readGitFile(repo, candidate, relative),
    readGitFile(repo, D8_PUBLICATION_SHA, relative),
    relative,
    label,
  );
}

function validateD8PublicationRebind(bundle, loaded, repoInfo, authorization, prepared, frozen, missionTerminal, campaignTerminal, iccTerminal) {
  if (!bundle.d8_publication_rebind_receipt
      || typeof bundle.d8_publication_rebind_receipt !== 'object'
      || Array.isArray(bundle.d8_publication_rebind_receipt)) {
    fail('D8_REBIND_MISSING', 'D8 publication rebind receipt is required');
  }
  const ref = resolveAuthorityRef(
    bundle.d8_publication_rebind_receipt,
    'D8 publication rebind receipt',
    repoInfo,
    loaded.path,
  );
  assertExactKeys(ref.value, D8_REBIND_KEYS, 'D8 publication rebind receipt');
  const body = validateSealedDigest(ref.value, 'D8 publication rebind receipt');
  if (body.schema_version !== 1 || body.artifact_type !== 'd8_publication_rebind_receipt'
      || body.repo_identity !== repoInfo.repo_identity
      || body.mission_lineage_id !== authorization.mission_lineage_id
      || body.task_authority_id !== prepared.task_authority_id
      || body.authorized_branch !== authorization.branch
      || body.review_base_sha !== REVIEW_BASE_SHA
      || body.evaluated_sha !== D8_EVALUATED_SHA
      || body.publication_sha !== D8_PUBLICATION_SHA
      || body.publication_report_sha256 !== frozen.d8.report_sha256
      || body.candidate_ref !== bundle.candidate_ref
      || !HEAD_REF.test(body.candidate_ref || '')
      || body.candidate_sha !== frozen.candidate
      || body.candidate_tree_sha !== frozen.candidateTree
      || body.mission_terminal_receipt_digest !== missionTerminal.receipt_digest
      || body.campaign_terminal_receipt_digest !== campaignTerminal.receipt_digest
      || body.icc_terminal_receipt_digest !== iccTerminal.receipt_digest
      || gitObject(repoInfo.repo, body.candidate_ref) !== frozen.candidate) {
    fail('D8_REBIND_INVALID', 'D8 publication rebind does not bind authority, evidence, or candidate');
  }
  return { body, path: ref.file };
}

function runEvidenceGate(repo, script, argv, code) {
  const result = spawnSync(process.execPath, [path.join(repo, script), ...argv], {
    cwd: repo,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail(code, `${script} rejected evidence: ${String(result.stderr || result.error || '').trim()}`);
  }
}

function runCandidateEvidenceGates(repo, candidate, bundle, candidateTree) {
  const source = integrationWorktree(bundle.source_worktree, { common: runtime.canonicalRepository(repo).common }, 'candidate evidence worktree');
  if (!HEAD_REF.test(bundle.candidate_ref || '')
      || gitObject(source, bundle.candidate_ref) !== candidate
      || gitObject(source, 'HEAD') !== candidate
      || gitText(source, ['rev-parse', 'HEAD^{tree}']) !== candidateTree) {
    fail('CANDIDATE_WORKTREE_DRIFT', 'candidate evidence worktree ref, HEAD, or tree does not match the frozen candidate');
  }
  const regularCandidatePaths = [
    'scripts/validate-grok-implementer-ab.js',
    'scripts/validate-hook-multiplexer-benchmark.js',
    'evals/grok-implementer-ab/seed.json',
    'evals/grok-implementer-ab/tasks.json',
    'hooks/tests/fixtures/hook-multiplexer-benchmark.json',
    D8_REPORT_PATH,
    D6_REPORT_PATH,
  ];
  for (const relative of regularCandidatePaths) {
    const tree = String(git(repo, ['ls-tree', '-z', candidate, '--', relative], true).stdout || '');
    const mode = tree.split(/[\s\0]/u)[0];
    if (!['100644', '100755'].includes(mode)) {
      fail('EVIDENCE_INVALID', `candidate evidence path is not a regular file: ${relative}`);
    }
  }
  requireCleanIntegrationWorktree(source, 'candidate evidence worktree');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'next-touch-evidence-'));
  let failure = null;
  try {
    const reportBytes = (relative) => {
      const type = gitText(repo, ['cat-file', '-t', `${candidate}:${relative}`]);
      if (type !== 'blob') fail('EVIDENCE_INVALID', `candidate evidence path is not a regular blob: ${relative}`);
      return readGitFile(repo, candidate, relative);
    };
    const d8Report = path.join(temporary, 'grok-implementer-ab.json');
    const d6Report = path.join(temporary, 'hook-multiplexer-benchmark.json');
    fs.writeFileSync(d8Report, reportBytes(D8_REPORT_PATH), { mode: 0o600 });
    fs.writeFileSync(d6Report, reportBytes(D6_REPORT_PATH), { mode: 0o600 });
    runEvidenceGate(source, 'scripts/validate-grok-implementer-ab.js', ['--report', d8Report], 'D8_REPORT_INVALID');
    runEvidenceGate(source, 'scripts/validate-hook-multiplexer-benchmark.js', [d6Report], 'D6_REPORT_INVALID');
  } catch (error) {
    failure = error;
  }
  try {
    fs.rmSync(temporary, { recursive: true, force: true });
  } catch (error) {
    fail('EVIDENCE_TEMP_CLEANUP_FAILED', `candidate evidence temp cleanup failed: ${error.message}`);
  }
  if (failure) throw failure;
  if (gitObject(source, bundle.candidate_ref) !== candidate
      || gitObject(source, 'HEAD') !== candidate
      || gitText(source, ['rev-parse', 'HEAD^{tree}']) !== candidateTree) {
    fail('CANDIDATE_WORKTREE_DRIFT', 'candidate evidence worktree drifted during evidence validation');
  }
  requireCleanIntegrationWorktree(source, 'candidate evidence worktree');
}

function validateTerminalIdentity(args, repoInfo, authorization, source, loaded) {
  const { bundle } = loaded;
  if (bundle.repo_identity !== repoInfo.repo_identity
      || bundle.mission_lineage_id !== authorization.mission_lineage_id) {
    fail('TERMINAL_IDENTITY_MISMATCH', 'terminal bundle repository/lineage binding is invalid');
  }
  const admission = args.admission_base || bundle.admission_base_sha;
  const review = args.review_base || args.base;
  const candidateArg = args.candidate;
  if (admission !== ADMISSION_BASE_SHA || bundle.admission_base_sha !== admission) {
    fail('ADMISSION_BASE_MISMATCH', 'terminal bundle admission base is not the frozen f680 base');
  }
  if (review !== REVIEW_BASE_SHA || bundle.review_base_sha !== review || review === admission) {
    fail('REVIEW_BASE_MISMATCH', 'terminal bundle review base is not the distinct frozen 1f9 base');
  }
  if (bundle.d8_evaluated_sha !== D8_EVALUATED_SHA
      || bundle.d8_publication_sha !== D8_PUBLICATION_SHA) {
    fail('D8_REBIND_INVALID', 'terminal bundle D8 evaluated/publication SHAs are not frozen');
  }
  if (!GIT_OID.test(candidateArg || '') || bundle.candidate_sha !== candidateArg) {
    fail('CANDIDATE_BINDING_INVALID', 'terminal bundle candidate SHA does not match CLI');
  }
  if (!HEAD_REF.test(bundle.candidate_ref || '')) {
    fail('CANDIDATE_BINDING_INVALID', 'terminal bundle candidate_ref must be an exact refs/heads/* name');
  }
  const candidate = gitObject(repoInfo.repo, candidateArg);
  if (candidate !== candidateArg) fail('CANDIDATE_BINDING_INVALID', 'candidate SHA is not Git truth');
  const candidateTree = gitText(repoInfo.repo, [`rev-parse`, `${candidate}^{tree}`]);
  if (!GIT_OID.test(bundle.candidate_tree_sha || '') || bundle.candidate_tree_sha !== candidateTree) {
    fail('CANDIDATE_TREE_MISMATCH', 'terminal bundle candidate tree does not match Git');
  }
  if (!SHA256.test(bundle.source_plan_sha256 || '') || bundle.source_plan_sha256 !== source.planSha) {
    fail('SOURCE_PLAN_RUBRIC_MISMATCH', 'terminal bundle plan digest is not the active source digest');
  }
  if (!SHA256.test(bundle.source_rubric_sha256 || '') || bundle.source_rubric_sha256 !== source.rubricSha) {
    fail('SOURCE_PLAN_RUBRIC_MISMATCH', 'terminal bundle rubric digest is not the active source digest');
  }
  const candidatePlan = sha256(readGitFile(repoInfo.repo, candidate, PLAN_PATH));
  const candidateRubric = sha256(readGitFile(repoInfo.repo, candidate, RUBRIC_PATH));
  if (candidatePlan !== source.planSha || candidateRubric !== source.rubricSha) {
    fail('SOURCE_PLAN_RUBRIC_MISMATCH', 'candidate plan/rubric bytes drift from the frozen source');
  }
  assertAncestor(repoInfo.repo, admission, candidate, 'ADMISSION_BASE_ANCESTRY_INVALID');
  assertAncestor(repoInfo.repo, review, candidate, 'REVIEW_BASE_ANCESTRY_INVALID');
  const d8 = validateD8Publication(repoInfo.repo, candidate);
  if (d8.report_sha256 !== FROZEN_EVIDENCE_SHA256[D8_REPORT_PATH]) {
    fail('D8_REPORT_INVALID', 'frozen D8 publication report digest is not the admitted evidence');
  }
  assertFrozenEvidenceBlob(repoInfo.repo, candidate, D8_REPORT_PATH, 'D8 report');
  for (const [relative, label] of [
    [D6_REPORT_PATH, 'D6 report'],
    ['scripts/validate-hook-multiplexer-benchmark.js', 'D6 validator'],
    ['hooks/tests/fixtures/hook-multiplexer-benchmark.json', 'D6 fixture'],
    ['scripts/validate-grok-implementer-ab.js', 'D8 validator'],
    ['evals/grok-implementer-ab/seed.json', 'D8 seed'],
    ['evals/grok-implementer-ab/tasks.json', 'D8 tasks'],
  ]) assertFrozenEvidenceBlob(repoInfo.repo, candidate, relative, label);
  runCandidateEvidenceGates(repoInfo.repo, candidate, bundle, candidateTree);
  return { bundle, candidate, candidateTree, admission, review, d8 };
}

function resolveAuthorityRef(value, label, repoInfo, bundlePath) {
  let requested = value;
  let expectedDigest = null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    assertExactKeys(value, ['path', 'receipt_digest'], `${label} reference`);
    requested = value.path;
    expectedDigest = value.receipt_digest;
    assertDigest(expectedDigest, `${label} reference receipt_digest`);
  }
  if (typeof requested !== 'string' || requested.length === 0) {
    fail('RECEIPT_REF_INVALID', `${label} must name an authority-store file`);
  }
  const file = assertAuthorityPath(
    path.isAbsolute(requested) ? requested : path.resolve(path.dirname(bundlePath), requested),
    repoInfo,
    label,
  );
  if (!fs.existsSync(file)) fail('AUTHORITY_MISSING', `${label} is missing: ${file}`);
  const loaded = readJson(file, label);
  if (expectedDigest !== null && loaded.receipt_digest !== expectedDigest) {
    fail('RECEIPT_REF_DIGEST_INVALID', `${label} reference digest does not match the sealed receipt`);
  }
  return { file, value: loaded, expectedDigest };
}

function validatePreparedAndMissionState(bundle, loaded, repoInfo, authorization, frozen) {
  const preparedRef = resolveAuthorityRef(bundle.prepared_receipt, 'prepared receipt', repoInfo, loaded.path);
  const stateRef = resolveAuthorityRef(bundle.mission_state, 'Mission state', repoInfo, loaded.path);
  let prepared;
  try {
    prepared = runtime.validatePreparedReceipt(preparedRef.value, repoInfo);
  } catch (error) {
    fail(error.code || 'PREPARED_AUTHORITY_INVALID', error.message);
  }
  let state = stateRef.value;
  try { mission.validateMissionState(state); } catch (error) {
    fail('MISSION_STATE_INVALID', error.message);
  }
  if (path.resolve(stateRef.file) !== path.resolve(prepared.paths.state)
      || (prepared.state && canonicalJson(prepared.state) !== canonicalJson(state))) {
    fail('MISSION_STATE_BINDING_MISMATCH', 'Mission state differs from the prepared receipt state');
  }
  if (state.mission_lineage_id !== authorization.mission_lineage_id
      || state.mission_policy_digest !== authorization.mission_policy_digest
      || state.mission_graph_digest !== authorization.mission_graph_digest
      || prepared.value.mission_lineage_id !== authorization.mission_lineage_id) {
    fail('MISSION_BINDING_MISMATCH', 'terminal Mission state does not bind authorization');
  }
  if (state.state !== 'COMPLETE' || !state.terminal || state.terminal.state !== 'COMPLETE') {
    fail('MISSION_NOT_READY', `terminal Mission state is ${state.state}`);
  }
  return { prepared: prepared.value, state, preparedRef, stateRef, frozen };
}

function validateMissionTerminalReceipt(receipt, state, authorization) {
  let expected;
  try {
    expected = mission.buildMissionTerminalReceipt(state, receipt.residue);
  } catch (error) {
    fail('MISSION_TERMINAL_INVALID', error.message);
  }
  if (canonicalJson(expected) !== canonicalJson(receipt)
      || receipt.artifact_type !== 'mission_terminal_receipt'
      || receipt.mission_terminal !== true) {
    fail('MISSION_TERMINAL_DIGEST_INVALID', 'Mission terminal receipt is not the canonical receipt for state');
  }
  if (state.mission_lineage_id !== authorization.mission_lineage_id) {
    fail('MISSION_TERMINAL_BINDING_MISMATCH', 'Mission terminal lineage does not match authorization');
  }
  return receipt;
}

function validateImplementationTerminalReceipt(receipt, candidateTree) {
  assertExactKeys(receipt, IMPLEMENTATION_TERMINAL_KEYS, 'ICC terminal receipt');
  const body = validateSealedDigest(receipt, 'ICC terminal receipt');
  if (body.artifact_type !== 'implementation_campaign_terminal'
      || body.status !== 'ready'
      || body.candidate_tree_sha !== candidateTree
      || !SHA256.test(body.verification_receipt_digest || '')
      || body.lifecycle_receipt_ref === 'unknown'
      || !Array.isArray(body.follow_up) || body.follow_up.length !== 0
      || !Array.isArray(body.unresolved_final_findings) || body.unresolved_final_findings.length !== 0
      || !Array.isArray(body.rejected_findings)
      || !Number.isSafeInteger(body.sealed_min_panel_size)
      || !Number.isSafeInteger(body.final_panel_count)
      || !Array.isArray(body.final_panel_seat_receipts)) {
    fail('ICC_TERMINAL_NOT_READY', 'ICC terminal receipt is not a ready, fully adjudicated receipt');
  }
  if (!Number.isSafeInteger(body.repair_generations) || body.repair_generations < 0
      || !Array.isArray(body.trace)) {
    fail('ICC_TERMINAL_NOT_READY', 'ICC terminal receipt replay metadata is invalid');
  }
  if (body.lifecycle_receipt_ref === 'unknown'
      || !body.lifecycle_receipt_ref || typeof body.lifecycle_receipt_ref !== 'object'
      || Array.isArray(body.lifecycle_receipt_ref)) {
    fail('ICC_TERMINAL_NOT_READY', 'ICC terminal lifecycle receipt reference is required');
  }
  assertExactKeys(body.lifecycle_receipt_ref, ['path', 'root_run_id', 'receipt_digest'], 'ICC lifecycle receipt reference');
  assertDigest(body.lifecycle_receipt_ref.receipt_digest, 'ICC lifecycle receipt reference receipt_digest');
  const panel = composition.validateFinalPanelReceipt({
    reviewed: true,
    sealed_min_panel_size: body.sealed_min_panel_size,
    final_panel_count: body.final_panel_count,
    final_panel_seat_receipts: body.final_panel_seat_receipts,
  }, body.sealed_min_panel_size);
  if (panel.passed !== true || panel.final_panel_count < 3) {
    fail('FINAL_PANEL_INVALID', panel.reason || 'final panel minimum is three reviewed seats');
  }
  return body;
}

function validateCampaignRuntimeTerminalReceipt(receipt, state, authorization) {
  const body = validateSealedDigest(receipt, 'Mission campaign terminal receipt', (value) => sha256(canonicalJson(value)));
  if (body.artifact_type !== 'campaign_terminal_receipt'
      || body.outcome !== 'ready'
      || body.mission_lineage_id !== authorization.mission_lineage_id
      || body.graph_node_id !== authorization.graph_node_id
      || body.possibly_effectful !== true) {
    fail('CAMPAIGN_TERMINAL_NOT_READY', 'Mission campaign terminal receipt is not ready or is misbound');
  }
  let canonicalApplication;
  try { canonicalApplication = mission.applyMissionCampaignReceipt(state, receipt); }
  catch (error) { fail('CAMPAIGN_TERMINAL_INVALID', error.message); }
  if (!canonicalApplication
      || !new Set(['replay_noop', 'applied']).has(canonicalApplication.status)) {
    fail('CAMPAIGN_TERMINAL_INVALID', 'Mission campaign terminal receipt is not canonically accepted by the reducer');
  }
  const claim = state.claims && state.claims[body.claim_id];
  if (!claim || claim.campaign_id !== body.campaign_id || claim.terminal !== true) {
    fail('CAMPAIGN_TERMINAL_BINDING_MISMATCH', 'campaign terminal claim is not the canonical terminal claim');
  }
  return body;
}

function validateIccLedger(bundle, loaded, repoInfo, iccTerminal, frozen) {
  const ledgerRef = resolveAuthorityRef(bundle.ledger_path, 'ICC campaign ledger', repoInfo, loaded.path);
  let rows;
  try { rows = campaignCli.loadRows(ledgerRef.file); } catch (error) {
    fail('ICC_AUTHORITY_INVALID', error.message);
  }
  const campaignId = bundle.campaign_id;
  if (typeof campaignId !== 'string' || !/^campaign-v1-[0-9a-f]{64}$/u.test(campaignId)) {
    fail('ICC_AUTHORITY_INVALID', 'ICC campaign_id is required and must be campaign-v1');
  }
  let projection;
  try { projection = campaignCli.projectCampaign(rows, campaignId); } catch (error) {
    fail('ICC_AUTHORITY_INVALID', error.message);
  }
  if (!projection || projection.state.phase !== 'TERMINAL_READY'
      || projection.lifecycle_receipt_ref === 'unknown'
      || !projection.candidate_reference
      || projection.candidate_reference.kind !== 'git_candidate') {
    fail('ICC_TERMINAL_NOT_READY', 'ICC ledger projection is not terminal-ready with a candidate');
  }
  if (canonicalJson(projection.lifecycle_receipt_ref)
      !== canonicalJson(iccTerminal.lifecycle_receipt_ref)) {
    fail('ICC_LIFECYCLE_BINDING_MISMATCH', 'ICC terminal lifecycle receipt differs from ledger projection');
  }
  const lifecyclePath = assertAuthorityPath(
    path.isAbsolute(iccTerminal.lifecycle_receipt_ref.path)
      ? iccTerminal.lifecycle_receipt_ref.path
      : path.resolve(path.dirname(ledgerRef.file), iccTerminal.lifecycle_receipt_ref.path),
    repoInfo,
    'ICC lifecycle receipt',
  );
  if (iccTerminal.lifecycle_receipt_ref.root_run_id !== campaignId
      || !fs.existsSync(lifecyclePath)) {
    fail('ICC_LIFECYCLE_BINDING_MISMATCH', 'ICC lifecycle receipt is missing or has the wrong campaign id');
  }
  const lifecycleReceipt = readJson(lifecyclePath, 'ICC lifecycle receipt');
  if (lifecycleReceipt.receipt_digest !== iccTerminal.lifecycle_receipt_ref.receipt_digest) {
    fail('ICC_LIFECYCLE_BINDING_MISMATCH', 'ICC lifecycle receipt digest differs from its sealed reference');
  }
  try { validateSealedDigest(lifecycleReceipt, 'ICC lifecycle receipt'); }
  catch (error) { fail('ICC_LIFECYCLE_BINDING_MISMATCH', error.message); }
  if (projection.candidate_reference.commit !== frozen.candidate
      || projection.candidate_reference.tree_sha !== frozen.candidateTree
      || projection.candidate_reference.base !== frozen.review) {
    fail('ICC_CANDIDATE_BINDING_MISMATCH', 'ICC candidate reference does not match terminal candidate');
  }
  return { campaignId, projection, ledgerRef };
}

function integrationWorktree(worktree, repoInfo, label) {
  if (typeof worktree !== 'string' || !path.isAbsolute(worktree)) {
    fail('INTEGRATION_WORKTREE_INVALID', `${label} must be an absolute path`);
  }
  let resolved;
  try { resolved = fs.realpathSync(worktree); } catch (error) {
    fail('INTEGRATION_WORKTREE_INVALID', `${label} cannot be resolved: ${error.message}`);
  }
  const top = gitText(resolved, ['rev-parse', '--show-toplevel']);
  let topReal;
  try { topReal = fs.realpathSync(top); } catch (error) {
    fail('INTEGRATION_WORKTREE_INVALID', `${label} has no canonical Git root: ${error.message}`);
  }
  if (topReal !== resolved) fail('INTEGRATION_WORKTREE_INVALID', `${label} is not an exact worktree root`);
  const common = gitText(resolved, ['rev-parse', '--git-common-dir']);
  let commonReal;
  try { commonReal = fs.realpathSync(path.isAbsolute(common) ? common : path.resolve(resolved, common)); }
  catch (error) { fail('INTEGRATION_WORKTREE_INVALID', `${label} has no canonical common-dir: ${error.message}`); }
  if (commonReal !== repoInfo.common) fail('INTEGRATION_WORKTREE_INVALID', `${label} is outside the declared repository`);
  return resolved;
}

function validatePathPrefix(prefix) {
  return typeof prefix === 'string'
    && prefix.length > 0
    && prefix.endsWith('/')
    && !path.isAbsolute(prefix)
    && !prefix.split('/').includes('..')
    && prefix.replace(/\\/g, '/') === prefix;
}

function requireCleanIntegrationWorktree(worktree, label) {
  const dirty = {
    staged: gitText(worktree, ['diff', '--cached', '--name-only']),
    unstaged: gitText(worktree, ['diff', '--name-only']),
    untracked: gitText(worktree, ['ls-files', '--others', '--exclude-standard']),
    ambiguous: gitText(worktree, ['diff', '--name-only', '--diff-filter=U']),
  };
  if (Object.values(dirty).some((value) => value.length > 0)) {
    fail('INTEGRATION_WORKTREE_DIRTY', `${label} must be clean before integration`);
  }
}

function validateIntegrationPreconditions(bundle, args, repoInfo, frozen) {
  if (typeof bundle.candidate_ref !== 'string' || !HEAD_REF.test(bundle.candidate_ref)) {
    fail('INTEGRATION_AUTHORITY_INVALID', 'candidate_ref must be an exact refs/heads/* name');
  }
  if (!GIT_OID.test(bundle.develop_sha || '')) {
    fail('INTEGRATION_AUTHORITY_INVALID', 'develop_sha must be an immutable commit');
  }
  const currentDevelop = gitObject(repoInfo.repo, 'refs/heads/develop');
  if (currentDevelop !== bundle.develop_sha) {
    fail('DEVELOP_TIP_DRIFT', 'develop tip changed since terminal review');
  }
  if (!Array.isArray(bundle.allowed_path_prefixes)
      || bundle.allowed_path_prefixes.some((prefix) => !validatePathPrefix(prefix))
      || new Set(bundle.allowed_path_prefixes).size !== bundle.allowed_path_prefixes.length) {
    fail('INTEGRATION_AUTHORITY_INVALID', 'allowed_path_prefixes must be unique normalized relative prefixes');
  }
  const source = integrationWorktree(bundle.source_worktree, repoInfo, 'source_worktree');
  const target = integrationWorktree(args.integrate_worktree, repoInfo, 'integrate_worktree');
  if (source === target) fail('INTEGRATION_WORKTREE_INVALID', 'source and target worktrees must differ');
  const sourceSha = gitObject(source, bundle.candidate_ref);
  const sourceHead = gitObject(source, 'HEAD');
  if (sourceSha !== frozen.candidate || sourceHead !== frozen.candidate) {
    fail('CANDIDATE_WORKTREE_DRIFT', 'source worktree ref/HEAD does not match frozen candidate');
  }
  const targetRef = 'refs/heads/develop';
  const targetSha = gitObject(target, targetRef);
  const targetHead = gitObject(target, 'HEAD');
  const symbolic = gitText(target, ['symbolic-ref', '-q', 'HEAD']);
  if (targetSha !== bundle.develop_sha || targetHead !== bundle.develop_sha || symbolic !== targetRef) {
    fail('DEVELOP_WORKTREE_DRIFT', 'integration worktree ref/HEAD is not the frozen develop tip');
  }
  requireCleanIntegrationWorktree(source, 'source_worktree');
  requireCleanIntegrationWorktree(target, 'integrate_worktree');
  let sealed;
  try {
    sealed = mergeIntent.buildMergeIntent({
      repo: repoInfo.repo,
      root_run_id: bundle.campaign_id,
      edges: [{
        source_ref: bundle.candidate_ref,
        source_worktree: source,
        target_ref: targetRef,
        target_worktree: target,
        mode: 'ff-only',
        required_result: 'source-contained',
      }],
      forbidden_reverse_edges: [{ source_ref: targetRef, target_ref: bundle.candidate_ref }],
      preservation_policy: { allowed_path_prefixes: bundle.allowed_path_prefixes },
    });
  } catch (error) {
    fail('INTEGRATION_INTENT_INVALID', error.message);
  }
  const preflight = mergeIntent.preflightMergeIntent(sealed);
  if (!preflight || preflight.can_merge !== true || preflight.status !== 'safe') {
    const reason = preflight && preflight.blockers && preflight.blockers[0]
      ? preflight.blockers[0].reason : 'preflight_invalid';
    if (reason === 'ff_only_not_possible') fail('FF_ONLY_NOT_POSSIBLE', 'sole ff-only integration is not possible');
    fail('INTEGRATION_PREFLIGHT_BLOCKED', `integration preflight is ${reason}`);
  }
  return { source_worktree: source, target_worktree: target, sealed, preflight };
}

function strictMergeReceiptRef(bundle, bundlePath, repoInfo) {
  if (!bundle.merge_receipt || typeof bundle.merge_receipt !== 'object'
      || Array.isArray(bundle.merge_receipt)) {
    fail('MERGE_RECEIPT_INVALID', 'integrated terminal bundle requires a merge receipt reference');
  }
  assertExactKeys(bundle.merge_receipt, ['path', 'receipt_digest'], 'merge receipt reference');
  assertDigest(bundle.merge_receipt.receipt_digest, 'merge receipt reference receipt_digest');
  const file = assertAuthorityPath(
    path.isAbsolute(bundle.merge_receipt.path)
      ? bundle.merge_receipt.path
      : path.resolve(path.dirname(bundlePath), bundle.merge_receipt.path),
    repoInfo,
    'merge receipt',
  );
  if (!fs.existsSync(file)) fail('AUTHORITY_MISSING', `merge receipt is missing: ${file}`);
  const receipt = readJson(file, 'merge receipt');
  if (receipt.receipt_digest !== bundle.merge_receipt.receipt_digest
      || mergeExecutor.verifyMergeExecutionReceipt(receipt) !== true
      || receipt.status !== 'complete') {
    fail('MERGE_RECEIPT_INVALID', 'merge receipt is not a sealed complete execution');
  }
  return { file, receipt };
}

function validateMergeExecution(receipt, sealed, bundle, preconditions, frozen) {
  if (mergeExecutor.verifyMergeExecutionReceipt(receipt) !== true
      || receipt.artifact_type !== 'merge_execution_receipt'
      || receipt.status !== 'complete'
      || receipt.manifest_seal !== sealed.seal
      || receipt.root_run_id !== bundle.campaign_id
      || !Array.isArray(receipt.edges) || receipt.edges.length !== 1) {
    fail('MERGE_RECEIPT_INVALID', 'merge execution receipt is not the sealed one-edge campaign execution');
  }
  const edge = receipt.edges[0];
  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
    fail('MERGE_RECEIPT_INVALID', 'merge execution receipt edge is invalid');
  }
  const intentEdge = sealed.manifest.edges[0];
  const sourceExpected = edge.source_validation
    && (edge.source_validation.expected_sha || edge.source_validation.expectedSha);
  const targetExpected = edge.target_validation
    && (edge.target_validation.expected_sha || edge.target_validation.expectedSha);
  if (edge.status !== 'executed' || edge.mode !== 'ff-only'
      || edge.source_ref !== intentEdge.source_ref || edge.target_ref !== intentEdge.target_ref
      || edge.before_sha !== intentEdge.target_sha || edge.after_sha !== frozen.candidate
      || edge.merge_commit !== null || sourceExpected !== frozen.candidate
      || targetExpected !== intentEdge.target_sha
      || preconditions.preflight.can_merge !== true) {
    fail('MERGE_RECEIPT_INVALID', 'merge execution edge does not match the frozen ff-only candidate');
  }
  return { receipt, edge };
}

function validateIntegratedExecution(receipt, bundle, args, repoInfo, frozen) {
  if (mergeExecutor.verifyMergeExecutionReceipt(receipt) !== true
      || receipt.artifact_type !== 'merge_execution_receipt'
      || receipt.status !== 'complete' || receipt.root_run_id !== bundle.campaign_id
      || !Array.isArray(receipt.edges) || receipt.edges.length !== 1) {
    fail('MERGE_RECEIPT_INVALID', 'integrated merge receipt is not a sealed one-edge execution');
  }
  if (!HEAD_REF.test(bundle.candidate_ref || '')) {
    fail('INTEGRATION_AUTHORITY_INVALID', 'integrated candidate_ref must be an exact refs/heads/* name');
  }
  const edge = receipt.edges[0];
  if (!edge || typeof edge !== 'object' || Array.isArray(edge)) {
    fail('MERGE_RECEIPT_INVALID', 'integrated merge receipt edge is invalid');
  }
  const sourceExpected = edge.source_validation
    && (edge.source_validation.expected_sha || edge.source_validation.expectedSha);
  const targetExpected = edge.target_validation
    && (edge.target_validation.expected_sha || edge.target_validation.expectedSha);
  if (edge.status !== 'executed' || edge.mode !== 'ff-only'
      || edge.source_ref !== bundle.candidate_ref || edge.target_ref !== 'refs/heads/develop'
      || edge.before_sha !== bundle.develop_sha || edge.after_sha !== frozen.candidate
      || edge.merge_commit !== null || sourceExpected !== frozen.candidate
      || targetExpected !== bundle.develop_sha) {
    fail('MERGE_RECEIPT_INVALID', 'integrated merge receipt edge does not match the frozen candidate');
  }
  const source = integrationWorktree(bundle.source_worktree, repoInfo, 'source_worktree');
  const target = integrationWorktree(args.integrate_worktree, repoInfo, 'integrate_worktree');
  if (source === target) fail('INTEGRATION_WORKTREE_INVALID', 'source and target worktrees must differ');
  if (gitObject(source, bundle.candidate_ref) !== frozen.candidate
      || gitObject(source, 'HEAD') !== frozen.candidate
      || gitObject(target, 'HEAD') !== frozen.candidate
      || gitText(target, ['symbolic-ref', '-q', 'HEAD']) !== 'refs/heads/develop') {
    fail('INTEGRATION_WORKTREE_DRIFT', 'integrated source/target worktrees drifted from the sealed receipt');
  }
  requireCleanIntegrationWorktree(source, 'source_worktree');
  requireCleanIntegrationWorktree(target, 'integrate_worktree');
  if (!Array.isArray(bundle.allowed_path_prefixes)
      || bundle.allowed_path_prefixes.some((prefix) => !validatePathPrefix(prefix))) {
    fail('INTEGRATION_AUTHORITY_INVALID', 'integrated allowed_path_prefixes are invalid');
  }
  const manifest = {
    schema_version: 1,
    artifact_type: 'merge_intent_manifest',
    repo: repoInfo.repo,
    root_run_id: bundle.campaign_id,
    edges: [{
      sequence: 1,
      source_ref: bundle.candidate_ref,
      source_worktree: source,
      source_sha: frozen.candidate,
      source_from_edge: null,
      target_ref: 'refs/heads/develop',
      target_worktree: target,
      target_sha: bundle.develop_sha,
      target_from_edge: null,
      mode: 'ff-only',
      required_result: 'source-contained',
    }],
    forbidden_reverse_edges: [{
      source_ref: 'refs/heads/develop', target_ref: bundle.candidate_ref,
    }],
    preservation_policy: {
      allowed_path_prefixes: [...new Set(bundle.allowed_path_prefixes)].sort(),
    },
  };
  if (receipt.manifest_seal !== canonicalDigest(manifest)) {
    fail('MERGE_RECEIPT_INVALID', 'integrated receipt manifest is not the authorized intent');
  }
  return { source_worktree: source, target_worktree: target, edge, receipt };
}

function safeCommit(worktree, ref) {
  const result = git(worktree, ['rev-parse', '--verify', `${ref}^{commit}`], true);
  return result.status === 0 ? String(result.stdout || '').trim() : null;
}

function integrationTargetSnapshot(worktree) {
  return {
    ref: safeCommit(worktree, 'refs/heads/develop'),
    head: safeCommit(worktree, 'HEAD'),
    symbolic: String(git(worktree, ['symbolic-ref', '-q', 'HEAD'], true).stdout || '').trim(),
    dirty: [
      git(worktree, ['status', '--porcelain=v1'], true),
      git(worktree, ['diff', '--name-only'], true),
      git(worktree, ['diff', '--cached', '--name-only'], true),
    ].some((result) => result.status !== 0 || String(result.stdout || '').trim().length > 0),
  };
}

function restoreExactBytes(file, bytes) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.rollback-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.unlinkSync(temporary); } catch (_error) { /* already renamed */ }
  }
}

function restoreIntegrationTarget(worktree, beforeSha) {
  const reset = git(worktree, ['reset', '--hard', beforeSha], true);
  if (reset.status !== 0) return false;
  const snapshot = integrationTargetSnapshot(worktree);
  return snapshot.ref === beforeSha
    && snapshot.head === beforeSha
    && snapshot.symbolic === 'refs/heads/develop'
    && snapshot.dirty === false;
}

function restoreIntegrationAuthority(file, existed, originalBytes) {
  if (existed) {
    if (!fs.existsSync(file) || !Buffer.from(fs.readFileSync(file)).equals(originalBytes)) {
      restoreExactBytes(file, originalBytes);
    }
    return;
  }
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

function executeAuthorizedIntegration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    fail('INTEGRATION_REQUEST_INVALID', 'integration request must be an object');
  }
  const { bundle, bundlePath, repoInfo, frozen, args } = input;
  if (!bundle || !repoInfo || !frozen || typeof bundlePath !== 'string') {
    fail('INTEGRATION_REQUEST_INVALID', 'integration request is missing bundle, path, repository, or frozen candidate');
  }
  const canonicalBundlePath = assertAuthorityPath(path.resolve(bundlePath), repoInfo, 'terminal bundle');
  if (bundle.integration_state === 'integrated') {
    const existing = strictMergeReceiptRef(bundle, canonicalBundlePath, repoInfo);
    const checked = validateIntegratedExecution(existing.receipt, bundle, args, repoInfo, frozen);
    return { status: 'already_integrated', receipt_path: existing.file, receipt: checked.receipt };
  }
  if (bundle.integration_state !== 'reviewed_archived' || bundle.merge_receipt !== null) {
    fail('INTEGRATION_STATE_INVALID', 'integration starts only from reviewed_archived with no merge receipt');
  }
  const preconditions = input.preconditions || validateIntegrationPreconditions(bundle, args, repoInfo, frozen);
  const { sealed, preflight } = preconditions;
  if (!mergeIntent.verifyMergeIntentSeal(sealed)
      || !sealed.manifest || sealed.manifest.edges.length !== 1
      || sealed.manifest.edges[0].mode !== 'ff-only'
      || sealed.manifest.edges[0].required_result !== 'source-contained'
      || !preflight || preflight.can_merge !== true || preflight.status !== 'safe') {
    fail('INTEGRATION_PREFLIGHT_BLOCKED', 'only a sealed safe one-edge ff-only preflight may execute');
  }
  const intentEdge = sealed.manifest.edges[0];
  const target = preconditions.target_worktree;
  const beforeSha = bundle.develop_sha;
  if (intentEdge.target_ref !== 'refs/heads/develop'
      || intentEdge.target_sha !== beforeSha
      || safeCommit(target, 'refs/heads/develop') !== beforeSha
      || safeCommit(target, 'HEAD') !== beforeSha
      || String(git(target, ['symbolic-ref', '-q', 'HEAD'], true).stdout || '').trim() !== 'refs/heads/develop') {
    fail('DEVELOP_WORKTREE_DRIFT', 'integration target drifted before execution');
  }
  const receiptDir = path.join(canonicalAuthorityRoot(repoInfo), 'next-touch-debt-retirement');
  const receiptPath = path.join(
    receiptDir,
    `merge-execution-${bundle.campaign_id}-${frozen.candidate}.json`,
  );
  const originalBundleBytes = fs.readFileSync(canonicalBundlePath);
  const receiptExisted = fs.existsSync(receiptPath);
  const originalReceiptBytes = receiptExisted ? fs.readFileSync(receiptPath) : null;
  const receiptDirExisted = fs.existsSync(receiptDir);
  let execution;
  let checked;
  let updatedBody;
  try {
    execution = mergeExecutor.executeMergeIntent({
      sealed_manifest: sealed,
      manifest_seal: sealed.seal,
      preflight,
      approved_preservation: [],
    });
    checked = validateMergeExecution(execution, sealed, bundle, preconditions, frozen);
    if (fs.existsSync(receiptPath)) {
      const existing = readJson(receiptPath, 'merge receipt');
      if (canonicalJson(existing) !== canonicalJson(checked.receipt)
          || mergeExecutor.verifyMergeExecutionReceipt(existing) !== true) {
        fail('MERGE_RECEIPT_IMMUTABLE', 'existing merge receipt bytes differ from this execution');
      }
    } else {
      runtime.atomicWriteJson(receiptPath, checked.receipt);
    }
    const relativeReceiptPath = path.relative(path.dirname(canonicalBundlePath), receiptPath);
    updatedBody = {
      ...bundle,
      integration_state: 'integrated',
      merge_receipt: {
        path: relativeReceiptPath,
        receipt_digest: checked.receipt.receipt_digest,
      },
    };
    delete updatedBody.receipt_digest;
    updatedBody.receipt_digest = canonicalDigest(updatedBody);
    runtime.atomicWriteJson(canonicalBundlePath, updatedBody);
    return { status: 'integrated', receipt_path: receiptPath, receipt: checked.receipt, bundle: updatedBody };
  } catch (error) {
    const targetSnapshot = integrationTargetSnapshot(target);
    const targetChanged = targetSnapshot.ref !== beforeSha
      || targetSnapshot.head !== beforeSha || targetSnapshot.dirty;
    const bundleChanged = !fs.existsSync(canonicalBundlePath)
      || !Buffer.from(fs.readFileSync(canonicalBundlePath)).equals(originalBundleBytes);
    const receiptChanged = fs.existsSync(receiptPath) !== receiptExisted
      || (receiptExisted && !Buffer.from(fs.readFileSync(receiptPath)).equals(originalReceiptBytes));
    if (!targetChanged && !bundleChanged && !receiptChanged) throw error;
    const rollbackErrors = [];
    if (targetChanged && !restoreIntegrationTarget(target, beforeSha)) {
      rollbackErrors.push('develop target did not restore to the authenticated pre-merge SHA');
    }
    try {
      if (bundleChanged) restoreIntegrationAuthority(canonicalBundlePath, true, originalBundleBytes);
      if (receiptChanged) restoreIntegrationAuthority(receiptPath, receiptExisted, originalReceiptBytes);
      if (!receiptDirExisted && fs.existsSync(receiptDir)
          && fs.readdirSync(receiptDir).length === 0) fs.rmdirSync(receiptDir);
    } catch (restoreError) {
      rollbackErrors.push(`authority rollback failed: ${restoreError.message}`);
    }
    if (rollbackErrors.length > 0) {
      fail('INTEGRATION_ROLLBACK_FAILED', rollbackErrors.join('; '));
    }
    throw error;
  }
}

const VERIFICATION_RECEIPT_KEYS = Object.freeze([
  'schema_version', 'artifact_type', 'campaign_id', 'tree_sha', 'argv_hash',
  'env_fingerprint', 'request_digest', 'verdict', 'exit_status',
  'writer_lease_closed', 'detached_checkout', 'runner_argv_attested',
  'writer_fence_digest', 'checkout_attestation_digest', 'stdout_digest',
  'stderr_digest', 'started_at', 'ended_at', 'receipt_digest',
]);

const VERIFIER_ATTESTATION_KEYS = Object.freeze([
  'schema_version', 'artifact_type', 'repo_identity', 'mission_lineage_id',
  'campaign_id', 'base_sha', 'candidate_sha', 'candidate_tree_sha', 'roster_tuple',
  'actor_id', 'session_id', 'runner_version', 'provider_version', 'command',
  'command_argv', 'command_digest', 'result_digest', 'receipt_ref', 'receipt_digest',
]);

const REVIEW_ATTESTATION_KEYS = Object.freeze([
  'schema_version', 'artifact_type', 'repo_identity', 'mission_lineage_id',
  'campaign_id', 'base_sha', 'candidate_sha', 'candidate_tree_sha', 'roster_tuple',
  'actor_id', 'session_id', 'reviewer_version', 'review_input_digest', 'diff_digest',
  'verdict', 'findings', 'receipt_ref', 'receipt_digest',
]);

function actorKey(attestation) {
  return `${attestation.roster_tuple}:${attestation.actor_id}:${attestation.session_id}`;
}

function validateVerificationReceipt(receipt, candidateTree, campaignId) {
  assertExactKeys(receipt, VERIFICATION_RECEIPT_KEYS, 'verification receipt');
  const body = validateSealedDigest(receipt, 'verification receipt');
  const request = {
    tree_sha: body.tree_sha,
    argv_hash: body.argv_hash,
    env_fingerprint: body.env_fingerprint,
    request_digest: body.request_digest,
  };
  if (body.artifact_type !== 'implementation_campaign_verification'
      || body.campaign_id !== campaignId
      || body.tree_sha !== candidateTree
      || body.verdict !== 'GREEN' || body.exit_status !== 0
      || body.writer_lease_closed !== true || body.detached_checkout !== true
      || body.runner_argv_attested !== true
      || !verification.reusableGreenReceipt(body, request)) {
    fail('VERIFIER_RECEIPT_INVALID', 'canonical verification receipt is not GREEN for candidate');
  }
  return body;
}

function validateVerifierAttestation(attestation, candidate, candidateTree, campaignId, repoInfo, authorization, frozen, loaded) {
  assertExactKeys(attestation, VERIFIER_ATTESTATION_KEYS, 'verifier attestation');
  const body = validateSealedDigest(attestation, 'verifier attestation');
  if (body.schema_version !== 1 || body.artifact_type !== 'next_touch_verifier_attestation'
      || body.repo_identity !== repoInfo.repo_identity
      || body.mission_lineage_id !== authorization.mission_lineage_id
      || body.campaign_id !== campaignId || body.base_sha !== frozen.review
      || body.candidate_sha !== candidate || body.candidate_tree_sha !== candidateTree
      || body.roster_tuple !== EXPECTED_ROSTER.verifier
      || typeof body.actor_id !== 'string' || body.actor_id.length === 0
      || typeof body.session_id !== 'string' || body.session_id.length === 0
      || typeof body.runner_version !== 'string' || body.runner_version.length === 0
      || typeof body.provider_version !== 'string' || body.provider_version.length === 0
      || typeof body.command !== 'string' || body.command.length === 0
      || !Array.isArray(body.command_argv) || body.command_argv.length === 0
      || body.command_digest !== canonicalDigest({ command: body.command, argv: body.command_argv })
      || !SHA256.test(body.result_digest || '')) {
    fail('VERIFIER_ATTESTATION_INVALID', 'verifier attestation identity/command binding is invalid');
  }
  const receiptRef = resolveAuthorityRef(body.receipt_ref, 'canonical verification receipt', repoInfo, loaded.path);
  const receipt = validateVerificationReceipt(receiptRef.value, candidateTree, campaignId);
  const expectedResultDigest = canonicalDigest({
    receipt_digest: receipt.receipt_digest,
    verdict: receipt.verdict,
    exit_status: receipt.exit_status,
    stdout_digest: receipt.stdout_digest,
    stderr_digest: receipt.stderr_digest,
  });
  if (body.result_digest !== expectedResultDigest) {
    fail('VERIFIER_ATTESTATION_INVALID', 'verification result digest does not bind canonical receipt output');
  }
  return {
    body,
    actor_id: body.actor_id,
    session_id: body.session_id,
    receipt_digest: receipt.receipt_digest,
  };
}

function validateReviewerAttestation(attestation, candidate, candidateTree, campaignId, repoInfo, authorization, frozen, loaded, diffDigest, reviewInputDigest) {
  assertExactKeys(attestation, REVIEW_ATTESTATION_KEYS, 'reviewer attestation');
  const body = validateSealedDigest(attestation, 'reviewer attestation');
  if (body.schema_version !== 1 || body.artifact_type !== 'next_touch_reviewer_attestation'
      || body.repo_identity !== repoInfo.repo_identity
      || body.mission_lineage_id !== authorization.mission_lineage_id
      || body.campaign_id !== campaignId || body.base_sha !== frozen.review
      || body.candidate_sha !== candidate || body.candidate_tree_sha !== candidateTree
      || body.roster_tuple !== EXPECTED_ROSTER.reviewer
      || typeof body.actor_id !== 'string' || body.actor_id.length === 0
      || typeof body.session_id !== 'string' || body.session_id.length === 0
      || typeof body.reviewer_version !== 'string' || body.reviewer_version.length === 0
      || body.review_input_digest !== reviewInputDigest || body.diff_digest !== diffDigest
      || body.verdict !== 'SHIP' || !Array.isArray(body.findings) || body.findings.length !== 0) {
    fail('REVIEW_ATTESTATION_INVALID', 'reviewer attestation identity/diff binding is invalid');
  }
  const receiptRef = resolveAuthorityRef(body.receipt_ref, 'canonical reviewer receipt', repoInfo, loaded.path);
  const review = validateSealedDigest(receiptRef.value, 'canonical reviewer receipt');
  const candidateCommit = review.candidate_sha || review.candidate_commit
    || (review.candidate_ref && typeof review.candidate_ref === 'object'
      ? review.candidate_ref.commit : null);
  const reviewCandidateTree = review.candidate_tree_sha
    || (review.candidate_ref && typeof review.candidate_ref === 'object'
      ? review.candidate_ref.tree_sha : null);
  const findingsEmpty = Array.isArray(review.findings)
    ? review.findings.length === 0 : review.findings === '[]';
  if (!['product_review', 'implementation_campaign_review', 'controller_full_diff_review'].includes(review.artifact_type)
      || review.base_sha !== frozen.review
      || candidateCommit !== candidate || reviewCandidateTree !== frozen.candidateTree
      || !findingsEmpty
      || !Array.isArray(review.follow_up) || review.follow_up.length !== 0
      || !Array.isArray(review.unresolved_final_findings) || review.unresolved_final_findings.length !== 0
      || !['SHIP', 'SHIP-AS-IS'].includes(review.verdict)) {
    fail('REVIEW_RECEIPT_INVALID', 'canonical reviewer receipt is not a SHIP review for candidate');
  }
  return {
    body,
    actor_id: body.actor_id,
    session_id: body.session_id,
    receipt_digest: receiptRef.value.receipt_digest,
  };
}

function validateIndependentEvidence(bundle, loaded, repoInfo, authorization, frozen, campaignId, panelValidation, source) {
  if (!Array.isArray(bundle.verification_receipts) || bundle.verification_receipts.length < 1
      || !Array.isArray(bundle.review_receipts) || bundle.review_receipts.length < 1) {
    fail('INDEPENDENT_EVIDENCE_MISSING', 'at least one verifier and one reviewer receipt are required');
  }
  const verifiers = bundle.verification_receipts.map((ref, index) => {
    const loadedRef = resolveAuthorityRef(ref, `verification receipt ${index + 1}`, repoInfo, loaded.path);
    return validateVerifierAttestation(loadedRef.value, frozen.candidate, frozen.candidateTree, campaignId, repoInfo, authorization, frozen, loaded);
  });
  const diffResult = git(repoInfo.repo, ['diff', '--binary', `${frozen.review}..${frozen.candidate}`], false);
  const diffDigest = sha256(Buffer.from(diffResult.stdout));
  const reviewInputDigest = canonicalDigest({
    schema_version: 1,
    artifact_type: 'next_touch_review_input',
    admission_base_sha: frozen.admission,
    review_base_sha: frozen.review,
    candidate_sha: frozen.candidate,
    candidate_tree_sha: frozen.candidateTree,
    source_plan_sha256: source.planSha,
    source_rubric_sha256: source.rubricSha,
    diff_digest: diffDigest,
  });
  const reviewers = bundle.review_receipts.map((ref, index) => {
    const loadedRef = resolveAuthorityRef(ref, `review receipt ${index + 1}`, repoInfo, loaded.path);
    return validateReviewerAttestation(loadedRef.value, frozen.candidate, frozen.candidateTree, campaignId, repoInfo, authorization, frozen, loaded, diffDigest, reviewInputDigest);
  });
  const verifierActors = new Set(verifiers.map((item) => item.actor_id));
  const reviewerActors = new Set(reviewers.map((item) => item.actor_id));
  const verifierSessions = new Set(verifiers.map((item) => item.session_id));
  const reviewerSessions = new Set(reviewers.map((item) => item.session_id));
  if ([...verifierActors].some((actor) => reviewerActors.has(actor))
      || [...verifierSessions].some((session) => reviewerSessions.has(session))) {
    fail('INDEPENDENT_ACTOR_COLLISION', 'verifier and reviewer actors must be distinct');
  }
  const panelActors = new Set((panelValidation.final_panel_seat_receipts || []).map((seat) => [
    seat.runner, seat.model, seat.effort, seat.family,
  ].join('/').toLowerCase()));
  if (![EXPECTED_ROSTER.verifier, EXPECTED_ROSTER.reviewer].every((tuple) => {
    const [runner, model, effort, family] = tuple.toLowerCase().split('/');
    return [...panelActors].some((entry) => entry.includes(runner) && entry.includes(model)
      && entry.includes(effort) && entry.includes(family));
  })) {
    fail('FINAL_PANEL_ACTOR_BINDING', 'final panel does not contain the independent verifier/reviewer tuples');
  }
  return { verifiers, reviewers };
}

function candidateFileExists(repo, ref, relative) {
  return git(repo, ['cat-file', '-e', `${ref}:${relative}`], true).status === 0;
}

function validateArchiveState(repo, candidate, source, authorization) {
  const archivePlanPath = `${ARCHIVE_DIR}/2026-08-03-next-touch-debt-retirement.md`;
  const archiveRubricPath = `${ARCHIVE_DIR}/2026-08-03-next-touch-debt-retirement.rubric.md`;
  const archiveAuthPath = `${ARCHIVE_DIR}/evidence/authorization.json`;
  const archiveReadmePath = `${ARCHIVE_DIR}/README.md`;
  for (const relative of [archivePlanPath, archiveRubricPath, archiveAuthPath, archiveReadmePath, 'docs/projects/INDEX.md']) {
    if (!candidateFileExists(repo, candidate, relative)) fail('ARCHIVE_INCOMPLETE', `candidate is missing ${relative}`);
  }
  let candidatePlan;
  try { candidatePlan = readGitFile(repo, candidate, PLAN_PATH); }
  catch (_error) { candidatePlan = readGitFile(repo, REVIEW_BASE_SHA, PLAN_PATH); }
  const candidateRubric = candidateFileExists(repo, candidate, RUBRIC_PATH)
    ? readGitFile(repo, candidate, RUBRIC_PATH)
    : readGitFile(repo, REVIEW_BASE_SHA, RUBRIC_PATH);
  const archivePlan = readGitFile(repo, candidate, archivePlanPath);
  const archiveRubric = readGitFile(repo, candidate, archiveRubricPath);
  if (sha256(candidatePlan) !== source.planSha || sha256(candidateRubric) !== source.rubricSha
      || archivePlan !== candidatePlan || archiveRubric !== candidateRubric) {
    fail('ARCHIVE_DIGEST_MISMATCH', 'archive plan/rubric bytes do not equal the frozen source');
  }
  const archiveAuth = JSON.parse(readGitFile(repo, candidate, archiveAuthPath));
  if (canonicalJson(archiveAuth) !== canonicalJson(authorization)) {
    fail('ARCHIVE_AUTHORITY_MISMATCH', 'archived authorization does not equal the admitted authorization');
  }
  const readme = readGitFile(repo, candidate, archiveReadmePath);
  if (!/archived/u.test(readme) || /pending harness integrate|awaiting harness integrate/u.test(readme)) {
    fail('ARCHIVE_STATE_INVALID', 'archive README does not declare completed archival');
  }
  const index = readGitFile(repo, candidate, 'docs/projects/INDEX.md');
  if (!/_archive\/2026-08-03-next-touch-debt-retirement\/README\.md/u.test(index)
      || !/\|\s*archived\s*\|/u.test(index)) {
    fail('ARCHIVE_INDEX_INVALID', 'projects INDEX does not record the archived project');
  }
  if (candidateFileExists(repo, candidate, 'docs/projects/2026-08-03-next-touch-debt-retirement/README.md')) {
    fail('ARCHIVE_INCOMPLETE', 'active project README remains after archival');
  }
  return { archivePlanPath, archiveRubricPath, archiveAuthPath };
}

function validateTerminal(args = {}) {
  const identity = loadRepoAndAuthority(args, { allowArchived: true });
  const source = sourceDigests(identity.repoInfo.repo);
  const loaded = loadTerminalBundle(args.receipt, identity.repoInfo);
  const frozen = validateTerminalIdentity(args, identity.repoInfo, identity.authorization, source, loaded);
  validateHeadingSet(
    identity.repoInfo.repo,
    frozen.admission,
    frozen.candidate,
    args.assert_removed_ledger,
    source,
  );
  const missionState = validatePreparedAndMissionState(
    loaded.bundle,
    loaded,
    identity.repoInfo,
    identity.authorization,
    frozen,
  );
  validateArchiveState(identity.repoInfo.repo, frozen.candidate, source, identity.authorization);
  const missionTerminalRef = resolveAuthorityRef(
    loaded.bundle.mission_terminal_receipt,
    'Mission terminal receipt',
    identity.repoInfo,
    loaded.path,
  );
  validateMissionTerminalReceipt(missionTerminalRef.value, missionState.state, identity.authorization);
  const campaignTerminalRef = resolveAuthorityRef(
    loaded.bundle.campaign_terminal_receipt,
    'Mission campaign terminal receipt',
    identity.repoInfo,
    loaded.path,
  );
  if (campaignTerminalRef.value.artifact_type !== 'campaign_terminal_receipt') {
    fail('CAMPAIGN_TERMINAL_NOT_READY', 'Mission campaign terminal receipt has the wrong artifact type');
  }
  const campaignTerminal = validateCampaignRuntimeTerminalReceipt(
    campaignTerminalRef.value,
    missionState.state,
    identity.authorization,
  );
  const iccTerminalRef = resolveAuthorityRef(
    loaded.bundle.icc_terminal_receipt,
    'ICC terminal receipt',
    identity.repoInfo,
    loaded.path,
  );
  if (iccTerminalRef.value.artifact_type !== 'implementation_campaign_terminal') {
    fail('ICC_TERMINAL_NOT_READY', 'ICC terminal receipt has the wrong artifact type');
  }
  const iccTerminal = validateImplementationTerminalReceipt(
    iccTerminalRef.value,
    frozen.candidateTree,
  );
  validateD8PublicationRebind(
    loaded.bundle,
    loaded,
    identity.repoInfo,
    identity.authorization,
    missionState.prepared,
    frozen,
    missionTerminalRef.value,
    campaignTerminalRef.value,
    iccTerminalRef.value,
  );
  const panelRef = resolveAuthorityRef(
    loaded.bundle.final_panel_receipt,
    'final panel receipt',
    identity.repoInfo,
    loaded.path,
  );
  const panel = panelRef.value;
  const minimum = Number.isSafeInteger(loaded.bundle.min_panel_size) ? loaded.bundle.min_panel_size : 3;
  if (minimum < 3) fail('FINAL_PANEL_INVALID', 'final panel minimum must be at least three');
  const panelValidation = composition.validateFinalPanelReceipt(panel, minimum);
  if (panelValidation.passed !== true) fail('FINAL_PANEL_INVALID', panelValidation.reason);
  if (iccTerminal.final_panel_count !== panelValidation.final_panel_count
      || canonicalJson(iccTerminal.final_panel_seat_receipts)
        !== canonicalJson(panelValidation.final_panel_seat_receipts)) {
    fail('FINAL_PANEL_BINDING_MISMATCH', 'ICC terminal panel does not equal the sealed final panel receipt');
  }
  const icc = validateIccLedger(loaded.bundle, loaded, identity.repoInfo, iccTerminal, frozen);
  if (loaded.bundle.campaign_id !== icc.campaignId
      || campaignTerminal.icc_campaign_id !== icc.campaignId) {
    fail('ICC_CAMPAIGN_BINDING_MISMATCH', 'ICC campaign id is not shared by terminal evidence');
  }
  const independent = validateIndependentEvidence(
    loaded.bundle,
    loaded,
    identity.repoInfo,
    identity.authorization,
    frozen,
    icc.campaignId,
    panelValidation,
    source,
  );
  if (!independent.verifiers.some((verifier) =>
    verifier.receipt_digest === iccTerminal.verification_receipt_digest)) {
    fail('VERIFICATION_BINDING_MISMATCH', 'ICC terminal verification digest is not a canonical verifier receipt');
  }
  const integrationPreconditions = loaded.bundle.integration_state === 'reviewed_archived'
    ? validateIntegrationPreconditions(loaded.bundle, args, identity.repoInfo, frozen)
    : null;
  const integration = executeAuthorizedIntegration({
    bundle: loaded.bundle,
    bundlePath: loaded.path,
    repoInfo: identity.repoInfo,
    frozen,
    args,
    preconditions: integrationPreconditions,
  });
  return {
    status: 'validated',
    repo_identity: identity.repoInfo.repo_identity,
    mission_lineage_id: identity.authorization.mission_lineage_id,
    candidate_sha: frozen.candidate,
    candidate_tree_sha: frozen.candidateTree,
    campaign_id: icc.campaignId,
    final_panel_count: panelValidation.final_panel_count,
    verifier_count: independent.verifiers.length,
    reviewer_count: independent.reviewers.length,
    integration_state: integration.status === 'integrated' || integration.status === 'already_integrated'
      ? 'integrated' : loaded.bundle.integration_state,
    integration: { status: integration.status },
  };
}

module.exports = {
  ADMISSION_BASE_SHA,
  assertFrozenEvidenceBytes,
  canonicalDigest,
  D8_EVALUATED_SHA,
  D8_PUBLICATION_SHA,
  NextTouchValidationError,
  REVIEW_BASE_SHA,
  assertAuthorityPath,
  canonicalAuthorityRoot,
  fail,
  findPreparedReceipt,
  loadRepoAndAuthority,
  loadTerminalBundle,
  parseStrictArgs,
  validateHeadingSet,
  readJson,
  sourceDigests,
  validateImplementationTerminalReceipt,
  validateCampaignRuntimeTerminalReceipt,
  validateIndependentEvidence,
  validateIccLedger,
  validateVerificationReceipt,
  validateReviewerAttestation,
  validateVerifierAttestation,
  validatePreparedAndMissionState,
  validateTerminalIdentity,
  validateSealedDigest,
  validateMissionReservation,
  validateReservation,
  validateIntegrationPreconditions,
  validateD8PublicationRebind,
  validateArchiveState,
  executeAuthorizedIntegration,
  validateTerminal,
};
