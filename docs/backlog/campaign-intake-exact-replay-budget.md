# Exact-replay no-op resume refused when budgets are exhausted (BL-0360)

Reported by an openclaw fleet session (report 01M6AATV4Y687QQJS6R82F5JT8, full test hunk in 01M6AAX77KC96C5023MD9BWSWX).

## Problem

`src/engine/campaign-intake.js` already marks a durable resume that is an exact replay no-op as `resume_durable_wait` (`exact_replay`, `no_op`, `dispatcher_called=false`). The changed-file and churn budget checks that follow do not honour that mark, so a resume that dispatches nothing and mutates nothing is still rejected with `campaign_file_budget_exhausted` or `campaign_churn_budget_exhausted` once a budget is spent.

## Fix direction

Skip the two budget rejections only when the wait is proven exact-replay, no-op, no dispatcher call, zero mutation attempts and zero gate attempts. Every mutation-capable resume and every unmarked durable state keeps the rejection. Candidate, authority, identity, wall-clock and ledger guards stay unchanged. Negative control: a mutation-capable resume with a full budget must still be rejected.

## Original patch

Port through the normal review; do not apply verbatim. The MUT_SEAL assignment before the first node block is dead (overwritten from mut_seal=) and can be dropped.

The branch is fix/resume-guard-maintenance-20260921 at ff4b76968, present only on the reporter. Its commit message says QC is pending and it is not approved for merge. Source change (hunk in `src/engine/campaign-intake.js`, right after `existing.resume_review_digest = reviewReference.digest;`):

```diff
-    if (existing.state.usage.changed_files >= existing.state.limits.max_changed_files) {
-      return rejected('campaign_generation','campaign_file_budget_exhausted','durable campaign has no changed-file budget remaining');
-    }
-    if (existing.state.usage.churn >= existing.state.limits.max_churn) {
-      return rejected('campaign_generation','campaign_churn_budget_exhausted','durable campaign has no churn budget remaining');
-    }
+    // Exhausted file/churn budgets still admit a proven exact-replay no-op
+    // (resume_durable_wait already marked no dispatch / no mutation). Every
+    // mutation-capable resume and unmarked durable state keeps the rejection.
+    const exactReplayNoMutation = Boolean(
+      existing.resume_durable_wait
+      && existing.resume_durable_wait.exact_replay === true
+      && existing.resume_durable_wait.no_op === true
+      && existing.resume_durable_wait.dispatcher_called === false
+      && existing.resume_durable_wait.mutation_attempts === 0
+      && existing.resume_durable_wait.gate_attempts === 0,
+    );
+    if (!exactReplayNoMutation) {
+      (the two original budget checks moved here unchanged)
+    }
     const preflightEvent = buildResumeEvent({ ...
```

Changelog text proposed by the patch: when `resume_durable_wait` is marked exact_replay, no-op, zero dispatch and zero mutation, an exact replay is no longer rejected for an exhausted file or churn budget; mutation-capable resume and unmarked state keep the budget rejection.

### Tests in hooks/tests/implementation-campaign-routing.test.sh

(1) In the disposition-resume block, after `console.log('legacy_empty_snapshot_resumes=true')`:

```js
const incompleteAdapters = adapters(provider, { controllers: [], events: [] });
incompleteAdapters.adjudicate = () => ({ registry_complete: false, repair_gate_passed: false, reason: 'registry incomplete', must_fix_now: [], follow_up: [], rejected: [] });
const incompleteSink = { controllers: [], events: [] };
incompleteAdapters.onCampaignEvent = (event) => incompleteSink.events.push(event.event_type);
incompleteAdapters.onControllerUpdate = (controller) => { incompleteSink.controllers.push(JSON.parse(JSON.stringify(controller))); };
const incomplete = runCampaignComposition({ promptBytes: 0, maxRepairGenerations: 1, minPanelSize: 1, controller: persisted,
  resume: resumeFrom(persisted, persisted.findings_snapshot || persisted.unresolved_findings) }, incompleteAdapters);
assert.strictEqual(incompleteSink.events.includes('DISPOSITION_RESUMED'), false, `incomplete registry emitted ${JSON.stringify(incompleteSink.events)}`);
assert.notStrictEqual(incomplete.status, 'ready');
assert.notStrictEqual(incomplete.phase, 'terminal_ready');
console.log('incomplete_registry_skips_disposition_resumed=true');
```

Also add `incomplete_registry_skips_disposition_resumed` to the key list of the check loop (after `legacy_empty_snapshot_resumes`).

(2) After `assert_contains "$DISP_RESUME_OUT" "t3_preclaim_drift=true" "T3 pre-claim drift refused"`, a mutation-capable full-budget test (context lines before it: the two `wall_clock_paused_resume_admitted=true` lines):

```bash
MUT_CONTRACT="$DISP_CONTRACT.mutation.json"
MUT_SEAL="$DISP_SEAL.mutation.json"
git -C "$DISP_WT" reset --hard "$C0" >/dev/null
git -C "$DISP_SBX" replace -d "$C1" >/dev/null 2>&1 || true
MUT_JOURNAL="$(node - "$REPO_ROOT" "$DISP_SBX" "$DISP_WT" "$DISP_CONTRACT" "$DISP_PROMPT" \
  "$DISP_BASE" "$C0" "$C0_TREE" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [
  root, repo, worktree, contractPath, promptFile, base, c0, c0Tree,
] = process.argv.slice(2);
const {
  CAMPAIGN_EVENTS,
  appendCampaignEvent,
  canonicalDigest,
  createWriterFence,
  runCampaignIntake,
} = require(path.join(root, 'src', 'engine'));
const { worktreeInstanceId } = require(path.join(root, 'src', 'engine', 'repair-lineage-cleanup'));
const mutationContract = `${contractPath}.mutation.json`;
const mutationSeal = `${contractPath}.mutation.seal.json`;
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
contract.ticket = 'icc-disp-mutation-budget';
fs.writeFileSync(mutationContract, `${JSON.stringify(contract, null, 2)}\n`);
const sealed = spawnSync(process.execPath, [
  path.join(root, 'scripts', 'implementation-campaign-check.js'),
  'seal', '--contract', mutationContract, '--repo', repo,
  '--mission-mode', 'shadow', '--out', mutationSeal,
], { encoding: 'utf8' });
assert.strictEqual(sealed.status, 0, sealed.stderr || sealed.stdout);
const adapters = {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
};
let control = runCampaignIntake({
  repo, contractPath: mutationContract, sealPath: mutationSeal, promptFile,
  branch: 'impl/disp-resume', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: '2026-09-16T00:00:00.000Z',
}, adapters);
assert.strictEqual(control.status, 'admitted', JSON.stringify(control.rejection || control));
const mutationId = control.campaign_id;
const lineage = {
  lineage_id: mutationId,
  branch: 'impl/disp-resume',
  worktree,
  provider_session_id: null,
  provider_session_reused: false,
  provider_session_non_reuse_reason: 'runner_resume_not_verified:fixture',
  worktree_reused: false,
  worktree_instance_id: worktreeInstanceId(worktree),
  cleanup_epoch: 1,
  cleanup_receipt_id: null,
  generation: 0,
  inherited_churn: 0,
  delta_churn: 2,
  retention_owner: mutationId,
  retention_reason: 'implementation-campaign-repair-lineage',
  retention_expires_at: 2000000000,
  terminal_worktree_disposition: 'active',
  transcript_reused: false,
  transcript_source_digest: 'a'.repeat(64),
  review_input_mode: 'full_diff_generation',
  new_input_bytes: 17,
  new_input_tokens: 23,
  input_token_measurement: 'provider_reported',
  finding_occurrences: [],
  accepted_invariant_ids: [`acceptance:${'c'.repeat(64)}`],
  accepted_invariants: ['preserve durable invariant'],
  accepted_invariants_source_commit: c0,
  accepted_invariants_digest: canonicalDigest({
    schema: 1,
    assertions: ['preserve durable invariant'],
    source_commit: c0,
  }),
  prior_review_finding_ids: [],
  previous_repair_finding_count: null,
  non_reduction_rounds: 0,
  repair_scope_paths: ['src/value.txt'],
  repair_scope_seal: null,
};
const gitCandidate = {
  kind: 'git_candidate',
  commit: c0,
  tree_sha: c0Tree,
  branch: 'impl/disp-resume',
  base,
  writer_fence: createWriterFence({
    campaignId: mutationId,
    stageIdentity: 'campaign-implementation',
    candidateCommit: c0,
    candidateTreeSha: c0Tree,
    implementationResult: {
      status: 'committed',
      implementation: { commit: c0 },
      implementationResult: { error: null, signal: null, status: 0 },
    },
  }),
  repair_lineage: lineage,
};
control = { ...control, initial_state: appendCampaignEvent({
  repo, campaignControl: control, observedAt: '2026-09-16T00:00:01.000Z',
  eventType: CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED, generation: 0,
  stageIdentity: 'campaign-mutation:0', payload: { sealed_contract: true },
}).state };
control = { ...control, initial_state: appendCampaignEvent({
  repo, campaignControl: control, observedAt: '2026-09-16T00:00:02.000Z',
  eventType: CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED, generation: 0,
  stageIdentity: 'campaign-mutation:0',
  payload: { scope_check_passed: true, scope_check_digest: 'd'.repeat(64) },
  artifactReference: gitCandidate,
  usage: { changed_files: 4, churn: 15 },
}).state };
console.log(`mut_seal=${mutationSeal}`);
console.log('mutation_journal=true');
NODE
)"
assert_exit_code "$?" "0" "mutation-capable journal: $MUT_JOURNAL"
MUT_SEAL="$(printf '%s\n' "$MUT_JOURNAL" | sed -n 's/^mut_seal=//p')"
MUT_RESUME="$(node - "$REPO_ROOT" "$DISP_SBX" "$MUT_CONTRACT" "$MUT_SEAL" "$DISP_PROMPT" "$DISP_BASE" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const [root, repo, contractPath, sealPath, promptFile, base] = process.argv.slice(2);
const { runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const blocked = runCampaignIntake({
  repo, contractPath, sealPath, promptFile,
  branch: 'impl/disp-resume', base,
  roster: { implementer_engine: 'fixture-implementer' },
  observedAt: '2026-09-16T00:00:03.000Z',
  resume: true,
}, {
  readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
  contextGate: () => ({ owner: 'context_window', status: 'ready' }),
  occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
});
assert.strictEqual(blocked.status, 'blocked', JSON.stringify(blocked));
assert.strictEqual(
  blocked.rejection.code,
  'campaign_file_budget_exhausted',
  JSON.stringify(blocked.rejection || blocked),
);
console.log('mutation_capable_full_budget_blocked=true');
NODE
)"
assert_exit_code "$?" "0" "mutation-capable resume blocked: $MUT_RESUME"
assert_contains "$MUT_RESUME" "mutation_capable_full_budget_blocked=true" \
  "full-budget mutation-capable resume stays rejected"
```

(3) In T5, after the BOUNDARY_REJECTED event (artifactReference `{ kind: 'campaign_boundary_rejected', digest }`), add `usage: { changed_files: 4, churn: 15 },` to fill the budget.

(4) In the T5 resume assertions, after `assert.strictEqual(wait.candidate_ref, 'unbound-candidate')`:

```js
assert.strictEqual(wait.exact_replay, true);
assert.strictEqual(wait.no_op, true);
assert.strictEqual(wait.dispatcher_called, false);
assert.strictEqual(wait.mutation_attempts, 0);
console.log('t5_full_budget_exact_replay_admitted=true');
```

and in the outer shell: `assert_contains "$T5_RESUME" "t5_full_budget_exact_replay_admitted=true" "T5 full-budget exact-replay durable wait is admitted"`.

Omitted from the report: platforms/codex mirror (same as src), version-file bumps, and a maintenance-log row with commit PENDING.
