# Implementation brief — disposition-resume-2026-09-16

You are the implementer of ONE managed deliverable. The harness commits your work; you never push,
never `git stash`, never touch files outside `output_paths`, never read or write the host ledger
(`.git/autopilot/implementation-campaign.jsonl` of this repo or any other).

## Read first (in this order, nothing else)
1. `docs/plans/_archive/2026/09/2026-09-16-disposition-resume-scope-sha.md` — §0 mechanism, §1 ruling, §2 changes, §2.4 tests.
2. `docs/plans/_archive/2026/09/2026-09-16-disposition-resume-scope-sha.rubric.md` — R1–R10 are the acceptance.
3. `src/engine/campaign-intake.js` lines 518-635 (`verifyResumeCandidate`) and 760-860 (`defaultGenerationClaim` resume branches).
4. `hooks/tests/implementation-campaign-routing.test.sh` lines 944-1330 (the P3 resume block you extend).

## The defect (one paragraph)
For durable-wait phases (`BOUNDARY_REJECTED`, `AWAITING_DISPOSITION`, `AWAITING_CONVERGENCE_ADJUDICATION`)
`defaultGenerationClaim` assigns `existing.resume_candidate = existing.candidate_reference` (raw ledger
reference) and skips `verifyResumeCandidate`. Only `verifyResumeCandidate` produces the normalized shape
with `scope_implementation_sha`; the engine (`autopilot-engine.js:4610-4616`) reads it into
`createCampaignScopeSession`, and `check-repair-scope.js` rejects `undefined`. Measured 2026-09-16 on a
real resume: `implementation_sha must be an immutable full 40-hex commit object ID`, exit 2.

## The fix (product) — two parts, both in `src/engine/campaign-intake.js`
(A) PRE-CLAIM PREFLIGHT: `runCampaignIntake` calls the Mission claim adapter (`:1469-1472`) BEFORE the
generation claim (`:1806`). Add a read-only preflight before `missionClaimAdapter`: when `input.resume
=== true` and the canonical ledger projection (`projectCampaign(loadRows(ledgerPath), campaignId)`)
is in a durable-wait phase (`BOUNDARY_REJECTED`, `AWAITING_DISPOSITION`, `AWAITING_CONVERGENCE_ADJUDICATION`) AND has `candidate_reference.kind === 'git_candidate'`, call `verifyResumeCandidate({ projection, repo,
base })`; a thrown `CampaignIntakeError` → return `{ status: 'blocked', reason, rejection:
rejected('campaign_generation', error.code || 'campaign_resume_candidate_invalid', message), steps:
[rejection], pre_spend_no_effect_receipt: null }` (same shape as the repo-precondition refusal at
`:1385-1398`) and NEVER call the Mission claim adapter. ADJUDICATING/VERTICAL_VERIFICATION resumes are NOT preflighted (leave their flow untouched). The preflight stores nothing.
(B) IN-CLAIM BINDING: in the `durableWaitPhase` block of `defaultGenerationClaim`: when `existing.candidate_reference &&
existing.candidate_reference.kind === 'git_candidate'`, set
`existing.resume_candidate = verifyResumeCandidate({ projection: existing, repo, base })` inside the same
try/catch shape as the non-durable branch (a thrown error → `rejected('campaign_generation', error.code ||
'campaign_resume_candidate_invalid', error.message || String(error))`). Delete the two raw assignments.
Keep the `resumableCandidatePhase` block's exclusions (no double verification). Do NOT change
`verifyResumeCandidate`, the reducer, `campaign-composition.js`, `src/campaign/cli.js`,
`check-repair-scope.js`, or any CLI flag. Mirror the file byte-identically to
`platforms/codex/plugin/src/engine/campaign-intake.js` (`bash scripts/sync-codex-plugin-skills.sh --check`
must pass).

## Tests (red-first; extend `hooks/tests/implementation-campaign-routing.test.sh` after the P3 block)
Header comment: `# RED at base 1ea8825b: <the ACTUAL failing message you observed at base>` for every change-pinning assertion (run the block against base to capture it);
label preservation guards `(preservation, green at base)`. Never point a test at a live ledger: copy the
P3 sandbox ledger (`$SBX/.git/autopilot/implementation-campaign.jsonl`) or build a fresh sandbox repo.
Fixture: two real commits on the retained branch — `C0` (initial candidate, first `git_candidate`
artifact reference) and `C1` (repair candidate, second reference, branch tip); ledger parked at
`AWAITING_DISPOSITION` with `awaiting_disposition.candidate_ref === C1`. Prove the fixture itself
(`initial_candidate_reference.commit === C0`, `candidate_reference.commit === C1`, `C0 !== C1`).
- T1/T2 intake: `runCampaignIntake({ resume: true })` with the fixture adapters →
  `status === 'admitted'`, `generation_claim.resume_durable_wait.phase === 'AWAITING_DISPOSITION'`
  (use the exact CAMPAIGN_STATES value), `resume_candidate.committed === true`,
  `resume_candidate.commit === C1`, `resume_candidate.tree_sha === tree(C1)`,
  `resume_candidate.scope_implementation_sha === C0` AND `!== C1`; branch, writer_fence, repair_lineage
  equal the C1 reference's values. (RED at base: `scope_implementation_sha` is undefined.)
- T1 exact shape: `Object.keys(resume_candidate).sort()` deep-equals the `verifyResumeCandidate` key
  set (`branch, commit, committed, repair_lineage, scope_implementation_sha, tree_sha, writer_fence`
  + `campaign_contract_sha256, unit_contract_sha256` iff the reference carries them); raw-only `kind`
  and `base` ABSENT; branch/writer_fence/repair_lineage deep-equal the ledger reference's values.
- T3 drift is PRE-CLAIM: pass a `missionClaim` adapter SPY (counts calls, returns the fixture claim)
  and run four cases on the awaiting_disposition ledger: branch-tip drift (`git update-ref` to base),
  candidate-tree drift (`git replace` with a base-tree commit), base-ancestry drift (`git replace`
  with an off-base parent), malformed reference (ledger copy with the writer-fence `receipt_digest`
  altered). Per case: `status === 'blocked'`, `rejection.code` = `campaign_resume_git_drift` (three
  drifts) / `campaign_resume_candidate_invalid` (malformed), spy count 0. Restore refs/replacements
  after each. Leave the existing ADJUDICATING P3 drift cases' assertions exactly as they are.
- T4 engine: `AutopilotEngine.runImplementationReviewLoop({ resume: true, … })` on the same ledger with a
  `must-fix-now` disposition authority; inject the engine option `campaignScopeChecker`
  (`autopilot-engine.js:2459`) as a SPY that records every `session.contract` and returns a passing
  receipt; the implementation dispatcher stub commits a real `C2` on the branch for the repair. Assert:
  spy called ≥ 1, EVERY recorded contract has `base_sha === base` and `implementation_sha === C0`
  (never C1/undefined), `C2`'s parent is `C1` (repair started from the current candidate), and the
  ledger/trace shows `DISPOSITION_RESUMED` followed by a repair generation — the run advanced through
  disposition into repair. (RED at base: returns at the scope contract before the spy is called.)
- T5 preservation: a `BOUNDARY_REJECTED` projection whose only recorded ref is `'unbound-candidate'`
  (no `git_candidate` artifact) still admits with `resume_candidate` null/absent and
  `resume_durable_wait.candidate_ref === 'unbound-candidate'`.
- T6 preservation: the existing P3 `ADJUDICATING` assertions are unchanged.

## Docs (small)
- `docs/BACKLOG.md`: row "Managed rail: disposition resume dies in `check-repair-scope.js` —
  `scope_implementation_sha` never set": Status → `shipped v2.36.53 2026-09-16`; Context line replaced with: "the durable-wait branch of
  `defaultGenerationClaim` bypassed `verifyResumeCandidate`, so `resume_candidate` was the raw reference
  without `scope_implementation_sha`; now every git_candidate resume is verified and normalized." Keep the
  row ≤ 900 B; run `node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (exit 0).
- `skills/l5/references/hetero-impl-loop.md` step 11: move the "disposition resume dies in
  `check-repair-scope.js` …" clause into the "Fixed since 2026-09-14" list as "durable-wait resume
  verified pre-claim + `scope_implementation_sha` bound v2.36.53". Regenerate the mirror
  `platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md` with `bash scripts/sync-codex-plugin-skills.sh`
  (then `--check`). Do NOT touch CHANGELOG.md (depth-0 release action).

## Verify (run all, in the foreground, before you finish; all must be green)
```
bash hooks/tests/implementation-campaign-routing.test.sh
bash hooks/tests/implementation-campaign-state.test.sh
bash hooks/tests/controller-execution-independent.test.sh
bash hooks/tests/p6d-gates-repair-ladder.test.sh
bash hooks/tests/mission-runtime-v2.test.sh
bash hooks/tests/implementation-campaign-receipt.test.sh
node scripts/check-js-syntax.js
bash scripts/sync-codex-plugin-skills.sh --check
node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md
```
Run one suite at a time (they interfere in parallel). Do not weaken or delete any existing assertion.

## Sealed output_paths (the ONLY files you may change)
```
src/engine/campaign-intake.js
platforms/codex/plugin/src/engine/campaign-intake.js
hooks/tests/implementation-campaign-routing.test.sh
docs/BACKLOG.md
skills/l5/references/hetero-impl-loop.md
platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md
```
Finish by leaving a clean tree with your changes staged/committed as the harness instructs; report the
list of RED-at-base assertions you recorded and the suite pass/fail counts.
