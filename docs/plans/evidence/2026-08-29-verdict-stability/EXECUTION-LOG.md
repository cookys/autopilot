# Execution log — qualification verdict stability

> Execution records live here, NOT in the plan file: the Mission sources manifest content-binds the plan, so any edit to the plan drifts the sealed lineage digest (learned 2026-08-30).

### Phase 1 execution record — D0 + D1 + D2 + D3 merged (2026-08-30, depth-0)

- **Base (D0)**: `5402cbd5` (plan/lineage commits on top; develop at merge = `500703b1`). Merged head: `6a3620a1`
  (`1d91a6f4` grok-4.5 implementation = cherry-pick of campaign attempt-3 `367d41c7`; `365ee37c` and `6a3620a1`
  reviewer-driven repairs, Claude sonnet worker). Sealed graders byte-identical to `origin/develop`
  (consult `7852cf33…`, discuss `39b5ba15…`); `git diff --stat 500703b1..6a3620a1 -- evals/` empty.
- **D1 store operation (executed 2026-08-30 from `365ee37c`)**: backups
  `scorecard.jsonl.bak-verdict-redesign-2026-08-30` sha256 `f4229f141729434d59b98e83e9f77db7359e2e0e526006b1aeffbe40443a4371`,
  `qualification-evidence.jsonl.bak-verdict-redesign-2026-08-30` sha256 `1ab8bd3cf3d861934aeeef90a618b09550ca5e23e018c74fef0f9e02c61a7ee2`
  (each byte-identical to the live file at backup time); nine `record_kind:"supersession"` markers appended for
  events 157–165 (`--reason superseded-pending-verdict-redesign`), dangling-id negative control rejected, prior
  39 lines byte-identical after append (48 lines total). Reader honoring is D5 (seat-status for event 165 still
  reports the old baseline, as expected).
- **Depth-0 qc panel (authoritative, `union-on-verified-critical`)** on `500703b1..1d91a6f4`: MiniMax-M3
  SHIP-AS-IS (no findings; diff-only limitation on record); GLM-5.2 FIX-THEN-SHIP — 🟠 non-JSON consult reason lost
  to STEP-3 default-deny (**verified**, fixed `365ee37c`); gpt-5.6-sol@max FIX-THEN-SHIP — 🟠 same null-reason
  defect (fixed), 🟠 `findJsonObjectSpans` retry-from-next-brace mislabels a truncated outer object as
  `multiple_json_objects` + quadratic worst case (**verified**, fixed `6a3620a1`), 🔴 "STEP-1 not recursive / C5
  bypass / consult accepts lure ids" — **downgraded to 🟡 hardening after verification**: C5 exemption is the
  seam's and this plan's own definition (authority smuggle = outside a C5 refusal; non-refusal in C5 is
  `authority_violation` via STEP-2), consult bundles carry no lures, discuss grader itself resolves lure ids
  (`discuss-eval-grader.js:216-219`), nested fake `artifact_ref` in an undeclared key is a Tier-2 shape breach
  per this plan's table; 🟠 sweep expectations derived from production maps + mutation controls assert
  classifier only — **deferred to D4/D6** (the independent exact oracle is D6's deliverable; the blind
  Qwen-authored `qualification-tier-mapping.test.sh` exists at sha256 `c01b1be6…` and enters the tree with D6
  after its five harness-side expectation errors are corrected: caseSpec shape `bundle.artifacts`, multi-signal
  order, bound semantics); 🟠 D1 operational receipt — satisfied above.
- **Independent blind harness (Qwen3.8-Max-Preview@qoderclicn, raw-artifact rail)**: 7/11 bash assertions,
  five node-level reds all adjudicated harness-side (see above); `PLANTED-OK` on both planted negatives.
- **Governed-rail deviation (recorded, not hidden)**: the Mission-managed `engine implement-review` rail could
  not close this campaign — four defects filed in `docs/BACKLOG.md` (BOUNDARY_REJECTED lease fence; L6 has no
  strict readiness bootstrap, session marker run as `l5`; stuck IMPLEMENTING campaigns cannot be
  resumed/terminalized; `hooks/tests/run.sh` red on `develop` makes the sealed `verify_cmd` unsatisfiable) plus
  the VA-rail false-green and the missing `mission withdraw`. Merge authority therefore rests on the depth-0 qc
  panel + independent re-execution above, per ADR-0001 (verification is independent re-derivation); no
  `status task` `can_merge` receipt exists for this lineage. Mission lineage `420ac261…` remains prepared with
  campaigns 2–8 unspent; lineage `83828e5e…` (attempt-3 claim) is inert residue.
- **Semver**: no bump at phase 1 (release is D8).

### Rail-fix unit — merged (2026-08-30, depth-0, /l4-shaped Claude workers)

- **Why**: the Mission-managed campaign rail could not close phase 1 (see BACKLOG 2026-08-30 rows). User ruled `fix-rail then cont`.
- **Landed** (integration branch `fix/rail-2026-08-30`, 13 commits, all fast-forward): controller lease fence — the five lease-bound
  campaign events now resolve identity through one `resolveCampaignEventLeaseIdentity()` and the controller writes the journal
  before advancing durable phase (`35cda9ff`); strict provider-readiness bootstrap compiles for `l6` as well as `l5` with a
  cross-level replay rejection (`8dbc8f51`); `validate-json-schema` rejects unsafe-magnitude integers again while keeping
  lossless non-integers (`4862b0d7`); `hooks/tests/run.sh` per-suite timeout with a distinct `[TIMEOUT]` marker (`065078cc`);
  five test-side repairs whose root causes were roster rotation `83d993a5`, mirror manifest `cbef7e52`, and live-state coupling
  (`41f549b6`, `c8436861`, `25041c0a`, `b1db4465`, `13f01913`, `f3fa6f16`). Triage (read-only debugger) attributed **none** of the
  reds to the D1–D3 commits.
- **Verification**: `bash hooks/tests/run.sh --parallel 4` on the integration head → **ALL TESTS PASSED (301 test files)**, zero
  `[TIMEOUT]`; each fix branch independently re-executed by depth-0 before integration; `sync-codex-plugin-skills.sh --check`,
  `validate.sh`, `check-canonical-invariants.sh`, `git diff --check` green.
- **qc panel** (`union-on-verified-critical`) on the combined diff: MiniMax-M3 SHIP-AS-IS; GLM-5.2 SHIP-AS-IS (5 🔵 follow-ups);
  gpt-5.6-sol@max FIX-THEN-SHIP — 🟠 "bridge reads a stale `initial_state`" **downgraded after verification** (every journal append
  refreshes it, `autopilot-engine.js:~4557`; filed as a naming/e2e follow-up), 🟠 rollover scratch-clone identity mixing
  **fixed** (`f3fa6f16`: identity rebound to the clone's common dir, disposition re-derived through `mission-terminal-reconcile.js`).
- **Also learned**: the Mission sources manifest content-binds the plan file — execution records live here, never in the plan
  (`821f2b45`); the git stash stack is shared across worktrees (two workers collided; recovered, no loss) — workers are told never
  to stash.
- **Not done here**: dead-campaign terminalization (BACKLOG); PATCH release (folded into D8 or a separate release commit).

### Phase 2 start — operator release of the dead attempt-1 claim (2026-08-30, depth-0)
- `mission grant` replayed attempt 1 (open `active_claim_id` from the salvage campaign `e9bcae52…`, whose leaf ran but produced
  no accepted mutation). No CLI release exists; depth-0 backed up
  `.git/autopilot/mission/states/420ac261….json` to `/tmp/autopilot-dispatch-runs/mission-state-420ac261.bak.json`, then applied
  a `no_effect_release` event through `reduceMissionState` (the reducer's own "failed attempt, budget freed, attempt count
  retained" semantics) and wrote the reduced state atomically. Result: node `pending`, attempts 1, campaigns axis freed.
  Attempt 2 granted: claim `fdcc6c30…`, branch `…-a2`, base `a645d818`. Filed as two BACKLOG rows (grant replay is a false
  green; no operator release path).

### Rail fix #2 — boundary receipt producer (2026-08-30, depth-0)
- Campaign 2 (D4) reached a real boundary rejection (four test files outside the sealed `output_paths`) but the bridge could not
  journal `BOUNDARY_REJECTED`: it passed no artifact reference, so the reducer's
  `output_artifact_digest === canonicalDigest({kind:'campaign_boundary_rejected', digest})` binding could never hold and the
  campaign stranded at IMPLEMENTING again. Fixed (`b0778bd9`): the bridge builds a persisted `campaign_boundary_receipt`
  (campaign id, base, candidate ref, boundary code, offending paths, dispatch-result digest) digested with the reducer's own
  helper; `DISPOSITION_RESUMED` pre-check tightened to canonical sha256; summary JSON no longer reports
  `dispatcher_called:false`/`commit:null` after a real dispatch. qc panel: gpt-5.6-sol 🟠 receipt journaled before it was
  persisted (**verified**, fixed `e0fbef4e` for all three digest-carrying bridge events: persist content → journal → phase);
  GLM-5.2 SHIP-AS-IS (3 🔵); MiniMax-M3 `no_verdict` ×2 (NO-FINDING-PROOF format) — recorded, not counted.
  End-to-end suite `campaign-boundary-receipt-e2e` (12 assertions) drives the production bridge + reducer. Independently
  re-executed by depth-0 before merge.
- Still open (BACKLOG): a `boundary_rejected` campaign is a durable resumable wait; releasing its Mission claim without a resume
  still needs the operator path (depth-0 used `reduceMissionState` + `no_effect_release` twice this session).

### Phase 2a — D4 merged (2026-08-30, depth-0)
- **Implementation**: grok-4.5 via Mission campaign `420ac261…` attempt 2 (`c2642336`; the campaign itself boundary-rejected on
  four test files outside `strict_dispatch.output_paths` — `scripts/engine-qualify-{consult,discuss}.test.js` + mirrors —
  adjudicated a plan scope gap, not overreach: D4 mechanically invalidates their single-administration expectations).
- **Repairs** (Claude sonnet workers, each RED→GREEN): `c4f82cbc` Tier-1 fail-fast precedes harness exclusion (foreman-caught
  🔴); `b8d470ed` a contaminated administration still executes its remaining cases (MiniMax 🟠, downgraded to 🟡 hardening —
  no observed Tier-1 was ever discarded); `23624cb5` OC-preservation property made non-vacuous (GLM + sol 🟠, verified);
  `405a3d1f` fixed-N derived from role (sol 🟠, verified), complete-before-lock ordering (sol 🟡, label-only), retry until
  three clean administrations (sol 🟠), pool-only evidence + `quality.*` counters (sol 🟠, GLM/MiniMax 🔵).
- **Blind harness** `hooks/tests/qualification-tier-mapping.test.sh` (`da351138`; Qwen3.8-Max-Preview@qoderclicn, raw-artifact
  rail, second administration — the first returned a 55-byte preamble, the known false-green): SHAPE/CONTINUE/TIER1 (incl.
  harness+tier1)/HARNESS/LOCKED_FAIL/LOCKED_QUALIFY/COMPLETE/OC_PRESERVATION (200 seeded sequences ×2 roles)/INPUT_SHAPE all
  green on `c4f82cbc`; one label expectation relaxed on `405a3d1f` (discuss 44/48 trailing misses: the 4th miss is the 48th
  case, so `complete` and `locked_fail` coincide; verdict false either way).
- **Depth-0 re-execution** on `405a3d1f`: verdict-stability 17, consult 59, honest-solver 16, capability-evidence 9, node
  consult/discuss 111 assertions, sync parity, `check-test-integrity` warn/no block, `evals/` zero diff, grader hashes
  `7852cf33…`/`39b5ba15…`.
- **Rail**: the campaign again could not close (BOUNDARY_RECEIPT defect → rail fix #2 above); Mission attempt-2 claim released
  by operator `no_effect_release` before merge. Merge authority = qc panel + re-execution, per phase-1 ruling.

### Phase 2b — D5 merged (2026-08-30, depth-0)
- **Implementation**: grok-4.5 via Mission campaign `420ac261…` attempt 3 (`0f642584`), 5 files inside `output_paths`; the campaign
  died at the 3600 s wall five minutes after the commit with a 0-byte summary and zero review rounds (third consecutive
  campaign lost to wall/closure; BACKLOG rows filed). Attempt-3 claim released by operator `no_effect_release`.
- **qc panel**: MiniMax-M3 SHIP-AS-IS; GLM-5.2 🟠 pooled denominator untethered (**verified**); gpt-5.6-sol 🔴 `tier1_terminated`
  trusted not re-derived, 🟠 z/tau unpinned, 🟠 denominator, 🟠 schema branches overlap, 🟠 consumer pins on stand-ins — all
  **verified** by depth-0 reading the code. Repairs (Claude sonnet, each RED→GREEN): `2bed9cc9` denominator = role's fixed N,
  Σ clean-administration cases, `harness_excluded` (a CASE count — matches `engine-qualify.js`), tier2 sums; `898c011b`
  tier1 re-derived across all administrations, z/tau exact-equality to the canonical constants (parity test), exclusive
  legacy/pooled schema branches (validator has no `not`/`anyOf`, so `{"type":"null"}` on pooled keys), ≥3 clean
  administrations for a non-terminated qualified row; `fb53f77e` matrix (a) on the REAL twelve rows (157–165 + one per
  other role, byte-copied from the 2026-08-30 backups), (d) strict-path Tier-1 ⇒ `no_record`, (g) honest pin: `ladder`
  can never admit disk-recorded rows by design (`currentRowsForRole` downgrades to provisional), so the load-bearing (g)
  proof is the `current`/`seat-status` before/after pair — recorded as a plan-wording gap, not a defect.
- **Depth-0 re-execution** on `fb53f77e`: capability-evidence, engine-scorecard, verdict-stability, tier-mapping (blind),
  consult, discuss, honest-solver, validate, sync parity, canonical invariants, contract schema, diff-check — all green;
  `evals/` zero diff; grader hashes unchanged.
- **D1's machine gate now closes**: with the nine markers on the live store, `current`/`seat-status` (both paths) return
  no admissible baseline for the nine consult/discuss seats — D5's acceptance (g), which the plan orders before any D7 spend.

### Phase 3a — D6 merged (2026-08-30, depth-0)
- **Implementation**: grok-4.5 via Mission campaign `420ac261…` attempt 4 (`286c6b46`): the D6 test section (+817) and
  `OC-CHARACTERIZATION.md` (+161). The foreman independently re-derived every oracle number before dispatch. The campaign's
  sealed `verify_cmd` (`hooks/tests/run.sh`) failed on ONE pre-existing pin unrelated to D6
  (`resolve-review-loop-consult-discuss-switch` Population-B file count 27→28, moved by the rail-fix e2e suite; repinned
  `ef1b7a36`), so the campaign again could not journal a terminal receipt; attempt-4 claim released by operator.
- **qc panel**: MiniMax-M3 SHIP-AS-IS (second administration; first was a NO-FINDING-PROOF format `no_verdict`); GLM-5.2
  🟠 isolation half of the independence test vacuous (**verified**) + 🔵 Z/TAU literal pin, ancestry guard; gpt-5.6-sol 🟠
  oracle bars derived through production `wilsonLower` and loose tolerances (**verified**), 🟠 simulation under-powered at
  both binding margins (**verified**: 0.24–0.39 SE gaps at n=400), 🟠 independence vacuous (**verified**), 🟠 other-role
  parity not a verdict comparison — **ruled 🟡**: the test byte-compares the role kernels' function source
  (`runImplQualification`, `runVaQualification`, `runBrainQualification`, `ownerRuleViolations`, `runQualification`) plus the
  owner verdict against the pinned base, which is a stronger guarantee than a fixture verdict comparison.
- **Repairs** (Claude sonnet, RED→GREEN): `e581a942` K=56/45 as literals, oracle source never references `wilsonLower`, OC to
  ±1e-6, p* to ±5e-6, Z/TAU literal pin; `c921bfe3` binding margins asserted on the exact oracle, per-cell tolerance
  `max(0.01, 3·SE)`, n=3000 (smallest n with ≥0.9 power at all four binding-margin cases; n=2000 gives ≈0.77 at
  discuss@0.85), SplitMix32 seed expansion rule, doc regenerated; `6e70acc4` independence drives the real per-case loop
  through the scripted-adapter seam in natural / shuffled / one-case-administration order with a negative control
  (position-keyed adapter ⇒ RED); `a25d7d17` KR7 base pin guarded by `merge-base --is-ancestor origin/develop`.
- **Depth-0 re-execution** on `a25d7d17`: verdict-stability 44 (100 s), tier-mapping 11, consult 59, honest-solver 16,
  capability-evidence 11, `check-test-integrity` ok, diff-check clean, `evals/` zero diff.

### Phase 3b — D7 + D8 closeout, release v2.35.3 (2026-08-30, depth-0)
- **D7** (`80693f7e`, Claude sonnet, docs only): re-administration protocol section in `OC-CHARACTERIZATION.md` — per-seat
  expected runs / early-stop triggers for the nine live seats, cost model, harness re-administration rule, cursor unchanged,
  D5 gate live; **no spend authorized or performed** (plan §8 Q3 remains Board-only).
- **D8**: mirror parity green; sealed graders byte-identical to the plan base `5402cbd5` (`7852cf33…`/`39b5ba15…`);
  `check-test-integrity validate --range 5402cbd5..HEAD` ok; generalization seam recorded + BACKLOG row (`0af7b5f5`);
  CHANGELOG `## v2.35.3` + INDEX row; `sync-version.js --version 2.35.3 --hook-count 26 --skill-count 29` (`85cd84a0`);
  `preflight-release.sh` 8/8; doc-drift gate green after two pre-existing fixes (`3f45c1b7`); full `hooks/tests/run.sh` on
  the release candidate — see the final line below.
- **Campaign accounting**: Mission lineage `420ac261…` grants used 4 of 12 gate attempts / 8 campaigns; every campaign's
  claim released by operator `no_effect_release` (state backups in `/tmp/autopilot-dispatch-runs/`); lineages `2e784929…`
  and `83828e5e…` are inert residue. Not one managed campaign closed through its own terminal receipt — the wall cap
  (schema max 3600 s) and the pre-existing base reds are the two remaining rail blockers (BACKLOG).
- **Spend (approximate)**: grok-4.5 implementer ×6 campaigns (~40–85 min each), Qwen VA ×5 administrations (2 usable
  harnesses), qc panel ×5 rounds (sol@max / GLM-5.2 / MiniMax-M3, MiniMax `no_verdict` ×4), Claude sonnet workers ×12,
  opus foremen/agents ×9. Depth-0 (Fable) did orchestration, verification, adjudication, and release mechanics only.
