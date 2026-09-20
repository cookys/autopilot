# Plan — backlog bundle review-loop-resolver-a (B1, wave 2)
> Status: proposed · Owner: depth-0 (cookys) · Branch: `docs/backlog-bundles` (authoring only; execution in own clone/branch, see brief) · Frame: L, per `references/plan-template.md`

## 0. Context / thesis
Approved bundle analysis (`bundles.md`, depth-0 2026-09-21) splits 49/103 BACKLOG `S`/`Fix` rows into 6 file-disjoint bundles for parallel hetero-impl per `skills/l5/references/hetero-impl-loop.md` §Parallel units. This is **B1**, 7 rows, wave 2 (wave1=B2/B3/B4/B5/B6 simultaneous; wave2=B1 alone after wave1 `rc=`).

## 0.1 BACKLOG rows (verbatim Title/Trigger/Context from `docs/BACKLOG.md` @ develop 47b52eac; long quotes `…`-trimmed to fit 8 KB, full text there)
- **Row 23** (S) `probe-unknown.js classify` spawns `resolve-r…
  Trig: a foreman round-end ledger or `cost-tracker` sample showing `probe-unknown.js classify` taking ≥ 10 s wall tim…
  Ctx: v2.36.15 P1/P2 read `unknown_escalation`, the three budgets, `consult_dispatch`, `consult_resolved_from` and `…
- **Row 36** (S) resolve-review-loop.sh: audit every remaining…
  Trig: next touch of the reviewer_ladder / hetero_review extraction or any `entry.runner === implRunner` site
  Ctx: normRunner was added at the plan-panel and consult sites; other comparisons may re-admit a dual seat (GLM FOLL…
- **Row 41** (S) resolve-review-loop.test.sh capability-warnin…
  Trig: next touch of that test file
  Ctx: wording only; the expectations are correct (GLM CUT, core review g2)
- **Row 42** (S) `normalize_agy_alias()` rewrites config-side…
  Trig: a `qc_panel` entry written as an agy alias (e.g. `gemini-flash`) while the topology ladder carries the resolve…
  Ctx: found by the D4 hermetic test's first fixture (2026-09-04); the fixture was changed to a non-aliased name, the…
- **Row 43** (S) `resolve-review-loop.sh` `auto` knobs read a…
  Trig: a host whose cached topology predates a plugin version that added roles (observed 2026-09-04: cache without `c…
  Ctx: the resolver never regenerates the cache; `sync-all.sh` runs `--check` only.
- **Row 44** (S) `contract-parity` / `resolve-review-loop-cons…
  Trig: the next time either test goes red on one host and green on another with the same tree (2026-09-07: red on thi…
  Ctx: both tests resolve the shipped template with `implementer_ladder: auto` / `consult_dispatch: auto`, so the res…
- **Row 54** (S) `resolve-review-loop-consult-discuss-gate` ca…
  Trig: the next time a pooled test dies with `EACCES` on `evals/consult-capability-evidence-corpus.json`, or when `ho…
  Ctx: case (xix) `chmod 000`s the REAL `evals/consult-capability-evidence-corpus.json` for two script runs; any pool…

## 1. Problem
Rows above are `open`, trigger fired/actionable; none need an operator decision, live credential, or unconfirmed root cause (bundle-analysis Exclusions).

## 2. OKR / KRs
KR1: each row's new assertion RED@base→GREEN post-phase. KR2: §5 pre-existing suites stay GREEN. KR3: `git diff --stat` touches nothing outside §3.

## 2.5 Global Constraints (verbatim into every dispatch)
Node ≥20.10 · RED-first per row · new/touched `*.test.sh` `chmod +x` · no CHANGELOG/version/`.claude-plugin/plugin.json` edit · one clone, no fetch/pull into it once foreman starts (main-checkout-boundary) · foreman `dispatch-foreman.sh --model kimi-code/k3` · implementer `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low` · review `dispatch-review.sh` 2nd family · §5 commands prefixed `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`.

## 2.6 Change-policy: Compatibility `internal-only` (scripts/hooks/suites, no published API) · Dependency `none` (fixes within existing files).

## 3. File-structure map
- `scripts/{resolve-review-loop.sh,probe-unknown.js}` + `platforms/codex/plugin/` mirrors (verified present)
- `hooks/tests/{resolve-review-loop,resolve-review-loop-consult-discuss-switch,contract-parity,resolve-review-loop-consult-discuss-gate,probe-unknown}.test.sh`
- NEW `hooks/tests/review-loop-resolver-a.test.sh`

## 4. Phases (order fixed by bundle-analysis risk — do not reorder). Each phase implements its §0.1 row; acceptance = the named assertion RED at base (record base output) → GREEN after the fix, §5 unregressed.
**P1 r23 (S)** → §0.1 row 23. `assert_r23_probe_unknown_js_cla`.
**P2 r36 (S)** → §0.1 row 36. `assert_r36_resolve_review_loop`.
**P3 r41 (S)** → §0.1 row 41. `assert_r41_resolve_review_loop`.
**P4 r42 (S)** → §0.1 row 42. `assert_r42_normalizeagyalias_re`.
**P5 r43 (S)** → §0.1 row 43. `assert_r43_resolve_review_loop`.
**P6 r44 (S)** → §0.1 row 44. `assert_r44_contract_parity_reso`.
**P7 r54 (S)** → §0.1 row 54. `assert_r54_resolve_review_loop`.

## 5. Test / validation
Scratch worktree, temp branch (not detached HEAD); prefix `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`:
- `for s in hooks/tests/resolve-review-loop.test.sh hooks/tests/resolve-review-loop-consult-discuss-switch.test.sh hooks/tests/contract-parity.test.sh hooks/tests/resolve-review-loop-consult-discuss-gate.test.sh hooks/tests/probe-unknown.test.sh; do env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash "$s" < /dev/null; done`
- `node scripts/check-js-syntax.js`
- `bash scripts/sync-codex-plugin-skills.sh --check`
- `test -x hooks/tests/review-loop-resolver-a.test.sh`
All exit 0. No human gate (Hold-scope autonomous).

## 6. Risks + inversion
🟡 output fields read by B5/B2 — no field renamed/removed (ve…
**Inversion**: two bundles sharing one `.git`/worktree ⇒ `main-checkout-boundary.sh` flags `main_checkout_mutated`. Mitigation: one clone per bundle, never shared.

## 7. Out of scope
Other bundles' files: B2 review-loop-resolver-b (hetero-review-loop.js, check-phase-review-receipt.js, dispatch-plan-review.js); B3 managed-rail-core-engine (autopilot-engine.js, implementation-campaign.js, campaign-composition.js); B4 qualification-scorecard-tools (engine-scorecard.js +6 scripts, endpoints/cli.js); B5 hooks-live-state-misc (context-budget.js, dispatch-model-guard.js, depth0-delegate-gate.js, dispatch-review.sh, live-state-dir.js, 3 SKILL.md); B6 dispatch-lifecycle-residue-mission (run-ledger.sh, reap-dispatch-*.sh, prune-tmp-residue.sh, mission-policy.js, mission/runtime.js) — full maps in each bundle's own §3. · `docs/BACKLOG.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json` · §5 suites (run-only; new assertions live only in `hooks/tests/review-loop-resolver-a.test.sh`) · the 52 excluded rows (not-fired, needs decision, >S/Fix, malformed row 31, CI-coupled — see bundle-analysis).

## 8. Open questions
None — scope/order/risk fixed by the approved analysis.

## Review log
R0 author: depth-0 (cookys), 2026-09-21. No plan-readiness round for this batch (operator pre-approved the split); execution review is the §2.5 hetero dispatch-review loop.

---
## Foreman brief (paste into `dispatch-foreman.sh --model kimi-code/k3` for this clone)
Bundle **review-loop-resolver-a** (7 rows). Own `git clone` (never main checkout/shared worktree). Branch/row: `hands/review-loop-resolver-a/<row-n>` off develop.
1. Work P1..P7 in §4 order (§6 sequencing risk).
2. Impl `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low`; commits on `hands/review-loop-resolver-a/<row-n>` (harness commits, never you); never push/stash.
3. Review `dispatch-review.sh` 2nd family. Verdict = depth-0 from git; you report, don't self-attest.
4. RED-first: assertion fails @base before fix; record base output per row. No CHANGELOG/version/BACKLOG edits (row 31 handled separately).
5. Report per row `PASS <n> <assertion>` / `FAIL <n> <assertion> <reason>` + each dispatch's `rc=`. After all rows re-run full §5; report aggregate before ending turn.
