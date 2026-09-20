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

### 2.1 `src/engine/campaign-intake.js`

**Ordering fact (G1 finding b8d813b1)**: `runCampaignIntake` calls the Mission claim adapter
(`campaign-intake.js:1469-1472`) BEFORE the generation-claim adapter (`:1806`, `defaultGenerationClaim`).
A drift check that lives only inside `defaultGenerationClaim` therefore runs after the claim and
burns a grant attempt on a resume that could never proceed — the same pre-spend pattern fixed three
times already (ledger v2.36.42, panel v2.36.46, repo facts v2.36.48). Two changes:

- **Pre-claim durable-resume preflight** (new, read-only): when `input.resume === true` and the
  canonical ledger projects a `git_candidate` `candidate_reference` for the campaign, run
  `verifyResumeCandidate({ projection, repo, base })` BEFORE `missionClaimAdapter`; a thrown
  `CampaignIntakeError` becomes `{ status: 'blocked', rejection: { code: error.code ||
  'campaign_resume_candidate_invalid' }, pre_spend_no_effect_receipt: null }` and the Mission claim
  adapter is never called. Scope (G2 ruling, R6): the preflight runs ONLY for the durable-wait phases
  this defect covers (`BOUNDARY_REJECTED`, `AWAITING_DISPOSITION`, `AWAITING_CONVERGENCE_ADJUDICATION`);
  `ADJUDICATING` / `VERTICAL_VERIFICATION` control flow is untouched (their drift cases still spend a
  claim first — follow-up row, §6). The preflight is a check, not a binding: it stores nothing.
- **In-claim binding** (`defaultGenerationClaim`, `durableWaitPhase` block, ~790-830): when
  `existing.candidate_reference.kind === 'git_candidate'`, set
  `existing.resume_candidate = verifyResumeCandidate({ projection: existing, repo, base })` inside the
  same try/catch shape as the non-durable branch (revalidation closes the race between preflight and
  claim). Remove the two raw assignments (`existing.resume_candidate = existing.candidate_reference`).
  The `resumableCandidatePhase` block keeps its exclusions (no double verification);
  `AWAITING_CONVERGENCE_ADJUDICATION` is covered by the durable-wait block.
- `verifyResumeCandidate` itself is unchanged (its `scope_implementation_sha` already derives from
  `initial_candidate_reference || reference`).

### 2.2 `platforms/codex/plugin/src/engine/campaign-intake.js`

Byte-identical mirror (`bash scripts/sync-codex-plugin-skills.sh --check`).

### 2.3 Docs (pinned version: **v2.36.53** — canonical `origin/develop` is 2.36.52 at freeze; if an
intervening release lands first, depth-0 reseals the plan with the freed number per the
concurrent-session rule)

- `docs/BACKLOG.md`: the fired row → Status `shipped v2.36.53 2026-09-16`; Context replaced by the real
  mechanism (durable-wait branch bypassed `verifyResumeCandidate`; now every git_candidate resume is
  verified pre-claim and normalized).
- `skills/l5/references/hetero-impl-loop.md` step 11: move "disposition resume dies in
  `check-repair-scope.js` …" into the "Fixed since 2026-09-14" list as "durable-wait resume verified
  pre-claim + `scope_implementation_sha` bound v2.36.53". Its generated mirror
  `platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md` is regenerated from the source
  (`bash scripts/sync-codex-plugin-skills.sh`, then `--check`) and is a sealed output path.
- `CHANGELOG.md` is NOT a sealed output path: the v2.36.53 section is a separate depth-0 release
  action after the merge (`sync-version.js` + `preflight-release.sh`), never the hand's.

### 2.4 Tests (`hooks/tests/implementation-campaign-routing.test.sh`, extend the P3 resume block)

All change-pinning assertions recorded RED against base `3831d5f6` in a comment at the block head,
each with the failing assertion's actual message text captured at base pasted next to its RED
marker; preservation guards labelled and green at base.

- **T1 (RED at base) intake shape**: from the existing P3 sandbox (real git repo, real ledger under
  `$SBX/.git/autopilot/`), append the engine-shaped `AWAITING_DISPOSITION` event to a COPY of the
  campaign ledger (never the suite's live P3 ledger, never the host ledger) so the projection phase is
  `awaiting_disposition` with `awaiting_disposition.candidate_ref` = candidate; run `runCampaignIntake({
  resume: true })` with the fixture adapters; assert `status === 'admitted'`,
  `generation_claim.resume_durable_wait.phase === CAMPAIGN_STATES.AWAITING_DISPOSITION`, and the
  COMPLETE normalized object: `Object.keys(resume_candidate).sort()` deep-equals the
  `verifyResumeCandidate` key set (`branch, commit, committed, repair_lineage, scope_implementation_sha,
  tree_sha, writer_fence` plus `campaign_contract_sha256, unit_contract_sha256` iff the reference
  carries them) — raw-only fields `kind`, `base` are ABSENT; `committed === true`, `commit === <candidate
  sha>`, `tree_sha === <candidate tree>`, `branch`, `writer_fence`, `repair_lineage` deep-equal the
  ledger reference's values, `scope_implementation_sha === <initial candidate sha>` (40-hex).
- **T2 (RED at base) generation > 1 discriminator**: same fixture but with TWO `git_candidate`
  artifact references in the ledger (initial `c1`, repair `c2`, both real commits on the retained
  branch, `c2` the tip); assert `scope_implementation_sha === c1` and `commit === c2`. A shape-only
  patch that copies `candidate_ref`/`commit` yields `c2` for both and fails this assertion.
- **T3 (RED at base) drift refusal is pre-claim**: with a `missionClaim` adapter SPY (counts calls,
  returns the fixture claim) run four cases against the `awaiting_disposition` ledger — branch-tip
  drift (`git update-ref` to base), candidate-tree drift (`git replace` with a base-tree commit),
  base-ancestry drift (`git replace` with an off-base parent), and a malformed reference (ledger copy
  with the writer-fence digest altered); assert per case `status === 'blocked'`, `rejection.code` is
  `campaign_resume_git_drift` for the three drifts and `campaign_resume_candidate_invalid` for the
  malformed one, and the spy count is 0 (RED at base: the claim adapter is called first). Restore
  refs/replacements after each case. The existing `ADJUDICATING` P3 drift cases keep their current
  assertions (no new zero-call requirement — R6).
- **T4 (RED at base) engine scope check**: `AutopilotEngine.runImplementationReviewLoop({ resume:
  true, … })` on the `awaiting_disposition` ledger with a `must-fix-now` disposition authority; inject
  `campaignScopeChecker` (engine option, `autopilot-engine.js:2459`) as a SPY that records every
  `session.contract` it receives and returns a passing receipt; the implementation dispatcher stub
  commits a real `c2` on the branch for the repair. Assert: the spy was called ≥ 1 time, EVERY recorded
  `contract.base_sha === base` and `contract.implementation_sha === c1` (never `c2`/undefined), the
  repair dispatch's base was `c2`'s parent = `c2` started from the current candidate, and the run's
  trace/ledger shows `DISPOSITION_RESUMED` followed by a repair (status/phase beyond adjudication) —
  i.e. it advanced through disposition and repair, not merely avoided two phase names. (RED at base:
  the run returns at the scope contract with the 40-hex error before the spy is ever called.) The
  composition-layer disposition test at `:369-521` stays as is — it is the finding-rebind proof.
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
| `durable-wait-drift-refused` | a resume whose retained branch/tree/ancestry drifted (or whose reference is malformed) is `blocked` BEFORE the Mission claim adapter is called (spy count 0) with `campaign_resume_git_drift` / `campaign_resume_candidate_invalid` | T3 |
| `scope-check-passes` | an engine-level `awaiting_disposition` resume reaches adjudication and repair with a valid repair-scope contract | T4 |
| `unbound-preserved` | a durable wait with no git candidate still admits without a `resume_candidate` | T5 |
| `no-regression` | `bash hooks/tests/implementation-campaign-routing.test.sh`, `implementation-campaign-state.test.sh`, `controller-execution-independent.test.sh`, `p6d-gates-repair-ladder.test.sh`, `mission-runtime-v2.test.sh`, `implementation-campaign-receipt.test.sh` all green; `node scripts/check-js-syntax.js`; `bash scripts/sync-codex-plugin-skills.sh --check` | suite output |

## 5. Dogfood proof (depth-0, after merge)

cuda re-runs `--resume --campaign-disposition-authority` on `campaign-v1-a8095f81…` (fleet-comms
ledger, thread `msg_01M2JW9NJRE106DKDZWQARFJF2`) after updating; the resume must pass intake, log
`DISPOSITION_RESUMED`, and either converge or stop at a phase that is not `campaign_scope_session`.
Their outcome is recorded at the row pointer, not here.

## 6. Follow-ups filed, not done here

- `ADJUDICATING` / `VERTICAL_VERIFICATION` resumes still call the Mission claim adapter before the
  drift check (a drifted resume burns an attempt) — same pre-spend class, kept out by R6; BACKLOG row.
- `AWAITING_CONVERGENCE_ADJUDICATION` has no intake-layer resume test at all (before or after this
  plan) — BACKLOG candidate once a real run parks there.

## Review log

- Design consult 2026-09-16 (grok seat 402 quota-exhausted → codex gpt-5.6-sol via the raw-prompt
  rail, evidence `docs/plans/evidence/2026-09-16-disposition-resume/consult-codex.txt`): recommends
  (a) verify git_candidate durable-wait resumes; names the C0/C1/C2 dual-anchor assertions folded into
  T2/T4 and the "no claim, no adapter" drift assertion folded into T3.
- G1 (GLM-5.2 READY, gpt-5.6-sol STOP with 5 blockers, all accepted and folded): pre-claim preflight
  (§2.1), exact-shape T1, instrumented T4, CHANGELOG outside the seal + mirror listed (§2.3),
  version pinned v2.36.53 (§2.3). Reviewed bytes: `plan.as-reviewed-g1.md` in the evidence dir.
- G2 (terminal at generation cap; GLM CONDITIONAL 1 minor, gpt-5.6-sol STOP 1 blocker; both accepted and
  folded): RED headers carry the failing message (§2.4); the pre-claim preflight is restricted to the
  durable-wait phases and the ADJUDICATING zero-call assertion is dropped (R6), follow-up filed (§6).
  Depth-0 freeze: zero unaddressed blockers, zero deferred. Reviewed bytes: `plan.as-reviewed-g2.md`.
