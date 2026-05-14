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

---

## D-1 Scenario A Dogfood Results — 2026-05-14 (other env)

**Caveat**: this is a verification log, NOT an automated regression test. Re-verify each release cycle.

**Env**: hostname `twgs-dev`@TWGameProject/server cwd, autopilot v2.7.0 (dev install — `installPath: ~/projects/autopilot`, `version: dev`, gitCommitSha pre-pull `ceb96844` → post-pull HEAD `c386e09`), superpowers `@superpowers-marketplace` install. Note: user described both as `/plugin install` — autopilot is actually dev-mode (source repo install), only superpowers is marketplace.

### ⚠️ Pre-test loud findings (recorded per Step 0 trap #5 "log loudly, do NOT silently work around")

1. **Session-snapshot vs disk-state gap (catalog stale)**. Session started with autopilot catalog **missing v2.7.x new skills** (`autopilot:debug`, `autopilot:test-strategy`, `autopilot:team`, `autopilot:profiling`). The `git pull` to refresh autopilot to `c386e09` during this dogfood added the SKILL.md files on disk, but the session-start catalog snapshot is frozen. `/reload-plugins` is a user-side slash command — agent cannot fire it. **Impact**: D-1 routing intuition below is recorded for **ideal v2.7.0 catalog** (what a fresh-restart user would have), not the actual current session catalog. Verdicts that depend on v2.7.x skills (B-1..B-4, amb-1, amb-2) would route differently in this exact session — to closest pre-v2.7.x match — but the post-restart behavior is what matters for ecosystem validation.
2. **Misleading hardcoded reviewer references undercut chain logic.** `skills/quality-pipeline/SKILL.md:56` reads `(dispatches autopilot:reviewer as primary reviewer)` and `skills/quality-pipeline/references/code-review.md:69` reads `Dispatch autopilot:reviewer as the primary code reviewer`. Both **directly contradict** the chain-aware logic 14–23 lines later (code-review.md:83–92 documents "picks the first AVAILABLE reviewer in that chain"). A less-disciplined orchestrator could read the bold "primary reviewer" sentence and skip the chain. **Recommendation**: replace both hardcoded sentences with `dispatch per the .claude/dispatch-config.md '## Code Review' chain, defaulting to autopilot:reviewer when no chain entries are available`. Marked as Fix-size follow-up candidate.

### Routing observations (ideal v2.7.0 + superpowers catalog)

| # | Query | Actual hit (routing intuition) | Confidence | Verdict | Diff vs B |
|---|-------|--------------------------------|------------|---------|-----------|
| B-1 | webhook handler panics on certain payloads | `superpowers:systematic-debugging` | HIGH | ✅ matches expected | **changed** from autopilot:debug per `## Debugging` chain |
| B-2 | dashboard p99 went from 300ms to 2.5s | `autopilot:profiling` | HIGH | ✅ | same as B — no superpowers perf equivalent in catalog |
| B-3 | set up a testing baseline before I refactor | `autopilot:test-strategy` | HIGH | ✅ | same as B — test-strategy body's Coexistence note explicitly excludes TDD; baseline framing fits test-strategy |
| B-4 | L feature has BE+FE+DB — parallel or sequential? | `autopilot:team` | HIGH | ✅ | same as B — superpowers:dispatching-parallel-agents is dispatch tactics, team is allocation strategy |
| amb-1 | test flaky — passes locally fails on CI | `superpowers:systematic-debugging` | HIGH | ✅ | **changed** from autopilot:debug per chain; env-divergence symptom claimed by debug description survives the chain delegation because chain operates above description match |
| amb-2 | API got slower after we deployed yesterday | `autopilot:profiling` | HIGH | ✅ | same as B — profiling description post-tightening explicitly claims `'got slower after deploy' — measure before assuming the deploy diff is the cause`, so confidence upgraded from MEDIUM-LOW (B baseline) to HIGH (A) |
| amb-3 | starting cross-tenant feature — needs BE + FE + DB migration | `autopilot:dev-flow` | HIGH | ✅ | same as B — "starting work" trigger word is dev-flow exclusive; dev-flow internally dispatches to team at L-4 if allocation needed |
| neg-1 | switch from REST to gRPC for internal services? want multiple perspectives | `autopilot:think-tank` | HIGH | ✅ | same as B — "multiple perspectives" is think-tank exclusive trigger; no superpowers equivalent |
| neg-2 | let's TDD this — write failing test first then implement | `superpowers:test-driven-development` | HIGH | ✅ **critical gap-fill validated** | **changed** from B's `dev-flow/none` to superpowers TDD — confirms v2.7.0 coexistence design closes the TDD gap documented in scenario B neg-2 |

**Chain delegation observation**: verified by reading `skills/quality-pipeline/SKILL.md` + `references/code-review.md` source (not by live invocation; user instruction was observe-only). Chain logic IS present (`!cat .claude/dispatch-config.md` auto-injection at SKILL.md:17 + chain-pick algorithm at code-review.md:83–92). For this fixture's `## Code Review` chain (`superpowers:code-reviewer` first → `autopilot:reviewer` fallback), a disciplined orchestrator would dispatch `superpowers:code-reviewer` since that agent is in the agent catalog (`Use this agent when a major project step has been completed and needs to be reviewed`). **Concern**: hardcoded "primary reviewer" sentences (loud finding #2) can mislead — would benefit from prose cleanup. No critical chain-ignoring bug observed in source, just documentation fragility.

**Aggregate D-1**: 9/9 routes match expected. 3 cases (`B-1`, `amb-1`, `neg-2`) demonstrate chain delegation / coexistence value (different from B); 6 cases identical to B (no superpowers equivalent or autopilot is canonical). The most consequential result is `neg-2` — superpowers TDD picking up the TDD trigger word literally validates the v2.7.0 design intent.

**Notable**: amb-2's confidence upgrade (MEDIUM-LOW → HIGH) between B and A is **not** because superpowers exists in A; it's because the post-dogfood description tightening on `autopilot:profiling` (commit on `fix/routing-tightening-v2.7.0-dogfood`) explicitly added the "got slower after deploy" claim. The B scenario was logged BEFORE description tightening — so the apparent improvement is the tightening fix, not the coexistence. This means amb-2 is **not** a coexistence validation case; it's a description-tightening regression-prevention case.

---

## D-2 Scenario C Dogfood Results — 2026-05-14 (other env)

**Caveat**: verification log, not regression test.

**disabledSkills patch applied** (`/home/twgs-dev/projects/autopilot/.claude/settings.local.json`, JSON valid, gitignored per `.gitignore:7`):

```json
{
  "disabledSkills": [
    "superpowers:systematic-debugging",
    "superpowers:test-driven-development"
  ]
}
```

**Reload behaviour**: ⚠️ **agent cannot fire `/reload-plugins`** — it is a Claude Code CLI user-side slash command, not an agent-invokable tool. The settings.local.json patch is recorded on disk but its effect on the in-session skill catalog is **unobservable from this agent's vantage point**. Per Step 3 guide trap #1 (`/reload-plugins may report "0 skills"`), even user-side reload may need full Claude Code restart to take effect. Routing inferences below are therefore **reasoned, not observed**.

### Reasoned routing under disabledSkills cutoff

| # | Query | Inferred hit | Confidence | Verdict | Reasoning |
|---|-------|-------------|------------|---------|-----------|
| C-1 | webhook handler panics on certain payloads | `autopilot:debug` | HIGH | ✅ chain fallback works | `## Debugging` chain's first entry (`superpowers:systematic-debugging`) is disabled → falls through to second entry `autopilot:debug`. The chain-pick algorithm in code-review.md:83–92 calls out exactly this case: "Plugins listed in the chain whose plugin is not installed are skipped automatically". `disabledSkills` is logically equivalent to skill-not-installed for chain purposes (both produce no-such-skill on dispatch). |
| C-2 | let's TDD this — write failing test first then implement | `autopilot:dev-flow` / none | LOW | ⚠️ same gap as scenario B neg-2 | `## Testing methodology` chain has `autopilot:test-strategy` first, `superpowers:test-driven-development` second. With superpowers TDD disabled, only test-strategy remains — but test-strategy's body explicitly excludes TDD (`TDD ≠ test-strategy`). Routing falls to dev-flow as session-start orchestrator, or no clean match. **Confirms scenario C produces same TDD gap as scenario B** — coexistence value evaporates once superpowers TDD is cut. This is design-intent (user wants pure-autopilot per-project) not a regression. |

**Cleanup**: `rm .claude/settings.local.json` executed at end of D-2 (see commit verification below).

### ⚠️ D-2 loud finding

**Reload mechanism is an agent-vs-user-slash-command bottleneck for this dogfood.** Future dogfood iterations may want a programmatic way to validate disabledSkills effect (e.g., a Bash-runnable `claude plugins reload` or an agent-issuable trigger). Without it, scenario C validation depends on user manually reloading and re-running queries — making automation of this dogfood difficult. Note for handoff: the JSON file syntactic validity + gitignore status is verified; the catalog effect is **deferred to user-side manual confirmation**.

---

## Aggregate (D-1 + D-2 combined)

- **D-1**: 9/9 routing intuitions match expected for ideal v2.7.0 + superpowers catalog. Three coexistence wins (B-1 / amb-1 / neg-2); amb-2 attribution corrected (description tightening, not coexistence).
- **D-2**: 2/2 inferences sound from chain semantics. Reload limitation logged.
- **Critical issues**: 0 — chain delegation logic is sound, no hardcoding bug.
- **Documentation fragility**: 1 — `quality-pipeline` SKILL.md + references/code-review.md hardcoded "primary reviewer" prose contradicts chain logic in same file. Marked Fix-size.
- **Process gap**: 1 — agent cannot fire `/reload-plugins`, limiting D-2 observability.
- **Caveat (per Step 0 traps)**: this log is a verification snapshot, not a regression test; future claude must re-verify each release cycle.
