> Investigation of a peer-reported repair-at-file-cap failure (cuda, second occurrence).
> Status: fixed in v2.36.114.

# changed-file budget vs same-scope repair (v2.36.113, origin/develop)

## 1. How usage.changed_files is written
- Only writer in the engine: src/engine/autopilot-engine.js:8180-8182 (scopeCheck, after_initial_mutation / after_repair_mutation):
  `changed_files: receipt.changed_files.length` -> journaled as usage on IMPLEMENTATION_COMPLETED / REPAIR_COMPLETED.
- receipt.changed_files = distinct paths of `git diff --numstat --no-renames <base_sha>..<head>`
  (scripts/check-repair-scope.js:339-355, :580). base_sha is the campaign's immutable base, so the value is the
  CUMULATIVE DISTINCT path count of the candidate vs base. It is SET (not summed): not per-generation, not per-attempt.
  A repair that re-touches already-changed paths leaves it unchanged.
- Reducer: src/engine/implementation-campaign.js:874-877 (usage may never decrease), :886-889 (FILE_BUDGET_EXCEEDED if
  usage > max, strict `>`), :1107 (RESUMED may not change usage). In-engine scope check also uses `<=`:
  autopilot-engine.js:1864 (`changed_files.length <= max_changed_files`). So the hard ceiling is `> cap` = violation.

## 2. Pre-spend checks (all use `>=`, none look at the next write)
- src/campaign/cli.js:~915-921 campaignResumeEligibility: `usage.changed_files >= limits.max_changed_files` ->
  campaign_file_budget_exhausted. Exempt only `reviewingResumable` (REVIEWING + bound candidate; v2.36.111, commit 911b9a65).
- src/engine/campaign-intake.js:1365-1371: same `>=`, same REVIEWING exemption, message
  "durable campaign has no changed-file budget remaining" (this is what the peer hit; rejected pre-spend).
- Mutation-time gate: autopilot-engine.js:1560-1575 campaignMutationBudgetStatus (`>=`, axis changed_files),
  called at :7577 and :10458 before every implement dispatch. It reads campaignControl.initial_state.usage (the durable
  count), not a projection of the pending write.
- Real post-write cap (the correct, distinct-path enforcement): scope check autopilot-engine.js:1864 (`<=`) plus reducer :886 (`>`).
- Answer to Q2: NO check considers that a repair touching only already-counted paths adds zero new distinct paths.
  All three pre-spend gates are `>=` and block at exactly cap == count. The only exemption is review-only REVIEWING.
  AWAITING_DISPOSITION (the peer's phase) -> resume is a repair dispatch (writes), so it is not exempt.
- Repair path-scope is separately sealed: repair delta paths must be within the finding-bound seal (autopilot-engine.js:8113-8137),
  which is independent of the file cap.

## 3. Documented semantics
- schemas/implementation-campaign-contract.schema.json:81-85: `max_changed_files` is integer 1..4096, NO description.
  `max_repair_generations` likewise bare. No doc states "cumulative distinct paths including repairs" or any headroom advice.
- Admission only requires output_paths <= max_changed_files (src/engine/mission-execution-graph.js:230-232;
  campaign-dispatch-projection.js:279), i.e. scope N with cap N is ADMITTED, so the operator is never warned that a repair
  will be unreachable.
- skills/l5/references/hetero-impl-loop.md:225-226 only says the cap does not apply to review-only REVIEWING resumes.
  No sizing guidance in skills/l5, skills/l6, references/, docs/.
- Prior art: CHANGELOG.md:1195-1198 (v2.36.6x): a 13-path campaign with cap 13 hit `changed_files 13 >= max_changed_files 13`
  on repair -> TERMINAL_STOP, degraded to l3; "changed_files cap uses >= to block repair" was recorded as a rail defect
  (BACKLOG entry not found by grep in docs/BACKLOG.md today; likely archived or unrecorded - verify before citing).
  v2.36.111 fixed only the REVIEWING variant (CHANGELOG.md:29).

## 4. Answer
(A) Supported route today: NONE. No argv or contract field re-grants, bypasses, or exempts the writing-resume cap check.
    `--campaign-disposition-authority` binds a disposition; it does not touch budget. Anything else means editing
    seal/ledger/budget, which the peer has ruled out. Available non-campaign path: close the campaign terminal and
    repair outside the rail (the documented fallback is degrade to l3 and repair in the retained worktree, then
    depth-0 verifies), or start a NEW campaign (new contract/intake) from the candidate.
(B) Sizing rule from code: the campaign file budget counts DISTINCT paths vs base, cumulative, repairs included
    (so cap == N is enough for the post-write ceiling), BUT every writing resume/mutation is pre-blocked once
    count >= cap. Therefore any campaign that needs a repair after a first pass touching all N paths must have
    max_changed_files >= N + 1 (strictly greater than the first-pass distinct count). Practical rule: set the cap to
    scope paths + 1 (or + headroom) whenever max_repair_generations >= 1. Admission does not enforce or warn about this.
(C) Product defect: YES, a design defect (consistent `>=` that conflates "budget exhausted" with "no more distinct
    paths allowed"). A repair is bounded by the repair seal and scope check to in-scope paths, so when scope == cap,
    the pre-spend block refuses a repair that cannot exceed the cap. It is the second occurrence (v2.36.6x, now peer).
    Also a UX defect: admission accepts output_paths == cap with max_repair_generations >= 1 without warning.

## Narrowest fix shape (prose)
Option 1 (smallest, S): admission guard. Reject or warn at intake/contract validation when
`max_repair_generations >= 1 && max_changed_files <= output_paths.length` (reason_code e.g.
campaign_file_cap_no_repair_headroom); add schema description for both fields. Does not rescue the peer's existing campaign.
Option 2 (M, fixes the peer class): make the three pre-spend gates (cli.js eligibility, intake.js:1365, campaignMutationBudgetStatus)
block with `>` for the changed_files axis only when the campaign phase is a repair phase (AWAITING_DISPOSITION / repair),
i.e. admit at count == cap because the post-write ceiling (scope receipt `<=` :1864 + reducer `>` :886 + repair seal
allowed_paths) already rejects any NEW path beyond cap. Keep `>=` for IMPLEMENTING (first pass) and for churn/wall.
Invariants: (1) cumulative distinct-path ceiling still enforced at write time (scope check `file_cap_passed` + FILE_BUDGET_EXCEEDED);
(2) a repair adding a new path beyond cap is still TRIP/blocked; (3) count > cap pre-block stays; (4) usage never decreases;
(5) RESUMED event still cannot change usage. Option 2 is a mechanism change under the CLAUDE.md mechanism-vs-guidance
rule only if the requirement list is unchanged; here it relaxes what the gate demands, so treat as guidance and expect eval/evidence.
Tests (RED first): (a) campaign at AWAITING_DISPOSITION with usage == cap, repair touches only already-counted paths ->
resume admitted, REPAIR_COMPLETED usage unchanged, converges; (b) same but repair adds one new in-seal path -> scope check
file_cap_passed=false, blocked, no usage increase committed; (c) usage > cap still rejected pre-spend; (d) IMPLEMENTING at
cap still rejected; (e) parity: cli.js eligibility and intake.js agree (campaignResumeEligibility vs intake) across the phases.
Affected tests live around src/campaign/cli + campaign-intake suites (the v2.36.111 REVIEWING-exemption tests are the template).
Effort: Option 1 = S; Option 2 = M (three predicates must stay in lockstep, as the v2.36.111 comment already warns).
