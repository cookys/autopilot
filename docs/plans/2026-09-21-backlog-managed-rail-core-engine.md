# Plan — backlog bundle managed-rail-core-engine (B3, wave 1)
> Status: proposed · Owner: depth-0 (cookys) · Branch: `docs/backlog-bundles` (authoring only; execution in own clone/branch, see brief) · Frame: L, per `references/plan-template.md`

## 0. Context / thesis
Approved bundle analysis (`bundles.md`, depth-0 2026-09-21) splits 49/103 BACKLOG `S`/`Fix` rows into 6 file-disjoint bundles for parallel hetero-impl per `skills/l5/references/hetero-impl-loop.md` §Parallel units. This is **B3**, 7 rows, wave 1 (wave1=B2/B3/B4/B5/B6 simultaneous; wave2=B1 alone after wave1 `rc=`).

## 0.1 BACKLOG rows (verbatim Title/Trigger/Context from `docs/BACKLOG.md` @ develop 47b52eac; long quotes `…`-trimmed to fit 8 KB, full text there)
- **Row 1** (S) Managed rail: repair scope is derived from th…
  Trig: the next `--resume --campaign-disposition-authority` whose must-fix-now finding names no `…
  Ctx: findingBoundRepairPaths reads paths only from finding.claim/source; none → throw → termina…
- **Row 2** (S) Managed implementation dispatch timeout floor…
  Trig: the next managed campaign that logs an implementation dispatch with `--timeout` under 60 s…
  Ctx: the brief asked for the rail's minimum useful timeout; a 1 s floor only avoids a 0 s argv.…
- **Row 10** (S) Managed rail: verify_cmd runs in a fresh deta…
  Trig: a verify that needs node_modules/dist fails in 1.4 s; the ledger holds only `status:failed…
  Ctx: `autopilot-engine.js` ~1863 `autopilot-verify-wt-*` is a detached worktree; journal bounde…
- **Row 15** (Fix) Managed rail: a non-git `--repo` still consum…
  Trig: any intake rejection between the Mission claim and `inspectSealedCampaignContract` is meas…
  Ctx: `projectMissionMode` does not touch git, so the claim runs before repo identity is known.…
- **Row 17** (S) Managed rail: a malformed `review.findings` s…
  Trig: a review whose findings fail `normalizeFindings` (UNSTRUCTURED/INVALID/DUPLICATE codes) re…
  Ctx: identityInvalid gate in `campaign-composition.js` covers only FINDING_IDENTITY_INVALID; pr…
- **Row 121** (Fix) Managed-campaign controller cannot record `BO…
  Trig: any `engine implement-review` campaign whose implementer commit is boundary-rejected (unau…
  Ctx: `src/engine/autopilot-engine.js:6477` writes composition events with `controller-<event>:<…
- **Row 125** (S) Campaign bridge resolves lease identity from…
  Trig: any change to `recordCampaignEvent` / the campaign event appender that stops assigning `ca…
  Ctx: `onCampaignEvent` (`autopilot-engine.js:~6487`) calls `resolveCampaignEventLeaseIdentity(c…

## 1. Problem
Rows above are `open`, trigger fired/actionable; none need an operator decision, live credential, or unconfirmed root cause (bundle-analysis Exclusions).

## 2. OKR / KRs
KR1: each row's new assertion RED@base→GREEN post-phase. KR2: §5 pre-existing suites stay GREEN. KR3: `git diff --stat` touches nothing outside §3.

## 2.5 Global Constraints (verbatim into every dispatch)
Node ≥20.10 · RED-first per row · new/touched `*.test.sh` `chmod +x` · no CHANGELOG/version/`.claude-plugin/plugin.json` edit · one clone, no fetch/pull into it once foreman starts (main-checkout-boundary) · foreman `dispatch-foreman.sh --model kimi-code/k3` · implementer `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low` · review `dispatch-review.sh` 2nd family · §5 commands prefixed `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`.

## 2.6 Change-policy: Compatibility `internal-only` (scripts/hooks/suites, no published API) · Dependency `none` (fixes within existing files).

## 3. File-structure map
- `src/engine/{autopilot-engine.js,implementation-campaign.js,campaign-composition.js}` + `platforms/codex/plugin/` mirrors
- `hooks/tests/{autopilot-engine-repair-branch,campaign-boundary-receipt-e2e,implementation-campaign-state-boundary,campaign-dispatch-projection,mission-routing-campaign-bridge}.test.sh`
- NEW `hooks/tests/managed-rail-core-engine.test.sh`

## 4. Phases (order fixed by bundle-analysis risk — do not reorder). Each phase implements its §0.1 row; acceptance = the named assertion RED at base (record base output) → GREEN after the fix, §5 unregressed.
**P1 r1 (S)** → §0.1 row 1. `assert_r1_managed_rail_repair`.
**P2 r2 (S)** → §0.1 row 2. `assert_r2_managed_implementati`.
**P3 r10 (S)** → §0.1 row 10. `assert_r10_managed_rail_verifyc`.
**P4 r15 (Fix)** → §0.1 row 15. `assert_r15_managed_rail_a_non_g`.
**P5 r17 (S)** → §0.1 row 17. `assert_r17_managed_rail_a_malfo`.
**P6 r121 (Fix)** → §0.1 row 121. `assert_r121_managed_campaign_con`.
**P7 r125 (S)** → §0.1 row 125. `assert_r125_campaign_bridge_reso`.

## 5. Test / validation
Scratch worktree, temp branch (not detached HEAD); prefix `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`:
- `for s in hooks/tests/autopilot-engine-repair-branch.test.sh hooks/tests/campaign-boundary-receipt-e2e.test.sh hooks/tests/implementation-campaign-state-boundary.test.sh hooks/tests/campaign-dispatch-projection.test.sh hooks/tests/mission-routing-campaign-bridge.test.sh; do env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash "$s" < /dev/null; done`
- `node scripts/check-js-syntax.js`
- `bash scripts/sync-codex-plugin-skills.sh --check`
- `test -x hooks/tests/managed-rail-core-engine.test.sh`
All exit 0. No human gate (Hold-scope autonomous).

## 6. Risks + inversion
🔴 rows 121 and 125 both edit `recordCampaignEvent`/`onCampai…
**Inversion**: two bundles sharing one `.git`/worktree ⇒ `main-checkout-boundary.sh` flags `main_checkout_mutated`. Mitigation: one clone per bundle, never shared.

## 7. Out of scope
Other bundles' files: B1 review-loop-resolver-a (resolve-review-loop.sh, probe-unknown.js); B2 review-loop-resolver-b (hetero-review-loop.js, check-phase-review-receipt.js, dispatch-plan-review.js); B4 qualification-scorecard-tools (engine-scorecard.js +6 scripts, endpoints/cli.js); B5 hooks-live-state-misc (context-budget.js, dispatch-model-guard.js, depth0-delegate-gate.js, dispatch-review.sh, live-state-dir.js, 3 SKILL.md); B6 dispatch-lifecycle-residue-mission (run-ledger.sh, reap-dispatch-*.sh, prune-tmp-residue.sh, mission-policy.js, mission/runtime.js) — full maps in each bundle's own §3. · `docs/BACKLOG.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json` · §5 suites (run-only; new assertions live only in `hooks/tests/managed-rail-core-engine.test.sh`) · the 52 excluded rows (not-fired, needs decision, >S/Fix, malformed row 31, CI-coupled — see bundle-analysis).

## 8. Open questions
None — scope/order/risk fixed by the approved analysis.

## Review log
R0 author: depth-0 (cookys), 2026-09-21. No plan-readiness round for this batch (operator pre-approved the split); execution review is the §2.5 hetero dispatch-review loop.

---
## Foreman brief (paste into `dispatch-foreman.sh --model kimi-code/k3` for this clone)
Bundle **managed-rail-core-engine** (7 rows). Own `git clone` (never main checkout/shared worktree). Branch/row: `hands/managed-rail-core-engine/<row-n>` off develop.
1. Work P1..P7 in §4 order (§6 sequencing risk).
2. Impl `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low`; commits on `hands/managed-rail-core-engine/<row-n>` (harness commits, never you); never push/stash.
3. Review `dispatch-review.sh` 2nd family. Verdict = depth-0 from git; you report, don't self-attest.
4. RED-first: assertion fails @base before fix; record base output per row. No CHANGELOG/version/BACKLOG edits (row 31 handled separately).
5. Report per row `PASS <n> <assertion>` / `FAIL <n> <assertion> <reason>` + each dispatch's `rc=`. After all rows re-run full §5; report aggregate before ending turn.
