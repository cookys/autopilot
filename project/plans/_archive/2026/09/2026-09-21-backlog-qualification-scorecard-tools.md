# Plan — backlog bundle qualification-scorecard-tools (B4, wave 1)
> Status: shipped in v2.36.81 · Owner: depth-0 (cookys) · Branch: `docs/backlog-bundles` (authoring only; execution in own clone/branch, see brief) · Frame: L, per `references/plan-template.md`

## 0. Context / thesis
Approved bundle analysis (`bundles.md`, depth-0 2026-09-21) splits 49/103 BACKLOG `S`/`Fix` rows into 6 file-disjoint bundles for parallel hetero-impl per `skills/l5/references/hetero-impl-loop.md` §Parallel units. This is **B4**, 9 rows, wave 1 (wave1=B2/B3/B4/B5/B6 simultaneous; wave2=B1 alone after wave1 `rc=`).

## 0.1 BACKLOG rows (verbatim Title/Trigger/Context from `docs/BACKLOG.md` @ develop 47b52eac; long quotes `…`-trimmed to fit 8 KB, full text there)
- **Row 49** (S) scorecard runner token drift: sol's reviewer…
  Trig: any seat resolver that matches runn…
  Ctx: a qualified seat silently drops out…
- **Row 51** (S) `adopt-qualification-defaults.js list` prints…
  Trig: the next time the feed listing is s…
  Ctx: legacy (pre-effort, no event id / b…
- **Row 52** (S) Feed listing prints the pre-effort `seat_hash…
  Trig: a consumer complains the listing is…
  Ctx: by decision (A) the feed's advertis…
- **Row 53** (S) `--runner opencode` usage stays `null` — pars…
  Trig: the first time an opencode seat's c…
  Ctx: the opencode rail declares `log_for…
- **Row 55** (S) `autopilot endpoints test` hardcodes `claude-…
  Trig: the first time someone runs `autopi…
  Ctx: the probe's model id is a compatibi…
- **Row 64** (S) `validate-json-schema.js` 拒絕所有非整數數字 —— 任何帶小數的…
  Trig: 下一個要 schema 驗證的 artifact 帶浮點數;或下一次動…
  Ctx: `parseNumber`(`validate-json-schema…
- **Row 75** (Fix) Vacuous red case in the guided-disposition su…
  Trig: Next touch of `scripts/build-profil…
  Ctx: Mutation-tested 2026-08-18: deletin…
- **Row 82** (S) Governance CLI UX polish（experience-critic fi…
  Trig: 下一次動五支治理腳本任一時捎帶;或 critic 再報同類。
  Ctx: KR5 dogfood(GLM-5.2 critic,post-mer…
- **Row 127** (S) `engine-scorecard.js current/seat-status --re…
  Trig: next time an operator wants the str…
  Ctx: the strict path needs a caller-supp…

## 1. Problem
Rows above are `open`, trigger fired/actionable; none need an operator decision, live credential, or unconfirmed root cause (bundle-analysis Exclusions).

## 2. OKR / KRs
KR1: each row's new assertion RED@base→GREEN post-phase. KR2: §5 pre-existing suites stay GREEN. KR3: `git diff --stat` touches nothing outside §3.

## 2.5 Global Constraints (verbatim into every dispatch)
Node ≥20.10 · RED-first per row · new/touched `*.test.sh` `chmod +x` · no CHANGELOG/version/`.claude-plugin/plugin.json` edit · one clone, no fetch/pull into it once foreman starts (main-checkout-boundary) · foreman `dispatch-foreman.sh --model kimi-code/k3` · implementer `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low` · review `dispatch-review.sh` 2nd family · §5 commands prefixed `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`.

## 2.6 Change-policy: Compatibility `internal-only` (scripts/hooks/suites, no published API) · Dependency `none` (fixes within existing files).

## 3. File-structure map
- `scripts/{engine-scorecard.js,adopt-qualification-defaults.js,dispatch-status.js,validate-json-schema.js,build-profile-payload.js,next-pick.js,decision-ledger.js}`, `src/endpoints/cli.js` + `platforms/codex/plugin/` mirrors
- `hooks/tests/{engine-scorecard,qualification-defaults-adoption,dispatch-status,dispatch-status-contract,endpoints-cli,profile-guided-dispositions,next-pick,decision-ledger}.test.sh`, `scripts/validate-json-schema.test.js`
- NEW `hooks/tests/qualification-scorecard-tools.test.sh`

## 4. Phases (order fixed by bundle-analysis risk — do not reorder). Each phase implements its §0.1 row; acceptance = the named assertion RED at base (record base output) → GREEN after the fix, §5 unregressed.
**P1 r49 (S)** → §0.1 row 49. `assert_r49_scorecard_runner_tok`.
**P2 r51 (S)** → §0.1 row 51. `assert_r51_adopt_qualification`.
**P3 r52 (S)** → §0.1 row 52. `assert_r52_feed_listing_prints`.
**P4 r53 (S)** → §0.1 row 53. `assert_r53_runner_opencode_usag`.
**P5 r55 (S)** → §0.1 row 55. `assert_r55_autopilot_endpoints`.
**P6 r64 (S)** → §0.1 row 64. `assert_r64_validate_json_schema`.
**P7 r75 (Fix)** → §0.1 row 75. `assert_r75_vacuous_red_case_in`.
**P8 r82 (S)** → §0.1 row 82. `assert_r82_governance_cli_ux_po`.
**P9 r127 (S)** → §0.1 row 127. `assert_r127_engine_scorecard_js`.

## 5. Test / validation
Scratch worktree, temp branch (not detached HEAD); prefix `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`:
- `for s in hooks/tests/engine-scorecard.test.sh hooks/tests/qualification-defaults-adoption.test.sh hooks/tests/dispatch-status.test.sh hooks/tests/dispatch-status-contract.test.sh hooks/tests/endpoints-cli.test.sh hooks/tests/profile-guided-dispositions.test.sh hooks/tests/next-pick.test.sh hooks/tests/decision-ledger.test.sh; do env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash "$s" < /dev/null; done`
- `node scripts/check-js-syntax.js`
- `bash scripts/sync-codex-plugin-skills.sh --check`
- `test -x hooks/tests/qualification-scorecard-tools.test.sh`
All exit 0. No human gate (Hold-scope autonomous).

## 6. Risks + inversion
🟡 rows 49 and 127 both touch `scripts/engine-scorecard.js` —…
**Inversion**: two bundles sharing one `.git`/worktree ⇒ `main-checkout-boundary.sh` flags `main_checkout_mutated`. Mitigation: one clone per bundle, never shared.

## 7. Out of scope
Other bundles' files: B1 review-loop-resolver-a (resolve-review-loop.sh, probe-unknown.js); B2 review-loop-resolver-b (hetero-review-loop.js, check-phase-review-receipt.js, dispatch-plan-review.js); B3 managed-rail-core-engine (autopilot-engine.js, implementation-campaign.js, campaign-composition.js); B5 hooks-live-state-misc (context-budget.js, dispatch-model-guard.js, depth0-delegate-gate.js, dispatch-review.sh, live-state-dir.js, 3 SKILL.md); B6 dispatch-lifecycle-residue-mission (run-ledger.sh, reap-dispatch-*.sh, prune-tmp-residue.sh, mission-policy.js, mission/runtime.js) — full maps in each bundle's own §3. · `docs/BACKLOG.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json` · §5 suites (run-only; new assertions live only in `hooks/tests/qualification-scorecard-tools.test.sh`) · the 52 excluded rows (not-fired, needs decision, >S/Fix, malformed row 31, CI-coupled — see bundle-analysis).

## 8. Open questions
None — scope/order/risk fixed by the approved analysis.

## Review log
R0 author: depth-0 (cookys), 2026-09-21. No plan-readiness round for this batch (operator pre-approved the split); execution review is the §2.5 hetero dispatch-review loop.

---
## Foreman brief (paste into `dispatch-foreman.sh --model kimi-code/k3` for this clone)
Bundle **qualification-scorecard-tools** (9 rows). Own `git clone` (never main checkout/shared worktree). Branch/row: `hands/qualification-scorecard-tools/<row-n>` off develop.
1. Work P1..P9 in §4 order (§6 sequencing risk).
2. Impl `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low`; commits on `hands/qualification-scorecard-tools/<row-n>` (harness commits, never you); never push/stash.
3. Review `dispatch-review.sh` 2nd family. Verdict = depth-0 from git; you report, don't self-attest.
4. RED-first: assertion fails @base before fix; record base output per row. No CHANGELOG/version/BACKLOG edits (row 31 handled separately).
5. Report per row `PASS <n> <assertion>` / `FAIL <n> <assertion> <reason>` + each dispatch's `rc=`. After all rows re-run full §5; report aggregate before ending turn.
