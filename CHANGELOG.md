# Changelog

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
