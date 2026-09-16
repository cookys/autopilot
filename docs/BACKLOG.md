# autopilot — BACKLOG

One entry = one index row per [`references/backlog-entry.md`](../references/backlog-entry.md); evidence lives at
the row's `Pointer` (a plan, a project, or a sidecar under `docs/backlog/`). Gate:
`node scripts/check-backlog-entries.js --backlog docs/BACKLOG.md` (config `.claude/backlog-config.md`, `mode: block`;
residual debt in `.claude/backlog-debt.json` ratchets down only). Migrated 2026-09-14 by
`scripts/migrate-backlog-entries.js` (manifest `docs/backlog/MIGRATION-2026-09-14.json`).

**FIRED queue (order, as of 2026-09-14)** — rows whose trigger has fired are worked in this order:

1. ~~`chatgpt-tunnel-host` (E)~~ SHIPPED v2.36.32 · 2. ~~`openclaw` main claim~~ v2.36.28 · 3. ~~`cookys-7840hs` four defects~~ v2.36.33 ·
4. ~~foreman rail Shape B~~ v2.36.34 · 5. ~~`308-db` (a) residue sweep~~ v2.36.35 · 6. ~~2026-09-12 dogfood four defects~~ v2.36.36 ·
7. ~~backlog entry schema Phases 1–4~~ v2.36.38–39 · 8. ~~disposition resume~~ v2.36.41 · 9. ~~ledger flag burns a grant~~ v2.36.42 · 10. ~~reviewer no_verdict releases the claim~~ v2.36.43. Next: operator-named work, or the 308-8f dispatch-hetero reports.

### Managed rail: a reviewer no_verdict releases the campaign claim instead of retrying the seat
- **Status**: shipped v2.36.43 2026-09-14
- **Trigger**: fired 2026-09-14 — a no_verdict review (MiniMax format fault) blocked the campaign at full_diff_review and released the claim; --resume then met "claim is released or terminal"
- **Effort**: S
- **Source**: backlog-entry-migration dogfood, 2026-09-14
- **Pointer**: docs/plans/2026-09-14-backlog-entry-migration.md
- **Context**: an instrument fault on the reviewer seat should re-administer or swap the seat, not end the campaign

### Foreman rail residuals (v2.36.34) — accepted and named, not hidden
- **Status**: open
- **Trigger**: **NOT FIRED — recorded at ship time, 2026-09-13.** Fires when a real foreman run trips one of them.
- **Effort**: M
- **Source**: `docs/plans/2026-09-13-foreman-rail-b-build.md`, ship-time adjudication.
- **Pointer**: docs/backlog/foreman-rail-residuals-v2-36-34-accepted-and-named-not-hidden.md

### PEER-REPORTED (308-8f): an agy hand commits to the MAIN checkout from inside its worktree — REPRODUCED, FIXED v2.36.37
- **Status**: shipped v2.36.37 2026-09-13
- **Trigger**: **FIRED — reported 2026-09-13 with evidence, reproduced here the same hour.** `dispatch-foreman.sh` probe on 308: kimi foreman behaved; `dispatch-hetero.sh --runner agy` built `/tmp/hetero-hands-…` but agy committed to 308's…
- **Effort**: Fix
- **Source**: `308-8f` cross-session report 2026-09-13; evidence in 308 `a096548e`.
- **Pointer**: docs/backlog/peer-reported-308-8f-an-agy-hand-commits-to-the-main-checkout-from-inside-its-wo.md

### Dev mode layer ③ (marketplace clone) as a symlink — spike before changing dev-setup
- **Status**: open
- **Trigger**: **NOT FIRED — operator question 2026-09-13** after `/reload-plugins` loaded v2.34.5 skills because `~/.claude/plugins/marketplaces/autopilot` had not been pulled since 2026-08-07 (the same shape as the 2026-07-17 incident in…
- **Effort**: S
- **Source**: unknown
- **Pointer**: docs/backlog/dev-mode-layer-marketplace-clone-as-a-symlink-spike-before-changing-dev-setup.md

### PEER-REPORTED (cuda, for revival.3d): a backlog ENTRY has no schema, no DI, and no mechanical gate — so backlogs become work journals
- **Status**: shipped v2.36.39 2026-09-14
- **Trigger**: **FIRED 2026-09-14 — Phases 1–3 SHIPPED v2.36.38** (plan `docs/plans/2026-09-14-backlog-entry-schema.md`, G1-reviewed; gate in warn mode; Phase 4 migration + block flip is the next mission). Relayed by `cuda` as an owner assignment;…
- **Effort**: S
- **Source**: `cuda` via hangar-bridge, 2026-09-14, msg `msg_01M2E2BHMGERX2963SGAM51YYS`.
- **Pointer**: docs/backlog/peer-reported-cuda-for-revival-3d-a-backlog-entry-has-no-schema-no-di-and-no-mec.md

### Managed rail: `--resume` with a disposition authority drops the prior findings and terminal-stops the campaign
- **Status**: shipped v2.36.41 2026-09-14
- **Trigger**: **FIRED — measured 2026-09-14** on mission-3b68ecb09a61 (backlog-entry-schema): round-1 review returned FIX-THEN-SHIP → `awaiting_disposition`; the re-invocation with `--resume --campaign-disposition-authority <valid file>` blocked…
- **Effort**: S
- **Source**: this dogfood; evidence `docs/plans/evidence/2026-09-14-backlog-entry-schema/impl-run3-resume-terminal-stop.json`.
- **Pointer**: docs/backlog/managed-rail-resume-with-a-disposition-authority-drops-the-prior-findings-and-te.md
- **Context**: root cause in `campaign-composition.js`, not the engine: writer read the findings JSON string as an array (→ `[]`); resume bound the array to a string-only provider. Both fixed (composition test); CLI e2e 待量.

### PEER-REPORTED (308-8f): parallel dispatch-hetero runs on one repo kill each other — the fingerprint counts every ref
- **Status**: shipped v2.36.44 2026-09-15
- **Trigger**: ≥2 concurrent `dispatch-hetero.sh` on one repo; 308 saw 3/3 `main checkout mutated`
- **Effort**: S
- **Source**: `308-8f` via SendMessage 2026-09-14 (KR1 c1–c3); 308 homeforge HANDOFF next-step 4
- **Pointer**: none
- **Context**: fingerprint excluded only own `BRANCH`; a sibling's `refs/heads/hands/*` was a delta. Fixed: `--sibling-ref-prefix` declares the namespace.

### Managed rail: disposition resume dies in `check-repair-scope.js` — `scope_implementation_sha` never set
- **Status**: shipped v2.36.53 2026-09-16
- **Trigger**: cuda e2e (fleet-comms P0, autopilot 3ac4fa4e): `--resume --campaign-disposition-authority` → `implementation_sha must be an immutable full 40-hex commit object ID`, exit 2, no JSON
- **Effort**: Fix
- **Source**: `cuda` via hangar-bridge 2026-09-16, msg `msg_01M2K1VDJ50VJQZPC7SGDEJVVN`; the v2.36.41 measurement point
- **Pointer**: docs/plans/evidence/2026-09-16-disposition-resume/README.md
- **Context**: the durable-wait branch of `defaultGenerationClaim` bypassed `verifyResumeCandidate`, so `resume_candidate` was the raw reference without `scope_implementation_sha`; now every git_candidate resume is verified and normalized.

### Managed rail: ledger rotation carry-forward reorders journal rows — resume/inspect fail above 256 KiB
- **Status**: shipped v2.36.54 2026-09-16
- **Trigger**: campaign-v1-fd316019… (this repo, ledger 2.1 MB): composition marked `review_no_verdict` resumable, `campaign resume` → `event input artifact must match the prior output artifact`
- **Effort**: Fix
- **Source**: /l5 dogfood 2026-09-16 (the v2.36.43 measurement point)
- **Pointer**: docs/plans/evidence/2026-09-16-disposition-resume/README.md
- **Context**: `group_by` sorted the journal carry into base64(row) order; writer now keep-first in append order; reader untouched.

### Managed rail: already-scrambled carry-only ledger segments cannot project — reader recovery or locked migration
- **Status**: open
- **Trigger**: host ledgers already rotated under the sorted `group_by` carry (zero original journals; file order is base64, not append) still throw `event input artifact must match the prior output artifact`
- **Effort**: Fix
- **Source**: l5 implementation plan 2026-09-16 (writer-only ship; reader recovery out of scope)
- **Pointer**: docs/plans/2026-09-16-ledger-rotation-order.md
- **Context**: plan §6 — provenance-gated reader recovery for `_rotation_carry` rows, or a locked migration that proves projected digests unchanged.

### Managed rail: stale campaign leases are never released — 109 runs leased since July keep the ~2 MB carry alive
- **Status**: open
- **Trigger**: any append to this repo's `implementation-campaign.jsonl` still rotates (carry ≈ whole ledger); a parked or dead campaign's `leased` stage row is carried forever
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-16 (measured while shipping v2.36.54; split out of the rotation-order row)
- **Pointer**: docs/plans/2026-09-16-ledger-rotation-order.md
- **Context**: plan §6 — a lease GC (dead pid + no heartbeat past TTL → `released`/`expired` row) so the live segment can shrink; A's `fd316019` and D's `409e89d2` parked campaigns join the pile.

### Managed rail: ADJUDICATING / VERTICAL_VERIFICATION resumes still spend the Mission claim before the git-drift check
- **Status**: open
- **Trigger**: a drifted non-durable-wait resume burns a grant attempt (same pre-spend class as v2.36.42/46/48/53)
- **Effort**: S
- **Source**: plan 2026-09-16-disposition-resume-scope-sha §6 (kept out by rubric R6)
- **Pointer**: docs/plans/2026-09-16-disposition-resume-scope-sha.md
- **Context**: extend the v2.36.53 pre-claim preflight from the durable-wait phases to every git_candidate resume; the existing P3 drift cases gain a zero-call assertion.

### Managed rail (cuda P1): GLM tautological no_finding_proof stops full_diff_review; final panel seat transport_failed
- **Status**: fired 2026-09-16
- **Trigger**: cuda P1 (fleet-comms): r2 GLM no_verdict (tautological no_finding_proof) stopped the campaign; r3 `final_panel_seat_transport_failed`; aimax395 campaign C 2026-09-16: codex seat transport_failed, panel 2/3
- **Effort**: Fix
- **Source**: `cuda` via hangar-bridge 2026-09-16, msg `msg_01M2KKK4FVS88RA6DDAR2MN3GB`
- **Pointer**: docs/projects/ongoing-maintenance/HANDOFF.md
- **Context**: three defects (raw data msg `msg_01M2KKPZ75X780NYXR0KPDDBQS`): tautological-proof check rejects a concrete proof; no_verdict result omits raw_log; final panel refuses codex (blind-review no-tools profile) though dispatch-review.sh runs it.

### Managed rail: a failed campaign_verification still dispatches review, then review_completed hits VERTICAL_VERIFICATION
- **Status**: shipped v2.36.56 2026-09-16
- **Trigger**: cuda e2e: campaign-v1-48ffc2fd… verify script failed → engine ran dispatch_review (SHIP-AS-IS) → blocked at campaign_event_journal `cannot apply review_completed while campaign is VERTICAL_VERIFICATION`
- **Effort**: Fix
- **Source**: `cuda` msg `msg_01M2K2PYTE18H2JSJ260EXMN26`; `openclaw` msg `msg_01M2KR1TFPY8F2SEX8D6ABCH2G` (second measurement, campaign-v1-cfadd975…)
- **Pointer**: docs/projects/ongoing-maintenance/HANDOFF.md
- **Context**: performReview journaled `review_completed` under `vertical_failed`; vertical repair had no path binding — now predicate-gated and path-bound to the initial changed paths.

### Managed rail: verify_cmd runs in a fresh detached worktree with no deps; its stdout/stderr never reach the ledger
- **Status**: open
- **Trigger**: a verify that needs node_modules/dist fails in 1.4 s; the ledger holds only `status:failed` + tree_sha
- **Effort**: S
- **Source**: `openclaw` via hangar-bridge 2026-09-16, msg `msg_01M2KR1TFPY8F2SEX8D6ABCH2G`
- **Pointer**: none
- **Context**: `autopilot-engine.js` ~1863 `autopilot-verify-wt-*` is a detached worktree; journal bounded verify output and document that verify_cmd must self-bootstrap.

### PEER-REPORTED (openclaw): PreToolUse(Bash) guard — detach without wake-up, `pkill -f` self-match, zsh `=`/glob abort
- **Status**: open
- **Trigger**: operator decision on adoption; three regex rules on `tool_input.command`, must fire for depth-0 too
- **Effort**: S
- **Source**: `openclaw` msgs `msg_01M2KS2TXH2V1T90DQ7X8F2TB1`, `msg_01M2KS5WZKY5WTFXPGEKJ9QH8W`; replied `msg_01M2KS6RBYNB9X43MT9PMTKGVG`
- **Pointer**: docs/projects/ongoing-maintenance/HANDOFF.md
- **Context**: (1) `nohup`/`setsid`/`&` + rail entrypoint → deny (use `run_in_background`); (2) `pkill -f` without `[x]` → warn; (3) bare `=` token or unquoted glob → deny (zsh aborts the line).

### context-budget: no model-id window source — a 1M session without the autopilot statusline gets 200k tiers
- **Status**: open
- **Trigger**: a host without autopilot's statusLine (no live `context_window_size`) on an `[1m]` model: T2 at 155k, nagging at 16 % use
- **Effort**: S
- **Source**: `gentoo` msg `msg_01M2KSM2SZRDN31GY8K943K18V`; replied `msg_01M2KSSQHTS6WMCBXGSQFHD4P5` (set explicit t1/t2 meanwhile)
- **Pointer**: docs/projects/ongoing-maintenance/HANDOFF.md
- **Context**: `hooks/context-budget.js` reads the live file, else `inferWindowTokens(observedMax)`; add the transcript model id (`[1m]` → 1M) as a source before the ratchet.

### provider-readiness-consumer / autopilot-cli suites track the live review-loop config — red since acf3b06c
- **Status**: fired 2026-09-16
- **Trigger**: `resolveReviewLoopJson(['--check-scorecard'])` inside the suites exits 3 (cursor implementer has no row in the sandboxed capability dir); 5 + 33 failures at base fe225ff5
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-16 (mission agy-effort-rail-wording, `acceptance_failed` on command #6)
- **Pointer**: docs/plans/evidence/2026-09-16-agy-effort-rail-wording/README.md
- **Context**: the d0b95eff config does not heal them either (6 / 25 failures); the suites need a hermetic `REVIEW_LOOP_CONFIG_OVERRIDE` fixture and host-independent expectations.

### Managed rail: acceptance_failed cannot be journaled — terminal journal says MUTATION_FAILURE_EVIDENCE_REQUIRED
- **Status**: open
- **Trigger**: a hand commit whose verification command fails → `campaign_terminal_journal` refuses, exit 1, no durable wait, no receipt; the lease joins the stale pile
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-16 (mission agy-effort-rail-wording, campaign-v1-fee713e8…)
- **Pointer**: docs/plans/evidence/2026-09-16-agy-effort-rail-wording/impl-run1.json
- **Context**: the dispatch-hetero envelope names the failing command and exit code; the terminal event wants a mutation-failure evidence digest the acceptance path never produces.

### CI `tests` workflow red before v2.36.54: `dispatch-detached-campaign-authority.test.sh` fails on the runner
- **Status**: open
- **Trigger**: every run since at least 2026-09-14 (the workflow runs only the changed test files, so the red is masked locally)
- **Effort**: S
- **Source**: `gh run list` 2026-09-16 while fixing the v2.36.54 executable-bit red
- **Pointer**: none
- **Context**: `detached campaign strict dispatch changes only the narrow subset: expected 'src/out.txt', got ''` on the GitHub runner; passes locally — environment coupling to reproduce in a clean clone.

### Intake dirty-tree precondition on a shared main checkout: the refusal does not name the clean-worktree remedy
- **Status**: shipped v2.36.55 2026-09-16
- **Trigger**: cuda e2e on v2.36.48: `--cwd` main checkout refused (dirty), a clean detached worktree as `--cwd` passed
- **Effort**: S
- **Source**: `cuda` via hangar-bridge 2026-09-16, msg `msg_01M2K2PYTE18H2JSJ260EXMN26`
- **Pointer**: none
- **Context**: expected usage (fail-closed pre-claim, v2.36.48); refusal should name the remedy: commit, or pass a clean checkout/worktree as `--cwd`.

### /l5 wording: verification-author seat error lacks the remedy; CLI `status readiness --probe` is always probe-needed
- **Status**: shipped v2.36.55 2026-09-16
- **Trigger**: an operator hits `requires the verification-author seat` or reads `probe-needed` from the CLI
- **Effort**: S
- **Source**: `cuda` via hangar-bridge 2026-09-16 (same thread)
- **Pointer**: none
- **Context**: VA refusal must name `verification_author_present: true` plus `verification_author_*` keys in `.claude/review-loop-config.md`; silent readiness bootstrap fallback made `--probe` look always probe-needed.

### PEER-REPORTED (openclaw): agy flash/low implementer is no-go on real briefs — qualify on brief length + self-run tests
- **Status**: open
- **Trigger**: next agy implementer qualification, or a consumer config that still defaults the implementer to agy
- **Effort**: S
- **Source**: `openclaw` via hangar-bridge 2026-09-16, msg `msg_01M2KNFAB7P7TGGMF4K5QYQFYH`
- **Pointer**: none
- **Context**: agy `-p` self-aborts at 5 min, a >~40-line brief at low ends in silent no_op, `run_command` 10 s cap backgrounds test loops; add scorecard dimensions or auto-degrade the seat with a warning.

### Managed rail: a reviewer that self-revokes a MUST-FIX under a reused finding id is normalized as no_verdict
- **Status**: open
- **Trigger**: a rail review whose findings text contains "REVOKED" and two entries with one `[id]` — `product_review_normalization` fails `duplicate product review finding <id>` and the campaign parks in durable wait although the verdict was readable
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-16 (mission ledger-rotation-order, MiniMax-M3 r1)
- **Pointer**: docs/plans/evidence/2026-09-16-ledger-rotation-order/README.md
- **Context**: a 🟠 and a 🔵 shared id `rotation-carry-jq`, the 🟠 ending "REVOKED"; the duplicate-id check is correct fail-closed but discards a readable review. Option: drop REVOKED findings before the duplicate check, keep them advisory.

### PEER-REPORTED (cuda): `migrate-backlog-entries.js` needs a table-style parser — revival.3d's BACKLOG is a 196 KB table
- **Status**: shipped v2.36.51 2026-09-16
- **Trigger**: cuda asked 2026-09-16 (msg `msg_01M2JWY92NEV7CMDB7MSFK5YJZ`) after the heading-only limit was named in the v2.36.39 handoff
- **Effort**: S
- **Source**: `cuda` via hangar-bridge, 2026-09-16, thread `msg_01M2JW9NJRE106DKDZWQARFJF2`
- **Pointer**: docs/projects/ongoing-maintenance/HANDOFF.md
- **Context**: `planMigration` opens with `exit 2 not supported yet` for table style; the gate's parser already handles tables. Owner-led /l5 question in the same thread was a stale v2.36.22 checkout.

### PEER-REPORTED (308-8f): main-checkout fingerprint stat-walks untracked files — a foreman's own rail I/O trips it
- **Status**: shipped v2.36.50 2026-09-16
- **Trigger**: a caller writes hand result/stderr under its own worktree, or `main_checkout_mutated` fires falsely again
- **Effort**: S
- **Source**: `308-8f` via SendMessage 2026-09-14 (TASK-C3); 308 repo `TASK-C3-tracer-second-worker-20260914.md` "rail 坑"
- **Pointer**: none
- **Context**: stat walk is by design (2026-09-13); fixed as caller-declared `--sibling-path-prefix <dir>/`.

### PEER-REPORTED (308-8f): agy flash-medium hand without `--effort medium` only edits — no run_command, no commit
- **Status**: shipped v2.36.55 2026-09-16
- **Trigger**: any agy hand dispatched without an explicit effort; re-check `agy_effort_clamp` default in `dispatch-hetero.sh`
- **Effort**: Fix
- **Source**: `308-8f` via SendMessage 2026-09-14; dispatcher note in 308's `/tmp/c3-runs/u1-a.stderr.log`
- **Pointer**: none
- **Context**: CONFLICT `--model <tier id> --effort <other>` on agy ≥ 1.2 (not a missing flag); suffix-encoded ids must drive `--effort`.

### Managed rail: a non-git `--repo` still consumes a Mission claim before intake rejects it
- **Status**: open
- **Trigger**: any intake rejection between the Mission claim and `inspectSealedCampaignContract` is measured burning an attempt again
- **Effort**: Fix
- **Source**: v2.36.42 pre-merge review (sonnet), 2026-09-14
- **Pointer**: none
- **Context**: `projectMissionMode` does not touch git, so the claim runs before repo identity is known. Reject on `canonicalRepoIdentity` throw pre-claim + a non-git fixture.

### `dispatch-foreman.test.sh` loses its TEST_TMP after case 3 — 40 assertions red on develop
- **Status**: open
- **Trigger**: reproduced 2026-09-15 on origin/develop in a clean worktree (62 pass / 40 fail); first symptom `wait_for: No record of process`, then `TEST_TMP/repo: No such file`
- **Effort**: S
- **Source**: observed while shipping v2.36.44; not caused by it (identical on HEAD~1)
- **Pointer**: none
- **Context**: looks like the EXIT trap (`rm -rf "$TEST_TMP"`) fires from a killed child/process group in case 3. Cases 6/9/12 (main-checkout boundary) are unobservable until fixed.

### `autopilot-engine.test.sh` resolves the live config under an isolated capability store — 10 waiver/KR4 assertions red
- **Status**: shipped tests-only 2026-09-15
- **Trigger**: the suite is red wherever this repo has an l5 marker (2026-09-14: 476/10 on HEAD, `strict /l5 implementer tuple.endpoint is unresolved`)
- **Effort**: S
- **Source**: observed 2026-09-14 while adding the no_verdict classifier cases (v2.36.43)
- **Pointer**: none
- **Context**: the live config's cursor pin is absent from the isolated capability dir (exit 3); fixed via frozen fixture + seeded pin.

### Managed rail: the final panel's non-incumbent seats are structurally precondition_failed under the exact-tuple rule
- **Status**: shipped v2.36.46 2026-09-15
- **Trigger**: peer-residue attempt 3 stopped at `final_panel_seat_precondition_failed`: codex/GLM seats are neither the incumbent tuple nor in `fallback_ladder`
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-15, `finalPanelSeatQualified` in `src/engine/autopilot-engine.js`
- **Pointer**: docs/plans/2026-09-15-final-panel-per-seat-pins.md
- **Context**: cause was the inputs, not the rule — see plan §0.

### Managed rail: a pre-spend rejection at the dispatch-hetero layer still consumes the Mission claim
- **Status**: shipped v2.36.48 2026-09-15
- **Trigger**: peer-residue attempts 1–2 burned (dirty tree; marker-bridge digest); final-panel-pins attempt 1 burned on `required path … not present at base` (a NEW file in `required_paths`)
- **Effort**: Fix
- **Source**: /l5 dogfood 2026-09-15; sibling of v2.36.42 and of the non-git `--repo` row
- **Pointer**: docs/plans/evidence/2026-09-15-final-panel-pins/impl-run1.json
- **Context**: `precondition_failed` before any runner spend should release with the attempt refunded, or the checks should run at intake before the claim.

### `--mirror-roots-json` omits `skills` — the graph check cannot warn that a skills output needs its mirror
- **Status**: shipped v2.36.47 2026-09-15
- **Trigger**: final-panel-pins attempt 1: hand commit `boundary_rejected` on `platforms/codex/plugin/skills/l5/references/hetero-impl-loop.md`, unlisted and unflagged by `--mirror-roots`
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-15
- **Pointer**: docs/plans/evidence/2026-09-15-final-panel-pins/impl-run2.json
- **Context**: add `skills` to the dirs list so the graph check names the mirror pre-seal.

### Managed rail never passes scorecard scope files — `fallback_ladder` is always `[]`; evidenced qc seats need a pin
- **Status**: open
- **Trigger**: a qc seat scorecard-qualified for reviewer (e.g. gpt-5.6-sol once `codex-cli`/`codex` canonicalise) is refused at intake without a pin
- **Effort**: S
- **Source**: plan §0 fact 1 / §6, 2026-09-15
- **Pointer**: docs/plans/2026-09-15-final-panel-per-seat-pins.md
- **Context**: engine resolves with bare `--check-scorecard`; `resolve-review-loop.sh:1498` needs both files to emit a ladder.

### /l5 recipe: set the l5 marker AFTER the plan hetero loop — under it codex seats are refused as non-strict dispatch
- **Status**: fired 2026-09-15
- **Trigger**: plan-review codex seat exit 2 with `active session-mode=l5 blocks non-strict dispatch`; the artifact recorded empty stdout and transport_exhausted
- **Effort**: S
- **Source**: /l5 dogfood 2026-09-15
- **Pointer**: docs/plans/2026-09-15-peer-residue-config-ladder-qc-namespace.md
- **Context**: recipe order corrected; the rail could surface the marker block as the seat's reason instead of an empty envelope.

### Managed rail: a malformed `review.findings` string parks the campaign in AWAITING_DISPOSITION with `[]` snapshot
- **Status**: open
- **Trigger**: a review whose findings fail `normalizeFindings` (UNSTRUCTURED/INVALID/DUPLICATE codes) reaches the durable wait on a real run
- **Effort**: S
- **Source**: v2.36.41 pre-merge review (sonnet), 2026-09-14
- **Pointer**: none
- **Context**: identityInvalid gate in `campaign-composition.js` covers only FINDING_IDENTITY_INVALID; pre-existing. Widen the gate or block non-resumable.

### `engine implement-review --campaign-ledger <custom path>` is refused at intake and the refusal burns a grant attempt
- **Status**: shipped v2.36.42 2026-09-14
- **Trigger**: **FIRED — measured 2026-09-14**: `campaign_ledger_path_mismatch` ("must be the repository-wide canonical Git common-dir ledger"); the claim for attempt 1 was consumed and `mission grant` minted attempt 2.
- **Effort**: Fix
- **Source**: this dogfood.
- **Pointer**: docs/backlog/engine-implement-review-campaign-ledger-custom-path-is-refused-at-intake-and-the.md
- **Context**: the flag exists in `--help` but only one value is accepted; either drop the flag or make intake validate it before the claim is spent.

### agy `--input-format stream-json` raises the payload ceiling but does NOT remove it — and above it the failure is SILENT
- **Status**: open
- **Trigger**: the next agy-rail dispatch refused by `agy_argv_ceiling_assert`, or any work that proposes routing `dispatch-review.sh` / `dispatch-hetero.sh` / `dispatch-author.sh` through stream-json.
- **Effort**: S
- **Source**: peer report from twgs-revival 2026-09-11, re-derived locally the same day with four probes; `scripts/lib/agy-argv-ceiling.sh`, callers at…
- **Pointer**: docs/backlog/agy-input-format-stream-json-raises-the-payload-ceiling-but-does-not-remove-it-a.md
- **Context**: a peer host (twgs-revival, 2026-09-11) reported that agy 1.2.0's `--input-format stream-json` reads NDJSON from stdin and so bypasses the 131072-byte `MAX_ARG_STRLEN` argv wall, measured at 208951 bytes with `status: SUCCESS`, and…

### Pin store hardening: fsync, orphaned temp files, and re-validation of stored rows
- **Status**: open
- **Trigger**: a report of a `pins.jsonl` lost or corrupted by power loss (not a process kill), a store directory accumulating `.pins.jsonl.tmp.*` litter, or the first consumer that reads the pin store without going through `readPinRows`.
- **Effort**: S
- **Source**: depth-0 QC panel on the operator pin store, 2026-09-11.
- **Pointer**: docs/backlog/pin-store-hardening-fsync-orphaned-temp-files-and-re-validation-of-stored-rows.md
- **Context**: the QC panel (GLM-5.2, 2026-09-11) raised four Suggestion-level items against the v1 pin store, all reproduced at depth 0 and all hardening rather than regressions.

### Managed campaign intake: a rejected intake sometimes releases the Mission claim and sometimes strands it
- **Status**: open
- **Trigger**: the next managed `engine implement-review` run that hits `attempt_blocked_by_open_claim` naming a claim from a rejection that already reported failure, or any work on `src/engine/campaign-intake.js`'s rejection paths.
- **Effort**: S
- **Source**: /l5 dogfood on the operator pin store, 2026-09-11 — D1 (5 attempts, 3 lost to this class) and D2 (3 attempts, repair deadlocked identically).
- **Pointer**: docs/backlog/managed-campaign-intake-a-rejected-intake-sometimes-releases-the-mission-claim-a.md
- **Context**: measured 2026-09-11 across five attempts on one lineage.

### PEER-REPORTED (chatgpt-tunnel-host via cuda): a non-Claude foreman rail — and two contract defects that are not really about foremen
- **Status**: shipped v2.36.45 2026-09-15
- **Trigger**: **FIRED — feature request received 2026-09-12.** Queued behind the 2026-09-12 integration-ledger graph. Before designing the rail, split it (see the ruling below): two of the four root causes are general contract defects that a…
- **Effort**: Fix
- **Source**: feature request from `chatgpt-tunnel-host` relayed via `cuda`, 2026-09-12. Not reproduced here; their log and brief deliberately not collected yet, to avoid…
- **Pointer**: docs/backlog/peer-reported-chatgpt-tunnel-host-via-cuda-a-non-claude-foreman-rail-and-two-con.md

### PEER-REPORTED (7840hs, unverified locally): four dispatch-layer defects, three of them silent
- **Status**: shipped v2.36.33 2026-09-13
- **Trigger**: **FIRED — reported 2026-09-12.** Queued behind the four deliverables of the 2026-09-12 integration-ledger graph. Reproduce each on this host before designing; the peer's evidence is isolated and credible but lives on their machine.…
- **Effort**: Fix
- **Source**: cross-session report from `cookys-7840hs` via fleet relay, 2026-09-12. Not reproduced on this host. Reply sent the same day; delivery was **durable, not…
- **Pointer**: docs/backlog/peer-reported-7840hs-unverified-locally-four-dispatch-layer-defects-three-of-the.md

### PEER-REPORTED (308 dogfood): acceptance records no accepted SHA, so containment cannot be checked mechanically
- **Status**: shipped v2.36.29 2026-09-12
- **Trigger**: **FIRED — reported with two days of burned measurement behind it, 2026-09-12.** Queue behind the operator-pin plan. P1 first: P2 and P3 both consume it. Reproduce the schema gap locally (it is a file read, not a run) before designing;…
- **Effort**: Fix
- **Source**: cross-session report from `308-db`, 2026-09-12, after a two-day measurement phase measured a build whose inputs were never verified present.
- **Pointer**: docs/backlog/peer-reported-308-dogfood-acceptance-records-no-accepted-sha-so-containment-cann.md

### PEER-REPORTED (openclaw): an active l5 marker deadlocks the bounded campaign /l5 itself launched — MAIN CLAIM CLOSED v2.36.28, two side effects open
- **Status**: open
- **Trigger**: see pointer
- **Effort**: Fix
- **Source**: peer report from openclaw via fleet relay, 2026-09-12. Not reproduced on this host.
- **Pointer**: docs/backlog/peer-reported-openclaw-an-active-l5-marker-deadlocks-the-bounded-campaign-l5-its.md

### Reconnaissance and implementation share one leaf bash budget, so a leaf can exhaust it before touching code
- **Status**: open
- **Trigger**: **NOT FIRED — peer observation, 2026-09-13.** Fires when a leaf under this rail is measured hitting its command cap with zero diff.
- **Effort**: S
- **Source**: `308-db` via the local session mesh, 2026-09-13.
- **Pointer**: docs/backlog/reconnaissance-and-implementation-share-one-leaf-bash-budget-so-a-leaf-can-exhau.md
- **Context**: `308-db` ran six Agent-worktree leaves on 2026-09-13; three hit the 40-command bash ceiling **after reconnaissance was complete and before a single line changed**.

### A non-Claude engine cannot sit in the foreman seat — no rail exists, and the request is now from two independent peers
- **Status**: shipped v2.36.34 2026-09-13
- **Trigger**: **FIRED 2026-09-13 — the operator authorised Shape B directly ("B 真工頭（配額是動機）"); shipped v2.36.34.** (Earlier: requested by `308-db` 2026-09-12, relayed as an owner ruling.) A peer's relay of an owner decision is…
- **Effort**: S
- **Source**: cross-session request from `308-db` via the local Claude session mesh, 2026-09-12. Nothing re-derived on this host yet.
- **Pointer**: docs/backlog/a-non-claude-engine-cannot-sit-in-the-foreman-seat-no-rail-exists-and-the-reques.md
- **Context**: there is no supported path for a non-Claude engine to hold the control loop.

### `Project Paths` is write-only config — `scaffold-config.js` emits it, nothing reads it, and the skills that create project docs never see it
- **Status**: shipped v2.36.31 2026-09-13
- **Trigger**: **FIRED — swept 2026-09-12** across all 30 skills after `resolve-knowledge-routing.sh` landed, asking which others name autopilot's own layout.
- **Effort**: S
- **Source**: 30-skill sweep, 2026-09-12, prompted by the operator after `resolve-knowledge-routing.sh` (v2.36.30).
- **Pointer**: docs/backlog/project-paths-is-write-only-config-scaffold-config-js-emits-it-nothing-reads-it.md

### Main-checkout boundary: accepted residuals of an accident guard that is not a sandbox
- **Status**: open
- **Trigger**: fires only if the boundary is ever asked to be a sandbox — i.e. an adversarial worker becomes a threat model this repo adopts. Today it is not (`references/blind-dispatch.md`; v2.36.32's own contract says "accident guard, not a sandbox").
- **Effort**: L
- **Source**: v2.36.32 review round 6, 2026-09-13, adjudicated at depth 0 by re-derivation.
- **Pointer**: docs/backlog/main-checkout-boundary-accepted-residuals-of-an-accident-guard-that-is-not-a-san.md
- **Context**: v2.36.32's detection layer fingerprints every ref, HEAD, symbolic-ref target, staged/unstaged diff content, and a size+mtime+type+link-target walk of every entry outside `.git`.

### The shared config ladder's tier 3 reads the PLUGIN's `.claude/`, and the installed plugin ships one
- **Status**: shipped v2.36.45 2026-09-15
- **Trigger**: **FIRED — measured 2026-09-12** while building `resolve-knowledge-routing.sh`; the leak went red on the first foreign-project test before the resolver was fixed.
- **Effort**: S
- **Source**: /l5-adjacent dogfood, 2026-09-12, `docs/plans/2026-09-12-portable-knowledge-routing.md`.
- **Pointer**: docs/backlog/the-shared-config-ladder-s-tier-3-reads-the-plugin-s-claude-and-the-installed-pl.md
- **Context**: `scripts/lib/resolve-config.sh` tier 3 is `$REPO_ROOT/.claude/<basename>`, where `REPO_ROOT` is **autopilot's own root**, not the consuming project's.

### `resolve-review-loop.test.sh` asserts on the LIVE project config, so any legitimate seat change reds the suite
- **Status**: shipped v2.36.36 2026-09-13
- **Trigger**: nine failures of the shape `default implementer (grok, Board decision A): '"implementer_engine": "grok-4.5"' not found in output` after editing `.claude/review-loop-config.md`.
- **Effort**: S
- **Source**: /l5 dogfood, 2026-09-12, discovered by the suite catching the author's own config edit.
- **Pointer**: docs/backlog/resolve-review-loop-test-sh-asserts-on-the-live-project-config-so-any-legitimate.md

### The shipped operator-pin admission is unreachable from the managed rail — it only fires when a caller passes `--resolved-live`
- **Status**: shipped v2.36.36 2026-09-13
- **Trigger**: `contract checker failed: ["engine: no qualified scorecard row for configured role/engine/runner (per-invocation --qualification-override is the only evidence-free path)"]` on a seat that HAS a standing pin.
- **Effort**: S
- **Source**: /l5 dogfood, 2026-09-12 — five grant attempts on one node, each blocked by a different layer of the same seat change.
- **Pointer**: docs/backlog/the-shipped-operator-pin-admission-is-unreachable-from-the-managed-rail-it-only.md

### The Mission graph models parallel deliverables that the controller cannot actually run in parallel
- **Status**: shipped v2.36.36 2026-09-13
- **Trigger**: any graph with two or more independent nodes in one batch, or the next `campaign_intake` rejection reading `canonical Mission state changed between intake and controller persistence`.
- **Effort**: S
- **Source**: /l5 dogfood on the integration-ledger graph, 2026-09-12 — three concurrent dispatches, one survivor, and a clean serial re-run of a rejected node as the…
- **Pointer**: docs/backlog/the-mission-graph-models-parallel-deliverables-that-the-controller-cannot-actual.md

### A campaign's `output_paths` must enumerate every codex mirror, and the rejection arrives after the model has done the work
- **Status**: shipped v2.36.36 2026-09-13
- **Trigger**: `boundary_rejected: changed path 'platforms/codex/plugin/...' is outside sealed output surface`.
- **Effort**: Fix
- **Source**: /l5 dogfood, 2026-09-12.
- **Pointer**: docs/backlog/a-campaign-s-output-paths-must-enumerate-every-codex-mirror-and-the-rejection-ar.md

### Two L5 deliverables cannot run on one repo inside 24h: the marker bridge scans every marker and `clear` needs a receipt nothing writes
- **Status**: shipped v2.36.48 2026-09-15
- **Trigger**: the next managed `engine implement-review` blocked at `precondition_failed` with `marker-to-campaign admission bridge failed: marker Mission mission_graph_digest does not match campaign projection`, or any work on…
- **Effort**: S
- **Source**: /l5 dogfood on the operator pin plan, 2026-09-11 — D4 blocked three attempts (`AUTOPILOT_ROOT_RUN_ID` missing, then `mission_grant_ref_released`, then the…
- **Pointer**: docs/backlog/two-l5-deliverables-cannot-run-on-one-repo-inside-24h-the-marker-bridge-scans-ev.md
- **Context**: measured 2026-09-11 (operator-pin D3→D4) and again 2026-09-15: a dead session's l3/entry-l5 marker for the shipped migration graph blocked peer-residue attempt 2; moved aside by hand.

### The implementer ladder's cost ordering is nearly degenerate — 11 of 17 rungs share one effort tier
- **Status**: open
- **Trigger**: the next time a climb picks a seat whose price is wildly out of line with the rung below it, or any work that wants the ladder to mean "cheaper first" in dollars rather than in label order.
- **Effort**: S
- **Source**: v2.36.20 follow-up, 2026-09-08; the adjacency rule shipped, this is the ordering key underneath it
- **Pointer**: docs/backlog/the-implementer-ladder-s-cost-ordering-is-nearly-degenerate-11-of-17-rungs-share.md
- **Context**: measured on this host 2026-09-08 (`~/.autopilot/topology.json`, 17 rungs): indices 5–16 are ALL `high`, so within that region the ordering falls through to `latency.sample_wall_time_s` then engine name.

### `probe-unknown.js classify` spawns `resolve-review-loop.sh` up to seven times per call — memoize one resolver invocation
- **Status**: open
- **Trigger**: a foreman round-end ledger or `cost-tracker` sample showing `probe-unknown.js classify` taking ≥ 10 s wall time, or a round that runs classify ≥ 3 times (each resolver spawn is a full config + topology resolution with a 15 s timeout).
- **Effort**: S
- **Source**: pre-merge review of `feat/v2.36.15-unknown-escalation-ladder`, 2026-09-07.
- **Pointer**: docs/backlog/probe-unknown-js-classify-spawns-resolve-review-loop-sh-up-to-seven-times-per-ca.md
- **Context**: v2.36.15 P1/P2 read `unknown_escalation`, the three budgets, `consult_dispatch`, `consult_resolved_from` and `unknown_resolved_from` through separate `resolve-review-loop.sh --field` calls (`scripts/probe-unknown.js` resolverField).

### kimi reviewer rail: file-indirection for prompts above the argv wall (needs a live kimi credential to probe)
- **Status**: open
- **Trigger**: a host with a working `kimi login` (this host's managed:kimi-code OAuth has no credential as of 2026-09-07, so the probe could not run), or Kimi Code CLI shipping `--prompt-file` / stdin prompt input (0.39.1 has neither: `-p ''` is…
- **Effort**: S
- **Source**: 308 report 2026-09-07, run review-1788751167-2077044-2d7b.
- **Pointer**: docs/backlog/kimi-reviewer-rail-file-indirection-for-prompts-above-the-argv-wall-needs-a-live.md
- **Context**: v2.36.14 fails closed pre-spend when the kimi prompt exceeds ~120 KB (Linux MAX_ARG_STRLEN, 308 hit rc=126 on a 145 KB prompt).

### Per-hook × per-harness support matrix with verification dates (hook inventory that is periodically re-checked)
- **Status**: open
- **Trigger**: the next hook that is registered on a second harness (Codex `Stop`/`SessionEnd` for `dirty-protected-paths` is the first, v2.36.11, and its Codex live-fire is unverified), or a `harness-maintenance` run that finds a hook-event claim…
- **Effort**: S
- **Source**: owner 2026-09-07 during the dirty-tree hook ship; `references/evidence-discipline.md` (script existing ≠ running).
- **Pointer**: docs/backlog/per-hook-per-harness-support-matrix-with-verification-dates-hook-inventory-that.md
- **Context**: owner question 2026-09-07 「那些 hook 是不是要統一做個盤點表定期 check 所有 harness 是否支援」.

### Codex dev-mode hook entry that survives plugin cache replacement (`~/.codex/hooks.json` → repo path)
- **Status**: open
- **Trigger**: a second report of `PostCompact MODULE_NOT_FOUND` on a host that ran `dev-setup.sh --harness codex --install` with `--force`, or a Codex release that documents whether hook `command` strings run through a shell (then a self-contained…
- **Effort**: S
- **Source**: local Codex session hand-off via agent-call 2026-09-07; `hooks/tests/codex-plugin-package.test.sh` upgrade case.
- **Pointer**: docs/backlog/codex-dev-mode-hook-entry-that-survives-plugin-cache-replacement-codex-hooks-jso.md
- **Context**: v2.36.10 guards the update (refuse under live sessions) but cannot make a live session survive it: Codex pins `PLUGIN_ROOT` to `~/.codex/plugins/cache/…/<version>/`, and both `plugin add` (in-place upgrade) and `plugin remove` delete…

### Apply two-tier + pooled verdict to reviewer/implementer/owner/verification_author/brain
- **Status**: open
- **Trigger**: a role's own eval corpus + scorecard-first ON/OFF evidence exists — a frozen, sealed
- **Effort**: L
- **Source**: `docs/plans/2026-08-29-qualification-verdict-stability.md` D8
- **Pointer**: docs/backlog/apply-two-tier-pooled-verdict-to-reviewer-implementer-owner-verification-author.md
- **Context**: `foldPooledVerdict`, `(VERDICT_Z, VERDICT_TAU)`, and the D3 error-class → tier map

### Codex payload install-time generation（2026-08-02 residual spike：NO-GO）
- **Status**: open
- **Trigger**: Codex 提供受支援的 native plugin lifecycle：在 plugin install **與** Git marketplace upgrade/refetch 兩條適用路徑上，都能於 payload discovery 前自動執行 deterministic generator，且 generator…
- **Effort**: L
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）；[`codex-payload-residual-spike`](projects/_archive/2026-08-02-codex-payload-residual-spike/README.md)…
- **Pointer**: docs/backlog/codex-payload-install-time-generation-2026-08-02-residual-spike-no-go.md
- **Context**: codex-cli 0.146.0 的 logged-in `codex exec` 已實證 installed Autopilot cache payload 與 linked support reference 可被讀取，且 audit 結果正確。殘餘 probe 同時反證把 local source 當 Git refresh：generation A…

### Release-time payload branch（B）重啟條件
- **Status**: open
- **Trigger**: CI 連續數週綠＋真實 tag/release 節奏存在（非每 push 即 shippable）＋ C-Spike 已否決 install-time 路線
- **Effort**: L
- **Source**: health-roadmap P6 Decision Brief（2026-07-17）
- **Pointer**: docs/backlog/release-time-payload-branch-b.md
- **Context**: Generic push/PR test CI 已存在，但 B 仍需新建 tag→payload publication→push-credential 的 release path；於多 PATCH/日的節奏下，每個 Codex 可見修復多四個失敗點；QA 判 test-signal 時點最差（user…

### 🔵 suite oracle lock: a killed full-suite run leaves the next one refused (observed 2026-09-02)
- **Status**: open
- **Trigger**: see pointer
- **Effort**: M
- **Source**: unknown
- **Pointer**: docs/backlog/suite-oracle-lock-a-killed-full-suite-run-leaves-the-next-one-refused-observed-2.md

### <Topic title>
- **Status**: open
- **Trigger**: <external or evidence condition; e.g. "after sample N of behavior Y" / "performance degrades below threshold Z">
- **Effort**: S
- **Source**: <commit SHA / review-round / retro / plan ref>
- **Pointer**: docs/backlog/topic-title.md
- **Context**: <one-line problem>

### Promote the depth-0 hetero-run watcher to a shipped dispatch-watch script
- **Status**: open
- **Trigger**: the next `/l4`–`/l6` session that has to wake parked foremen — depth-0 re-armed a scratch script ~40 times in v2.36.0 (report the first run whose `dispatch-status.js` phase flips from running to terminal)
- **Effort**: S
- **Source**: v2.36.0 session
- **Pointer**: docs/backlog/promote-the-depth-0-hetero-run-watcher-to-a-shipped-dispatch-watch-script.md
- **Context**: parked foremen are never woken by their own background children; a shipped watcher plus a documented `SendMessage` wake step would replace the hand-rolled loop.

### Lint hands diffs for fixture literals leaking into production code
- **Status**: open
- **Trigger**: next hands cut on a script with a test that names phases/ids (`p7`, `fixture`, `test`)
- **Effort**: S
- **Source**: core review g2, v2.36.0
- **Pointer**: docs/backlog/lint-hands-diffs-for-fixture-literals-leaking-into-production-code.md
- **Context**: `references/evidence-discipline.md` §23 — three reviewers caught a `phase === 'p7'` carve-out the suite could not

### check-phase-review-receipt: min-reviewed-seats enforcement test on a multi-seat fixture
- **Status**: open
- **Trigger**: next touch of the seat-coverage rule
- **Effort**: S
- **Source**: same g4 dir
- **Pointer**: docs/backlog/check-phase-review-receipt-min-reviewed-seats-enforcement-test-on-a-multi-seat-f.md
- **Context**: case 14 proves the parse guard, not that a higher minimum is enforced on a 3-seat chain (MiniMax FOLLOW-UP, core review g4)

### hetero-review-loop: confirm finalize always emits severity in open_findings (checker now requires deep equality on id/severity/disposition)
- **Status**: open
- **Trigger**: the next FIX-THEN-SHIP receipt with verified Major/Minor findings — depth-0 saw severity present on the v2.36.0 receipts, so this is a confirmation row (GLM FOLLOW-UP, core review g3)
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/g3/`
- **Pointer**: docs/backlog/hetero-review-loop-confirm-finalize-always-emits-severity-in-open-findings-check.md
- **Context**: shared-format drift surface between finalize and the checker

### resolve-review-loop.sh: audit every remaining runner comparison for codex-cli/codex canonicalisation
- **Status**: open
- **Trigger**: next touch of the reviewer_ladder / hetero_review extraction or any `entry.runner === implRunner` site
- **Effort**: S
- **Source**: same g3 dir
- **Pointer**: docs/backlog/resolve-review-loop-sh-audit-every-remaining-runner-comparison-for-codex-cli-cod.md
- **Context**: normRunner was added at the plan-panel and consult sites; other comparisons may re-admit a dual seat (GLM FOLLOW-UP, core review g3)

### hetero-review-loop: charset guard on seat ids before path.join
- **Status**: open
- **Trigger**: any change that lets a seat id come from outside the driver
- **Effort**: S
- **Source**: same g3 dir
- **Pointer**: docs/backlog/hetero-review-loop-charset-guard-on-seat-ids-before-path-join.md
- **Context**: `../` in an id could escape the generation directory; no capability gained today because the ledger is writer-controlled (GLM FOLLOW-UP, core review g3)

### check-phase-review-receipt: a head moved only by commits touching allowlisted excluded paths should still validate
- **Status**: open
- **Trigger**: every release closeout — CHANGELOG/ledger/archive commits land after the last review generation, so the receipt's head never equals the merge head
- **Effort**: S
- **Source**: v2.36.0 closeout, `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/`
- **Pointer**: docs/backlog/check-phase-review-receipt-a-head-moved-only-by-commits-touching-allowlisted-exc.md
- **Context**: the checker binds `review_head_sha` to the branch head; today the honest sequence is "checker exit 0 at the reviewed head, recorded in the ledger, then docs-only commits".

### hetero-review-loop / check-phase-review-receipt: hoist EXCLUDE_ALLOWLIST and isPathspecAllowed into scripts/lib
- **Status**: open
- **Trigger**: the next edit to either copy (they are byte-identical today)
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-core/g2/`
- **Pointer**: docs/backlog/hetero-review-loop-check-phase-review-receipt-hoist-exclude-allowlist-and-ispath.md
- **Context**: duplicated verbatim in both scripts; a one-sided edit would silently desynchronise the gate (GLM + MiniMax FOLLOW-UP, core review g2, 2026-09-04)

### review-chain-derive.js documents "no side effects" but mutates the chain entries it receives
- **Status**: open
- **Trigger**: any caller that keeps a reference to the chain after derivation
- **Effort**: S
- **Source**: same g2 dir
- **Pointer**: docs/backlog/review-chain-derive-js-documents-no-side-effects-but-mutates-the-chain-entries-i.md
- **Context**: either copy on entry or drop the purity claim (GLM FOLLOW-UP, core review g2)

### check-phase-review-receipt: open_findings comparison ignores severity; reviewed_seats/total_seats not cross-checked against seat artifacts
- **Status**: open
- **Trigger**: verify after the g2 repairs land whether the deep-equality and seat-coverage fixes already cover both; close the row if so
- **Effort**: S
- **Source**: same g2 dir
- **Pointer**: docs/backlog/check-phase-review-receipt-open-findings-comparison-ignores-severity-reviewed-se.md
- **Context**: MiniMax + GLM FOLLOW-UP, core review g2

### resolve-review-loop.test.sh capability-warning assertion messages still say "no warning" while expecting the topology fallback lines
- **Status**: open
- **Trigger**: next touch of that test file
- **Effort**: S
- **Source**: same g2 dir
- **Pointer**: docs/backlog/resolve-review-loop-test-sh-capability-warning-assertion-messages-still-say-no-w.md
- **Context**: wording only; the expectations are correct (GLM CUT, core review g2)

### `normalize_agy_alias()` rewrites config-side seat names before the qc-exclusion match in `consult_dispatch: auto`
- **Status**: open
- **Trigger**: a `qc_panel` entry written as an agy alias (e.g. `gemini-flash`) while the topology ladder carries the resolved name — the exclusion set never matches and a qc seat can be picked as the consult seat
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/D4.md`
- **Pointer**: docs/backlog/normalize-agy-alias-rewrites-config-side-seat-names-before-the-qc-exclusion-matc.md
- **Context**: found by the D4 hermetic test's first fixture (2026-09-04); the fixture was changed to a non-aliased name, the resolver was not.

### `resolve-review-loop.sh` `auto` knobs read a stale `~/.autopilot/topology.json` and fall back natively
- **Status**: open
- **Trigger**: a host whose cached topology predates a plugin version that added roles (observed 2026-09-04: cache without `consult_ladder` ⇒ `consult_resolved_from: native-fallback` until `resolve-dispatch-topology.js` was re-run)
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/D1.md`
- **Pointer**: docs/backlog/resolve-review-loop-sh-auto-knobs-read-a-stale-autopilot-topology-json-and-fall.md
- **Context**: the resolver never regenerates the cache; `sync-all.sh` runs `--check` only.

### `contract-parity` / `resolve-review-loop-consult-discuss-switch` tests read the real `~/.autopilot/topology.json`
- **Status**: open
- **Trigger**: the next time either test goes red on one host and green on another with the same tree (2026-09-07: red on this host for three days because the host cache carried two legacy `effort: ""` rungs; the fix landed in v2.36.16 but the *test*…
- **Effort**: S
- **Source**: v2.36.16 (2026-09-07), CHANGELOG「未做」
- **Pointer**: docs/backlog/contract-parity-resolve-review-loop-consult-discuss-switch-tests-read-the-real-a.md
- **Context**: both tests resolve the shipped template with `implementer_ladder: auto` / `consult_dispatch: auto`, so the resolver reads whatever topology cache the host has.

### `hetero-review-loop.js` collect appends to chain.json without a lock or atomic rename
- **Status**: open
- **Trigger**: two collects for the same phase ever run concurrently (today callers serialise by generation)
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-04-dev-flow-hetero-loops/ledger/review-D2-attempt1-parser-defect/`
- **Pointer**: docs/backlog/hetero-review-loop-js-collect-appends-to-chain-json-without-a-lock-or-atomic-ren.md
- **Context**: a lost chain entry would self-recover on retry, never forge a gate pass; MiniMax CUT/FOLLOW-UP on the D2 review 2026-09-04

### `hetero-review-loop.js` opt-out knob parser character class parses `*->` as a range
- **Status**: open
- **Trigger**: the next touch of the knob parser in handleOptOut
- **Effort**: S
- **Source**: same ledger dir as above
- **Pointer**: docs/backlog/hetero-review-loop-js-opt-out-knob-parser-character-class-parses-as-a-range.md
- **Context**: a line such as "9plan_review: off" can set configured_value; harmless while the checker re-derives the value from the resolver (GLM CUT/FOLLOW-UP)

### `hetero-review-loop.js` exports the STUB_SEAT_ID test seam into the real dispatch-review.sh environment
- **Status**: open
- **Trigger**: reworking the seat-stub mechanism for any other reason
- **Effort**: S
- **Source**: same ledger dir as above
- **Pointer**: docs/backlog/hetero-review-loop-js-exports-the-stub-seat-id-test-seam-into-the-real-dispatch.md
- **Context**: cosmetic hardening; the real script ignores the variable (GLM CUT/FOLLOW-UP)

### `finalize` closes an earlier verified finding by absence in a later generation
- **Status**: open
- **Trigger**: a future review-policy deliverable, or evidence that a reviewer missed a still-open finding
- **Effort**: Fix
- **Source**: same ledger dir as above
- **Pointer**: docs/backlog/finalize-closes-an-earlier-verified-finding-by-absence-in-a-later-generation.md
- **Context**: the plan defines closure as absence-in-later-findings; tightening to "explicitly re-verified" needs a policy decision (MiniMax CUT/FOLLOW-UP)

### Opt-out receipt with a non-existent config path hashes the empty buffer
- **Status**: open
- **Trigger**: D2-repair R2/R3 does not already require the config path to exist (it is in that brief; verify at closeout)
- **Effort**: S
- **Source**: same ledger dir as above
- **Pointer**: docs/backlog/opt-out-receipt-with-a-non-existent-config-path-hashes-the-empty-buffer.md
- **Context**: sha256 of empty matches a receipt claiming the empty-file hash; the resolver's `off` re-derivation is the real boundary (MiniMax CUT/FOLLOW-UP)

### scorecard runner token drift: sol's reviewer row is recorded under `codex-cli`, not `codex`
- **Status**: open
- **Trigger**: any seat resolver that matches runner tokens exactly (topology `--role plan_reviewer` normalises it today)
- **Effort**: S
- **Source**: `docs/plans/evidence/2026-09-04-dev-flow-hetero-loops-default/context.md`
- **Pointer**: docs/backlog/scorecard-runner-token-drift-sol-s-reviewer-row-is-recorded-under-codex-cli-not.md
- **Context**: a qualified seat silently drops out of auto-derived panels when the recorded runner spelling differs from the dispatch runner enum

### ~~Foreman context is not measurable by hook — `context-budget` only sees the parent transcript~~ (CLOSED 2026-09-05, v2.36.1: `subagentStatusLine` `tasks[].tokenCount` is the per-agent usage field; `foreman-guard.js` denies at T2 from the tmpfs live file — `docs/plans/2026-09-05-statusline-live-context-feed.md`)
- **Status**: open
- **Trigger**: Claude Code's hook payload carries the SUBAGENT's own `transcript_path` (or an equivalent per-agent usage field) — check the CC changelog / a SPIKE on the running version; or a second cost incident where a foreman's context (not its…
- **Effort**: Fix
- **Source**: cuda quota digest 2026-09-04; `docs/plans/2026-09-04-foreman-cost-discipline.md` D2
- **Pointer**: docs/backlog/foreman-context-is-not-measurable-by-hook-context-budget-only-sees-the-parent-tr.md

### autopilot effort vocabulary has no `minimal` — the muse-spark contributor tier cannot be examined at its cheapest setting
- **Status**: open
- **Trigger**: a Board request to examine or route a seat at `minimal` (asked 2026-09-03 for opencode-go/muse-spark-1.3-contributor), or a second provider whose cheapest reasoning tier is below `low`.
- **Effort**: L
- **Source**: v2.35.14 probe (`CHANGELOG.md`); opencode models.dev `reasoning_options` for the model
- **Pointer**: docs/backlog/autopilot-effort-vocabulary-has-no-minimal-the-muse-spark-contributor-tier-canno.md
- **Context**: `dispatch-hetero.sh` (`--effort` enum), `engine-scorecard.js` (`EFFORT_VALUES`), `src/engine/capability-evidence.js`, `schemas/review-loop-contract.schema.json`, `implementer-ladder.js` and the seat-hash partition all enumerate…

### `adopt-qualification-defaults.js list` prints `event undefined — null` for legacy feed rows
- **Status**: open
- **Trigger**: the next time the feed listing is shown to a consumer (any `list --from` run reproduces it: 12 such lines on 2026-09-03 against the live feed), or when a second display defect lands in the same command.
- **Effort**: S
- **Source**: 7840hs peer report 2026-09-03 (plan 065 P5); reproduced on aimax395 (exit 0, defaults 29 / strikes 1 / priors 57)
- **Pointer**: docs/backlog/adopt-qualification-defaults-js-list-prints-event-undefined-null-for-legacy-feed.md
- **Context**: legacy (pre-effort, no event id / bundle path) scorecard rows reach the `evidence` line without a fallback, so the consumer prints `event undefined — null`.

### Feed listing prints the pre-effort `seat_hash` ⚠ once per row — consider one consolidated notice
- **Status**: open
- **Trigger**: a consumer complains the listing is unreadable, or the producer moves to effort-bearing seat hashes (then the per-row ⚠ disappears on its own).
- **Effort**: S
- **Source**: 7840hs peer report 2026-09-03 (plan 065 P5 closeout)
- **Pointer**: docs/backlog/feed-listing-prints-the-pre-effort-seat-hash-once-per-row-consider-one-consolida.md
- **Context**: by decision (A) the feed's advertised `seat_hash` is a diff key only and the consumer re-derives every hash; every current row is pre-effort three-key, so every row prints the ⚠.

### `--runner opencode` usage stays `null` — parse `step_finish.tokens` from the `--format json` event stream
- **Status**: open
- **Trigger**: the first time an opencode seat's cost/efficiency is compared against another rail (scorecard `cost`/`usage` telemetry), or `dispatch-status.js` gains a second event-stream format anyway.
- **Effort**: S
- **Source**: v2.35.12 (`docs/plans/2026-09-03-opencode-implementer-rail.md` § Out of scope)
- **Pointer**: docs/backlog/runner-opencode-usage-stays-null-parse-step-finish-tokens-from-the-format-json-e.md
- **Context**: the opencode rail declares `log_format: plain`, so `dispatch-status.js --usage-only` returns `null`.

### `resolve-review-loop-consult-discuss-gate` case (xix) mutates the canonical evals corpus — move it to a scratch copy and un-serialize
- **Status**: open
- **Trigger**: the next time a pooled test dies with `EACCES` on `evals/consult-capability-evidence-corpus.json`, or when `hooks/tests/run.sh --parallel` wall time is being trimmed and the serial tail is on the table.
- **Effort**: S
- **Source**: v2.35.11 pre-merge suite run (`d48b5235`); `hooks/tests/resolve-review-loop-consult-discuss-gate.test.sh:487-493`
- **Pointer**: docs/backlog/resolve-review-loop-consult-discuss-gate-case-xix-mutates-the-canonical-evals-co.md
- **Context**: case (xix) `chmod 000`s the REAL `evals/consult-capability-evidence-corpus.json` for two script runs; any pooled test that requires the consult grader in that window (verdict-stability D7, 2026-09-03: 12 EACCES failures, green…

### `autopilot endpoints test` hardcodes `claude-3-haiku-20240307` — a local server that validates model ids returns 404 and the probe reads as broken auth
- **Status**: open
- **Trigger**: the first time someone runs `autopilot endpoints test <name>` against a named local-model endpoint (SGLang/vLLM validate the model id) and gets a non-200 that is not an auth failure.
- **Effort**: S
- **Source**: v2.35.11 (`docs/plans/2026-09-03-endpoint-transport-optin.md` § Out of scope)
- **Pointer**: docs/backlog/autopilot-endpoints-test-hardcodes-claude-3-haiku-20240307-a-local-server-that-v.md
- **Context**: the probe's model id is a compatibility choice for GLM/MiniMax gateways (they map claude-* ids).

### `src/engine/local-deployment.js` carries its own transport rule (TLS outside loopback) — align with `resolve-endpoint.sh` before it gets a live caller
- **Status**: open
- **Trigger**: `dispatch-local-openai.js` / `probe-local-engine.js` gain a caller on a real rail, or a second transport-policy divergence between the two is reported.
- **Effort**: Fix
- **Source**: v2.35.11 (`docs/plans/2026-09-03-endpoint-transport-optin.md` § Out of scope)
- **Pointer**: docs/backlog/src-engine-local-deployment-js-carries-its-own-transport-rule-tls-outside-loopba.md
- **Context**: the named-endpoint resolver now owns the transport policy (loopback + disclosed `plaintext-private` for private-range IP literals).

### `dispatch-review` raw-log deviation 採信判準必要但不充分 —— 回音的 prompt 樣板可冒充 verdict
- **Status**: open
- **Trigger**: 下一次 depth-0 依 P5 判準（2026-07-31）以 raw-log deviation 採信一個 `no_verdict` 席次時；或為 `dispatch-review.sh` 加任何 verdict 解析路徑時。
- **Effort**: S
- **Source**: codepower `f65f29a7` qc panel 裁決 §4b；raw log `/tmp/dispatch-review-log-WPI98b`（sol）與 `-WO5A1B`（MiniMax）
- **Pointer**: docs/backlog/dispatch-review-raw-log-deviation-prompt-verdict.md
- **Context**: P5 立的採信條件是「verdict block 完整、nonce 匹配、block 閉合」。2026-08-08 codepower 的 qc panel 出現一個**同時滿足這三條、但內容是被回音的 prompt 樣板**的案例：`gpt-5.6-sol@codex`…

### Contract-first escalation and local-repair gates — P6D incident follow-up
- **Status**: open
- **Trigger**: An owner-approved corrective project is opened from the 2026-08-21 P6D incident record; before that project may claim completion, all three controls must have planted negative cases that demonstrate they can block (a) unjustified heavy…
- **Effort**: L
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026-08-21-p6d-orchestration-incident/README.md), including the quoted Fable 5 independent judgment.
- **Pointer**: docs/backlog/contract-first-escalation-and-local-repair-gates-p6d-incident-follow-up.md
- **Context**: A bounded six-file/three-command consumer task was routed through strict L5 Mission governance.

### Foreman model is hardcoded as `opus` in /l4–/l6 prose; routing config already overrides it
- **Status**: open
- **Trigger**: any consuming project sets `tree:sub-orchestrator` in `.claude/model-routing-config.md`
- **Effort**: S
- **Source**: revival.3d `15edf5e7` (routing override), `NOTE-FOR-FABLE-QUOTA.md` (grok cost split),
- **Pointer**: docs/backlog/foreman-model-is-hardcoded-as-opus-in-l4-l6-prose-routing-config-already-overrid.md
- **Context**: `skills/l6/SKILL.md`, `skills/ceo-agent/references/level-front-door.md` (§"Dispatching

### `probe-runner-coverage` parallel-only flake — fork-pressure suspected, residue ruled out
- **Status**: open
- **Trigger**: next time it reds in a `--parallel` run (it passes standalone).
- **Effort**: Fix
- **Source**: fix/suite-residue-reaper QC round, depth-0 panel + foreman reproduction logs, 2026-08-28.
- **Pointer**: docs/backlog/probe-runner-coverage-parallel-only-flake-fork-pressure-suspected-residue-ruled.md
- **Context**: 2026-08-28 suite-reaper reproduction split the old diagnosis — the residue leak

### Suite reaper — symlinked-TMPDIR hosts fall back to rm -rf (git-worktree-remove path never engages)
- **Status**: open
- **Trigger**: first report of dangling `.git/worktrees` entries on a host with symlinked `/tmp`
- **Effort**: S
- **Source**: depth-0 qc panel 🔵, 2026-08-28.
- **Pointer**: docs/backlog/suite-reaper-symlinked-tmpdir-hosts-fall-back-to-rm-rf-git-worktree-remove-path.md
- **Context**: `_wt_is_registered_path` exact-string-compares realpath'd entry vs git's raw

### Implementer suite hardening backlog (pre-merge review round-1 cut list)
- **Status**: open
- **Trigger**: 下一次動 `evals/impl-eval-*`/`runImplQualification` 時捎帶;或第三場正式施測之前(屆時 Stage-0 機械化與 live-rail smoke 應先落);或 reviewer 再報同類。
- **Effort**: M
- **Source**: autopilot:reviewer pre-merge round-1,2026-08-22;`docs/plans/2026-08-22-implementer-qualification-suite.md` §6-§8。
- **Pointer**: docs/backlog/implementer-suite-hardening-backlog-pre-merge-review-round-1-cut-list.md
- **Context**: v2.34.34 round-1 review 裁 CUT 的殘項(五個 MUST-FIX 已修:partial-corpus fail-open 雙層拒收、preflight prose-justification、dispatcher_called ETIMEDOUT 歸因、HELP、Stage-0 明文 operator-run):(1) **Stage-0 probe…

### agy output envelope invalid on create-a-new-file responses (blocks agy implementer qualification)
- **Status**: open
- **Trigger**: 下一次要考 agy 家族 implementer 時（v2.35.13 起信封無效只是遙測遺失、狀態看 artifact，且 log 會留信封原文——重考就能同時拿到 row 與重現樣本）;或 agy 更新後 changelog/實測顯示…
- **Effort**: Fix
- **Source**: `docs/plans/evidence/2026-08-22-implementer-qualification-suite/agy-flash-qualify/README.md`。
- **Pointer**: docs/backlog/agy-output-envelope-invalid-on-create-a-new-file-responses-blocks-agy-implemente.md
- **Context**: 2026-08-22 implementer 施測(agy 1.1.17):flash-high 6 案、pro(event 147)2 案、flash-medium(event 152)6 案 envelope FAIL + 2 案 stall——envelope 失敗案**全部**是建新檔任務且同簽名(family-wide、發生率隨 tier…

### `validate-json-schema.js` 拒絕所有非整數數字 —— 任何帶小數的 JSON 文件都驗不了
- **Status**: open
- **Trigger**: 下一個要 schema 驗證的 artifact 帶浮點數;或下一次動 `scripts/validate-json-schema.js` 的 `parseNumber`/`assertJsonValue`。
- **Effort**: S
- **Source**: 2026-08-23 official-qualification-defaults 施工實測(run `official-defaults-l4`)。
- **Pointer**: docs/backlog/validate-json-schema-js-json.md
- **Context**: `parseNumber`(`validate-json-schema.js:161`)在 **schema 求值之前**的 document preflight 就把任何含 `.`/`e`/`E` 的數字字面量判為 `UNSUPPORTED_JSON_NUMBER`(exit 2),與 schema 內容無關;`assertJsonValue:71`…

### v2.34.37 first-pass review 的 cut list —— 六個「不是錯,但名字比保證大」的小項
- **Status**: open
- **Trigger**: 下一次動這六處任一 —— `hooks/tests/external-lifecycle-witness.test.sh` 的 `stop_bounded` 斷言、`hooks/tests/calendar-teeth-negative.test.sh` 的 `instant3`/`instant4`、`scripts/engine-qualify.js` 的 `wall_truncated`…
- **Effort**: S
- **Source**: 2026-08-23 v2.34.37 first-pass pre-merge review(autopilot:reviewer);run `fix-bundle-l4`。
- **Pointer**: docs/backlog/v2-34-37-first-pass-review-cut-list.md
- **Context**: v2.34.37 first-pass review(autopilot:reviewer,opus)判 Low risk、無 🔴 無 🟠,兩枚 MUST-FIX 皆為文件用語已當場修掉。剩下六項刻意不在該刀處理,逐條記下以免被吞:(1) `measureBoundedStop` 的死…

### `engine-qualify-impl.test.js` 單次無法重現的紅(1/24 solo,訊息未捕獲)
- **Status**: open
- **Trigger**: 下一次它在 full-suite / CI 或 solo 跑紅(歸因半件)。**保存半件已做(2026-08-23)**:`hooks/tests/run.sh` L1 現在把 `node --test` 全輸出 tee 進…
- **Effort**: S
- **Source**: 2026-08-23 v2.34.37 收尾實測(run `fix-bundle-l4`),foreman 直接觀察。
- **Pointer**: docs/backlog/engine-qualify-impl-test-js-1-24-solo.md
- **Context**: 2026-08-23 v2.34.37 收尾期間,`node --test scripts/engine-qualify-impl.test.js` 在約 24 次 solo 連跑中出現**一次** `pass 0 / fail 1`;當時的 harness 只 grep 摘要行、沒有保留 log,`AssertionError` 的 message…

### Brain-seat sittings in the shipped qualification defaults (v2 artifact)
- **Status**: open
- **Trigger**: a consuming repo asks to adopt an owner/brain seat without self-qualifying; or the Board schedules the fourth brain sitting and it PASSES (a passing sitting is the first brain row worth shipping as a default).
- **Effort**: S
- **Source**: v2.34.36 official-qualification-defaults ship;`references/qualification-defaults.md` § "What this does NOT do"。
- **Pointer**: docs/backlog/brain-seat-sittings-in-the-shipped-qualification-defaults-v2-artifact.md
- **Context**: v2.34.36 ships official defaults for `implementer` / `reviewer` / `verification_author` — all scorecard rows.

### Durable repair-lock — 解鎖路徑先行,鎖才准回來(P6D KR3 的第二階段)
- **Status**: open
- **Trigger**: 無狀態拒絕被實測繞過(terminalization 之外的路徑把 BOUNDARY_REJECTED campaign 排水/succession 掉而未修復 —— 例如 host 直驅 reducer 的 no_effect_release);或 engine_terminal_evidence…
- **Effort**: L
- **Source**: 2026-08-21 pre-merge review(autopilot:reviewer);`docs/projects/_archive/2026-08-21-p6d-corrective-gates/`(歸檔後)。
- **Pointer**: docs/backlog/durable-repair-lock-p6d-kr3.md
- **Context**: v2.34.32 原出貨 durable claim-bound repair lock + 四 Mission 後盾,pre-merge review 兩枚 🔴 殺掉:解鎖路僅存於 mission-v2 ready/follow_up 排水(legacy receipt 永無解)、bypass enum…

### ~~Contract-first escalation and local-repair gates~~ — 2/3 classes SHIPPED v2.34.32; class (a) REMAINS OPEN
- **Status**: shipped v2.34.32 2026-08-21
- **Trigger**: see pointer
- **Effort**: M
- **Source**: [`2026-08-21-p6d-orchestration-incident`](projects/_archive/2026-08-21-p6d-orchestration-incident/README.md);plan…
- **Pointer**: docs/backlog/contract-first-escalation-and-local-repair-gates-2-3-classes-shipped-v2-34-32-cl.md
- **Context**: 原三控制中兩個已出貨且各有 planted negative + dead-gate mutation kill:(c) repair ladder(`src/engine/repair-ladder.js`,無狀態形:terminalize 邊單點拒絕;零 delta 轉終局被拒)與 (b) pre-commit manifest…

### Skill contract-card rewrites under 成績單前置（G2 MiniMax R8）
- **Status**: open
- **Trigger**: 四層 redesign 的 Policy 層設計定案,且目標 skill 有 eval ON/OFF 證據（成績單前置）
- **Effort**: L
- **Source**: G2 review finding（MiniMax R8, 2026-08-16）;strategy thread 2026-08-16
- **Pointer**: docs/backlog/skill-contract-card-rewrites-under-g2-minimax-r8.md
- **Context**: 童子軍規則的漸近線——把重量級 skills（dev-flow、quality-pipeline 候選）改寫為 contract-card shape（trigger/inputs/decision-table/engine-pointers）。未評測前不得重寫。

### dev-flow card re-attempt — instrument repair first (V2-vacuous verdict 2026-08-18)
- **Status**: open
- **Trigger**: A new evidence campaign budget is approved AND the skill-onoff task set is repaired so ≥4 of 5 families are load-bearing (per the frozen V2 rule). Repair directions from the data: harder tasks where sonnet's base rate drops (F1/F5…
- **Effort**: M
- **Source**: dev-flow-contract-card P6 adjudication（2026-08-18）.
- **Pointer**: docs/backlog/dev-flow-card-re-attempt-instrument-repair-first-v2-vacuous-verdict-2026-08-18.md
- **Context**: The 499-line card draft is digest-frozen at `evals/skill-onoff/packs/dev-flow-card/` and was NON-INFERIOR on the only load-bearing family (F3 branch discipline: FULL 9/9, CARD 9/9, OFF 0/9 — total discrimination, perfectly preserved).

### Panel progress view — reviewer-cut cosmetic residuals (v2.34.31 round-1)
- **Status**: open
- **Trigger**: An operator incident actually caused by one of these: misread an exit-4 run because a never-dispatched seat shows `transport_exhausted`; `--panels` truncation at 10 hides a panel someone was looking for; `.tmp-<pid>` residue accumulates…
- **Effort**: S
- **Source**: autopilot:reviewer FIX-THEN-SHIP round-1, 2026-08-21;docs/projects/_archive/2026-08-21-panel-progress-view/
- **Pointer**: docs/backlog/panel-progress-view-reviewer-cut-cosmetic-residuals-v2-34-31-round-1.md
- **Context**: 2026-08-21 review 判 CUT/FOLLOW-UP 的殘項(行為今日驗證正確,純回歸保護/污染防護):(1) never-dispatched seat 標籤應為 `not_dispatched`(`dispatch-plan-review.js` settle 分支);(2) `--panels` 輸出加…

### Arm the ordinary-strike threshold (currently shadow-only) — DATED REVIEW REQUIRED
- **Status**: open
- **Trigger**: When shadow data exists for a role — i.e. `would_requalify` has fired at least once against a seat and the operator has replayed those strikes and agrees each was a true engine/pair failure. Also: this row must be re-read by…
- **Effort**: S
- **Source**: hetero design panel 2026-08-22 (kimi's "trench coat" objection), shipped shadow-first per synthesis §8.
- **Pointer**: docs/backlog/arm-the-ordinary-strike-threshold-currently-shadow-only-dated-review-required.md
- **Context**: v2.34.35 ships `ordinary_strike` accrual in SHADOW: strikes are recorded and `would_requalify` is projected, but `admission_status` stays `qualified`.

### Strike-decay deferrals — the five mechanisms the panel cut from the first instrument
- **Status**: open
- **Trigger**: Any of: (1) a detector is caught emitting strikes at an anomalous rate; (2) more than two seats trip in one short span and the cause turns out to be a gate bug, not the engines; (3) a re-exam is needed and nobody notices for a week; (4)…
- **Effort**: M
- **Source**: hetero design panel 2026-08-22 synthesis §5/§6 + cut list; deferred by scope=Hold on the M-size first cut.
- **Pointer**: docs/backlog/strike-decay-deferrals-the-five-mechanisms-the-panel-cut-from-the-first-instrume.md
- **Context**: Deliberately NOT built in v2.34.35, each with a reason rather than an omission.

### Capability-claim identity is coupled to its observation timestamp
- **Status**: open
- **Trigger**: When a receipt refresh is next needed, or before adding a fourth consumer to `platform-capability-claims.js`.
- **Effort**: M
- **Source**: 2026-08-18 capability-receipt expiry investigation.
- **Pointer**: docs/backlog/capability-claim-identity-is-coupled-to-its-observation-timestamp.md
- **Context**: `claim_id = sha256(claim body)` and the body includes `live_evidence.observed_at` + `freshness.expires_at`, while the required IDs are hardcoded constants in `dispatch-hetero.sh:1653-1654`, `dispatch-review.sh:169-170`,…

### Vacuous red case in the guided-disposition suite (alien-hash branch)
- **Status**: open
- **Trigger**: Next touch of `scripts/build-profile-payload.js` guided-compatibility validation, or when adding any new disposition error code.
- **Effort**: Fix
- **Source**: v2.34.19 pre-merge review mutation pass (autopilot:reviewer, 2026-08-18).
- **Pointer**: docs/backlog/vacuous-red-case-in-the-guided-disposition-suite-alien-hash-branch.md
- **Context**: Mutation-tested 2026-08-18: deleting the `required === 0` branch at `scripts/build-profile-payload.js:478-483` leaves `hooks/tests/profile-guided-dispositions.test.sh:114-117` **GREEN** — the mutant survives.

### dev-flow F4 ledger rule — re-measure before deciding (F6 leg RESOLVED 2026-08-18)
- **Status**: open
- **Trigger**: The skill-onoff instrument-repair campaign, at the point where its task fixtures are redesigned — F4 must be re-measured there, not decided from the existing data.
- **Effort**: S
- **Source**: dev-flow-contract-card primary block（`evidence/…/primary-sonnet-results.jsonl`）;P7 adjudication 2026-08-18.
- **Pointer**: docs/backlog/dev-flow-f4-ledger-rule-re-measure-before-deciding-f6-leg-resolved-2026-08-18.md
- **Context**: F4 (Fix step 6 ongoing-maintenance ledger row) measured 0/3 in the FULL arm, but n=3 and the fixture repo carried no `docs/` tree at all, so the model had to originate a directory rather than append a line — a materially different…

### Outcome-shaped quality-gate enforcer (opt-in) — replaces the rejected invocation check
- **Status**: open
- **Trigger**: When an enforcer for the quality gate is wanted again, OR when `quality-pipeline` grows a SHA-bound "this ran" receipt that a gate could re-derive from. Not before: the current design has nothing to verify against.
- **Effort**: M
- **Source**: think-tank 5-role panel 2026-08-18（collision insights…
- **Pointer**: docs/backlog/outcome-shaped-quality-gate-enforcer-opt-in-replaces-the-rejected-invocation-che.md
- **Context**: P7 ruled out the obvious enforcer.

### Scaffold-tier effect A/B measurement（four-layer D6 promised row — repaired 2026-08-18）
- **Status**: open
- **Trigger**: Before any skill or routing policy CONSUMES scaffold tiers（T0/T1/T2）as an outcome-quality claim（成績單前置 applies）;or before the next capability-tier expansion.
- **Effort**: M
- **Source**: four-layer-redesign D6 closeout leftover（2026-08-17）;audit 2026-08-18（dev-flow-contract-card prologue）.
- **Pointer**: docs/backlog/scaffold-tier-effect-a-b-measurement-four-layer-d6-promised-row-repaired-2026-08.md
- **Context**: v2.34.11 shipped capability-tiered scaffolding with fail-closed T2, but `references/scaffold-tiers.md` Non-goals explicitly disclaims any tier→outcome effect claim — the A/B was deferred.

### cc-shim framing chrome leaks via `generate_session_title` (v2.34.7 fix incomplete)
- **Status**: open
- **Trigger**: Next touch of `dispatch-review.sh`'s cc-shim launcher, or the next `no_verdict` whose raw log shows an intact nonce block behind CC chrome.
- **Effort**: Fix
- **Source**: 2026-08-18 dev-flow-contract-card P1 review round.
- **Pointer**: docs/backlog/cc-shim-framing-chrome-leaks-via-generate-session-title-v2-34-7-fix-incomplete.md
- **Context**: 2026-08-18 P1 review (MiniMax-M3, cc-shim): parser returned `no_verdict` / "response did not start with the expected wrapped block" because Claude Code prepended `[claude-code:unrecognized_model]…

### Qualification CLI transport — runtime identity capture
- **Status**: open
- **Trigger**: When any CLI harness (codex / claude) grows a verifiable runtime model-identity signal in headless mode, or before promoting a CLI-transport qualification to a decision where alias drift would be material.
- **Effort**: S
- **Source**: v2.34.15 pre-merge review; hardening round 2026-08-17.
- **Pointer**: docs/backlog/qualification-cli-transport-runtime-identity-capture.md
- **Context**: CLI transports return no model id, so administered identity is operator-asserted (pre-run probe recorded per the v2.34.15 governance rule; the HTTP path caught glm-5.2→glm-5.3 exactly via its runtime echo).

### Broker payload format token rename (unified_diff misnomer)
- **Status**: open
- **Trigger**: Next time the broker client protocol version bumps for any reason, or before onboarding a fourth non-diff payload family.
- **Effort**: S
- **Source**: VA suite plan v3 §6 (G1-F11 deferral); v2.34.17 pre-merge review.
- **Pointer**: docs/backlog/broker-payload-format-token-rename-unified-diff-misnomer.md
- **Context**: `qualification-case-broker.js` hardcodes `payload.format: unified_diff` in its sandbox client; brain round bundles (v2.34.14) and VA spec envelopes (v2.34.17) ship JSON content under that diff-named token (VA plan G1-F11; the reviewer…

### Roster qualification — remaining legs (explorer suite; brain re-sit) — implementer leg SHIPPED v2.34.34
- **Status**: shipped v2.34.34 2026-08-22
- **Trigger**: Explorer formal suite — before autonomous routing claims for that role. Brain re-sit — when the Board schedules a fourth sitting (three sittings recorded, events 3/4/6; instrument clean, margins are capability; identity re-pin…
- **Effort**: L
- **Source**: v2.34.15 qualification-cli-transport + 2026-08-17 hardening round;evidence `docs/plans/evidence/2026-08-17-roster-qualification/` +…
- **Pointer**: docs/backlog/roster-qualification-remaining-legs-explorer-suite-brain-re-sit-implementer-leg.md
- **Context**: v2.34.15 shipped the CLI exam transport; the administrations are now spent through the gpt-5.6-sol leg.

### Governance CLI UX polish（experience-critic findings, v2.34.13 dogfood）
- **Status**: open
- **Trigger**: 下一次動五支治理腳本任一時捎帶;或 critic 再報同類。
- **Effort**: S
- **Source**: v2.34.13 KR5 dogfood(2026-08-17);critic run bvxubvq39。
- **Pointer**: docs/backlog/governance-cli-ux-polish-experience-critic-findings-v2-34-13-dogfood.md
- **Context**: KR5 dogfood(GLM-5.2 critic,post-merge)對五支治理 CLI 的三條產品缺口:(1) `next-pick parse` 輸出是裸 JSON array,沒有 `schema_version`/`artifact_type` envelope(R4 尺,其餘四支都有);(2)…

### OpenCode `debug skill` truncation — restore portability check 16 to hard-fail
- **Status**: open
- **Trigger**: Upstream OpenCode fixes the corpus-volume-dependent `opencode debug skill` output truncation, or a supported OpenCode release changes the plugin/serve discovery surface again.
- **Effort**: Fix
- **Source**: 2026-07-17 OpenCode 1.17 migration run (v2.32.50); current `scripts/preflight-portability.sh` advisory wiring.
- **Pointer**: docs/backlog/opencode-debug-skill-truncation-restore-portability-check-16-to-hard-fail.md
- **Context**: `scripts/preflight-portability.sh` check 16 is intentionally advisory while OpenCode 1.17 can omit discovered skills from `debug skill` output.

### t14 long-horizon per-turn verification gate
- **Status**: open
- **Trigger**: The next experiment aimed at improving long-horizon constraint adherence, or before claiming that prompt re-injection solves t14-class drift.
- **Effort**: M
- **Source**: `docs/projects/_archive/2026-07-08-t14-reinject/report.md` § Follow-up.
- **Pointer**: docs/backlog/t14-long-horizon-per-turn-verification-gate.md
- **Context**: Per-turn re-injection moved vocabulary but did not produce a statistically conclusive behavior lift.

### Mission graph scheduler 與 portfolio optimization
- **Status**: open
- **Trigger**: v2.34.0 的 frozen deliverable graph gate 已出貨，且至少兩個真實 portfolio 顯示靜態 dependency batches 造成可量測的 idle time，或使用者明確要求跨專案排程／dashboard。
- **Effort**: L
- **Source**: 2026-07-28 Mission Convergence Portfolio 34-phase runaway audit；`governance-correction.md`
- **Pointer**: docs/backlog/mission-graph-scheduler-portfolio-optimization.md
- **Context**: v2.34.0 只需要機械阻止 phase explosion：bounded deliverable count、DAG、parallel/batch/depth/gate budget 與 ready-node admission。Critical-path optimization、dynamic reorder、跨 repo portfolio、priority queue、進度…

### Mission authority store 與 cross-harness enforcement hardening
- **Status**: open
- **Trigger**: 需要把 Mission `enforce` 宣稱擴到目前未有 executable blocking adapter 的 harness，或 threat model 升級為防止惡意 same-UID worker 刪改 `.git` 內 registry/state；若只是誠實 agent 的 branch/session…
- **Effort**: L
- **Source**: 2026-07-28 Mission P1/P2 parity audit與獨立 Architect/Ops/Skeptic review；`governance-correction.md`
- **Pointer**: docs/backlog/mission-authority-store-cross-harness-enforcement-hardening.md
- **Context**: 本次只實作 current-host 可驗證的 Git-common-dir durable registry、CAS 與 fail-closed adapter。防惡意本機程序需要獨立 UID、root-owned/remote daemon 或具 authenticity 的 authority service；精確 provider…

### Every gate needs a negative control — the caution needs a routine behind it
- **Status**: open
- **Trigger**: 下一次新增或修改任何「閘」（release gate、drift gate、anti-gaming scan、admission check、hook）時；或再抓到一個閘存在卻沒在擋東西。
- **Effort**: M
- **Source**: 2026-08-08 CI triage（11/273 → 1/273）三起獨立成因的共同模式；本檔另有三條各自的條目。
- **Pointer**: docs/backlog/every-gate-needs-a-negative-control-the-caution-needs-a-routine-behind-it.md
- **Context**: CLAUDE.md 已經寫著「腳本存在不是它在運作的證據」，但 2026-08-08 一天之內出現三次同一種形狀，全部通過既有 CI 而沒被發現——(1) managed dev-flow admission 對 bounded 非 Mission campaign…

### Test-integrity L0 cannot see an early `exit 0` spliced into a shell suite
- **Status**: open
- **Trigger**: 下一次有人想把這個閘升到 `block`,或再抓到一個 bash 套件「綠得太安靜」時。
- **Effort**: M
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。
- **Pointer**: docs/backlog/test-integrity-l0-cannot-see-an-early-exit-0-spliced-into-a-shell-suite.md
- **Context**: v2.34.38 讓 `*.test.sh` 進入閘的視野,但三條 gaming vector 裡只有兩條半是機械可見的。

### `check-test-integrity.sh` warn → block needs an accuracy record first
- **Status**: open
- **Trigger**: 累積夠多真實 range 的 violation 輸出,足以判斷「違規流是否準確到可以擋」時;或有人主動
- **Effort**: M
- **Source**: 2026-08-23 v2.34.38 test-integrity coverage ship。
- **Pointer**: docs/backlog/check-test-integrity-sh-warn-block-needs-an-accuracy-record-first.md
- **Context**: v2.34.38 刻意停在 `warn`。原因不是保守,是 L0 的判準粒度:它對 match 到的測試檔**每一行

### Engine and CLI have no session-mode fallback for bounded non-Mission campaigns
- **Status**: open
- **Trigger**: 要把 session-marker 紀律擴到非 Mission 的 managed campaign 時；或 threat model 升級為「同一 host 上未經 /l3–/l6 進入的呼叫端不得驅動 managed loop」。單純誠實使用者不觸發。
- **Effort**: M
- **Source**: 2026-08-08 v2.34.8 pre-push QC。兩個 family（MiniMax-M3、GLM-5.2）皆回 SHIP-AS-IS 且 findings=none，都沒抓到這條；MiniMax-M3…
- **Pointer**: docs/backlog/engine-and-cli-have-no-session-mode-fallback-for-bounded-non-mission-campaigns.md
- **Context**: 三條路徑對「contract 不帶 Mission projection」的處置不一致。`dispatch-hetero.sh:1710` 在 `CAMPAIGN_PROJECTION_BOUND != 1` 時仍跑 `check_session_mode_gate` +…

### Mission runtime retires superseded adoptions at closeout, not after the fact
- **Status**: open
- **Trigger**: 下一次 Mission 重試鏈再留下多個 COMPLETE adoption，或要動 `src/mission/runtime.js` 的收尾路徑時。
- **Effort**: M
- **Source**: 2026-08-07 v2.34.6 rollover ship；`docs/projects/_archive/2026-08-06-dispatch-residue-cleanup/README.md`。
- **Pointer**: docs/backlog/mission-runtime-retires-superseded-adoptions-at-closeout-not-after-the-fact.md
- **Context**: v2.34.6 的 `mission-terminal-reconcile.js rollover` 是**事後清理**——它能指名已整合的 adoption 並退役其餘，但根因沒動：runtime 只在 mission UNRESOLVED 時圍籬，COMPLETE…

### `reap-dispatch-branches.sh scan` cannot see branches that carry no `root_run_id`
- **Status**: open
- **Trigger**: 下一次要盤點 dispatch 殘留分支時；或再出現「分支堆積但 scan 回報乾淨」。
- **Effort**: S
- **Source**: 2026-08-06 dispatch residue cleanup（20 → 1 branches, 6.3 GB reclaimed）。
- **Pointer**: docs/backlog/reap-dispatch-branches-sh-scan-cannot-see-branches-that-carry-no-root-run-id.md
- **Context**: `scan` 以 `root_run_id` 為 key，沒帶 id 的殘留分支完全隱形——2026-08-06 清出的 20 個就是這樣躲過的。缺的是一個**報告-only 的 `--all` 模式**列出 `unattributed`，不自動刪（preserve-first…

### `prune_tmp_residue` covers 7 prefixes; 25 scripts create `/tmp` dirs
- **Status**: open
- **Trigger**: `/tmp` 再次被 autopilot 殘留撐大，或有人要為 CI runner 加磁碟配額時。
- **Effort**: S
- **Source**: 2026-08-06 dispatch residue cleanup（782 項 `/tmp`、1.9 GB）；2026-08-08 複驗仍成立；2026-08-16 全掃擴大範圍——原標題「test-fixture…
- **Pointer**: docs/backlog/prune-tmp-residue-covers-7-prefixes-25-scripts-create-tmp-dirs.md
- **Context**: `prune_tmp_residue` 只被四個 dispatch 腳本呼叫，共 7 個…

### `next-touch-validation.test.sh` asserts against un-versioned local Mission state
- **Status**: open
- **Trigger**: 立刻——它在 CI 上**永遠**紅；或下次有人相信「本機全套綠」等於「CI 綠」時。
- **Effort**: M
- **Source**: 2026-08-08 CI triage（11/273 紅的最後一個，其餘十個已於 v2.34.8 修復）；2026-08-09 收尾。
- **Pointer**: docs/backlog/next-touch-validation-test-sh-asserts-against-un-versioned-local-mission-state.md
- **Context**: 該套件讀 `.git/autopilot/mission/next-touch-debt-retirement/successor-prepared.json` 並斷言 `validatePreparedReceipt(...).state === 'ACTIVE'`，另外還綁 `D8_PUBLICATION_SHA` 與…

### Dispatch-branch lifecycle — SHA-256 `check --ack` residual
- **Status**: open
- **Trigger**: 第一個 SHA-256 object-format repository 要使用 manual `check --ack`／restore acknowledgment。
- **Effort**: S
- **Source**: 2026-07-31 code/backlog audit。
- **Pointer**: docs/backlog/dispatch-branch-lifecycle-sha-256-check-ack-residual.md
- **Context**: inventory、reap 與 restore tests 已支援 SHA-256；剩餘缺口是 acknowledgment validator 仍只接受 40-hex SHA-1。

### context-budget T3 deny tier — calibration and obedience evidence
- **Status**: open
- **Trigger**: 有可持久化的 context calibration／handoff obedience receipts，或再次觀察到 T3 後新派遣造成 spiral。
- **Effort**: M
- **Source**: context-budget follow-up audit。
- **Pointer**: docs/backlog/context-budget-t3-deny-tier-calibration-and-obedience-evidence.md
- **Context**: 先前 finish-flow marker blocker 已解；真正未完成的是用 session evidence 校準 deny threshold、handoff structure 與 anti-spiral policy，不能只靠靜態 token 比例。

### skills frontmatter `tier:` 欄位（B4 step 2 — 分層進 frontmatter）
- **Status**: open
- **Trigger**: 先在 Claude Code ＋ codex 兩平台各做一次「帶未知 frontmatter 欄位」的 plugin load dry-run 且確認解析容忍（R1-F5：未驗不得宣稱無行為影響）；兩平台紀錄在手才動工。
- **Effort**: S
- **Source**: docs/plans/2026-07-04-surface-area-reduction.md §B4；v2.31.16 收尾 deferred。
- **Pointer**: docs/backlog/skills-frontmatter-tier-b4-step-2-frontmatter.md
- **Context**: v2.31.16 B4 step 1 已把 docs/skills.md 排成 core/delegation/pioneer 三層（純排版）。step 2 = 把層級寫進各 SKILL.md frontmatter `tier:` 欄位，讓工具可機讀。風險面＝frontmatter 是路由面。

### certified-clean 語料庫重建 — evals/clean/ 已重定性為「已合併真實 diff 對照集」,絕對 specificity 門檻需要真 certified 集
- **Status**: open
- **Trigger**: 下次要對 reviewer 契約/引擎做「絕對」(非配對)specificity 認證時;或 evals/clean/ 標籤再倒一個時。
- **Effort**: M
- **Source**: 2026-07-10 L6-r2 WS-A campaign;MiniMax R2 的「reviewer-circular 標注」警告實證。
- **Pointer**: docs/backlog/certified-clean-evals-clean-diff-specificity-certified.md
- **Context**: 2026-07-10 syscontract campaign 實測:12 個「clean」標籤(merged-未被翻 標注法)倒了 5 個(舊01/舊03/06/08/新03),其中新03 的 flag 還抓到當日 develop 現行真 bug(ladder-run.sh pipefail,v2.32.18 修)。全火力…

### Domain-aware routing — consume the `work_domain` telemetry to route reviewer/implementer by diff domain
- **Status**: open
- **Trigger**: ALL remaining prerequisites are met (telemetry alone is NOT a trigger): (1) a **two-pass resolve** in `resolve-review-loop.sh` without breaking the single-shot JSON contract; (2) a **pre-impl planned-scope signal** for implementer…
- **Effort**: L
- **Source**: 2026-06-26 domain-telemetry ship (Phase 4); the deferred KR4 of the plan.
- **Pointer**: docs/backlog/domain-aware-routing-consume-the-work-domain-telemetry-to-route-reviewer-impleme.md
- **Context**: `/l5` 現已把 resolved `reviewer_runner` 傳入 `dispatch-review.sh`，所以舊 prerequisite (1) 已完成；domain probe 仍只輸出 `work_domain`/`domain_source` telemetry，沒有 domain-conditioned roster 或 two-pass…

### L1 block-mode override re-enable — needs a REAL isolation boundary (cgroup is NOT enough)
- **Status**: open
- **Trigger**: when a `/l5` block-mode project hits a legitimate `executed_set_shrink` that should be waivable, AND a real isolation boundary is available.
- **Effort**: L
- **Source**: test-integrity-l1 (v2.25.7) + W1/W2/W3 ship (v2.25.8); gpt-5.5 review verdict in session 2026-06-26; spec §8.3 / §12.
- **Pointer**: docs/backlog/l1-block-mode-override-re-enable-needs-a-real-isolation-boundary-cgroup-is-not-e.md
- **Context**: The override stays **DEFERRED**.

### qc-panel refute pass — graduate from shadow to gating (calibration-gated)
- **Status**: open
- **Trigger**: `scripts/calibration.sh report` over accumulated refute-shadow samples shows the refute pass does **not** false-suppress critical/`MISSED:` findings (meets the existing graduation-criteria data block). Until then it stays shadow.
- **Effort**: S
- **Source**: 2026-06-24 v2.24.0 ship (`77214a1`) + depth-0 qc 🔵 (reviewer `a4162329`).
- **Pointer**: docs/backlog/qc-panel-refute-pass-graduate-from-shadow-to-gating-calibration-gated.md
- **Context**: v2.24.0 shipped the refute pass as **shadow / non-gating** — it emits `refute_shadow` + rides into the calibration `--source` tag but never alters `verdict` (a refute pass that suppresses a true critical is worse than the bug it fixes).

### `/l5` hetero-parallel width fan-out (machinery built, deliberately unwired)
- **Status**: open
- **Trigger**: a **concrete, repeated** need to fan a single batch out across multiple *heterogeneous* (agy/Gemini) workers in parallel — i.e. real `/l5` task-supply where the cost-arbitrage of a second engine actually pays, AND the base-correctness…
- **Effort**: S
- **Source**: 2026-06-23 `docs/plans/2026-06-23-l4-l5-dep-graph-fanout.md` scope-cut + Phase L ship (`577ba8d`).
- **Pointer**: docs/backlog/l5-hetero-parallel-width-fan-out-machinery-built-deliberately-unwired.md
- **Context**: Phase L shipped `/l4` homogeneous (Claude) batch fan-out.

### Leaf-level output compaction for dispatched implementer / qc shell commands (rtk-style)
- **Status**: open
- **Trigger**: next time a `/l4` / `/l5` foreman or a `quality-pipeline` / `qc-panel` sub-agent's context bloats from raw shell output (full `git diff`, full `pytest`/`vitest` runs, linter dumps) — i.e. a concrete in-the-wild "the leaf agent burned…
- **Effort**: S
- **Source**: 2026-06-23 `/next` follow-up — user-requested survey of headroom + rtk; two Explore-agent technical reports + same-session spike (rtk not installed, CC…
- **Pointer**: docs/backlog/leaf-level-output-compaction-for-dispatched-implementer-qc-shell-commands-rtk-st.md

### M3-band fixtures（t15-t17）若供對抗性 implementer 情境重用，需 process-isolation 邊界
- **Status**: open
- **Trigger**: 下次把 `evals/orchestration/tasks/t15-cache-invalidation`、`t16-findings-triage`、`t17-purity-invariant` 用於對抗性 implementer 情境（`/l5`、`/l6` hetero 派遣、或任何候選碼不可信的場合）。
- **Effort**: L
- **Source**: opus 對抗性重攻，2026-07-09。`docs/projects/_archive/2026-07-09-m3-band-tasks/report.md` § "Residual: in-process introspection"。
- **Pointer**: docs/backlog/m3-band-fixtures-t15-t17-implementer-process-isolation.md
- **Context**: 這三個 oracle 的判分 python 與候選碼在**同一個 process** 內執行，候選模組 import 時可用 `sys._getframe()` 走訪呼叫端 frame 的 globals/locals，撈出判分器從未匯出的密鑰。opus 2026-07-09…

### First local runner capability semantics（availability/load，不是 quota）
- **Status**: open
- **Trigger**: 第一個 local runner（例如 ollama 類）接入 capability-state producer。
- **Effort**: S
- **Source**: 2026-07-14 status CLI design + 2026-07-31 code audit。
- **Pointer**: docs/backlog/first-local-runner-capability-semantics-availability-load-quota.md
- **Context**: named endpoint identity 與獨立的 local-deployment availability/load observation schema 已實作；剩餘工作縮為第一個真實 local runner 的 observation→capability-state producer bridge。不得把現有 metered quota…

### broader shared-config containment / per-worktree isolation（2026-07-17, follow-up）
- **Status**: open
- **Trigger**: when a dispatched worker poisons a non-identity shared `.git/config` key
- **Effort**: L
- **Source**: 2026-07-17 U1b panel findings remediation on identity-containment port.
- **Pointer**: docs/backlog/broader-shared-config-containment-per-worktree-isolation-2026-07-17-follow-up.md
- **Context**: v2.32.51 identity rail contains ONLY `user.name`/`user.email` (local scope).

### Durable merge execution crash recovery
- **Status**: open
- **Trigger**: When a caller-owned durable merge receipt directory and recovery authority are standardized.
- **Effort**: S
- **Source**: depth-0; p3-risk
- **Pointer**: docs/backlog/durable-merge-execution-crash-recovery.md
- **Context**: A process crash after one ordered merge edge can lose the in-memory aggregate receipt; P3 intentionally omitted a WAL because its frozen contract supplied no storage-path authority.

### Bind dirty content continuity from preflight to execution
- **Status**: open
- **Trigger**: When merge preflight schema v2 is designed or a consumer requires cross-phase content-continuity proof.
- **Effort**: S
- **Source**: depth-0; p3-risk
- **Pointer**: docs/backlog/bind-dirty-content-continuity-from-preflight-to-execution.md
- **Context**: P3 detects content drift after execution starts, but cannot prove preserved bytes are unchanged since P2 issuance because the P2 receipt binds path categories rather than content/index digests.

### Recover stale backlog admission locks safely
- **Status**: open
- **Trigger**: When a backlog admission is interrupted or the lock directory exists without a live owning admission process.
- **Effort**: S
- **Source**: depth-0; qwen-p4
- **Pointer**: docs/backlog/recover-stale-backlog-admission-locks-safely.md
- **Context**: Backlog admission correctly fails closed on a held lock, but an uncatchable process crash can leave the lock directory behind and block all later admissions until manual recovery.

### Controller helper API fail-closed hardening
- **Status**: open
- **Trigger**: Before these helpers are reused outside the current production Engine call sites or exposed to caller-supplied state/evidence.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/controller-helper-api-fail-closed-hardening.md
- **Context**: Close the helper-level fail-open edges recorded as CED-N01, CED-N02, CED-N03, CED-N05, and CED-N06: require explicit spend projection, preserve/reject empty controller replacement, require repository authority, reject traversal…

### Boundary outcome and root dispatch semantics
- **Status**: open
- **Trigger**: Before boundary receipts drive automated recovery or parallel independent graph nodes under one root are enabled.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/boundary-outcome-and-root-dispatch-semantics.md
- **Context**: Derive or remove mutation_failed/unknown_status instead of hardcoding them, and decide whether root-wide nonterminal exclusion is intentional; if not, retain root CAS while scoping dispatch blockers to the exact graph node.

### Portable byte and Work Order lifecycle hardening
- **Status**: open
- **Trigger**: Before Mission paths may contain symlinks, generic Work Order imports are accepted, or reconciliation runs on restricted process-table platforms.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/portable-byte-and-work-order-lifecycle-hardening.md
- **Context**: Unify symlink byte hashing with Git, reject/strip disposition_receipt on non-stale records, and convert PROCESS_TABLE_UNREADABLE into an explicit fail-closed Work Order classification.

### Durable resume and review authority binding
- **Status**: open
- **Trigger**: Before automatic durable resume, reviewer roster rotation, seat retry, or more than one candidate per repair generation is enabled.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/durable-resume-and-review-authority-binding.md
- **Context**: Make all durable stop payloads pass verbatim resume validation, bind full-diff barriers to the exact candidate and review kind, and include sealed reviewer roster/seat identities in full-diff and joint-review reuse keys.

### Mission graph and campaign capacity boundary hardening
- **Status**: open
- **Trigger**: Before graph hot reload/concurrent writers or caller-supplied non-default campaign capacities are supported.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/mission-graph-and-campaign-capacity-boundary-hardening.md
- **Context**: Read Mission graph bytes once or bind the validation read to the inspected digest, and mirror max_owned_worktrees/temp_capacity_limit/max_prompt_bytes/max_finding_recurrence schema caps in the executable validator.

### Orphan leaf liveness and resource reconstruction
- **Status**: open
- **Trigger**: Before orphan adoption or resource inventory is used as closure/capacity authority after controller or worktree-creation crashes.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/orphan-leaf-liveness-and-resource-reconstruction.md
- **Context**: Persist and re-observe leaf process identity before orphan adoption; discover orphan branches and never-registered worktrees; mechanically re-derive active inventory rows.

### Terminal status and receipt trust boundary
- **Status**: open
- **Trigger**: Before external/legacy terminal receipts cross a trust boundary or the threat model expands beyond confused controllers.
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/terminal-status-and-receipt-trust-boundary.md
- **Context**: Enforce the closed terminal_status enum at receipt validation and Work Order classification, resolve the unused attached disposition, and document integrity-hash versus producer-attestation guarantees under the confused-controller…

### Shared sealed zero-diff validator
- **Status**: open
- **Trigger**: 下次動 live-spend probe / capability 記錄 / engine preflight 時。
- **Effort**: S
- **Source**: depth-0-adjudication-760b
- **Pointer**: docs/backlog/shared-sealed-zero-diff-validator.md
- **Context**: 2026-07-31 codepower P4 U2 實測：probe 用 codex CLI 預設模型（gpt-5.5）回 PROBE_OK，實際 dispatch 的 `gpt-5.3-codex-spark` 池已 rate_limited → dispatch 跑 342s 中斷、產物 broken-by-construction（registry…

### HETO task-return detection can miss completed work
- **Status**: open
- **Trigger**: A second reproducible case where a completed HETO task produces no return event/notification, or before another HETO return-consumer is added.
- **Effort**: S
- **Source**: user-reported intermittent missed HETO return detection (2026-08-05)
- **Pointer**: docs/backlog/heto-task-return-detection-can-miss-completed-work.md
- **Context**: The controller can remain waiting when HETO has completed a dispatched task but the return detector does not fire; inspect event names, buffering/flush, timeout, and terminal-state reconciliation without treating silence as success.

### No route for external field experience contributed INTO autopilot itself
- **Status**: open
- **Trigger**: A second instance of a lesson learned while *using* autopilot on another project that
- **Effort**: S
- **Source**: knowledge-routing fix set, foreman first-pass review (2026-08-24)
- **Pointer**: docs/backlog/no-route-for-external-field-experience-contributed-into-autopilot-itself.md
- **Context**: `learn` records facts/gotchas into `.claude/knowledge/`; `distill` produces reusable

### `peer-coordination` skill — ruled in, blocked on a spike sweep
- **Status**: open
- **Trigger**: The R5 spike list below comes back with dated, per-machine results. Do not author the
- **Effort**: M
- **Source**: cross-repo request via peer relay, 2026-08-24/25; ruled by two-round heterogeneous panel
- **Pointer**: docs/backlog/peer-coordination-skill-ruled-in-blocked-on-a-spike-sweep.md
- **Context**: autopilot models subordinates (`team`, `l3`–`l6`) and future-self (`handoff`) but has

### Managed-campaign controller cannot record `BOUNDARY_REJECTED` — lease-fenced by its own synthesized stage identity
- **Status**: open
- **Trigger**: any `engine implement-review` campaign whose implementer commit is boundary-rejected (unauthorized output path / diff cap) — reproduced 2026-08-29 (`campaign-v1-3b6a9770…`, replayed through the real reducer).
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1-20260829T1804Z campaign attempt 2; debugger replay 2026-08-29.
- **Pointer**: docs/backlog/managed-campaign-controller-cannot-record-boundary-rejected-lease-fenced-by-its.md
- **Context**: `src/engine/autopilot-engine.js:6477` writes composition events with `controller-<event>:<gen>` stage identities; `src/engine/implementation-campaign.js:886/738` lease-fences `BOUNDARY_REJECTED` (and `AWAITING_CONVERGENCE`, `:971`)…

### `dispatch-author.sh` success predicate is "non-empty stdout" — truncated / tool-narrating output reports `authored`
- **Status**: open
- **Trigger**: already fired twice (2026-08-29, qoderclicn/Qwen3.8-Max-Preview: a 100-byte preamble ending at `[` and a 130 KB mid-file draft with 36 text-form ```` ```tool ```` fences both returned `status:authored`, exit 0, `final_status:null`).
- **Effort**: S
- **Source**: l6-verdict-stability-p1 attempt 1 (author-1788027293-2263145, author-1788027402-2269364).
- **Pointer**: docs/backlog/dispatch-author-sh-success-predicate-is-non-empty-stdout-truncated-tool-narratin.md
- **Context**: header line 102 / `emit_result "authored"` at :1222 treat any bytes as an artifact.

### Verification-author seats on agy / cc-shim / anthropic-compatible are structurally NO-GO under the exact-tuple quota gate
- **Status**: open
- **Trigger**: next time a VA seat other than codex/grok/qoderclicn is configured (GLM-5.3@anthropic-compatible is VA-qualified, event 142, yet unroutable on 2026-08-29).
- **Effort**: Fix
- **Source**: l6-verdict-stability-p1 roster rotation 2026-08-29 (commits 8d6f8786, 83d993a5).
- **Pointer**: docs/backlog/verification-author-seats-on-agy-cc-shim-anthropic-compatible-are-structurally-n.md
- **Context**: `dispatch-contract.js` always queries capability state with `--effort <resolver effort>` (and `withResolverConfig` injects `verification_author_effort: high` when absent), but `probe-engine-capability.sh` refuses to observe an…

### No supported withdraw for a never-granted DRAFT Mission adoption; graph revisions mint unbounded lineages
- **Status**: open
- **Trigger**: next time a frozen execution graph must be revised before or between grants (three adoptions now exist for `qualification-verdict-stability`: 2e784929 DRAFT, 83828e5e ACTIVE with an unreleasable live claim, 420ac261 current).
- **Effort**: S
- **Source**: mission-lineage authoring 2026-08-29 (commits 0279dccc, 5402cbd5, 500703b1).
- **Pointer**: docs/backlog/no-supported-withdraw-for-a-never-granted-draft-mission-adoption-graph-revisions.md
- **Context**: `mission prepare` binds the adoption key to {repo_identity, intent, acceptance hashes} (`src/engine/mission-policy.js:195-233`) and pins the graph digest; revising the graph re-derives the same key and fails `MISSION_BINDING_MISMATCH`…

### `hooks/tests/run.sh` is red on `develop` — sealed campaign `verify_cmd` is unsatisfiable
- **Status**: open
- **Trigger**: already fired (salvage campaign `campaign-v1-e9bcae52…` `acceptance_failed` on `bash hooks/tests/run.sh` with a byte-identical cherry-pick; seven suites red on base 500703b1: codex-plugin-package, execution-profile,…
- **Effort**: L
- **Source**: l6-verdict-stability-p1 salvage campaign 2026-08-29.
- **Pointer**: docs/backlog/hooks-tests-run-sh-is-red-on-develop-sealed-campaign-verify-cmd-is-unsatisfiable.md
- **Context**: every Mission node inherits the six-command chain as `verify_cmd`, so any campaign on this base fails acceptance regardless of the candidate.

### Campaign bridge resolves lease identity from `campaignControl.initial_state` — correct today only because every append refreshes it
- **Status**: open
- **Trigger**: any change to `recordCampaignEvent` / the campaign event appender that stops assigning `campaignControl.initial_state = appended.state` (`src/engine/autopilot-engine.js:~4557`), or a second appender path that bypasses it.
- **Effort**: S
- **Source**: rail-fix qc panel 2026-08-30 (gpt-5.6-sol 🟠 downgraded after verification; GLM-5.2 🔵).
- **Pointer**: docs/backlog/campaign-bridge-resolves-lease-identity-from-campaigncontrol-initial-state-corre.md
- **Context**: `onCampaignEvent` (`autopilot-engine.js:~6487`) calls `resolveCampaignEventLeaseIdentity(campaignControl.initial_state, …)`; the field name says "initial" but it is the live journal-replayed state because the closure refreshes it on…

### `hooks/tests/run.sh` TIMEOUT marker collides with a suite that self-exits 124/137
- **Status**: open
- **Trigger**: a suite observed to exit 124/137 on its own (e.g. propagating a child's SIGKILL) shows as `[TIMEOUT]` in the summary.
- **Effort**: M
- **Source**: rail-fix qc panel 2026-08-30 (GLM-5.2 🔵).
- **Pointer**: docs/backlog/hooks-tests-run-sh-timeout-marker-collides-with-a-suite-that-self-exits-124-137.md
- **Context**: `is_suite_timeout_ec` treats any 124/137 as the wrapper's timeout.

### Killed/dead managed campaign stuck at IMPLEMENTING with a held lease has no operator remedy
- **Status**: open
- **Trigger**: already fired three times 2026-08-29/30 (campaigns `3b6a9770…`, `d240ef14…`, `e9bcae52…`): leaf died (wall cap / host kill / acceptance failure before terminal journal), journal holds `live_lease`, `--resume` refuses with…
- **Effort**: S
- **Source**: l6-verdict-stability-p1 campaigns 2/3 + salvage, 2026-08-29/30.
- **Pointer**: docs/backlog/killed-dead-managed-campaign-stuck-at-implementing-with-a-held-lease-has-no-oper.md
- **Context**: add a bounded, evidence-gated terminalization for a campaign whose leaf run is provably dead (leaf manifest ended, pid gone, worktree reaped) that appends `MUTATION_FAILED` with the live lease identity and releases the Mission claim;…

### `mission grant` silently replays a stale claim when the node holds an open `active_claim_id` — SHIPPED in U4 (branch `u4-grantblock-20260831`)
- **Status**: shipped unknown 2026-08-30
- **Trigger**: already fired 2026-08-30 (lineage 420ac261, node `qualification-verdict-stability`): with attempt 1's claim still open, `mission grant` returned `status:"replay"` with attempt 1's contract — a `base_sha` two merges behind `develop`…
- **Effort**: S
- **Source**: phase-2 foreman escalation, 2026-08-30.
- **Pointer**: docs/backlog/mission-grant-silently-replays-a-stale-claim-when-the-node-holds-an-open-active.md
- **Context**: the idempotency key resolves to `graph-node:<id>:attempt:<n>` while `active_claim_id` is set; nothing tells the caller the attempt cannot advance.

### No operator-level release for a claim whose campaign died without a terminal receipt (second instance)
- **Status**: open
- **Trigger**: already fired again 2026-08-30 — depth-0 had to emit `no_effect_release` through the reducer module API (`reduceMissionState`) on the local state file (backup taken) because `mission control` exposes only…
- **Effort**: S
- **Source**: phase-2 foreman escalation + depth-0 operator action, 2026-08-30.
- **Pointer**: docs/backlog/no-operator-level-release-for-a-claim-whose-campaign-died-without-a-terminal-rec.md
- **Context**: pairs with the existing "Killed/dead managed campaign stuck at IMPLEMENTING" row: the fix must release BOTH the campaign lease (MUTATION_FAILED with the live lease identity) and the Mission claim, gated on provable leaf death, and be…

### A managed campaign whose wall expires leaves no terminal summary and no journal disposition
- **Status**: open
- **Trigger**: already fired twice 2026-08-30 (campaigns attempt-3 `d240ef14…` and `…a3` D5): the leaf committed, `max_wall_seconds` (3600, schema max) elapsed before the review round, the `engine implement-review` process ended with a 0-byte…
- **Effort**: S
- **Source**: phase-2 foremen (D4, D5) 2026-08-30.
- **Pointer**: docs/backlog/a-managed-campaign-whose-wall-expires-leaves-no-terminal-summary-and-no-journal.md
- **Context**: wall expiry must journal a wall-expiry disposition (MUTATION_FAILED-class with the live lease identity, or a resumable-wait phase if repair generations remain) and always write the summary JSON; a foreman reading an empty file cannot…

### 3600 s wall cap is the schema maximum and too small for an implement+review campaign on a real deliverable — SHIPPED in U3 (branch `u3-wallcap-20260831`), ceiling 14400 by CEO decision 2026-08-31
- **Status**: shipped unknown 2026-08-31
- **Trigger**: any deliverable whose implementer alone needs > ~40 min (D1–D3, D4, D5 all did: 42–55 min grok-4.5 runs), leaving no wall for the review round.
- **Effort**: S
- **Source**: phases 1–2, 2026-08-29/30.
- **Pointer**: docs/backlog/3600-s-wall-cap-is-the-schema-maximum-and-too-small-for-an-implement-review-camp.md
- **Context**: `schemas/mission-execution-graph.schema.json` caps `campaign.max_wall_seconds` at 3600 and `max_engine_attempts` at 3.

### Qualification recipes seed staged credentials only when the staged file is absent — rotating OAuth runners reuse stale material
- **Status**: open
- **Trigger**: already fired 2026-08-30 (D7): kimi and grok seats returned 240/240 `provider_process_failed` each (480 case attempts, ~1600 s) because the `if [ ! -f <staged> ]` guard kept 2026-08-29 credentials while the live ones had rotated;…
- **Effort**: S
- **Source**: D7 administration ledger 2026-08-30.
- **Pointer**: docs/backlog/qualification-recipes-seed-staged-credentials-only-when-the-staged-file-is-absen.md
- **Context**: every `run.sh` under `docs/plans/evidence/*/administration/*/` copies this block.

### `engine-scorecard.js current/seat-status --require-evidence` cannot be run standalone
- **Status**: open
- **Trigger**: next time an operator wants the strict admission projection for a live seat (it exits 2: `--require-evidence or --identity-file requires --scope-file`).
- **Effort**: S
- **Source**: D7 foreman 2026-08-30.
- **Pointer**: docs/backlog/engine-scorecard-js-current-seat-status-require-evidence-cannot-be-run-standalon.md
- **Context**: the strict path needs a caller-supplied applicability scope file; there is no helper that derives the canonical scope for a role, so foremen fall back to the non-strict `seat-status`.

### `mission withdraw` cannot bind a `mission-subject-v2` claim to its ICC campaign — the intake journals no mission binding
- **Status**: open
- **Trigger**: any operator calling `mission withdraw --campaign-ledger <real ICC ledger>` on a claim minted by `grantMissionCampaign` (`identity_scheme: 'mission-subject-v2'`) whose campaign DID run; or the next time `campaign-intake.js`'s intake…
- **Effort**: S
- **Source**: U4 foreman 2026-08-31; cuda revival.3d QUIET-a 2026-09-06; v2.36.6 pre-merge review (opus) 🔴 C1.
- **Pointer**: docs/backlog/mission-withdraw-cannot-bind-a-mission-subject-v2-claim-to-its-icc-campaign-the.md
- **Context**: the claim id is `campaign-v2-<domain sha of the subject>` (`src/engine/mission-campaign-identity.js`); the ICC intake row is keyed `campaign-v1-<sha of repo, ticket, raw contract bytes>` (`src/engine/campaign-intake.js` ~1664) and…

### v2.35.5 qc-panel 🔵 follow-ups (managed-campaign rail debt, 2026-08-31)
- **Status**: open
- **Trigger**: next touch of the named files.
- **Effort**: S
- **Source**: v2.35.5 qc panels + foremen, 2026-08-31.
- **Pointer**: docs/backlog/v2-35-5-qc-panel-follow-ups-managed-campaign-rail-debt-2026-08-31.md
- **Context**: four Suggestion-tier items from the three-seat panels, all excluded from the ship with rationale: (1) whitespace re-indent churn in `src/campaign/cli.js` ~412-437/598 pollutes blame in the projection path — revert cosmetically; (2)…

### `peer-addressing.md` says message rows live forever; a spec says 7 days
- **Status**: open
- **Trigger**: hangar-bridge implements message-row retention. Today it has not — `packages/relay/src/purge.ts` deletes only `token` and `human` rows, `message` has no trigger or CASCADE, and a repo-wide search finds no `DELETE FROM message` — so…
- **Effort**: M
- **Source**: `autopilot:reviewer` round 4 on `0d3554e3`, 2026-09-01.
- **Pointer**: docs/backlog/peer-addressing-md-says-message-rows-live-forever-a-spec-says-7-days.md
- **Context**: `hangar-bridge/SUBJECT_ROUTING_SPEC.md:516,614` records an accepted 7-day retention/replay bound for subjected `@team` chat that was never built.

### Plan-loop freeze: dispatcher and checker disagree on disposition shape; terminal artifact carries no dispositions
- **Status**: open
- **Trigger**: the next plan loop that reaches the generation cap, or any change to `loadDispositionFile` / plan-artifact mode.
- **Effort**: Fix
- **Source**: `docs/projects/2026-09-05-statusline-live-context-feed/ledger/plan-review/README.md`
- **Pointer**: docs/backlog/plan-loop-freeze-dispatcher-and-checker-disagree-on-disposition-shape-terminal-a.md
- **Context**: `check-phase-review-receipt.js --plan-artifact` requires `disposition` on every artifact finding and `candidate_blocker` on every disposition entry; `dispatch-plan-review.js` writes neither into the terminal artifact and its disposition…

### Live-state base on world-writable tmpfs — ownership/mode check on the reader side
- **Status**: open
- **Trigger**: autopilot runs on a multi-user host, or a second local user is observed on any fleet host; or the first report of a foreign `/dev/shm/autopilot-<uid>` directory.
- **Effort**: S
- **Source**: `docs/projects/_archive/2026-09-05-statusline-live-context-feed/` pre-merge review (opus), 2026-09-05
- **Pointer**: docs/backlog/live-state-base-on-world-writable-tmpfs-ownership-mode-check-on-the-reader-side.md
- **Context**: v2.36.1 moved `context-budget`/`depth0-gate` state and the codeforge live files under `$XDG_RUNTIME_DIR/autopilot` (0700, safe) or `/dev/shm/autopilot-<uid>` / `/tmp/autopilot-<uid>` (parent `drwxrwxrwt`, name predictable, no…

### live-state-dir 🔵 leftovers — multi-row findmnt, `\040`-only unescape, per-process SSD warning, sub-200k window scaling untested
- **Status**: open
- **Trigger**: a candidate that `findmnt -T` reports as more than one row; a mountpoint with an escaped character other than space; a host with neither findmnt nor /proc/mounts (macOS, unverified) where the SSD warning is observed once per hook fire;…
- **Effort**: S
- **Source**: v2.36.1 pre-merge review (opus), 2026-09-05; carried out of the v2.36.2 row
- **Pointer**: docs/backlog/live-state-dir-leftovers-multi-row-findmnt-040-only-unescape-per-process-ssd-war.md
- **Context**: the 🟡 items of the v2.36.1 pre-merge review shipped in v2.36.2; these 🔵 items did not.

### context-budget falls back to inference after a long foreground tool call — live tick starves under the 120 s freshness cap
- **Status**: open
- **Trigger**: the next observed T2/T1 message without "(statusline)" on a host that has the live writer; or before shortening/lengthening `DEFAULT_MAX_AGE_MS`.
- **Effort**: S
- **Source**: v2.36.2 session live observation, 2026-09-05
- **Pointer**: docs/backlog/context-budget-falls-back-to-inference-after-a-long-foreground-tool-call-live-ti.md
- **Context**: observed 2026-09-05 in the v2.36.2 session: a 600 s foreground `hooks/tests/run.sh --parallel` was followed by a `context-budget` T2 at 155k with no "(statusline)" clause, while the live file 3 s later was fresh with…

### Stale `closed_findings` stamps on chain entries written by pre-v2.36.3 finalize have no repair path short of a new generation
- **Status**: open
- **Trigger**: a second field report of a receipt refused with "attributes … to generation N, which is aborted", or a request to re-finalize without re-collecting.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066 ledger, 2026-09-05
- **Pointer**: docs/backlog/stale-closed-findings-stamps-on-chain-entries-written-by-pre-v2-36-3-finalize-ha.md
- **Context**: v2.36.3 made `review-chain-derive` evidence-only (chain-entry `closed_findings` stamps are output, ignored as input) and the checker refuses a receipt whose `closed_findings` names an aborted generation.

### `hetero-review-loop --exclude` allowlist is autopilot's own tree — consumer repos cannot shrink a review payload
- **Status**: open
- **Trigger**: the next consumer-repo report of `Exclude pathspec '…' is not permitted by allowlist` for a data/generated directory, or the next agy-seat payload overflow where `--exclude` was the only lever.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066, 2026-09-06
- **Pointer**: docs/backlog/hetero-review-loop-exclude-allowlist-is-autopilot-s-own-tree-consumer-repos-cann.md
- **Context**: `EXCLUDE_ALLOWLIST` (hetero-review-loop.js:29-47) hardcodes `platforms/**`, `docs/projects/**`, lockfiles… llm-playground plan 066 needed to exclude `benchmarks/matrix` (139 regenerated shard JSONs, most of the diff) to get the agy…

### agy seat payload overflow is discovered per seat at dispatch time — the loop could pre-compute it and fail before spending the other seats
- **Status**: open
- **Trigger**: the next generation where an agy seat returns no_verdict with `agy_argv_ceiling` in raw_log while the other seats completed.
- **Effort**: S
- **Source**: 7840hs / llm-playground plan 066, 2026-09-06
- **Pointer**: docs/backlog/agy-seat-payload-overflow-is-discovered-per-seat-at-dispatch-time-the-loop-could.md
- **Context**: `dispatch-review.sh` refuses an agy payload above `MAX_ARG_STRLEN` by design (named reason, no execve failure).

### CEO/dev-flow guidance proportionality — peer request to soften "Boil the Lake" / near-zero completion cost, TaskCreate-missing semantics, reversible-candidate release gates
- **Status**: open
- **Trigger**: owner decides to open this; AND eval ON/OFF evidence exists for the affected skills (scorecard-first rule — an unevidenced rewrite of ceo-agent/dev-flow prose is an unevidenced trust change).
- **Effort**: M
- **Source**: cuda revival.3d peer message, 2026-09-06; ASTRA-SKILL-AUDIT report on cuda (/data/rw3d-evidence/2026-09-06/ASTRA-SKILL-AUDIT/report.md, not shared)
- **Pointer**: docs/backlog/ceo-dev-flow-guidance-proportionality-peer-request-to-soften-boil-the-lake-near.md

### depth0-delegate-gate `Bash` matcher is an expansion over the frozen plan matcher
- **Status**: open
- **Trigger**: a measured depth-0 Bash latency complaint, or the next revision of `depth0-delegate-gate`.
- **Effort**: S
- **Source**: v2.36.1 pre-merge review (opus), 2026-09-05; `docs/plans/2026-09-05-statusline-live-context-feed.md` §4 P3.1
- **Pointer**: docs/backlog/depth0-delegate-gate-bash-matcher-is-an-expansion-over-the-frozen-plan-matcher.md
- **Context**: plan §4 P3.1 lists `WebFetch|WebSearch|Read|Grep|Glob|Agent|Skill|Task`; the shipped hook also matches `Bash` and classifies read-shaped commands (`grep|rg|find|cat|sed -n|head|tail`) with a duplicated 35-line shell lexer, adding ~17…

### live-state-dir / context-budget test strength — two surviving mutants, one vacuous-off-Linux assertion, injection-test residue
- **Status**: open
- **Trigger**: next time a consult is dispatched on a host whose qc panel
- **Effort**: S
- **Source**: v2.36.1 pre-merge review round 2 (opus), 2026-09-05
- **Pointer**: docs/backlog/live-state-dir-context-budget-test-strength-two-surviving-mutants-one-vacuous-of.md
- **Context**: On `cookys-openclaw`, `resolve-review-loop.sh` emits


