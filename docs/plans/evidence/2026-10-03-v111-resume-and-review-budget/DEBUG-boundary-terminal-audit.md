## Debugger Report

### Verdict
**PRODUCT DEFECT.** At origin/develop (f197fc09), a managed implementation campaign that has passed through BOUNDARY_REJECTED can never reach terminal success.

The success terminalize runs with `requireCompleteTranscript` and is always blocked at `controller_work_order_terminalize` (phase name `controller_work_order_terminalize`). The block is deterministic, because both halves come from rows written at boundary time and neither is ever repaired.

### Reproduction
This uses the real `runCampaignIntake`, a real ledger and real mission-managed terminal handling. It is a copy of the xproc final-panel driver (`final-panel-seat-xproc-driver.js`, not on develop; I took it from the wt-C2 worktree) pointed at the develop tree.

The copy has two changes:
- Run1 overrides `engine.implementTask` to return the exact shape the engine's boundary-rejected path produces. This is `status:'boundary_rejected'`, `candidate_ref`, `possibly_effectful:true`, `dispatcher_called:true`, and an `implementation` object carrying the worktree and run identity.
- A hook on `rebuildTranscriptAudit` logs the audit problems.

Files, all under `/tmp/claude-1000/-home-cookys-projects-autopilot/76c98aac-1838-4acb-bedd-e36d6bed7724/scratchpad/run/dbg/`:
- Driver and stub: `xdriver.js`, `stub.sh`.
- Env-scrub wrapper: `e.sh` (a `env -u …` wrapper script, because zsh rejected the inline form).
- Contexts: `x2/ctx.json` is the boundary case; `x3/ctx.json` is the control.

```
e.sh node xdriver.js run1 x2/ctx.json  -> status=blocked reason="scope boundary" durable_wait=true   (parked in BOUNDARY_REJECTED)
e.sh node xdriver.js run2 x2/ctx.json  -> impl=0 (no re-dispatch), resume goes to REVIEWING and review
   status=blocked  phase=controller_work_order_terminalize
   reason="controller transcript audit blocks terminal: audit_event 3e15d9d7… has foreign or missing controller
           tuple undefined/undefined; dispatch 53bdab86… lacks exact run/provider/resource/result-receipt identity"
```

The control is the same driver with no boundary in run1 (`x3`). It ends `status=converged phase=campaign_terminal_ready`. So the block comes from passing through BOUNDARY_REJECTED, not from the driver.

On the resume path, the cleanup transaction, the final panel and the Mission terminal all succeed. The block is the first step in the terminal block, at the `requireCompleteTranscript: composition.status === 'ready'` call. That call is at `src/engine/autopilot-engine.js:9296-9312` (blocked-return at 9313). The throw is at `autopilot-engine.js:7046-7052` (`transcript_incomplete`).

### The existing boundary-resume test never reaches this
I ran `hooks/tests/autopilot-engine-boundary-resume.test.sh`. It prints `green_reason=git worktree command exited with status 1` and never asserts the final status.
- That string is produced by `worktreeResultBlocked` at `autopilot-engine.js:2364`, via the cleanup transaction at `autopilot-engine.js:9024-9031`.
- The fixture computes `worktree_instance_id` as `sha256(worktree)`. `src/engine/repair-lineage-cleanup.js:41-48` expects a hash of `{birthtime_ns, device, inode, schema:1, worktree}`. The fixture also lacks the `.autopilot-worktree` marker that cleanup requires (`repair-lineage-cleanup.js:80-100`). So cleanup fails first.
- I injected a passing `repairLineageCleanupTransaction`. The stage then advanced to `campaign_repair_lineage_recovery_receipt` (reason "removed caller flag is not authority without Git removal reobservation", because nothing really removes the worktree). It still never reached the transcript audit.
- The reason it never reaches the audit is that the fixture's `campaignEventAppender` stub means `missionTerminalOutcomeCompleted` is false. The `controllerWorkOrder` terminalize at `autopilot-engine.js:9293` is therefore skipped. This is a fixture gap.
- The hand's own fixture did not exhibit the gap because it supplied a real Work Order and mission terminal. So the test hand's observation is real product behaviour, not fixture-only.

### path:line chain

**Half 1: null `result_receipt_digest`**
1. `src/engine/autopilot-engine.js:7846-7870` builds the boundary_rejected mutation. It carries `repair_lineage`, `raw` and `candidate_ref`, but no `writer_fence`. A writer fence is only created on the committed path (`autopilot-engine.js:7945-7997`, `writer_fence: writerFence`).
2. `src/engine/campaign-composition.js:1640-1670` writes the dispatch record before the boundary classification at ~1743.
   - It sets `result_receipt_digest: mutation.writer_fence && mutation.writer_fence.receipt_digest || null`, which is `null` here.
   - The record is digest-bound, so it is immutable. The resume dispatches nothing (`impl=0`), so nothing rewrites it.
   - Evidence from the checkpoint: `dispatch_records[0].result_receipt_digest = null`, digest `53bdab86…`.
3. `src/engine/controller-execution.js:3926-3932` (`rebuildTranscriptAudit`) requires `isCanonicalSha256(dispatch.result_receipt_digest)`. It pushes "lacks exact run/provider/resource/result-receipt identity".

**Half 2: the `undefined/undefined` audit_event**
1. `src/engine/campaign-composition.js:1773-1796` builds `boundaryReceiptBody` with these fields:
   - `schema_version`, `artifact_type:'campaign_boundary_receipt'`, `campaign_id`, `base`, `candidate_ref`, `boundary_code`, `offending_paths` and `dispatch_result_digest`.
   - It has no `root_run_id`, no `work_order_id` and no `event`.
2. `campaign-composition.js:1813-1820` pushes that receipt onto `controller.audit_events`. The comment there says it is deliberately an audit-only write.
3. `src/engine/controller-execution.js:3575` runs `pushUnique('audit_events','audit_event', e, e.digest)`.
   - `controller-execution.js:3525-3530` then compares `item.root_run_id !== rootRunId || item.work_order_id !== workOrderId`.
   - The error text uses `String(item.root_run_id)/String(item.work_order_id)`, which gives `undefined/undefined` for absent keys.
   - Evidence: the offending event is the checkpoint row `3e15d9d739289aab…`, an `artifact_type: campaign_boundary_receipt` with no tuple.
   - Every other audit event in that campaign carries the root and Work Order. Only this one row (`{}` in my event summary, because it also has no `event` key) lacks them.
4. The tuple is not in the receipt digest body. A fix that stamps it must keep the digest consistent with `boundary_receipt_digest` as journaled and with the reducer's `output_artifact_digest`.

### Minimal real-world trigger
- A managed (durable-journal, Mission-bound) implementation campaign where the implementer rail returns `boundary_rejected`, typically a scope or budget boundary.
- The campaign is then resumed or dispositioned with a git-bound `resume_candidate`, and acceptance goes through review to composition `ready`.
- The block is also hit for any such campaign that reaches `ready` after a boundary. A campaign that ends as `follow_up` is not affected, because it does not set `requireCompleteTranscript`.
- A rail-supplied boundary with no candidate cannot be resumed anyway, as the red stage shows.

### Fix shape (prose, no code)
1. **Audit event half.** The boundary receipt is audit-only evidence and is already persisted with the controller. Either of these works:
   - Stamp `root_run_id` and `work_order_id` onto the persisted `audit_events` row only. They would sit outside `boundaryReceiptBody`, so the digest and the journal binding stay unchanged. Also give it an `event` name.
   - Or have `rebuildTranscriptAudit` treat `artifact_type: campaign_boundary_receipt` as controller-scoped evidence that is cross-checked by `campaign_id` against `rootRunId`.
   The first is simpler, and it keeps the rule that observed rows are never stamped inside `pushUnique`. The tuple is added at the producer, not stamped on observed evidence.
2. **Dispatch half.** The dispatch record needs a real `result_receipt_digest` for a boundary_rejected outcome.
   - The cleanest option is to make the boundary mutation carry a receipt digest, for example the `dispatch_result_digest` already computed for the boundary receipt.
   - Alternatively, `rebuildTranscriptAudit` could accept a boundary dispatch whose receipt digest binds to the boundary receipt.
   - It must not be a null, and must not be forced to a fabricated value. The dispatch row is immutable, so the fix has to apply when the dispatch record is written, at `campaign-composition.js:1640-1670`.
3. Ship the fix as a mechanism change that lets an already-stated gate pass for a valid flow. It must not change what the transcript audit demands.

### Regression test shape
- Use the xproc-driver shape: real intake, run1 parks in boundary_rejected, run2 `--resume`. Add the boundary override that I added in `xdriver.js` via `ctx.boundaryPhase`.
- Assert run2 ends `converged` / `campaign_terminal_ready` with no `transcript_incomplete`.
- Assert the audit is clean: every `audit_events` row has the controller tuple, and the boundary dispatch has a canonical `result_receipt_digest`.
- Keep the control (no boundary, still converges) next to it.
- Add a negative case that tampers with the receipt tuple or digest and still blocks, so the audit stays real.
- Also fix `autopilot-engine-boundary-resume.test.sh`.
  - Derive `worktree_instance_id` the way `repair-lineage-cleanup.js` expects, or inject the cleanup transaction.
  - Provide the Work Order and mission terminal.
  - Assert the final status, so it reaches the transcript audit instead of printing a `green_reason` and passing.

### Handoff
Next consumer: NEEDS_DOMAIN_EXPERT
Routing rationale: the fix touches the controller transcript-audit digest invariants and the campaign-composition boundary receipt and dispatch record shapes, and needs someone who owns the controller-authority and campaign-reducer contracts.
Remaining risks:
- I used an implementTask-level override. It matches the shape the engine's boundary path produces, but I did not run a real dispatch-author boundary rejection.
- The stage's cleanup was exercised only through injection, so I did not verify real worktree removal after resume.
- Neither fix half was applied, so the sketch is untested.

The scratch worktree is removed (`wt-dbg` is gone from the clone's worktree list). The scratch drivers remain under `/tmp/claude-1000/-home-cookys-projects-autopilot/76c98aac-1838-4acb-bedd-e36d6bed7724/scratchpad/run/dbg/`. I edited no tracked files.