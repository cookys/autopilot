# Changelog

## v2.3.0 — L-1.6 skill routing forcing function

### Added

- **`dev-flow` L-1.6 Skill routing TaskCreate** — new mandatory parent task at L-1 alongside
  the existing L-5 `finish-flow` parent. Applies the passive→active TaskCreate forcing
  function pattern (first proven at L-5) to skill routing:
  - Parent task "L-1.6: Skill routing — invoke required skills for all affected code areas"
    must be created at L-1 time. Missing it = failed L-1 gate.
  - Input is the module list produced by L-1.5 Scope Completeness Audit.
  - Completion criteria: every required project skill actually invoked via the Skill tool
    (reading the skill file is explicitly NOT invoking), plus a one-line "what this skill
    told me for this task" note captured in session context.
  - **Phase tasks (P0..PN) must be created with `blockedBy=[L-1.6]`** — this is the
    mechanical layer: phases literally cannot start until skill routing completes. Two
    layers of defense: system-reminder surfaces the pending parent, and the blockedBy
    dependency makes implementation unclaimable.
- **`dev-flow` Anti-patterns** — three new rows covering the failure modes L-1.6 is
  designed to block: "skip because I already read CLAUDE.md", "create phase tasks
  without blockedBy", and "mark L-1.6 completed after reading skill markdown".
- **`dev-flow` Pre-implementation Checklist** — three new L-size rows covering L-1.5
  audit, L-1.6 skill routing parent, and phase-task blockedBy dependency.
- **`dev-flow` Phase 1 Session Start gate 6** — now cross-references L-1.6 as the active
  enforcement (gate 6 alone is passive markdown, retained as documentation).
- **`dev-flow` L-1.5 Scope Audit** — now explicitly "feeds into L-1.6", so the module
  list cannot be dropped on the floor between audit and phase start.

### Background

On 2026-04-11, the `reconnect-regression-fix` session ran a full fix workflow against
`src/network/`, `src/lobby/`, and E2E tests without invoking any of the project's `twgs-*`
skills (`twgs-network`, `twgs-debug`, etc). The existing "Skill routing" bullet in the
L-size Full Gates section (Phase 1 Session Start, gate 6) is passive markdown and got
mentally compressed into "I know this area" — the exact same failure mode that L-5 closing
hit before `finish-flow` replaced inline markdown with active TaskCreate.

The `dev-flow-l5-enforcement` project (v2.2.0) proved that passive→active TaskCreate works
for closing discipline. The Residual Gaps section of its Phase 5 dogfood walkthrough
explicitly flagged skill routing as out-of-scope at the time, to be addressed if the same
incident recurred. It recurred the same day. v2.3.0 applies the proven pattern to the
second gate.

Missing skill invocations don't produce immediate bugs — they systematically waste the
knowledge base the project has invested in, and they're invisible until post-merge review
spots a pattern the relevant skill would have flagged. This release surfaces the failure
at L-1 time where it's cheap to fix.

### Dogfood trace

This release was itself developed under dev-flow S workflow (not L) because the scope is a
single file edit plus mandatory version sync. The v2.2.1 L-1.5 audit dimensions were
walked:
- Source + tests: `skills/dev-flow/SKILL.md` ✅
- User-facing docs: CHANGELOG entry (this section) ✅
- Version bump (semver): 2.2.1 → 2.3.0 (new feat, backwards-compatible) ✅
- Version sync verification (grep): `grep "2\.2\.1"` across repo returned 6 hits, all
  addressed — plugin.json, marketplace.json, README.md badge, README.zh-TW.md badge,
  CHANGELOG.md (new header), SKILL.md line 361 (historical reference, intentionally left)
- Credit / attribution: N/A (pure internal process improvement)
- Dogfood target: ✅ this file IS the target; the new forcing function applies to future
  autopilot L-size work immediately after reload

### Files changed

- `skills/dev-flow/SKILL.md` (L Workflow task tracking block, L-1.5 feeds-into line,
  Phase 1 gate 6 cross-reference, Anti-patterns +3 rows, Pre-implementation Checklist +3 rows)
- `.claude-plugin/plugin.json` (2.2.1 → 2.3.0)
- `.claude-plugin/marketplace.json` (2.2.1 → 2.3.0)
- `README.md` (version badge 2.2.1 → 2.3.0)
- `README.zh-TW.md` (version badge 2.2.1 → 2.3.0)
- `CHANGELOG.md` (this entry)

---

## v2.2.1 — L-1.5 audit: credit + version-sync dimensions

### Added

- **`dev-flow` L-1.5 dimensions checklist** — two new rows added to the Scope Completeness Audit:
  - **Version sync verification (grep)** — any version bump must `grep` the old version string across all tracked files (no pre-filter by extension — tomorrow's repo may add `.toml` / `Dockerfile`). If grep returns N hits, the edit list must touch all N. Enumerating from memory is the failure mode.
  - **Credit / attribution** — any feature absorbing external OSS, prior art, or third-party design must update README's `Inspired By` / credits / acknowledgements section as part of the same release.
- **`ceo-agent` SKILL.md anti-patterns** — two new rows mirroring the new dimensions: "bump version in one file from memory without grepping" and "absorb external OSS / prior art design without crediting source".
- **`dev-flow` L-1.5 historical rationale** — additional paragraph explaining why these two rows were added (the v2.2.0 dual near-miss).

### Background

v2.2.0 (`think-tank-dialectic`) walked the L-1.5 dimensions checklist correctly but still had two near-misses:

1. **`marketplace.json` version bump was missed** — `autopilot:quality-pipeline` caught it after the main commit had already landed. The audit's existing `Version bump (semver)` row correctly triggered, but the audit was walked from memory and the edit list forgot one of the two version files. A `grep "2.1.1"` would have surfaced both immediately.
2. **README `Inspired By` credit was missed** — the user pointed out post-merge that the two source repos (`agora`, `council-of-high-intelligence`) were not credited. The dimensions checklist had no row for attribution at all, so even a careful audit could not have caught it.

Both failures share a root cause: the audit was *enumerated* rather than *grepped*, and one whole dimension (attribution) was missing from the checklist. v2.2.1 fixes both: grep becomes the default for version bumps, and attribution joins the dimensions list as a first-class row.

This release dogfoods both new dimensions: the first action of the v2.2.1 session was `grep "2.2.0"` across the autopilot repo to enumerate all live references before editing, and the credit dimension was checked (N/A — pure internal process improvement, no external OSS absorbed).

### Scope Completeness (L-1.5 walkthrough)

7 files in this release:

**0 new** (process tightening, no new artifacts).

**7 modified**:
- `skills/dev-flow/SKILL.md` (2 new dimension rows + historical rationale paragraph)
- `skills/ceo-agent/SKILL.md` (2 new anti-pattern rows)
- `CHANGELOG.md` (this entry)
- `.claude-plugin/plugin.json` (2.2.0 → 2.2.1)
- `.claude-plugin/marketplace.json` (2.2.0 → 2.2.1)
- `README.md` (version badge 2.2.0 → 2.2.1)
- `README.zh-TW.md` (version badge 2.2.0 → 2.2.1)

Skill count unchanged at 12 (no new skill). No public skill API changes.

---

## v2.2.0 — think-tank-dialectic: Hegelian dialectic for hard decisions

### Added

- **`think-tank-dialectic` skill** — structured Hegelian dialectic (Thesis → Antithesis → Synthesis) for irreversible or high-stakes decisions where two positions have genuine merit. **NOT** a "better think-tank" — a different tool for a different situation. 6 roles: 4 職能 (architect / product / ops-sre / qa-devil via voltagent) + 2 adversarial (Falsifier Popper-style / Inverter Munger-style via general-purpose with inline prompts). Two rounds: R1 independent blind analysis + optional R2 Hegelian cross-examination with forced thesis/antithesis declaration. Outputs Advance Decision Brief with Hegelian Arc, first-class Minority Report, Epistemic Diversity Scorecard self-eval, and sharp distinction between Unresolved Questions (factual gaps — can be researched) and Questions Only You Can Answer (value/preference — human must decide).
- **`think-tank-dialectic` Grounding Protocol** — 5 hard rules preventing "dialectic-for-the-sake-of-dialectic" overuse:
  - Rule 1: Max 2 rounds (no R3)
  - Rule 2: Session-scoped re-entry guard (3rd invocation on same topic → refuse with escape hatch)
  - Rule 3: HIGH consensus auto-downgrade (≥5/6 aligned → skip R2, output Downgrade Brief, recommend `think-tank` next time)
  - Rule 4: Turn-count budget (`dispatched_count > 12` without brief → emergency interim brief)
  - Rule 5: R2 hemlock rule targeting drifting agents (adversarial roles specifically)
- **`think-tank-dialectic` adversarial drift mitigations** — 4 concrete protections against `general-purpose` subagents softening over 2 rounds: R2 full prompt re-injection, verbatim concrete example moves in role prompts, front-weighted anti-drift anchor sentence, hemlock enforcement scan

### Changed

- **`think-tank` SKILL.md** — added escalation path note in "When to Use" (LOW consensus + irreversible → recommend `think-tank-dialectic`) and added `think-tank-dialectic` to "See Also" table. Existing think-tank workflow unchanged — no breaking change
- **`think-tank` brief-template.md** — Decision Brief footer now includes an `### Escalation Recommendation` section that checks R1 consensus level and recommends escalation to dialectic only when LOW consensus meets irreversible decision
- **`ceo-agent` SKILL.md** — added `think-tank-dialectic` to CEO's autonomous skill list, renamed boundary section to "Boundary with survey, think-tank, and think-tank-dialectic" with expanded trigger table, added dedicated "Think Tank Dialectic escalation rules" subsection specifying when CEO must escalate (LOW think-tank consensus + irreversible + both positions have genuine merit + CEO is genuinely willing to commit either way) and when NOT to escalate
- **`hooks/session-start.sh`** — routing table now includes `think-tank-dialectic` row (`"Irreversible decision, genuine stalemate, Hegelian dialectic, 不可逆決策, 兩邊都有道理, 辯證一下"`) so new sessions discover the escalation target
- **README.md + README.zh-TW.md** — skill count 11 → 12, version badge 2.1.1 → 2.2.0, skill count badge 11 → 12, skill table row added, design philosophy section updated

### Background

Completed a full scan of two open-source Claude Code skills: [agora](https://github.com/geekjourneyx/agora) (6 審議室, 31 思想家, 8-step dialectic protocol) and [council-of-high-intelligence](https://github.com/0xNyk/council-of-high-intelligence) (18-member council with enforcement mechanisms). Three key design insights were extracted and absorbed into autopilot:

1. **Every thinking style must carry its own fail-safe** — 100% of the 31 reference agents have a `## Grounding Protocol` section with 3-5 hard rules constraining their own overuse (e.g., Feynman max 2 analogies, Socrates 3-level depth limit on questioning, Popper max 1 analogy). This is the meta-pattern that makes multi-agent deliberation work: single LLMs fail because they have no limits, multi-agent structures force each voice to declare its own.
2. **The core of dialectic is Hegelian (Thesis → Antithesis → Synthesis), not consensus-finding** — `think-tank` maps perspectives; `think-tank-dialectic` resolves genuine stalemates through forced transcendent synthesis (must NOT be compromise).
3. **think-tank-class tools split into two types, not two depths**: "multi-perspective map" (frequent, low cost — think-tank) vs "structured dialectic" (rare, high cost — dialectic). Merging them into `--depth full` flag would erase the friction that keeps dialectic from being reflexively invoked. Separate skill enforces cost discipline.

### Scope Completeness (L-1.5 walkthrough)

16 files in this release:

**8 new**:
- `docs/plans/2026-04-11-think-tank-dialectic.md` (plan doc)
- `skills/think-tank-dialectic/SKILL.md`
- `skills/think-tank-dialectic/references/role-prompts.md`
- `skills/think-tank-dialectic/references/brief-template.md`
- `skills/think-tank-dialectic/references/problem-restate-gate.md`
- `skills/think-tank-dialectic/references/silent-pre-check.md`
- `skills/think-tank-dialectic/references/minority-report.md`
- `skills/think-tank-dialectic/references/epistemic-diversity-scorecard.md`

**8 modified**:
- `.claude-plugin/plugin.json` (version bump)
- `CHANGELOG.md` (this entry)
- `README.md` (skill count, badges, skill table, design philosophy)
- `README.zh-TW.md` (same)
- `hooks/session-start.sh` (routing table row)
- `skills/ceo-agent/SKILL.md` (autonomous skill list, boundary section, escalation rules)
- `skills/think-tank/SKILL.md` (escalation note, See Also row)
- `skills/think-tank/references/brief-template.md` (footer Escalation Recommendation)

Survey skill's boundary comment was evaluated but intentionally not changed — `think-tank` remains the single entry for strategic questions, and dialectic is discovered via think-tank's LOW-consensus escalation to preserve cost discipline.

### Phase 2 deferred (not shipped)

Four mechanisms are explicitly deferred pending Phase 1 real-session feedback:
- Forced Synthesis (R2 禁止選邊 — currently Synthesis Proposal exists but is not enforced)
- Novelty Gate (R2 must have new arguments vs R1)
- Counterfactual Trigger at >70% agreement (currently Dissent Quota exists but no auto-steelman)
- Anti-Recursion rules (Socrates-style 3-level depth limit)

Phase 2 triggers when ≥3 real dialectic sessions reveal: dissent quota failures, synthesis degrading to compromise, or user feedback showing brief didn't change the decision. If Phase 1's 4 core mechanisms prove sufficient, Phase 2 remains unshipped.

---

## v2.1.1 — L-1.5 Scope Completeness Audit

### Added
- **`dev-flow` L-1.5 Scope Completeness Audit** — mandatory discrete TaskCreate before phase enumeration. Walks a dimensions checklist (source/tests/docs/API/templates/CHANGELOG/version/migration/consumers/dogfood) and requires each "yes" row to be either phased or explicitly marked out-of-scope in README. Prevents the failure mode where a correctly-executed phase plan ships an incomplete deliverable because the scope missed user-facing surfaces.
- **`ceo-agent` Execution step 3e** — CEO mandate to run the scope audit BEFORE phase TaskCreate (renumbered prior step 3e to 3f for the phase/L-5-parent TaskCreate). Plus anti-patterns covering "skip audit because obvious" and "enumerate phases before audit".

### Background
2026-04-11 `dev-flow-l5-enforcement` project initially shipped the `finish-flow` skill but missed the autopilot-side user-facing surface (README skill count, CHANGELOG entry, template example, plugin version bump). The source-code dimension was complete; the docs dimension was invisible. `finish-flow` enforces closing discipline — it cannot recover a phase plan that never contained the docs phase in the first place. This is a different failure mode that belongs at L-1 (scope), not L-5 (closing). The audit is the L-1 counterpart to the L-5 forcing function: both are active TaskCreate items that cannot be silently compressed.

### Note on v2.1.0
The `v2.1.1` release itself is the first dogfood of the new audit. Had the audit existed 2 hours earlier, `v2.1.0` would have shipped with docs in a single commit instead of two.

---

## v2.1.0 — finish-flow Forcing Function

### Added
- **`finish-flow` skill** — size-aware closing sequence forcing function. On invocation, immediately `TaskCreate`s size-appropriate discrete sub-tasks (L=6, H=6, Fix=5, S=3) each with explicit verification output. Solves the "passive markdown gets mentally compressed" failure mode that caused repeated L-5 skips in real projects.
  - L-size: Final Goal Review → Pre-Merge Review → Merge → Post-Merge Review → Archive → L Session End
  - H-size: Verify fix → Quality gate → Merge to main → Post-incident learn (MANDATORY) → Delete hotfix branch → Session end
  - Fix-size (5 tasks) and S-size (3 tasks) are OPTIONAL — finish-flow is only enforced for L and H to preserve lightweight-workflow constraints
- **`project-config-template/finish-flow-config.md`** — template for project-specific closing overrides (merge target branch, archive procedure, per-size quality gate, known pitfalls)

### Changed
- **`dev-flow` L-1** now MANDATORILY creates a parent closing `TaskCreate` (`"L-5: Invoke autopilot:finish-flow"`) alongside phase tasks. Parent task stays pending through all phases and is surfaced by system-reminder after every tool use — the forcing function that makes the closing sequence unskippable
- **`dev-flow` L-5** — inline 6-step closing sequence replaced with "invoke `autopilot:finish-flow`". The skill owns the closing sequence via discrete TaskCreate items
- **`dev-flow` H workflow** — step 4 now delegates to `finish-flow` (same forcing function, H-size branch). H-1 mandates parent `"H-9: Invoke autopilot:finish-flow"` TaskCreate
- **`dev-flow` anti-patterns** — +4 rows covering skipped L-1 parent TaskCreate, inlined closing, premature parent completion, batched sub-task TaskCreate
- **`ceo-agent`** — merge-to-develop clarified as within CEO DOA (tactical, locally reversible; merge-to-main still requires Board approval). Execution steps updated to mandate parent closing TaskCreate and finish-flow invocation without pausing between sub-tasks. +3 anti-patterns
- **`project-config-template/dev-flow-config.md`** — new "L-5 / H-9 Closing Forcing Function" section explaining how to reference finish-flow
- **README / README.zh-TW** — skill count 10 → 11, finish-flow row added to skill table and config table

### Background
L-5 completion was silently skipped on 2026-03-17 and 2026-04-11 across different projects. Prior fixes tried bolder markdown, expanded sub-steps, explicit anti-patterns — all passive text, all mentally compressed into "one action" under time pressure. The only mechanism in Claude Code that produces **active** reminders is `TaskCreate` (surfaced by system-reminder after every tool use). This release converts closing-sequence enforcement from passive text to active task reminders. Core insight: the forcing function turns **passive skipping** (forgetting, compressing) into **active cheating** — good-faith operators will not cross the latter line.

### Migration
No config changes required. Existing `.claude/dev-flow-config.md` keeps working. Optionally drop `.claude/finish-flow-config.md` into projects that need closing-sequence overrides — see `project-config-template/finish-flow-config.md`.

---

## v2.0.0 — Rule-Setter Architecture

**Breaking:** Autopilot no longer competes with built-in Superpowers. It sets the rules; Superpowers executes.

### Changed
- **`dev-flow` gained Session Rules** — persistent config injection directives that tell the model to read project config files when debugging, testing, profiling, or dispatching teams. These rules complement Superpowers' tactical skills with project-specific context.
- **`quality-pipeline` slimmed** — keeps pipeline orchestration (test → scan → completeness → review), delegates step methodology.
- **`project-lifecycle` slimmed** — keeps bootstrap/structure, delegates branch finishing mechanics.
- **`audit` config injection activated** — was commented out, now silent `!`cat``.
- **All config fallbacks changed to silent** — `2>/dev/null` without `|| echo`. No noise for projects without config files.

### Removed
- **`debug`** — replaced by dev-flow session rule + superpowers:systematic-debugging
- **`test-strategy`** — replaced by dev-flow session rule + superpowers:test-driven-development
- **`team`** — replaced by dev-flow session rule + superpowers:dispatching-parallel-agents
- **`profiling`** — replaced by dev-flow session rule (methodology was generic; config injection is what matters)

### Migration
Your `.claude/*-config.md` files still work unchanged. `dev-flow` now tells the model to read them via session rules instead of dedicated skills. No config file changes needed.

If you relied on `autopilot:debug`, `autopilot:test-strategy`, `autopilot:team`, or `autopilot:profiling` as explicit skill invocations: invoke them via their Superpowers equivalents (`superpowers:systematic-debugging`, `superpowers:test-driven-development`, `superpowers:dispatching-parallel-agents`) — dev-flow's session rules ensure your project config is still read.

---

## v1.4.4
- Enhanced `ceo-agent` — added cognitive layer inspired by gstack's CEO review agent:
  - **Cognitive Patterns**: 10 thinking instincts (Bezos doors, Munger inversion, Jobs subtraction, Grove paranoia, Altman leverage) that shape tactical decisions within DOA
  - **Boil the Lake**: completeness principle — AI makes marginal cost near-zero, always choose complete over shortcut
  - **Prime Directives**: 5 execution principles (zero silent failures, named errors, shadow paths, 6-month horizon, permission to scrap) complementing quality-pipeline
  - **Scope Mode**: 4 postures (Expand/Selective/Hold/Reduce) chosen at startup, governs opportunity handling throughout execution
  - Fixed startup count, clarified Scope Mode vs DOA interaction, added Scope Opportunities to CEO Report template

## v1.4.3
- Enhanced `dev-flow` — added Fix workflow for bug fixes (any module count, no plan/project needed, ongoing-maintenance audit trail); restructured Quick Decision to separate nature (Fix/H) from size (S/L); fixed H scope check; updated session start/end to cover Fix
- Added scope creep detection to `dev-flow` — auto-escalate S→L when scope grows (3+ commits, 3+ modules)
- Fixed `ceo-agent` — CEO mode now **mandates** project setup for L-size (was text suggestion, now hard gate)
- Added 4 anti-patterns to `ceo-agent` covering project tracking bypass

## v1.4.2
- Activated config injection for `debug` and `test-strategy` skills (were commented out, inconsistent with other skills)
- Rewrote `dev-setup.sh`: symlinks cache dir to local clone (Claude Code only loads from `~/.claude/plugins/cache/`); requires one-time `/plugin install` first

## v1.4.1
- Added `scripts/dev-setup.sh` — one-command dev mode setup (points plugin registry at local clone, skips cache)
- Added Development section to README / README.zh-TW

## v1.4.0
- Enhanced `dev-flow` — unified session lifecycle (absorbed session-start, session-end, goal-check, context-reduce); H-size hotfix workflow, user override protocol
- Enhanced `learn` — session learning summary for L-size tasks; merged memory-health (knowledge health audit)
- Enhanced `next` — merged improvement-queue into Phase 0
- Merged proposal concept into plans (draft/approved status) — overlap check moved to project-lifecycle bootstrap
- Added `test-strategy` — test pyramid, baseline management, feature flag levels
- Added `audit` — systematic comparison between implementations
- Added `debug` — evidence-first debugging (broader than profiling: crashes, bugs, connectivity)
- Enhanced `quality-pipeline` — pre-existing error cleanup, dispatch decision tree
- Enhanced `project-lifecycle` — archive eligibility check, stale entry sweep
- Added `scripts/validate.sh` — skill validation script

## v1.3.0
- Added `profiling` — evidence-first performance profiling methodology, tool selection, interpretation
  - Injects from `.claude/profiling-config.md`

## v1.2.0
- Added `next` — global work recommender (scan → rank → recommend)
- Added `team` — multi-agent parallelization with dependency analysis
- Added `improvement-queue` — process pending maintenance suggestions

## v1.1.0
- Added `quality-pipeline` — unified quality gate with project config injection
- Added `project-lifecycle` — plan → bootstrap → structure → archive
- Added `memory-health` — MEMORY.md audit, knowledge staleness detection

## v1.0.0
- Initial release: dev-flow, survey, think-tank, ceo-agent, learn, retro, context-reduce
