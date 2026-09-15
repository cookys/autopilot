# Disposition resume: the durable-wait resume candidate carries the repair-scope sha, and is verified against Git

> Status: execution plan for ONE managed deliverable (`/l5`, mission graph node
> `disposition-resume-2026-09-16`).
> Source row: `docs/BACKLOG.md` "Managed rail: disposition resume dies in `check-repair-scope.js` —
> `scope_implementation_sha` never set" (fired 2026-09-16, cuda e2e on fleet-comms, the v2.36.41
> measurement point). Owner instruction 2026-09-16: CEO mode, work the fired rows in order via `/l5`.

## 0. What is actually broken (measured 2026-09-16)

Resuming a campaign parked at `awaiting_disposition` with
`engine implement-review --resume --campaign-disposition-authority <file>` exits 2 with no JSON:
`implementation_sha must be an immutable full 40-hex commit object ID` from
`scripts/check-repair-scope.js:215`.

The BACKLOG row and HANDOFF blame `campaign-intake.js:621-633` ("nothing sets
`initial_candidate_reference`"). That is wrong: `projectCampaign` (`src/campaign/cli.js:521`) sets it
for every ledger with a `git_candidate` artifact reference. The real mechanism:

1. `defaultGenerationClaim` (`src/engine/campaign-intake.js:790-814`) handles the durable-wait
   phases (`BOUNDARY_REJECTED`, `AWAITING_DISPOSITION`, `AWAITING_CONVERGENCE_ADJUDICATION`) by
   assigning `existing.resume_candidate = existing.candidate_reference` — the RAW ledger artifact
   reference (`kind, commit, tree_sha, branch, base, writer_fence, repair_lineage, …`).
2. Lines 816-819 explicitly skip `verifyResumeCandidate` for `BOUNDARY_REJECTED` and
   `AWAITING_DISPOSITION` (and never reach it for `AWAITING_CONVERGENCE_ADJUDICATION`).
   `verifyResumeCandidate` (`campaign-intake.js:518-635`) is the ONLY producer of the normalized
   resume shape `{committed, commit, tree_sha, branch, writer_fence, campaign_contract_sha256?,
   unit_contract_sha256?, scope_implementation_sha, repair_lineage}`.
3. `autopilot-engine.js:4610-4616` reads `resumeCandidate.scope_implementation_sha` (undefined for a
   raw reference) into `createCampaignScopeSession` (`:1458`), which freezes it as the repair-scope
   contract's `implementation_sha`; `check-repair-scope.js:215` rejects it on the first scope check.

So every durable-wait resume that reaches a scope check dies; the composition-layer suites never saw
it because they stub `scopeCheck`, and the intake-layer resume suite covers only `ADJUDICATING`
(`hooks/tests/implementation-campaign-routing.test.sh:944-1330`).

Two secondary facts the fix must respect:

- The non-durable path sets `scope_implementation_sha = (initial_candidate_reference ||
  candidate_reference).commit` — the FIRST generation's candidate (the churn baseline of the whole
  campaign) — and `commit = candidate_reference.commit` (the current tip). For generation > 1 they
  differ; binding `awaiting_disposition.candidate_ref` (the current tip) literally would drift the
  churn baseline from every other resume path.
- The engine's terminalization ladder (`autopilot-engine.js:2714-2731`) treats a present
  `generation_claim.resume_candidate` as "GIT-VERIFIABLE (intake bound resume_candidate)". Today the
  durable-wait branch sets it WITHOUT verification, so that premise is unmet for exactly these phases.

## 1. Ruling and shape

Route a durable-wait resume whose `candidate_reference.kind === 'git_candidate'` through
`verifyResumeCandidate` exactly like the non-durable phases (option (a) of the design consult,
see Review log). A durable-wait projection with no git candidate keeps today's behaviour:
`resume_candidate` stays unset and `resume_durable_wait` alone carries the recorded ref (this is the
`BOUNDARY_REJECTED` + `candidate_ref: 'unbound-candidate'` case, `campaign-composition.js:1742`,
which the terminalization ladder already handles as "recorded-ref-without-git-object").

Consequences:
- `resume_candidate` for every phase has ONE shape — the `verifyResumeCandidate` return — with
  `scope_implementation_sha` = the initial candidate commit.
- A durable-wait resume whose retained branch tip, candidate tree, or base ancestry no longer matches
  is refused pre-claim with `campaign_resume_git_drift` / `campaign_resume_candidate_invalid`, the same
  codes the `ADJUDICATING` resume already uses. A resume against drifted Git truth used to proceed
  and fail later (or, worse, scope-check the wrong tree).
- No reducer, ledger schema, event, or CLI flag changes. `--campaign-disposition-policy` and
  `--campaign-disposition-authority` remain mutually exclusive.

## 2. Changes by file

### 2.1 `src/engine/campaign-intake.js` (`defaultGenerationClaim`, ~790-830)

- In the `durableWaitPhase` block: when `existing.candidate_reference` is a `git_candidate`, set
  `existing.resume_candidate = verifyResumeCandidate({ projection: existing, repo, base })` inside the
  same try/catch shape as the non-durable branch (a thrown `CampaignIntakeError` becomes
  `rejected('campaign_generation', error.code || 'campaign_resume_candidate_invalid', message)`).
  Remove the two raw assignments (`existing.resume_candidate = existing.candidate_reference`).
- The `resumableCandidatePhase` block keeps its exclusions (do not double-verify); the
  `AWAITING_CONVERGENCE_ADJUDICATION` phase is covered by the durable-wait block.
- `verifyResumeCandidate` itself is unchanged (its `scope_implementation_sha` already derives from
  `initial_candidate_reference || reference`).

### 2.2 `platforms/codex/plugin/src/engine/campaign-intake.js`

Byte-identical mirror (`bash scripts/sync-codex-plugin-skills.sh --check`).

### 2.3 Docs

- `docs/BACKLOG.md`: the fired row → `shipped <version> 2026-09-16`, Context corrected to the real
  mechanism (durable-wait branch bypasses `verifyResumeCandidate`).
- `skills/l5/references/hetero-impl-loop.md` step 11: move "disposition resume dies in
  `check-repair-scope.js`" from the open list to the "Fixed since 2026-09-14" list with the version.
- `CHANGELOG.md`: new PATCH section (depth-0 writes it at release, not the hand).

### 2.4 Tests (`hooks/tests/implementation-campaign-routing.test.sh`, extend the P3 resume block)

All change-pinning assertions recorded RED against base `3831d5f6` in a comment at the block head;
preservation guards labelled and green at base.

- **T1 (RED at base) intake shape**: from the existing P3 sandbox (real git repo, real ledger under
  `$SBX/.git/autopilot/`), append the engine-shaped `AWAITING_DISPOSITION` event to a COPY of the
  campaign ledger (never the suite's live P3 ledger, never the host ledger) so the projection phase is
  `awaiting_disposition` with `awaiting_disposition.candidate_ref` = candidate; run `runCampaignIntake({
  resume: true })` with the fixture adapters; assert `status === 'admitted'`,
  `generation_claim.resume_candidate.committed === true`,
  `generation_claim.resume_candidate.scope_implementation_sha === <initial candidate sha>` (40-hex),
  `generation_claim.resume_candidate.commit === <candidate sha>`, and
  `generation_claim.resume_durable_wait.phase === 'awaiting_disposition'`.
- **T2 (RED at base) generation > 1 discriminator**: same fixture but with TWO `git_candidate`
  artifact references in the ledger (initial `c1`, repair `c2`, both real commits on the retained
  branch, `c2` the tip); assert `scope_implementation_sha === c1` and `commit === c2`. A shape-only
  patch that copies `candidate_ref`/`commit` yields `c2` for both and fails this assertion.
- **T3 (RED at base) drift refusal**: `git update-ref` the retained branch to base and re-run the
  intake probe; assert `status === 'blocked'` and `rejection.code === 'campaign_resume_git_drift'`;
  restore the ref afterwards.
- **T4 (RED at base) engine scope check**: `AutopilotEngine.runImplementationReviewLoop({ resume:
  true, … })` on the `awaiting_disposition` ledger with a `must-fix-now` disposition authority and the
  P3 fixture adapters; assert the run does NOT stop with `phase` in
  `{'campaign_scope_session', 'scope_check'}` and its repair-scope contract (`scopeCheck` input, or the
  ledger row) carries `implementation_sha === c1`. (The composition-layer disposition test at
  `:369-521` stays as is — it is the finding-rebind proof, not this one.)
- **T5 (preservation, green at base)**: a `BOUNDARY_REJECTED` projection whose only recorded ref is
  `'unbound-candidate'` (no `git_candidate` artifact) still admits with `resume_candidate` unset and
  `resume_durable_wait.candidate_ref === 'unbound-candidate'`.
- **T6 (preservation, green at base)**: the existing `ADJUDICATING` P3 resume assertions
  (`resume_status=converged`, `implementation_calls=0`, `review_calls=4`, …) are unchanged.

## 3. Out of scope (do not touch)

- `check-repair-scope.js`, `createCampaignScopeSession`, the reducer (`implementation-campaign.js`),
  `campaign-composition.js`, `src/campaign/cli.js`.
- Convergence-adjudication resume semantics beyond the shape fix (no new tests for that phase; the
  branch simply follows the same code path).
- The two other cuda reports of 2026-09-16 (failed `campaign_verification` proceeds to review; the
  intake dirty-tree message) — separate BACKLOG rows, separate campaigns.

## 4. Acceptance

| id | criterion | evidence |
|----|-----------|----------|
| `resume-shape` | every admitted resume (`VERTICAL_VERIFICATION`, `ADJUDICATING`, `BOUNDARY_REJECTED` with git candidate, `AWAITING_DISPOSITION`, `AWAITING_CONVERGENCE_ADJUDICATION`) exposes `generation_claim.resume_candidate` in the `verifyResumeCandidate` shape with a 40-hex `scope_implementation_sha` equal to the initial candidate | T1, T2 |
| `durable-wait-drift-refused` | a durable-wait resume whose retained branch/tree/ancestry drifted is `blocked` pre-claim with `campaign_resume_git_drift` | T3 |
| `scope-check-passes` | an engine-level `awaiting_disposition` resume reaches adjudication and repair with a valid repair-scope contract | T4 |
| `unbound-preserved` | a durable wait with no git candidate still admits without a `resume_candidate` | T5 |
| `no-regression` | `bash hooks/tests/implementation-campaign-routing.test.sh`, `implementation-campaign-state.test.sh`, `controller-execution-independent.test.sh`, `p6d-gates-repair-ladder.test.sh`, `mission-runtime-v2.test.sh`, `implementation-campaign-receipt.test.sh` all green; `node scripts/check-js-syntax.js`; `bash scripts/sync-codex-plugin-skills.sh --check` | suite output |

## 5. Dogfood proof (depth-0, after merge)

cuda re-runs `--resume --campaign-disposition-authority` on `campaign-v1-a8095f81…` (fleet-comms
ledger, thread `msg_01M2JW9NJRE106DKDZWQARFJF2`) after updating; the resume must pass intake, log
`DISPOSITION_RESUMED`, and either converge or stop at a phase that is not `campaign_scope_session`.
Their outcome is recorded at the row pointer, not here.

## 6. Follow-ups filed, not done here

- `AWAITING_CONVERGENCE_ADJUDICATION` has no intake-layer resume test at all (before or after this
  plan) — BACKLOG candidate once a real run parks there.

## Review log

(filled by depth-0 after the plan hetero loop — reviewed bytes, dispositions, receipt)
