# autopilot — Projects Index

> autopilot's project tracking index. Established 2026-04-12 during the v2.4.0 methodology-agents ship, replacing the previous plan-only convention.
>
> **Why this exists**: dev-flow L-1 mandates creating a project dir for every L-size work. autopilot's earlier L-ships accumulated skips against this mandate because `docs/projects/` did not exist. 2026-04-12 formalizes this layer: every L-ship from v2.4.0 onwards gets a project dir under `docs/projects/YYYY-MM-DD-<name>/` with a `README.md` tracking OKR / phases / progress.

## 進行中 (In Progress)

_None._

## 已完成 (Completed)

| Date | Project | Version | Merge | Plan |
|------|---------|---------|-------|------|
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
