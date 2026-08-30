#!/usr/bin/env bash
# End-to-end: a real dispatcher boundary rejection must reach the DURABLE campaign
# journal, not just the controller file.
#
# Why this suite exists (evidence-discipline §"green but dead"): the sibling suite
# controller-boundary-budget-bridge.test.sh drives the same production chain with
# `durable_journal: false`, so recordCampaignEvent short-circuits and the reducer
# is never consulted. It was green through two consecutive real campaigns that
# stranded, because the bridge forwarded the mapped BOUNDARY_REJECTED with no
# artifact reference: appendCampaignEvent then derived output_artifact_digest from
# the stage identity, the reducer compared it against
# canonicalDigest({kind:'campaign_boundary_rejected', digest: boundary_receipt_digest}),
# refused with BOUNDARY_EVIDENCE_REQUIRED, and the campaign stayed in IMPLEMENTING
# with its mutation lease held.
#
# Everything below runs against a REAL ledger written by scripts/run-ledger.sh and
# a REAL reduceCampaignState, with a REAL commit that touches a path outside the
# contract's allowed prefixes. No source-text assertions.

TEST_NAME="campaign-boundary-receipt-e2e"
. "$(dirname "$0")/lib.sh"

E2E_OUT="$(
  node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [root, testTmp] = process.argv.slice(2);
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));
const icc = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const intake = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const campaignCli = require(path.join(root, 'src', 'campaign', 'cli'));
const {
  campaignLedgerContract,
  openCampaignLedger,
} = require(path.join(root, 'hooks', 'tests', 'lib', 'implementation-campaign-ledger-fixture'));

const roster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  min_panel_size: 1,
  qc_panel_seats_complete: true,
  qc_panel_seats: [{
    role: 'qc',
    runner: 'fixture',
    model: 'fixture-reviewer',
    effort: 'high',
    endpoint: null,
    family: 'fixture',
  }],
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 2,
  loop_convergence_verdict: 'SHIP-AS-IS',
  cross_family_required: false,
};

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

// A repository, a durable campaign ledger opened through run-ledger.sh, and a
// real commit whose only changed path sits OUTSIDE the sealed output surface
// (contract allows `src/`; the candidate writes `docs/leak.md`).
function fixture(name) {
  const repo = path.join(testTmp, name, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q']);
  git(repo, ['config', 'user.email', 'boundary-e2e@example.invalid']);
  git(repo, ['config', 'user.name', 'Boundary E2E Test']);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'seed.txt'), `${name}\n`);
  git(repo, ['add', 'src/seed.txt']);
  git(repo, ['commit', '-qm', 'fixture']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  const commonRaw = git(repo, ['rev-parse', '--git-common-dir']);
  const commonDir = fs.realpathSync(
    path.isAbsolute(commonRaw) ? commonRaw : path.join(repo, commonRaw),
  );

  const branch = `impl/${name}`;
  const contract = campaignLedgerContract({
    repoIdentity: `git-common-dir:${commonDir}`,
    ticket: `boundary-e2e-${name}`,
    baseSha: base,
    branch,
  });
  const contractPath = path.join(testTmp, name, 'campaign.json');
  const sealPath = path.join(testTmp, name, 'campaign.seal.json');
  const promptFile = path.join(testTmp, name, 'prompt.txt');
  fs.writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  fs.writeFileSync(sealPath, '{}\n');
  fs.writeFileSync(promptFile, 'bounded implementation\n');

  const opened = openCampaignLedger({
    root,
    repo,
    ledger: path.join(commonDir, 'autopilot', 'implementation-campaign.jsonl'),
    contract,
    startedAt: '2026-08-30T00:00:00.000Z',
  });

  // The dispatcher's candidate: a real commit outside the sealed output surface.
  const offendingPath = 'docs/leak.md';
  const worktree = path.join(testTmp, name, 'candidate');
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', branch, worktree, base]);
  fs.mkdirSync(path.join(worktree, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(worktree, offendingPath), 'leaked outside src/\n');
  execFileSync('git', ['-C', worktree, 'add', offendingPath]);
  execFileSync('git', ['-C', worktree, 'commit', '-qm', 'candidate outside output surface']);
  const candidate = git(worktree, ['rev-parse', 'HEAD']);
  const changed = git(worktree, ['diff', '--name-only', `${base}..HEAD`]).split('\n');
  // Pin the premise: the candidate really is outside the contract's surface.
  assert.deepStrictEqual(changed, [offendingPath]);
  assert.ok(!contract.allowed_path_prefixes.some((p) => offendingPath.startsWith(p)));

  const campaignControl = {
    ...opened.control,
    contract_path: contractPath,
    seal_path: sealPath,
    full_enforcement: false,
    shadow_axes: ['mission'],
    steps: [],
  };
  return {
    repo,
    base,
    branch,
    candidate,
    offendingPath,
    contract,
    contractPath,
    sealPath,
    promptFile,
    campaignControl,
    ledger: opened.ledger,
    campaignId: opened.campaignId,
  };
}

// The exact JSON scripts/dispatch-hetero.sh emit_outcome writes for an
// unauthorized-output-path rejection (boundary_reject_fields branch).
function boundaryDispatchResult(fx) {
  return {
    status: 'boundary_rejected',
    runner: 'fixture',
    model: 'fixture-implementer',
    containment: 'plain',
    contained: true,
    branch: fx.branch,
    base: fx.base,
    commit: fx.candidate,
    files_changed: 1,
    insertions: 1,
    deletions: 0,
    worktree: fx.repo,
    agent_log: null,
    error: `boundary_rejected: changed path '${fx.offendingPath}' is outside sealed output surface`,
    boundary: 'rejected',
    boundary_code: 'unauthorized_output_path',
    boundary_reason: `boundary_rejected: changed path '${fx.offendingPath}' is outside sealed output surface`,
    candidate_ref: fx.candidate,
    possibly_effectful: true,
    mutation_failed: false,
    unknown_status: false,
    dispatcher_called: true,
    model_calls: 1,
    mutation_attempts: 1,
    gate_attempts: 1,
    resources_created: 1,
    zero_diff_receipt_digest: null,
  };
}

function transport(value, exitStatus) {
  const {
    parseImplementationOutput,
  } = require(path.join(root, 'src', 'runners', 'implementer'));
  const stdout = `${JSON.stringify(value)}\n`;
  return {
    error: null,
    status: exitStatus,
    signal: null,
    stdout,
    stderr: '',
    parseError: null,
    result: parseImplementationOutput(stdout),
  };
}

function runScenario(fx, options = {}) {
  const engine = new AutopilotEngine({
    cwd: fx.repo,
    clock: () => '2026-08-30T00:00:01.000Z',
    campaignIntake() {
      return fx.campaignControl;
    },
    campaignAdmissionReleaser() {
      return { status: 'released' };
    },
    implementationDispatcher() {
      return transport(boundaryDispatchResult(fx), 1);
    },
    ...(options.campaignEventAppender
      ? { campaignEventAppender: options.campaignEventAppender }
      : {}),
  });
  return engine.runImplementationReviewLoop({
    promptFile: fx.promptFile,
    branch: fx.branch,
    base: fx.base,
    roster,
    campaignContract: fx.contractPath,
    campaignSeal: fx.sealPath,
  });
}

// ---------------------------------------------------------------------------
// A. The boundary rejection reduces in the DURABLE journal.
// ---------------------------------------------------------------------------
const fxA = fixture('journaled');

// Pre-state: the journal must actually be IMPLEMENTING with a live lease before
// the boundary event, otherwise the reducer branch under test is never entered.
// The engine journals IMPLEMENTATION_STARTED itself; assert the campaign starts
// from PREPARED so nothing here pre-empts it.
assert.strictEqual(fxA.campaignControl.initial_state.phase, 'PREPARED');
assert.strictEqual(fxA.campaignControl.initial_state.live_lease, null);
assert.strictEqual(fxA.campaignControl.generation_claim.durable_journal, true);

// The engine re-seats campaignControl.initial_state as it journals; keep the
// PREPARED snapshot for the negative-control replay below.
const preparedStateA = JSON.parse(JSON.stringify(fxA.campaignControl.initial_state));

const resultA = runScenario(fxA);

assert.strictEqual(resultA.status, 'blocked');
assert.strictEqual(resultA.phase, 'boundary_rejected');
console.log(`a_phase=${resultA.phase}`);

// Read the journal back through the shipped projector, not the in-memory state.
const projection = campaignCli.projectCampaign(
  campaignCli.loadRows(fxA.ledger),
  fxA.campaignId,
);
assert.ok(projection, 'campaign projection is missing');
assert.strictEqual(projection.state.phase, icc.CAMPAIGN_STATES.BOUNDARY_REJECTED);
console.log(`a_journal_phase=${projection.state.phase}`);

// The lease that stranded the two real campaigns must be released.
assert.strictEqual(projection.state.live_lease, null);
console.log('a_lease_released=true');

// The mutation lease was genuinely acquired first (IMPLEMENTATION_STARTED landed).
const rows = campaignCli.loadRows(fxA.ledger);
const events = rows
  .filter((row) => row && row.kind === 'journal' && row.op === 'campaign_event')
  .map((row) => {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    return (payload && payload.event) || null;
  })
  .filter((event) => event && event.campaign_id === fxA.campaignId);
const started = events.filter(
  (e) => e.event_type === icc.CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
);
const rejected = events.filter(
  (e) => e.event_type === icc.CAMPAIGN_EVENTS.BOUNDARY_REJECTED,
);
assert.strictEqual(started.length, 1, 'implementation start was not journaled');
assert.strictEqual(rejected.length, 1, 'boundary rejection was not journaled');
console.log(`a_events=${started.length},${rejected.length}`);

// The digest binding the reducer enforces, re-derived here from the journal row.
const boundaryEvent = rejected[0];
assert.ok(/^[0-9a-f]{64}$/.test(boundaryEvent.payload.boundary_receipt_digest));
assert.strictEqual(
  boundaryEvent.output_artifact_digest,
  icc.canonicalDigest({
    kind: 'campaign_boundary_rejected',
    digest: boundaryEvent.payload.boundary_receipt_digest,
  }),
);
console.log('a_output_digest_bound=true');

// boundary_reason carries the exact code and the first offending path.
assert.strictEqual(
  boundaryEvent.payload.boundary_reason,
  `unauthorized_output_path: ${fxA.offendingPath}`,
);
assert.strictEqual(boundaryEvent.payload.candidate_ref, fxA.candidate);
console.log(`a_boundary_reason=${boundaryEvent.payload.boundary_reason}`);

// The receipt the digest stands for is persisted, and re-derivable from it.
const controllerA = resultA.campaign_control && resultA.campaign_control.controller;
assert.ok(controllerA, 'controller authority is missing from the result');
const persisted = (controllerA.audit_events || []).filter(
  (entry) => entry && entry.artifact_type === 'campaign_boundary_receipt',
);
assert.strictEqual(persisted.length, 1, 'boundary receipt was not persisted');
const { at: _at, digest: persistedDigest, ...receiptBody } = persisted[0];
assert.strictEqual(persistedDigest, boundaryEvent.payload.boundary_receipt_digest);
assert.strictEqual(icc.canonicalDigest(receiptBody), persistedDigest);
assert.strictEqual(receiptBody.campaign_id, fxA.campaignId);
assert.strictEqual(receiptBody.base, fxA.base);
assert.strictEqual(receiptBody.candidate_ref, fxA.candidate);
assert.strictEqual(receiptBody.boundary_code, 'unauthorized_output_path');
assert.deepStrictEqual(receiptBody.offending_paths, [fxA.offendingPath]);
assert.ok(/^[0-9a-f]{64}$/.test(receiptBody.dispatch_result_digest));
console.log('a_receipt_verifiable=true');

// Negative control: the reducer's demand is real, not decoration. Replay the
// same event with the digest binding broken and the journal must refuse.
const preBoundaryState = icc.replayCampaignEvents(
  preparedStateA,
  events.slice(0, events.length - 1),
);
assert.strictEqual(preBoundaryState.phase, icc.CAMPAIGN_STATES.IMPLEMENTING);
assert.notStrictEqual(preBoundaryState.live_lease, null);
// Forward pin: the exact journaled event still reduces from this state.
assert.strictEqual(
  icc.reduceCampaignState(preBoundaryState, boundaryEvent).phase,
  icc.CAMPAIGN_STATES.BOUNDARY_REJECTED,
);
let refusedCode = null;
try {
  icc.reduceCampaignState(preBoundaryState, {
    ...boundaryEvent,
    idempotency_key: `${boundaryEvent.idempotency_key}:negative-control`,
    output_artifact_digest: icc.canonicalDigest({
      kind: 'campaign_boundary_rejected',
      digest: icc.canonicalDigest({ tampered: true }),
    }),
  });
} catch (error) {
  refusedCode = error.code || null;
}
assert.strictEqual(refusedCode, 'BOUNDARY_EVIDENCE_REQUIRED');
console.log(`a_negative_control=${refusedCode}`);

// What this suite does NOT prove, stated rather than implied: the Mission graph
// claim is still held after BOUNDARY_REJECTED, and that is by design —
// runImplementationReviewLoop classifies boundary_rejected as a durable resumable
// wait (`durableWaitStatuses`), so it deliberately does not terminalize or
// release. Releasing it needs a resume that reaches a campaign terminal, or an
// operator disposition; `mission control` exposes only
// finish_requested|abort_requested|scope_frozen|ceiling_adjust, so the post-spend
// no-effect release is still the open BACKLOG item (2026-08-30). What this fix
// removes is the strand: the mutation LEASE is released and the durable phase is
// no longer stuck at IMPLEMENTING, so a resume can run at all.

// ---------------------------------------------------------------------------
// B. BL-4 — a controller/journal block after a real dispatch reports honestly.
// ---------------------------------------------------------------------------
// Same production chain; the durable appender refuses the boundary event (the
// exact failure the two stranded campaigns hit). The bridge rethrows, composition
// unwinds, and runImplementationReviewLoop's controller_execution_authority catch
// builds the top-level summary a foreman reads.
const fxB = fixture('honest-summary');
const resultB = runScenario(fxB, {
  campaignEventAppender(eventInput) {
    if (eventInput.eventType === icc.CAMPAIGN_EVENTS.BOUNDARY_REJECTED) {
      const error = new Error('boundary_rejected requires digest-bound boundary evidence');
      error.code = 'BOUNDARY_EVIDENCE_REQUIRED';
      throw error;
    }
    return intake.appendCampaignEvent(eventInput);
  },
});

assert.strictEqual(resultB.status, 'blocked');
assert.strictEqual(resultB.phase, 'controller_execution_authority');
console.log(`b_phase=${resultB.phase}`);

const dispatchEntries = (resultB.ledger || []).filter(
  (entry) => entry && entry.unit === 'dispatch_implementation',
);
assert.strictEqual(dispatchEntries.length, 1, 'the dispatch did not reach the ledger');
assert.strictEqual(dispatchEntries[0].commit, fxB.candidate);
console.log(`b_ledger_commit=${dispatchEntries[0].commit === fxB.candidate}`);

// The honesty assertions: the summary must not say nothing ran.
assert.strictEqual(resultB.dispatcher_called, true);
assert.ok(resultB.model_calls >= 1, `model_calls was ${resultB.model_calls}`);
assert.strictEqual(resultB.commit, fxB.candidate);
console.log(`b_dispatcher_called=${resultB.dispatcher_called}`);
console.log(`b_model_calls=${resultB.model_calls}`);
console.log(`b_commit=${resultB.commit === fxB.candidate}`);
NODE
)"
E2E_EXIT=$?

echo "$E2E_OUT"

assert_exit_code "$E2E_EXIT" "0" "boundary receipt end-to-end scenarios exit zero"
assert_contains "$E2E_OUT" "a_journal_phase=BOUNDARY_REJECTED" \
  "the durable reducer accepts the production boundary event"
assert_contains "$E2E_OUT" "a_lease_released=true" \
  "the mutation lease is released by the reduced boundary rejection"
assert_contains "$E2E_OUT" "a_events=1,1" \
  "the campaign really held a mutation lease before the rejection"
assert_contains "$E2E_OUT" "a_output_digest_bound=true" \
  "output_artifact_digest binds the boundary receipt digest"
assert_contains "$E2E_OUT" "a_boundary_reason=unauthorized_output_path: docs/leak.md" \
  "boundary_reason carries the exact code and first offending path"
assert_contains "$E2E_OUT" "a_receipt_verifiable=true" \
  "the persisted boundary receipt re-derives its own digest"
assert_contains "$E2E_OUT" "a_negative_control=BOUNDARY_EVIDENCE_REQUIRED" \
  "the reducer still refuses an unbound boundary event"
assert_contains "$E2E_OUT" "b_dispatcher_called=true" \
  "a controller block after a real dispatch does not claim the dispatcher was never called"
assert_contains "$E2E_OUT" "b_commit=true" \
  "a controller block surfaces the real candidate commit"

finalize_test
