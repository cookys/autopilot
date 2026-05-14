# v2.7.0 Dogfood Routing Log — 2026-05-14

**Context**: After `feat/v2.7.0-superpowers-coexistence` merged to develop (`eb70999`) and dev-mode installed via `scripts/dev-setup.sh`, the 4 new fallback skills (`debug`, `test-strategy`, `team`, `profiling`) were validated against natural-language queries in **scenario B** (no `superpowers` plugin installed).

**Mechanism**: Each query was issued in a new user turn. Claude's routing instinct (which `Skill` tool call to make based on description match) was reported and compared against the expected target.

**Coverage**: 9 cases total — 4 trivial happy-path (each new skill), 3 ambiguous (description-surface overlap), 2 negative (should not trigger new skills).

---

## Cases

### Trivial happy-path — 4 v2.7.0 fallback skills

| # | Query | Expected | Routed | Confidence | Verdict |
|---|-------|----------|--------|------------|---------|
| B-1 | `the webhook handler panics on certain payloads` | `autopilot:debug` | `autopilot:debug` | HIGH | ✅ |
| B-2 | `the dashboard p99 went from 300ms to 2.5s` | `autopilot:profiling` | `autopilot:profiling` | HIGH | ✅ |
| B-3 | `set up a testing baseline before I refactor` | `autopilot:test-strategy` | `autopilot:test-strategy` | HIGH | ✅ |
| B-4 | `this L feature has BE+FE+DB — parallel or sequential?` | `autopilot:team` | `autopilot:team` | HIGH | ✅ |

All 4 new skills routed correctly with HIGH confidence. Description keyword surfaces clean.

### Ambiguous — description-surface overlap

| # | Query | Routed | Confidence | Verdict | Notes |
|---|-------|--------|------------|---------|-------|
| amb-1 | `the test is flaky — passes locally fails on CI` | `autopilot:debug` | MEDIUM | ✅ (legit ambiguity) | env-specific specific-symptom investigation → debug's "works on my machine" anti-pattern. test-strategy runner-up plausible but body's Test Failure Investigation funnel is more about classification during work, not env-divergence root-causing. **Lesson**: 「系統性 flaky 處理」phrasing → test-strategy; specific-symptom flaky → debug. Captured in eval files post-dogfood. |
| amb-2 | `the API got slower after we deployed yesterday` | `autopilot:profiling` | MEDIUM-LOW | ⚠️ (debug equally valid) | Performance regression with known change attribution. profiling primary on keyword surface ("slower"); debug equally valid as "find what changed". **Lesson**: real user flow is profile first (measure baseline) then look at deploy diff if profile inconclusive. dispatch-config chain ordering is the right place to express user preference, not description rewrite. |
| amb-3 | `starting work on the cross-tenant feature — needs BE + FE + DB migration` | `autopilot:dev-flow` | HIGH | ✅ | "starting work" is dev-flow's exclusive trigger; team description focuses on allocation question not work-start declaration. dev-flow internally dispatches to team at L-4 when needed — this is the correct entry point. |

### Negative — should NOT trigger new v2.7.0 skills

| # | Query | Routed | Confidence | Verdict | Notes |
|---|-------|--------|------------|---------|-------|
| neg-1 | `should we switch from REST to gRPC for internal services? want multiple perspectives` | `autopilot:think-tank` | HIGH | ✅ | "want multiple perspectives" is think-tank's exclusive trigger. survey runner-up plausible (tech comparison). **None of the 4 new skills falsely triggered** ✅. |
| neg-2 | `let's TDD this — write failing test first then implement` | `autopilot:dev-flow` / none | LOW | ⚠️ (real gap) | In scenario B with no `superpowers:test-driven-development`, no skill cleanly handles TDD. test-strategy description's "writing tests" keyword has weak surface match but body's `## Coexistence with Superpowers` section explicitly excludes TDD. dev-flow weakly matches via "let's...implement" trigger. **Real answer**: install superpowers, OR proceed manually with TDD-style work without a dedicated skill. **Documents real ecosystem gap, not v2.7.0 regression**. |

---

## Aggregate

- **Pass rate**: 7/9 clean + 2 borderline-but-acceptable
- **No false triggers** of 4 new skills on any negative case
- **No description regressions** observed in any existing skill from before v2.7.0

---

## Lessons → follow-up actions

1. **「系統性 flaky 處理」vs「specific flaky symptom」**: distinct routing targets (test-strategy vs debug). Captured in `skill-creator-workspace/evals/{debug,test-strategy}-evals.json` post-dogfood as positive/negative pair.
2. **Perf regression with change attribution**: routing-ambiguous by design. `dispatch-config.md` chain ordering (Methodology Preferences → Debugging vs Performance profiling) is the user-side knob; description rewrite primarily clarifies which skill claims ownership, chain expresses user preference.
3. **TDD gap in scenario B**: documented in CHANGELOG migration callout + skill body Coexistence section. Not a v2.7.0 bug.
4. **Description tightening shipped** (Fix-size follow-up, branch `fix/routing-tightening-v2.7.0-dogfood`):
   - `test-strategy` description: added explicit `Not for: TDD red-green-refactor cycle (→ superpowers:test-driven-development)` exclusion + `specific test debugging (→ debug)`
   - `profiling` description: claims `'got slower after deploy' — measure before assuming the deploy diff is the cause`, defers crashes → debug, defers slow-tests-by-design → test-strategy
   - `debug` description: claims `intermittent failures (incl. flaky tests with environment divergence), or 'works on my machine' issues`, explicitly defers perf regressions to profiling

### Fix-size waiver — single-reviewer per `.claude/dev-flow-config.md:118`

autopilot's dev-flow rule classifies skill description changes as L-size. This Fix-size single-reviewer cycle is a deliberate waiver. Justification (per reviewer accept):

- Changes are **narrow follow-ups** to v2.7.0 L-loop which already ran 3 parallel + 1 spot-check + Phase 1/3 quality gates + final pre-merge review
- Each rewrite is **evidence-grounded** in this dogfood log's 9 cases (not speculative description redesign)
- Eval files capture the new routing protocol behavior as regression baseline (committed in Phase B `773edff`)

Future description-change reviews should still default to L-size; this waiver applies only to the dogfood→Fix lineage.

---

## Coverage limitations

This dogfood log only validates **scenario B** (no superpowers). Scenarios not tested in-session:

- **Scenario A** (with superpowers installed): cross-skill chain delegation in dispatch-config. Requires `/plugin install superpowers@<marketplace>` in a future session.
- **Scenario C** (superpowers user-level, pure-autopilot per-project via `.claude/settings.json` `disabledSkills`): requires A as precondition.
- **Real Claude routing in non-Claude-Code clients**: this session is itself Claude Code. Other clients (e.g., embedded SDK use) may route differently.

These are documented as deferred verification in plan §7 success criterion footnote.

---

## File references

- Plan: [`../../plans/2026-05-14-superpowers-coexistence.md`](../../../plans/2026-05-14-superpowers-coexistence.md)
- Project README: [`README.md`](README.md)
- CHANGELOG: [v2.7.0 entry](../../../../CHANGELOG.md)
- Eval files updated post-dogfood: `skill-creator-workspace/evals/{debug,test-strategy,profiling}-evals.json` (commit forthcoming on `fix/routing-tightening-v2.7.0-dogfood`)
