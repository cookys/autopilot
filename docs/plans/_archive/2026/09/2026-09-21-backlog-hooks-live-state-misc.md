# Plan — backlog bundle hooks-live-state-misc (B5, wave 1)
> Status: proposed · Owner: depth-0 (cookys) · Branch: `docs/backlog-bundles` (authoring only; execution in own clone/branch, see brief) · Frame: L, per `references/plan-template.md`

## 0. Context / thesis
Approved bundle analysis (`bundles.md`, depth-0 2026-09-21) splits 49/103 BACKLOG `S`/`Fix` rows into 6 file-disjoint bundles for parallel hetero-impl per `skills/l5/references/hetero-impl-loop.md` §Parallel units. This is **B5**, 7 rows, wave 1 (wave1=B2/B3/B4/B5/B6 simultaneous; wave2=B1 alone after wave1 `rc=`).

## 0.1 BACKLOG rows (verbatim Title/Trigger/Context from `docs/BACKLOG.md` @ develop 47b52eac; long quotes `…`-trimmed to fit 8 KB, full text there)
- **Row 12** (S) context-budget: no model-id window source — a…
  Trig: a host without autopilot's statusLine (no live `context_window_size`) on an `[1m]` model:…
  Ctx: `hooks/context-budget.js` reads the live file, else `inferWindowTokens(observedMax)`; add…
- **Row 59** (S) Foreman model is hardcoded as `opus` in /l4–/…
  Trig: any consuming project sets `tree:sub-orchestrator` in `.claude/model-routing-config.md`
  Ctx: doc + `dispatch-model-guard.js` read-path only — SCOPE-REDUCED per bundle analysis (drop t…
- **Row 79** (Fix) cc-shim framing chrome leaks via `generate_se…
  Trig: Next touch of `dispatch-review.sh`'s cc-shim launcher, or the next `no_verdict` whose raw…
  Ctx: 2026-08-18 P1 review (MiniMax-M3, cc-shim): parser returned `no_verdict` / "response did n…
- **Row 132** (S) Live-state base on world-writable tmpfs — own…
  Trig: autopilot runs on a multi-user host, or a second local user is observed on any fleet host;…
  Ctx: v2.36.1 moved `context-budget`/`depth0-gate` state and the codeforge live files under `$XD…
- **Row 133** (S) live-state-dir 🔵 leftovers — multi-row findmn…
  Trig: a candidate that `findmnt -T` reports as more than one row; a mountpoint with an escaped c…
  Ctx: the 🟡 items of the v2.36.1 pre-merge review shipped in v2.36.2; these 🔵 items did not.
- **Row 139** (S) depth0-delegate-gate `Bash` matcher is an exp…
  Trig: a measured depth-0 Bash latency complaint, or the next revision of `depth0-delegate-gate`.
  Ctx: plan §4 P3.1 lists `WebFetch|WebSearch|Read|Grep|Glob|Agent|Skill|Task`; the shipped hook…
- **Row 140** (S) live-state-dir / context-budget test strength…
  Trig: next time a consult is dispatched on a host whose qc panel [BACKLOG.md row truncated at so…
  Ctx: On `cookys-openclaw`, `resolve-review-loop.sh` emits [BACKLOG.md row truncated at source —…

## 1. Problem
Rows above are `open`, trigger fired/actionable; none need an operator decision, live credential, or unconfirmed root cause (bundle-analysis Exclusions).

## 2. OKR / KRs
KR1: each row's new assertion RED@base→GREEN post-phase. KR2: §5 pre-existing suites stay GREEN. KR3: `git diff --stat` touches nothing outside §3.

## 2.5 Global Constraints (verbatim into every dispatch)
Node ≥20.10 · RED-first per row · new/touched `*.test.sh` `chmod +x` · no CHANGELOG/version/`.claude-plugin/plugin.json` edit · one clone, no fetch/pull into it once foreman starts (main-checkout-boundary) · foreman `dispatch-foreman.sh --model kimi-code/k3` · implementer `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low` · review `dispatch-review.sh` 2nd family · §5 commands prefixed `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`.

## 2.6 Change-policy: Compatibility `internal-only` (scripts/hooks/suites, no published API) · Dependency `none` (fixes within existing files).

## 3. File-structure map
- `hooks/{context-budget.js,dispatch-model-guard.js,depth0-delegate-gate.js}` (no codex mirror, verified absent)
- `scripts/{dispatch-review.sh,lib/live-state-dir.js}`, `skills/{l4,l6}/SKILL.md`, `skills/ceo-agent/references/level-front-door.md` + `platforms/codex/plugin/` mirrors
- `hooks/tests/{context-budget-window-memory,dispatch-model-guard,dispatch-review,dispatch-review-prompt-skeleton}.test.sh`
- NEW `hooks/tests/hooks-live-state-misc.test.sh`

## 4. Phases (order fixed by bundle-analysis risk — do not reorder). Each phase implements its §0.1 row; acceptance = the named assertion RED at base (record base output) → GREEN after the fix, §5 unregressed.
**P1 r12 (S)** → §0.1 row 12. `assert_r12_context_budget_no_mo`.
**P2 r59 (S)** → §0.1 row 59. `assert_r59_foreman_model_is_har`.
**P3 r79 (Fix)** → §0.1 row 79. `assert_r79_cc_shim_framing_chro`.
**P4 r132 (S)** → §0.1 row 132. `assert_r132_live_state_base_on_w`.
**P5 r133 (S)** → §0.1 row 133. `assert_r133_live_state_dir_lefto`.
**P6 r139 (S)** → §0.1 row 139. `assert_r139_depth0_delegate_gate`.
**P7 r140 (S)** → §0.1 row 140. `assert_r140_live_state_dir_conte`.

## 5. Test / validation
Scratch worktree, temp branch (not detached HEAD); prefix `env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID`, end `< /dev/null`:
- `for s in hooks/tests/context-budget-window-memory.test.sh hooks/tests/dispatch-model-guard.test.sh hooks/tests/dispatch-review.test.sh hooks/tests/dispatch-review-prompt-skeleton.test.sh; do env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID bash "$s" < /dev/null; done`
- `node scripts/check-js-syntax.js`
- `bash scripts/sync-codex-plugin-skills.sh --check`
- `test -x hooks/tests/hooks-live-state-misc.test.sh`
All exit 0. No human gate (Hold-scope autonomous).

## 6. Risks + inversion
🟡 rows 12 and 140 both touch `hooks/context-budget.js` — seq…
**Inversion**: two bundles sharing one `.git`/worktree ⇒ `main-checkout-boundary.sh` flags `main_checkout_mutated`. Mitigation: one clone per bundle, never shared.

## 7. Out of scope
Other bundles' files: B1 review-loop-resolver-a (resolve-review-loop.sh, probe-unknown.js); B2 review-loop-resolver-b (hetero-review-loop.js, check-phase-review-receipt.js, dispatch-plan-review.js); B3 managed-rail-core-engine (autopilot-engine.js, implementation-campaign.js, campaign-composition.js); B4 qualification-scorecard-tools (engine-scorecard.js +6 scripts, endpoints/cli.js); B6 dispatch-lifecycle-residue-mission (run-ledger.sh, reap-dispatch-*.sh, prune-tmp-residue.sh, mission-policy.js, mission/runtime.js) — full maps in each bundle's own §3. · `docs/BACKLOG.md`, `CHANGELOG.md`, `.claude-plugin/plugin.json` · §5 suites (run-only; new assertions live only in `hooks/tests/hooks-live-state-misc.test.sh`) · the 52 excluded rows (not-fired, needs decision, >S/Fix, malformed row 31, CI-coupled — see bundle-analysis).

## 8. Open questions
None — scope/order/risk fixed by the approved analysis.

## Review log
R0 author: depth-0 (cookys), 2026-09-21. No plan-readiness round for this batch (operator pre-approved the split); execution review is the §2.5 hetero dispatch-review loop.

---
## Foreman brief (paste into `dispatch-foreman.sh --model kimi-code/k3` for this clone)
Bundle **hooks-live-state-misc** (7 rows). Own `git clone` (never main checkout/shared worktree). Branch/row: `hands/hooks-live-state-misc/<row-n>` off develop.
1. Work P1..P7 in §4 order (§6 sequencing risk).
2. Impl `dispatch-hetero.sh --runner cursor --model cursor-grok-4.6-low`; commits on `hands/hooks-live-state-misc/<row-n>` (harness commits, never you); never push/stash.
3. Review `dispatch-review.sh` 2nd family. Verdict = depth-0 from git; you report, don't self-attest.
4. RED-first: assertion fails @base before fix; record base output per row. No CHANGELOG/version/BACKLOG edits (row 31 handled separately).
5. Report per row `PASS <n> <assertion>` / `FAIL <n> <assertion> <reason>` + each dispatch's `rc=`. After all rows re-run full §5; report aggregate before ending turn.
