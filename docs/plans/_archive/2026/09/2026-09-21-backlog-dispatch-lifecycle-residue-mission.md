# Plan — backlog bundle dispatch-lifecycle-residue-mission (B6, wave 1)
> Status: proposed · Owner: depth-0 (cookys) · Branch: `docs/backlog-bundles` (authoring only; execution in own clone/branch, see brief) · Frame: L, per `references/plan-template.md`

## 0. Context / thesis
Approved bundle analysis (`bundles.md`, depth-0 2026-09-21) splits 49/103 BACKLOG `S`/`Fix` rows into 6 file-disjoint bundles for parallel hetero-impl per `skills/l5/references/hetero-impl-loop.md` §Parallel units. This is **B6**, 8 rows, wave 1 (wave1=B2/B3/B4/B5/B6 simultaneous; wave2=B1 alone after wave1 `rc=`).

## 0.1 BACKLOG rows (verbatim Title/Trigger/Context from `docs/BACKLOG.md` @ develop 47b52eac; long quotes `…`-trimmed to fit 8 KB, full text there)
- **Row 3** (S) `run-ledger.sh lease-gc` aborts mid-loop on a…
  Trig: a `lease-gc --json` run whose `appended`…
  Ctx: a failing `command_stage_transition` exi…
- **Row 16** (S) `dispatch-foreman.test.sh` loses its TEST_TMP…
  Trig: reproduced 2026-09-15 on origin/develop…
  Ctx: the EXIT trap (`rm -rf "$TEST_TMP"`) fir…
- **Row 19** (S) Pin store hardening: fsync, orphaned temp fil…
  Trig: a report of a `pins.jsonl` lost or corru…
  Ctx: the QC panel (GLM-5.2, 2026-09-11) raise…
- **Row 92** (S) `reap-dispatch-branches.sh scan` cannot see b…
  Trig: 下一次要盤點 dispatch 殘留分支時；或再出現「分支堆積但 scan 回報…
  Ctx: `scan` 以 `root_run_id` 為 key，沒帶 id 的殘留分支…
- **Row 93** (S) `prune_tmp_residue` covers 7 prefixes; 25 scr…
  Trig: `/tmp` 再次被 autopilot 殘留撐大，或有人要為 CI runne…
  Ctx: `prune_tmp_residue` 只被四個 dispatch 腳本呼叫，共…
- **Row 109** (S) Recover stale backlog admission locks safely
  Trig: When a backlog admission is interrupted…
  Ctx: Backlog admission correctly fails closed…
- **Row 122** (Fix) Verification-author seats on agy / cc-shim /…
  Trig: next time a VA seat other than codex/gro…
  Ctx: `dispatch-contract.js` always queries ca…
- **Row 123** (S) No supported withdraw for a never-granted DRA…
  Trig: next time a frozen execution graph must…
  Ctx: `mission prepare` binds the adoption key…

## 1. Problem
Rows above are `open`, trigger fired/actionable; none need an operator decision, live credential, or unconfirmed root cause (bundle-analysis Exclusions).

## 2. OKR / KRs
KR1: each row's new assertion RED@base→GREEN post-phase. KR2: §5 pre-existing suites stay GREEN. KR3: `git diff --stat` touches nothing outside §3.

## 2.5 Global Constraints (verbatim into every dispatch)
Node ≥20.10 · RED-first per row · new/touched `*.test.sh` `chmod +x` · no CHANGELOG/version/`.claude-plugin/plugin.json` edit · one clone, no fetch/pull into it once foreman starts (main-checkout-boundary) · foreman `dispatch-foreman.sh --model kimi-code/k3` · implementer `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low` · review `dispatch-review.sh` 2nd family · §5 commands prefixed `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`.

## 2.6 Change-policy: Compatibility `internal-only` (scripts/hooks/suites, no published API) · Dependency `none` (fixes within existing files).

## 3. File-structure map
- `scripts/{run-ledger.sh,reap-dispatch-worktrees.sh,reap-dispatch-branches.sh,admit-backlog-follow-ups.js,dispatch-contract.js,probe-engine-capability.sh}`, `scripts/lib/{dispatch-detach.sh,jsonl-store.js,prune-tmp-residue.sh}`, `src/engine/mission-policy.js`, `src/mission/runtime.js` + `platforms/codex/plugin/` mirrors
- `hooks/tests/{run-ledger-lease-gc,reap-dispatch-worktrees,dispatch-foreman,jsonl-store,reap-dispatch-branches,prune-tmp-residue,mission-policy-graph,mission-runtime-v2,mission-grant-open-claim}.test.sh`
- NEW `hooks/tests/dispatch-lifecycle-residue-mission.test.sh`

## 4. Phases (order fixed by bundle-analysis risk — do not reorder). Each phase implements its §0.1 row; acceptance = the named assertion RED at base (record base output) → GREEN after the fix, §5 unregressed.
**P1 r3 (S)** → §0.1 row 3. `assert_r3_run_ledger_sh_lease`.
**P2 r16 (S)** → §0.1 row 16. `assert_r16_dispatch_foreman_tes`.
**P3 r19 (S)** → §0.1 row 19. `assert_r19_pin_store_hardening`.
**P4 r92 (S)** → §0.1 row 92. `assert_r92_reap_dispatch_branch`.
**P5 r93 (S)** → §0.1 row 93. `assert_r93_prunetmpresidue_cove`.
**P6 r109 (S)** → §0.1 row 109. `assert_r109_recover_stale_backlo`.
**P7 r122 (Fix)** → §0.1 row 122. `assert_r122_verification_author`.
**P8 r123 (S)** → §0.1 row 123. `assert_r123_no_supported_withdra`.

## 5. Test / validation
Scratch worktree, temp branch (not detached HEAD); prefix `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`:
- `for s in hooks/tests/run-ledger-lease-gc.test.sh hooks/tests/reap-dispatch-worktrees.test.sh hooks/tests/dispatch-foreman.test.sh hooks/tests/jsonl-store.test.sh hooks/tests/reap-dispatch-branches.test.sh hooks/tests/prune-tmp-residue.test.sh hooks/tests/mission-policy-graph.test.sh hooks/tests/mission-runtime-v2.test.sh hooks/tests/mission-grant-open-claim.test.sh; do env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash "$s" < /dev/null; done`
- `node scripts/check-js-syntax.js`
- `bash scripts/sync-codex-plugin-skills.sh --check`
- `test -x hooks/tests/dispatch-lifecycle-residue-mission.test.sh`
All exit 0. No human gate (Hold-scope autonomous).

## 6. Risks + inversion
🟡 rows 3/92 share the reap pipeline via `scripts/lib/` (no d…
**Inversion**: two bundles sharing one `.git`/worktree ⇒ `main-checkout-boundary.sh` flags `main_checkout_mutated`. Mitigation: one clone per bundle, never shared.

## 7. Out of scope
Other bundles' files: B1 review-loop-resolver-a (resolve-review-loop.sh, probe-unknown.js); B2 review-loop-resolver-b (hetero-review-loop.js, check-phase-review-receipt.js, dispatch-plan-review.js); B3 managed-rail-core-engine (autopilot-engine.js, implementation-campaign.js, campaign-composition.js); B4 qualification-scorecard-tools (engine-scorecard.js +6 scripts, endpoints/cli.js); B5 hooks-live-state-misc (context-budget.js, dispatch-model-guard.js, depth0-delegate-gate.js, dispatch-review.sh, live-state-dir.js, 3 SKILL.md) — full maps in each bundle's own §3. · `docs/BACKLOG.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json` · §5 suites (run-only; new assertions live only in `hooks/tests/dispatch-lifecycle-residue-mission.test.sh`) · the 52 excluded rows (not-fired, needs decision, >S/Fix, malformed row 31, CI-coupled — see bundle-analysis).

## 8. Open questions
None — scope/order/risk fixed by the approved analysis.

## Review log
R0 author: depth-0 (cookys), 2026-09-21. No plan-readiness round for this batch (operator pre-approved the split); execution review is the §2.5 hetero dispatch-review loop.

---
## Foreman brief (paste into `dispatch-foreman.sh --model kimi-code/k3` for this clone)
Bundle **dispatch-lifecycle-residue-mission** (8 rows). Own `git clone` (never main checkout/shared worktree). Branch/row: `hands/dispatch-lifecycle-residue-mission/<row-n>` off develop.
1. Work P1..P8 in §4 order (§6 sequencing risk).
2. Impl `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low`; commits on `hands/dispatch-lifecycle-residue-mission/<row-n>` (harness commits, never you); never push/stash.
3. Review `dispatch-review.sh` 2nd family. Verdict = depth-0 from git; you report, don't self-attest.
4. RED-first: assertion fails @base before fix; record base output per row. No CHANGELOG/version/BACKLOG edits (row 31 handled separately).
5. Report per row `PASS <n> <assertion>` / `FAIL <n> <assertion> <reason>` + each dispatch's `rc=`. After all rows re-run full §5; report aggregate before ending turn.
