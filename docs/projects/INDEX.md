# autopilot — Projects Index

> autopilot's project tracking index. Established 2026-04-12 during the v2.4.0 methodology-agents ship, replacing the previous plan-only convention.
>
> **Why this exists**: dev-flow L-1 mandates creating a project dir for every L-size work. autopilot's earlier L-ships accumulated skips against this mandate because `docs/projects/` did not exist. 2026-04-12 formalizes this layer: every L-ship from v2.4.0 onwards gets a project dir under `docs/projects/YYYY-MM-DD-<name>/` with a `README.md` tracking OKR / phases / progress.

## 進行中 (In Progress)

| Date | Project | Target version | Branch |
|------|---------|----------------|--------|
| _(none)_ | | | |

## 已完成 (Completed)

| Date | Project | Version | Merge | Plan |
|------|---------|---------|-------|------|
| 2026-06-26 | hetero-dispatch roster fix + review-loop automation (`dispatch-hetero.sh` codex-trigger + `--runner`/`--effort` + best-effort cgroup containment; `resolve-review-loop.sh` + `review-loop-config.md` config-driven `/l5` engine roster with decorrelated reviewer; **L1 block-mode override unlock attempt REVERTED as UNSAFE** by gpt-5.5 review — sibling-scope cgroup escape + worker-reachable verdict path; no project dir, see CHANGELOG) | v2.25.8 | `<merge-sha>` | (CHANGELOG entry) |
| 2026-06-26 | [test-integrity-l1](2026-06-26-test-integrity-l1/README.md) — L1 executed-set invariance for `check-test-integrity.sh`: RUNS the collector (pytest/jest/vitest/go) on base↔head and fails `executed_set_shrink` if the actually-executing set shrinks (catches additions-only / out-of-test-path gaming L0 misses). Ship-now = detection + warn + block-hard-fail; block-mode override **honoring** deferred on a `dispatch-hetero.sh` descendant-containment dependency (forgeable in the same-user linked-worktree model). **Process**: 4-round gpt-5.5 adversarial design-spec loop → `gpt-5.3-codex-spark` impl → 3-round gpt-5.5 impl review + independent depth-0 adversarial harness (caught vitest-blind / go multi-pkg build-fail / override forgeability the implementer's own green missed) | v2.25.7 | [`a6b75bb`](../../../../commit/a6b75bb) | [spec](2026-06-26-test-integrity-l1/design-spec.md) · [plan](../plans/2026-06-25-test-integrity-gate.md) |
| 2026-06-24 | [port-autopilot-to-node](_archive/2026-06-24-port-autopilot-to-node/README.md) — pure-Node.js port of 7 core runtime/validation scripts (risk-counter, toggle-payload-capture, session-start, doc-drift-gate, check-node-report, tree, qc-panel); removes jq/python3 deps so the engine runs in dependency-minimal sandboxes (agy). Originals deleted, wiring re-pointed at `.js`. Pre-merge review fixed 3 🔴 (tree.js live-owner lock steal, qc-panel.js Judge-A false-PASS race, check-node-report.js sha256 fail-open) | v2.25.3 | [`3d48c7e`](../../../../commit/3d48c7e) | [plan](../plans/2026-06-24-port-autopilot-to-node.md) |
| 2026-06-26 | test-integrity-gate P1a (L0 anti-gaming gate `check-test-integrity.sh` — additions-only + skip/solo denylist + `rename_escape` + surface-touch + non-waivable protected-paths + config-from-base; override = fail-safe stub, L1 deferred; no project dir, plan-tracked. **Process note**: agy hetero-dispatch wrote to its own plugin install copy (not the worktree) → harvested + re-implemented via `gpt-5.3-codex-spark`, verified by gpt-5.5 adversarial review + an isolated adversarial harness) | v2.25.6 | [`0709fc3`](../../../../commit/0709fc3) | [plan](../plans/2026-06-25-test-integrity-gate.md) |
| 2026-06-24 | [gstack-superpowers-learnings](_archive/2026-06-24-gstack-superpowers-learnings/README.md) — L-size; dialectic-converged learnings from `obra/superpowers` v6.0.3 + `garrytan/gstack`: E1 `check-dispatch-suppression.sh` anti-gaming linter (+ test) + E2 plan-template Global Constraints + E3 standalone-TDD doc-honesty; **cut** L2 runtime-QA / L3 UX-axis (selection bias). Also bundles the `superpowers:code-reviewer` stale-ref fix + a 4-facet doc-staleness sweep | v2.25.0 | [`05d02e4`](../../../../commit/05d02e4) | [plan](../plans/2026-06-24-gstack-superpowers-learnings.md) |
| 2026-06-24 | qc-refute-shadow-and-no-silent-caps (L-size; CC-Workflow learnings adjudicated → 2 adopted: `qc-panel.sh` shadow refute pass — cross-family self-refutation, `default-refuted-if-uncertain`, **non-gating until calibration graduates it** — + a shared no-silent-caps disclosure clause across reviewer/audit contracts generalizing doc-sync; dispatched via `/l4` foreman; no project dir, see CHANGELOG) | v2.24.0 | (this ship) | (CHANGELOG entry) |
| 2026-06-23 | [l4-l5-dep-graph-fanout](_archive/2026-06-23-l4-l5-dep-graph-fanout/README.md) — `/l4 /l5` width fan-out: research → S0.a **fleet-measured** (built portable probe + zero-dep ingest endpoint; 6 machines / 6-of-7 measurable repos over the d2 gate) → **descope overturned** → **S1** result-validating file-disjointness gate (`check-disjointness.sh`) + **Phase L** Tier-2 batch engine (`dispatch-batch.sh`: all-or-nothing / merge-conflict→serial-collapse / single-base / setsid-verified kill-trap / Amdahl telemetry). Also fixed a qc-gate SIGPIPE bug. `/l5` hetero-parallel → BACKLOG; Amdahl auto-tune → won't-do | (no version bump) | [`577ba8d`](../../../../commit/577ba8d) (Phase L) · [`f21346e`](../../../../commit/f21346e) (S1) | [plan](../plans/2026-06-23-l4-l5-dep-graph-fanout.md) |
| 2026-06-23 | qc-gate-forcing-function (config-driven anti-skip pre-push gate — protected-path pushes need a `QC-Verdict: PASS` trailer or `.qc/<sha>.verdict.json`; `resolve-qc-gate.sh` + per-project `qc-gate-config.md`; no project dir, see CHANGELOG) | v2.22.0 | [`84d0f29`](../../../../commit/84d0f29) | (CHANGELOG entry) |
| 2026-06-22 | [ceo-fleet-autonomy](2026-06-22-ceo-fleet-autonomy/README.md) — `/l3 /l4 /l5` CEO front-door + dispatched sub-orchestrator foreman (context-hygiene/unattended); 3-round dialectic + P1.f dogfood (6/6) + 2-round L-5 dialectic; **v2.21.1 follow-up**: baseRef spike corrected the worktree-base invariant (`worktree.baseRef:"head"` supersedes the STEP-0 reset; `/l5 --base` is a separate mechanism) | v2.21.0 → v2.21.1 | [`010556a`](../../../../commit/010556a) | [plan](../plans/2026-06-22-ceo-fleet-autonomy.md) |
| 2026-06-22 | [doc-sync-gate](2026-06-22-doc-sync-gate/README.md) | v2.20.0 | (this ship) | (self-contained in README) |
| 2026-06-18 | [doc-sync-skill](2026-06-18-doc-sync-skill/README.md) | v2.19.0 | (this ship) | (self-contained in README) |
| 2026-06-17 | dispatch-signal-and-sync (tmuxai/ponytail absorptions; no project dir — plan-tracked, survey→2-round dialectic→CEO delegated build) | v2.18.0 | [`5ae34d5`](../../../../commit/5ae34d5) | [plan](../plans/2026-06-17-tmuxai-ponytail-absorptions.md) |
| 2026-06-12 | [tree-role-dispatch](_archive/2026-06-12-tree-role-dispatch/README.md) | v2.17.0 | [`58c05d3`](../../../../commit/58c05d3) | (self-contained in README) |
| 2026-06-12 | [task-tree-engine](_archive/2026-06-12-task-tree-engine/README.md) | v2.16.0 | [`569a8b2`](../../../../commit/569a8b2) | [plan](../plans/2026-06-12-task-tree-engine.md) |
| 2026-06-11 | agy-incident-knowledge (S-size; recovery recipe inlined + sourceable shell guard — no project dir, see CHANGELOG) | v2.15.3 | [`56c7c2a`](../../../../commit/56c7c2a) | (CHANGELOG entry) |
| 2026-06-11 | agy-export-then-install (S-size; structural workaround — agy never sees the live repo — no project dir, see CHANGELOG) | v2.15.2 | [`a2c89de`](../../../../commit/a2c89de) | (CHANGELOG entry) |
| 2026-06-11 | agy-install-guard (S-size; data-loss preflight in install-antigravity scripts after the symlink self-copy incident — no project dir, see CHANGELOG) | v2.15.1 | [`cc0e0cf`](../../../../commit/cc0e0cf) | (CHANGELOG entry) |
| 2026-06-11 | hetero-dispatch-script (S-size; `dispatch-hetero.sh` + reference doc, script-first — no project dir, see CHANGELOG) | v2.15.0 | [`b719f94`](../../../../commit/b719f94) | (CHANGELOG entry) |
| 2026-06-11 | _bodies-relocation (S-size; implemented by Gemini 3.5 Flash via `agy -p`, first heterogeneous dispatch — no project dir, see CHANGELOG) | v2.14.1 | [`a83c04a`](../../../../commit/a83c04a) | (CHANGELOG entry) |
| 2026-06-11 | [nested-dispatch-integration](_archive/2026-06-11-nested-dispatch-integration/README.md) | v2.14.0 | [`98d6ab2`](../../../../commit/98d6ab2) | (self-contained in README) |
| 2026-06-04 | [distill-consolidate](2026-06-04-distill-consolidate/README.md) | v2.11.0 | [`d2060e3`](../../../../commit/d2060e3) | [plan](../plans/2026-06-04-distill-consolidate.md) |
| 2026-06-03 | [harness-integration](_archive/2026-06-03-harness-integration/README.md) | v2.10.0 | [`4036a1b`](../../../../commit/4036a1b) | [handoff](../plans/2026-06-03-distill-handoff.md) |
| 2026-06-03 | [distill](_archive/2026-06-03-distill/README.md) | v2.9.0 | [`ef1f542`](../../../../commit/ef1f542) | [plan](../plans/2026-06-03-distill-skill.md) |
| 2026-06-02 | [hook-followups](_archive/2026-06-02-hook-followups/README.md) | v2.8.1 | [`a43b81b`](../../../../commit/a43b81b) | (self-contained in README) |
| 2026-06-02 | [hook-transcript-pivot](2026-06-02-hook-transcript-pivot/README.md) | v2.8.0 | [`e6c7f25`](../../../../commit/e6c7f25) | [plan](../plans/2026-06-02-hook-transcript-pivot.md) |
| 2026-06-02 | [skill-leverage-extraction](2026-06-02-skill-leverage-extraction/README.md) | v2.7.7 | [`a4c5db6`](../../../../commit/a4c5db6) | [plan](../plans/2026-06-02-skill-leverage-extraction.md) |
| 2026-06-01 | [test-suite-foundation](2026-06-01-test-suite-foundation/README.md) | v2.7.5 | [`81e769d`](../../../../commit/81e769d) | [plan](../plans/2026-05-14-test-suite.md) |
| 2026-05-29 | [post-portability-followups](2026-05-29-post-portability-followups/README.md) | v2.7.4 | [`6ed9e55`](../../../../commit/6ed9e55) | (self-contained in README) |
| 2026-05-27 | [multi-agent-portability-correction](2026-05-22-multi-agent-portability-correction/README.md) | v2.7.3 | [`5099d75`](../../../../commit/5099d75) | [plan](../plans/2026-05-22-multi-agent-portability-correction.md) |
| 2026-05-14 | [retro-roundup](_archive/2026-05-14-retro-roundup/README.md) | v2.7.2-followup ⚠ | [`57c88ee`](../../../../commit/57c88ee) | [plan](../plans/2026-05-14-retro-roundup.md) |
| 2026-05-14 | [context-handoff-hardening](_archive/2026-05-14-context-handoff-hardening/README.md) | v2.7.2 | [`670cc23`](../../../../commit/670cc23) | [plan](../plans/2026-05-14-context-handoff-hardening.md) |
| 2026-05-14 | [superpowers-coexistence](_archive/2026-05-14-superpowers-coexistence/README.md) | v2.7.0 | [`eb70999`](../../../../commit/eb70999) | [plan](../plans/2026-05-14-superpowers-coexistence.md) |
| 2026-04-13 | [pua-inspired-enhancement](_archive/2026-04-13-pua-inspired-enhancement/README.md) | v2.6.0 | [`cd6e73b`](../../../../commit/cd6e73b) | (self-contained in README) |
| 2026-04-13 | [universal-hooks-ship-b](_archive/2026-04-13-universal-hooks-ship-b/README.md) | v2.5.0 | [`817c707`](../../../../commit/817c707) | [plan](../plans/2026-04-12-universal-hooks.md) |
| 2026-04-12 | [methodology-agents-ship-a](2026-04-12-methodology-agents-ship-a/README.md) | v2.4.0 | [`14276bb`](../../../../commit/14276bb) | [plan](../plans/2026-04-12-methodology-agents-and-hooks.md) |

## Fix ships (no project dir — per dev-flow Fix-size convention)

Small batches that bump the version but don't warrant a project README. Source of truth: CHANGELOG entry.

| Date | Ship | Version | Merge |
|------|------|---------|-------|
| 2026-06-25 | scope-creep forcing function + OpenCode preflight retry — revived 2 commits from the stale `fix/scope-creep-gate-forcing-function` branch onto current develop (the 3rd, a now-obsolete BACKLOG nested-subagent proposal, dropped as superseded by v2.14.0). (1) S→L scope gate in `dev-flow`/`ceo-agent` becomes an `S-scope-gate` **TaskCreate** forcing function (surfaces before every commit) replacing passive markdown self-checks; adds a distinct L-scope-expansion → Board Decision path (maps to DOA "Resources 2x+"). (2) `preflight-portability.sh` `check_opencode_skill_discovery()` retries 3× to absorb the documented cold-start false negative | v2.25.5 | (this ship) |
| 2026-06-25 | finish-flow L-size branch cleanup — L-5 had no branch-delete sub-task (Fix `F.5`/Hotfix `H-9.5` did), so every L-ship leaked its `feat/*` branch (local + remote). Added **L-5.7 "Delete merged branch (local + remote)"** + hardened `F.5`/`H-9.5` to delete the remote too + synced the L-5 count 6→7 in `dev-flow`/`ceo-agent`. Not a git-config gap — git doesn't auto-delete local branches and GitHub auto-delete only fires on PR merges | v2.25.4 | (this ship) |
| 2026-06-24 | `cost-tracker` re-enabled — the **last disabled hook → 0**. Transcript-sum rewrite: reads `transcript_path` from the Stop payload + sums per-turn `message.usage` (the 2.1.186 Stop payload has no `usage` field); per-session cursor (`~/.claude/metrics/.cursors/`) avoids the per-turn double-count; cache-aware cost (read 0.1× / write 1.25× input). New `cost-tracker-lib.js` + `cost-tracker.test.js` (10 unit tests, e2e-verified vs a 287-turn transcript); opt-in via `settings.example.json`. Tally opt-in 11→12 / disabled 1→0 reconciled across the 4 descriptions + README/zh-TW/hooks tables + `check-hook-inventory.js` | v2.25.2 | (this ship) |
| 2026-06-24 | versioning bump rule documented (`CLAUDE.md` § Versioning — MINOR only for new skill/agent, everything else PATCH, pure docs/tests no-bump) + `sync-version.js` count-preservation fix (omitted `--opt-in-count`/`--disabled-count` now preserved from canonical, not clobbered to 7/0 — the v2.20.0 footgun) + `sync-version-preserve-counts.test.sh` regression guard. Dogfooded: bumped by omitting both flags | v2.25.1 | (this ship) |
| 2026-06-23 | re-enable parked hooks via the **`/dev/stdin`→fd-0** fix — the months-old "PreToolUse stdin permanently broken / blocked on #6305" diagnosis was over-broad: only the `/dev/stdin` PATH open ENXIOs, fd 0 carries the payload (e2e-verified 2.1.186, PreToolUse + Stop). **4 re-enabled opt-in**: `branch-protection` / `commit-secret-scan` / `large-file-warner` / `session-summary`. `cost-tracker` stays disabled — real blocker is the Stop payload having **no `usage` field** (needs transcript-sum rewrite), not stdin. Tally membership disabled 5→1 / opt-in 7→11; + `reenabled-blockers.test.sh` (49 test files) | v2.23.0 | (this ship) |
| 2026-06-22 | hook inventory single source of truth — `check-hook-inventory.js` derives 20 hooks (8 default-on / 7 opt-in / 5 disabled) from real wiring + gates counts AND tier membership; reconciled 4 canonical descriptions + README/hooks-README tables/badges; sync-version de-coupled from hook counts; + doc/-vs-docs/ ongoing-maintenance path leak fix + stray sweep | v2.19.1 | [`d875caf`](../../../../commit/d875caf) |
| 2026-06-15 | remove `.opencode/skills/` leftover (drift surface, not a mirror — OpenCode uses `.agents/skills/` symlink; portability-correction step 24 finally executed) | v2.17.2 | [`187a37c`](../../../../commit/187a37c) |
| 2026-06-12 | qc-panel node-scope rule (judges judge the node, not project lifecycle — fixes systematic shadow-fail) + tree-by-default in ceo-agent L-size setup + archive-ordering rule | v2.17.1 | [`1e833bd`](../../../../commit/1e833bd) |
| 2026-06-04 | standalone-fallback fix (think-tank-dialectic no longer hard-depends on voltagent) + brainstorm Phase-0 wiring + debug 3-fix architecture gate + reviewer→CC-native `/security-review` pointer; subagent-driven + writing-skills RED-phase CEO-deferred to BACKLOG ([plan](../plans/2026-06-04-internalize-superpowers-trio.md)) | v2.13.1 | [`c0d00d8`](../../../../commit/c0d00d8) |
| 2026-06-04 | internalize 3 superpowers caps → `brainstorm` skill (pre-code Socratic design gate) + `references/plan-template.md` + verification-before-completion 1-liner; dialectic descoped 3 proposed skills to 1 skill+1 template+1 edit ([plan](../plans/2026-06-04-internalize-superpowers-trio.md)) | v2.13.0 | [`b142972`](../../../../commit/b142972) |
| 2026-06-04 | reviewer claim-completeness (decompose stated claim → per-outcome external grounding or UNVERIFIED; claim-scope not diff-scope = unit of done; recall complement to v2.12.1 precision; prose sharpening not a new pass per review-verify-barrier §10) | v2.12.3 | [`7576db5`](../../../../commit/7576db5) |
| 2026-06-04 | team cap-3 clarification (collaborative coordination ≠ independent read-only fan-out, uncapped ~8) + non-goal: no parallel code-mutation via worktree (merge-back conflict cost) ([plan](../plans/2026-06-04-parallel-read-fanout.md)) | v2.12.2 | [`b67340a`](../../../../commit/b67340a) |
| 2026-06-04 | reviewer live-fact rule (documented vs live-system fact; Bash-verify-or-UNVERIFIED; ban argument-from-silence) + calibration + consumer verify-pushback; retires `reviewer-livefact-confabulation` 🔴; absorbed superpowers' cheap wins ([plan](../plans/2026-06-04-review-verify-barrier.md)) | v2.12.1 | [`b5bb995`](../../../../commit/b5bb995) |
| 2026-06-04 | `research-to-ship` skill (pinned research→plan→dialectic-loop→project→dev-flow pipeline; thin orchestrator delegating to existing skills; Workflow rejected — can't pause for human gates) | v2.12.0 | [`947a04d`](../../../../commit/947a04d) |
| 2026-06-04 | distill-consolidate `migrate` fix (rewrite frontmatter `name:` alongside dir rename — identity convergence needs both) | v2.11.1 | [`16407a7`](../../../../commit/16407a7) |
| 2026-06-04 | distill incremental cursor (`distill-scan.js --incremental`/`--new-only` per-session cursor; batch multi-select review gate + single push-back prompt) | v2.10.2 | [`5d29803`](../../../../commit/5d29803) |
| 2026-06-04 | distill onboarding hardening (fix broken `.gitignore` advice + `distill-sync-setup.sh` + guided first-run flow) | v2.10.1 | [`a6cf076`](../../../../commit/a6cf076) |
| 2026-06-02 | level-3 doc-rot batch (authored 2 missing canonical refs + validate.sh link-check hardening + test + BACKLOG hygiene) | v2.7.7 | [`2b5f6ed`](../../../../commit/2b5f6ed) |
| 2026-06-01 | hook-polish batch (symlink diag + failure-counter cleanup + malformed-flag self-heal) | v2.7.6 | [`c79e44c`](../../../../commit/c79e44c) |

## 歷史債 (Historical Debt — pre-2026-04-12, not retrofitted)

These L-size ships predate the `docs/projects/` convention. They are intentionally **not** retrofitted — creating retrospective project READMEs for already-merged work has theatrical value only. Source of truth for these ships: the plan doc + CHANGELOG entry.

| Version | Ship | Plan | Notes |
|---------|------|------|-------|
| v2.3.0 | L-1.6 skill routing forcing function | no plan doc | CHANGELOG entry only |
| v2.2.0 | [think-tank-dialectic](../plans/2026-04-11-think-tank-dialectic.md) | plan exists | plan has full design + review loop history |
| (earlier) | [skill-description-optimization](../plans/2026-03-26-skill-description-optimization.md) | plan exists | plan-only record |

**Retrofit policy**: do not retrofit these. If a historical ship needs reference, read its plan doc directly. The `docs/projects/` convention is forward-looking from v2.4.0 onwards.

### ⚠ Version-label note (2026-05-27)

The 2026-05-14 retro-roundup row originally claimed `v2.7.3`. Relabelled to `v2.7.2-followup` because that ship never bumped canonical `.claude-plugin/plugin.json` (which stayed at `2.7.2`). The first actual `v2.7.3` canonical bump is the 2026-05-27 multi-agent-portability-correction ship. See CHANGELOG.md v2.7.3 "Predecessor version-label note" for full reasoning.

## 規劃中 (Drafted — plan only, not yet started)

_None._

### Plan-only records (work shipped/absorbed — no project dir, kept for reference)

Triaged 2026-06-02 (level-3 `/next` deep scan found these unreferenced). Not retrofitted per the retrofit policy above — listed here so they are tracked, not orphaned.

| Plan | Status |
|------|--------|
| [2026-05-14-eval-router-judge](../plans/2026-05-14-eval-router-judge.md) | referenced in CHANGELOG (eval harness work) |
| [2026-05-14-reload-plugins-agent-invokable](../plans/2026-05-14-reload-plugins-agent-invokable.md) | referenced in CHANGELOG (reload-plugins work) |
| [2026-05-14-next-session-handoff](../plans/2026-05-14-next-session-handoff.md) | planning note, absorbed into context-handoff-hardening (v2.7.2) |
| [2026-05-14-powerloop-learnings](../plans/2026-05-14-powerloop-learnings.md) | retro/learnings note, absorbed into retro-roundup (v2.7.2-followup) |

## 歸檔 (Archived)

| Date | Project | Version |
|------|---------|---------|
| 2026-05-14 | [superpowers-coexistence](_archive/2026-05-14-superpowers-coexistence/README.md) | v2.7.0 |
| 2026-04-13 | [pua-inspired-enhancement](_archive/2026-04-13-pua-inspired-enhancement/README.md) | v2.6.0 |
| 2026-04-13 | [universal-hooks-ship-b](_archive/2026-04-13-universal-hooks-ship-b/README.md) | v2.5.0 |
