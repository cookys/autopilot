#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const tmp = process.argv[3];
const { AutopilotEngine } = require(path.join(root, 'src', 'engine'));

const BASE = '1'.repeat(40);
const COMMIT = '2'.repeat(40);
const POLICY_HASH = 'a'.repeat(64);
const PROMPT_SECRET = 'PROMPT_SECRET_MUST_NOT_LEAVE_ENGINE';
const BRANCH_SECRET = 'feature-BRANCH_SECRET';
const FINDINGS_SECRET = 'FINDINGS_SECRET_MUST_NOT_LEAVE_ENGINE';
const RAW_LOG_SECRET = '/tmp/RAW_LOG_SECRET_MUST_NOT_LEAVE_ENGINE';
const promptFile = path.join(tmp, 'prompt.txt');
fs.writeFileSync(promptFile, PROMPT_SECRET, 'utf8');

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function makeObserver({
  failAppendAt = null,
  rollbackAppendAt = null,
  wrongAppendBindingAt = null,
  rollbackClose = false,
} = {}) {
  const calls = [];
  let head = null;
  let appendCount = 0;
  const historicalHeads = [];
  return {
    calls,
    open(request) {
      calls.push({ kind: 'open', request });
      return {
        engine_run_id: request.engine_run_id,
        invocation_id: request.invocation_id,
        envelope_hash: request.envelope_hash,
        observation_head: head,
      };
    },
    appendIfHead(request) {
      calls.push({ kind: 'append', request });
      if (request.expected_observation_head !== head) throw new Error('unexpected observation head');
      appendCount += 1;
      if (failAppendAt === appendCount) throw new Error('simulated stale compare-and-append');
      if (rollbackAppendAt === appendCount) {
        return {
          engine_run_id: request.engine_run_id,
          invocation_id: request.invocation_id,
          sequence: request.sequence,
          previous_observation_head: request.expected_observation_head,
          record_hash: request.record_hash,
          observation_head: historicalHeads[0],
        };
      }
      head = digest(`append|${head}|${request.sequence}|${request.record_hash}`);
      historicalHeads.push(head);
      return {
        engine_run_id: request.engine_run_id,
        invocation_id: request.invocation_id,
        sequence: request.sequence,
        previous_observation_head: request.expected_observation_head,
        record_hash: wrongAppendBindingAt === appendCount ? digest('wrong-record-binding') : request.record_hash,
        observation_head: head,
      };
    },
    close(request) {
      calls.push({ kind: 'close', request });
      if (request.expected_observation_head !== head) throw new Error('unexpected terminal observation head');
      if (rollbackClose) {
        return {
          engine_run_id: request.engine_run_id,
          invocation_id: request.invocation_id,
          sequence: request.sequence,
          previous_observation_head: request.expected_observation_head,
          terminal_hash: request.terminal_hash,
          observation_head: historicalHeads[0],
        };
      }
      head = digest(`close|${head}|${request.sequence}|${request.terminal_hash}`);
      return {
        engine_run_id: request.engine_run_id,
        invocation_id: request.invocation_id,
        sequence: request.sequence,
        previous_observation_head: request.expected_observation_head,
        terminal_hash: request.terminal_hash,
        observation_head: head,
      };
    },
  };
}

function makeEngine(observer, counters, {
  implementationUsage,
  implementationStatus = 'committed',
  implementationCommits = [COMMIT],
  reviewVerdicts = ['SHIP-AS-IS'],
  engineOptions = {},
} = {}) {
  return new AutopilotEngine({
    lifecycleObserver: observer,
    clock: () => '2026-07-23T00:00:00.000Z',
    implementationDispatcher() {
      counters.implementation += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          status: implementationStatus,
          runner: 'implementer-runner',
          model: 'implementation-model',
          branch: BRANCH_SECRET,
          base: BASE,
          commit: implementationCommits[counters.implementation - 1] || COMMIT,
          files_changed: 1,
          insertions: 2,
          deletions: 0,
          worktree: '/tmp/implementation-worktree',
          agent_log: '/tmp/implementation-log',
          error: null,
          containment: 'worktree',
          contained: true,
          ...(implementationUsage === undefined ? {} : { usage: implementationUsage }),
        },
      };
    },
    reviewDispatcher() {
      counters.review += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          runner: 'review-runner',
          model: 'review-model',
          status: 'reviewed',
          verdict: reviewVerdicts[counters.review - 1] || 'SHIP-AS-IS',
          findings: FINDINGS_SECRET,
          raw_log: RAW_LOG_SECRET,
          error: null,
        },
      };
    },
    diffProvider() {
      const file = path.join(tmp, `review-${counters.implementation}.diff`);
      fs.writeFileSync(file, '+const answer = 42;\n', 'utf8');
      return file;
    },
    ...engineOptions,
  });
}

const roster = {
  reviewer_engine: 'review-model',
  reviewer_effort: 'high',
  reviewer_runner: 'review-runner',
  reviewer_qualified: true,
  implementer_engine: 'implementation-model',
  implementer_effort: 'high',
  implementer_runner: 'implementer-runner',
  loop_max_rounds: 1,
  loop_convergence_verdict: 'SHIP-AS-IS',
};

function run(engine, lifecycleObservation, extra = {}) {
  return engine.runLegacyImplementationReviewLoop({
    promptFile,
    branch: BRANCH_SECRET,
    base: BASE,
    roster,
    ...(lifecycleObservation === undefined ? {} : { lifecycleObservation }),
    ...extra,
  });
}

const config = {
  engineRunId: 'engine-run-1',
  invocationId: 'invocation-1',
  legacyLevel: 'l5',
  policyHash: POLICY_HASH,
};

const observedCounters = { implementation: 0, review: 0 };
const observer = makeObserver();
const observed = run(makeEngine(observer, observedCounters), config);
const wire = JSON.stringify(observer.calls);
const terminal = observer.calls.find((call) => call.kind === 'close').request.terminal;
console.log(`observed_status=${observed.status}`);
console.log(`observed_observation=${observed.lifecycle_observation.status}`);
console.log(`observed_entries=${observed.lifecycle_observation.entry_count}`);
console.log(`observed_terminal=${observed.lifecycle_observation.terminal_recorded}`);
console.log(`observed_authority=${observed.lifecycle_observation.owner_kernel_authority}`);
console.log(`observed_acceptance=${observed.lifecycle_observation.acceptance}`);
console.log(`observed_alias=${observed.lifecycle_observation.alias_retirement_eligible}`);
console.log(`observed_terminal_kind=${terminal.terminal}`);
console.log(`observed_terminal_acceptance=${terminal.acceptance}`);
console.log(`observed_open_level=${observer.calls[0].request.envelope.legacy_level}`);
console.log(`observed_append_count=${observer.calls.filter((call) => call.kind === 'append').length}`);
console.log(`observed_push_restored=${Object.prototype.hasOwnProperty.call(observed.ledger, 'push')}`);
console.log(`wire_prompt_secret=${wire.includes(PROMPT_SECRET)}`);
console.log(`wire_branch_secret=${wire.includes(BRANCH_SECRET)}`);
console.log(`wire_findings_secret=${wire.includes(FINDINGS_SECRET)}`);
console.log(`wire_raw_log_secret=${wire.includes(RAW_LOG_SECRET)}`);

const noConfigCounters = { implementation: 0, review: 0 };
const ignoredObserver = makeObserver();
const noConfig = run(makeEngine(ignoredObserver, noConfigCounters));
console.log(`no_config_status=${noConfig.status}`);
console.log(`no_config_field=${Object.prototype.hasOwnProperty.call(noConfig, 'lifecycle_observation')}`);
console.log(`no_config_calls=${ignoredObserver.calls.length}`);

const staleCounters = { implementation: 0, review: 0 };
const stale = run(makeEngine(makeObserver({ failAppendAt: 2 }), staleCounters), config);
console.log(`stale_status=${stale.status}`);
console.log(`stale_impl_review=${staleCounters.implementation}:${staleCounters.review}`);
console.log(`stale_observation=${stale.lifecycle_observation.status}`);
console.log(`stale_stage=${stale.lifecycle_observation.failure_stage}`);
console.log(`stale_terminal=${stale.lifecycle_observation.terminal_recorded}`);
console.log(`stale_acceptance=${stale.lifecycle_observation.acceptance}`);

const invalidCounters = { implementation: 0, review: 0 };
const invalidObserver = makeObserver();
const invalid = run(makeEngine(invalidObserver, invalidCounters), {
  ...config,
  legacyLevel: 'l3',
});
console.log(`invalid_status=${invalid.status}`);
console.log(`invalid_observation=${invalid.lifecycle_observation.status}`);
console.log(`invalid_stage=${invalid.lifecycle_observation.failure_stage}`);
console.log(`invalid_calls=${invalidObserver.calls.length}`);

const rollbackAppendCounters = { implementation: 0, review: 0 };
const rollbackAppend = run(makeEngine(makeObserver({ rollbackAppendAt: 3 }), rollbackAppendCounters), config);
console.log(`rollback_append_status=${rollbackAppend.status}`);
console.log(`rollback_append_observation=${rollbackAppend.lifecycle_observation.status}`);
console.log(`rollback_append_stage=${rollbackAppend.lifecycle_observation.failure_stage}`);
console.log(`rollback_append_terminal=${rollbackAppend.lifecycle_observation.terminal_recorded}`);

const rollbackCloseCounters = { implementation: 0, review: 0 };
const rollbackClose = run(makeEngine(makeObserver({ rollbackClose: true }), rollbackCloseCounters), config);
console.log(`rollback_close_status=${rollbackClose.status}`);
console.log(`rollback_close_observation=${rollbackClose.lifecycle_observation.status}`);
console.log(`rollback_close_stage=${rollbackClose.lifecycle_observation.failure_stage}`);
console.log(`rollback_close_terminal=${rollbackClose.lifecycle_observation.terminal_recorded}`);

const wrongBindingCounters = { implementation: 0, review: 0 };
const wrongBinding = run(makeEngine(makeObserver({ wrongAppendBindingAt: 1 }), wrongBindingCounters), config);
console.log(`wrong_binding_status=${wrongBinding.status}`);
console.log(`wrong_binding_observation=${wrongBinding.lifecycle_observation.status}`);
console.log(`wrong_binding_stage=${wrongBinding.lifecycle_observation.failure_stage}`);
console.log(`wrong_binding_terminal=${wrongBinding.lifecycle_observation.terminal_recorded}`);

const cyclicUsage = {};
cyclicUsage.self = cyclicUsage;
const cyclicBaselineCounters = { implementation: 0, review: 0 };
const cyclicBaseline = run(makeEngine(null, cyclicBaselineCounters, { implementationUsage: cyclicUsage }));
const cyclicObservedCounters = { implementation: 0, review: 0 };
const cyclicObserved = run(
  makeEngine(makeObserver(), cyclicObservedCounters, { implementationUsage: cyclicUsage }),
  config,
);
console.log(`cyclic_baseline_status=${cyclicBaseline.status}`);
console.log(`cyclic_observed_status=${cyclicObserved.status}`);
console.log(`cyclic_observation=${cyclicObserved.lifecycle_observation.status}`);
console.log(`cyclic_stage=${cyclicObserved.lifecycle_observation.failure_stage}`);
console.log(`cyclic_impl_review=${cyclicObservedCounters.implementation}:${cyclicObservedCounters.review}`);

const STATUS_SECRET = 'TOKEN_SECRET_STATUS_MUST_NOT_LEAVE_ENGINE';
const secretStatusObserver = makeObserver();
const secretStatusCounters = { implementation: 0, review: 0 };
const secretStatus = run(
  makeEngine(secretStatusObserver, secretStatusCounters, { implementationStatus: STATUS_SECRET }),
  config,
);
console.log(`secret_status_result=${secretStatus.status}`);
console.log(`secret_status_wire=${JSON.stringify(secretStatusObserver.calls).includes(STATUS_SECRET)}`);

class ClassObserver {
  constructor(delegate) {
    this.delegate = delegate;
  }

  open(request) { return this.delegate.open(request); }
  appendIfHead(request) { return this.delegate.appendIfHead(request); }
  close(request) { return this.delegate.close(request); }
}

const classDelegate = makeObserver();
const classCounters = { implementation: 0, review: 0 };
const classObserved = run(makeEngine(new ClassObserver(classDelegate), classCounters), config);
console.log(`class_observation=${classObserved.lifecycle_observation.status}`);
console.log(`class_calls=${classDelegate.calls.length}`);

const boundCounters = { implementation: 0, review: 0 };
const bound = run(makeEngine(makeObserver(), boundCounters), {
  ...config,
  engineRunId: 'bound-run',
}, { runId: 'bound-run' });
console.log(`bound_observation=${bound.lifecycle_observation.status}`);

const mismatchObserver = makeObserver();
const mismatchCounters = { implementation: 0, review: 0 };
const mismatch = run(makeEngine(mismatchObserver, mismatchCounters), config, { runId: 'different-run' });
console.log(`mismatch_status=${mismatch.status}`);
console.log(`mismatch_observation=${mismatch.lifecycle_observation.status}`);
console.log(`mismatch_stage=${mismatch.lifecycle_observation.failure_stage}`);
console.log(`mismatch_calls=${mismatchObserver.calls.length}`);

const repairObserver = makeObserver();
const repairCounters = { implementation: 0, review: 0 };
const repair = run(makeEngine(repairObserver, repairCounters, {
  implementationCommits: [COMMIT, '3'.repeat(40)],
  reviewVerdicts: ['FIX-THEN-SHIP', 'SHIP-AS-IS'],
}), config, {
  roster: { ...roster, loop_max_rounds: 2 },
});
const repairRecords = repairObserver.calls
  .filter((call) => call.kind === 'append')
  .map((call) => call.request.record.record_type);
console.log(`repair_status=${repair.status}`);
console.log(`repair_observation=${repair.lifecycle_observation.status}`);
console.log(`repair_impl_review=${repairCounters.implementation}:${repairCounters.review}`);
console.log(`repair_outcomes=${repairRecords.filter((kind) => kind === 'implementation_outcome').length}:${repairRecords.filter((kind) => kind === 'review_outcome').length}`);

const verifyWorktree = path.join(tmp, 'verify-worktree');
fs.mkdirSync(verifyWorktree, { recursive: true });
const verifyObserver = makeObserver();
const verifyCounters = { implementation: 0, review: 0 };
const verify = run(makeEngine(verifyObserver, verifyCounters, {
  engineOptions: {
    gitWorktreeAdd() {
      return { error: null, status: 0, signal: null, stdout: '', stderr: '', worktree: verifyWorktree, parent: null };
    },
    gitWorktreeRemove() {
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    verifyCommandRunner() {
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
  },
}), config, { verifyCmd: 'verified-command-secret-must-not-leave-engine' });
const verifyRecords = verifyObserver.calls
  .filter((call) => call.kind === 'append')
  .map((call) => call.request.record);
console.log(`verify_status=${verify.status}`);
console.log(`verify_observation=${verify.lifecycle_observation.status}`);
console.log(`verify_round_seen=${verifyRecords.some((record) => record.unit === 'verify_round' && record.status === 'passed')}`);
console.log(`verify_command_wire=${JSON.stringify(verifyObserver.calls).includes('verified-command-secret-must-not-leave-engine')}`);

const resumeObserver = makeObserver();
const resumeCounters = { implementation: 0, review: 0 };
const resumed = run(makeEngine(resumeObserver, resumeCounters, {
  engineOptions: {
    gitResumeInspect() {
      return { error: null, exists: true, tipSha: COMMIT, baseAncestor: true };
    },
  },
}), config, { resume: true });
const resumeRecords = resumeObserver.calls
  .filter((call) => call.kind === 'append')
  .map((call) => call.request.record);
console.log(`resume_status=${resumed.status}`);
console.log(`resume_observation=${resumed.lifecycle_observation.status}`);
console.log(`resume_impl_review=${resumeCounters.implementation}:${resumeCounters.review}`);
console.log(`resume_precheck_seen=${resumeRecords.some((record) => record.unit === 'resume_precheck' && record.status === 'resumed')}`);
console.log(`resume_implementation_seen=${resumeRecords.some((record) => record.unit === 'resume_implementation' && record.status === 'resumed')}`);
NODE
)"; EXIT=$?

assert_eq "0" "$EXIT" "engine lifecycle observation test process exits 0"
assert_contains "$OUT" "observed_status=converged" "observation sidecar preserves legacy convergence"
assert_contains "$OUT" "observed_observation=observed" "host observer records a complete observation"
assert_contains "$OUT" "observed_entries=4" "sidecar records each engine ledger entry plus implementation and review outcomes"
assert_contains "$OUT" "observed_terminal=true" "sidecar closes the terminal observation"
assert_contains "$OUT" "observed_authority=none" "sidecar does not grant Owner Kernel authority"
assert_contains "$OUT" "observed_acceptance=not_available" "sidecar cannot claim acceptance"
assert_contains "$OUT" "observed_alias=false" "sidecar cannot qualify alias retirement"
assert_contains "$OUT" "observed_terminal_kind=engine_converged" "convergence is recorded as an engine terminal only"
assert_contains "$OUT" "observed_terminal_acceptance=not_available" "terminal record cannot turn convergence into acceptance"
assert_contains "$OUT" "observed_open_level=l5" "sidecar binds the explicit L5 legacy level"
assert_contains "$OUT" "observed_append_count=4" "sidecar uses one compare-and-append call per nonterminal record"
assert_contains "$OUT" "observed_push_restored=false" "engine ledger array is restored after observation completes"
assert_contains "$OUT" "wire_prompt_secret=false" "observer never receives prompt content"
assert_contains "$OUT" "wire_branch_secret=false" "observer never receives raw branch names"
assert_contains "$OUT" "wire_findings_secret=false" "observer never receives reviewer findings"
assert_contains "$OUT" "wire_raw_log_secret=false" "observer never receives raw log paths"
assert_contains "$OUT" "no_config_status=converged" "injected observer without explicit context leaves legacy loop unchanged"
assert_contains "$OUT" "no_config_field=false" "no explicit context adds no observation result field"
assert_contains "$OUT" "no_config_calls=0" "no explicit context makes no observer calls"
assert_contains "$OUT" "stale_status=converged" "stale observation head cannot block the legacy loop"
assert_contains "$OUT" "stale_impl_review=1:1" "stale observation head does not suppress implementation or review"
assert_contains "$OUT" "stale_observation=partial" "compare-and-append failure is disclosed as partial telemetry"
assert_contains "$OUT" "stale_stage=append" "compare-and-append failure is attributed to append"
assert_contains "$OUT" "stale_terminal=false" "failed observation never fabricates a terminal receipt"
assert_contains "$OUT" "stale_acceptance=not_available" "partial telemetry cannot claim acceptance"
assert_contains "$OUT" "invalid_status=converged" "invalid observation context cannot block the legacy loop"
assert_contains "$OUT" "invalid_observation=failed" "only L5 and L6 observation contexts are accepted"
assert_contains "$OUT" "invalid_stage=open" "invalid level fails before opening host telemetry"
assert_contains "$OUT" "invalid_calls=0" "invalid level makes no observer call"
assert_contains "$OUT" "rollback_append_status=converged" "replayed append head cannot block the legacy loop"
assert_contains "$OUT" "rollback_append_observation=partial" "replayed append head is not accepted as ordered telemetry"
assert_contains "$OUT" "rollback_append_stage=append" "replayed append head is attributed to append"
assert_contains "$OUT" "rollback_append_terminal=false" "replayed append head cannot produce a terminal receipt"
assert_contains "$OUT" "rollback_close_status=converged" "replayed terminal head cannot block the legacy loop"
assert_contains "$OUT" "rollback_close_observation=partial" "replayed terminal head is not accepted as ordered telemetry"
assert_contains "$OUT" "rollback_close_stage=close" "replayed terminal head is attributed to close"
assert_contains "$OUT" "rollback_close_terminal=false" "replayed terminal head cannot mark telemetry complete"
assert_contains "$OUT" "wrong_binding_status=converged" "receipt binding mismatch cannot block the legacy loop"
assert_contains "$OUT" "wrong_binding_observation=partial" "receipt binding mismatch is not accepted as telemetry"
assert_contains "$OUT" "wrong_binding_stage=append" "receipt binding mismatch is attributed to append"
assert_contains "$OUT" "wrong_binding_terminal=false" "receipt binding mismatch cannot produce a terminal receipt"
assert_contains "$OUT" "cyclic_baseline_status=converged" "cyclic dispatcher metadata does not block the legacy baseline"
assert_contains "$OUT" "cyclic_observed_status=converged" "cyclic dispatcher metadata cannot make the sidecar throw"
assert_contains "$OUT" "cyclic_observation=partial" "unserializable sidecar metadata is disclosed as partial"
assert_contains "$OUT" "cyclic_stage=append" "unserializable sidecar metadata fails only the append"
assert_contains "$OUT" "cyclic_impl_review=1:1" "sidecar serialization failure does not suppress implementation or review"
assert_contains "$OUT" "secret_status_result=blocked" "custom token-shaped implementation status follows legacy blocking behavior"
assert_contains "$OUT" "secret_status_wire=false" "unknown token-shaped statuses are hashed before observation"
assert_contains "$OUT" "class_observation=observed" "class-instance host adapters are accepted"
assert_contains "$OUT" "class_calls=6" "class-instance adapter receives the complete observation protocol"
assert_contains "$OUT" "bound_observation=observed" "explicit engine run IDs can bind to the engine input runId"
assert_contains "$OUT" "mismatch_status=converged" "run-ID mismatch cannot block the legacy loop"
assert_contains "$OUT" "mismatch_observation=failed" "run-ID mismatch rejects the observation context"
assert_contains "$OUT" "mismatch_stage=open" "run-ID mismatch fails before host telemetry opens"
assert_contains "$OUT" "mismatch_calls=0" "run-ID mismatch makes no observer call"
assert_contains "$OUT" "repair_status=converged" "two-round repair remains converged with observation enabled"
assert_contains "$OUT" "repair_observation=observed" "two-round repair closes a complete observation"
assert_contains "$OUT" "repair_impl_review=2:2" "two-round repair dispatches both implementation and review rounds"
assert_contains "$OUT" "repair_outcomes=2:2" "two-round repair records each implementation and review outcome"
assert_contains "$OUT" "verify_status=converged" "verification path remains converged with observation enabled"
assert_contains "$OUT" "verify_observation=observed" "verification path closes a complete observation"
assert_contains "$OUT" "verify_round_seen=true" "verification result is mirrored as a bounded lifecycle record"
assert_contains "$OUT" "verify_command_wire=false" "verification command is hashed before observation"
assert_contains "$OUT" "resume_status=converged" "resume path remains converged with observation enabled"
assert_contains "$OUT" "resume_observation=observed" "resume path closes a complete observation"
assert_contains "$OUT" "resume_impl_review=0:1" "resume path skips redispatch and performs one review"
assert_contains "$OUT" "resume_precheck_seen=true" "resume precheck is mirrored into the observation ledger"
assert_contains "$OUT" "resume_implementation_seen=true" "synthetic resume implementation is mirrored into the observation ledger"

finalize_test
